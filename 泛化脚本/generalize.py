#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片泛化脚本 —— 数据飞轮第 7 步（两段式的第二段）

作用：
    读取评测工具导出的「泛化数据包.csv」，以「已标注」数据为种子，
    在「未抽样」数据中检索视觉相似的图片，输出相似数据的 URL 列表。

流程：
    读 CSV → 并发下载图片(带缓存) → DINOv2 提取特征 → FAISS 建索引 → 检索 → 输出 CSV

用法：
    python generalize.py --input 泛化数据包.csv --output 相似数据结果.csv

依赖安装：
    pip install -r requirements.txt
"""

import argparse
import os
import sys
import time
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


# ============ 参数 ============

def parse_args():
    p = argparse.ArgumentParser(
        description='图片泛化：以已标注数据为种子，在未抽样数据中检索相似图片',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument('--input', '-i', required=True, help='评测工具导出的「泛化数据包.csv」路径')
    p.add_argument('--output', '-o', default='相似数据结果.csv', help='输出 CSV 路径')
    p.add_argument('--cache', default='./image_cache', help='图片缓存目录（重跑复用，避免重复下载）')
    p.add_argument('--topk', type=int, default=20, help='每张种子图返回多少条相似结果')
    p.add_argument('--threshold', type=float, default=0.85, help='余弦相似度阈值，低于此值不输出')
    p.add_argument('--workers', type=int, default=16, help='并发下载线程数')
    p.add_argument('--batch-size', type=int, default=32, help='特征提取批大小（显存/内存不足时调小）')
    p.add_argument('--model', default='facebook/dinov2-base', help='embedding 模型（HuggingFace 名称）')
    p.add_argument('--device', default='auto', help='auto / cpu / cuda')
    p.add_argument('--timeout', type=int, default=20, help='单张图片下载超时（秒）')
    p.add_argument('--retries', type=int, default=2, help='下载失败重试次数')
    return p.parse_args()


# ============ 读数据 ============

def read_package(path):
    """读取泛化数据包，返回 (种子列表, 比对库列表)"""
    import pandas as pd

    # 工具导出时带了 BOM，用 utf-8-sig 读取可自动处理
    df = pd.read_csv(path, encoding='utf-8-sig', dtype={'规则标识': str})

    required = ['规则标识', '规则名称', '数据行ID', 'URL', '数据类型', '标注结果']
    missing = [c for c in required if c not in df.columns]
    if missing:
        sys.exit(f'错误：CSV 缺少必需列 {missing}\n实际列：{list(df.columns)}')

    df = df.dropna(subset=['URL'])
    df['URL'] = df['URL'].astype(str).str.strip()
    df = df[df['URL'] != '']

    seeds = df[df['数据类型'] == '已标注'].to_dict('records')
    database = df[df['数据类型'] == '未抽样'].to_dict('records')
    return seeds, database


# ============ 下载 ============

def url_to_cache_path(url, cache_dir):
    """URL → 本地缓存文件名（用 md5 避免非法字符）"""
    name = hashlib.md5(url.encode('utf-8')).hexdigest()
    return os.path.join(cache_dir, name[:2], name + '.img')


def download_one(url, cache_dir, timeout, retries):
    """下载单张图片到缓存目录，成功返回本地路径，失败返回 None"""
    import requests

    dest = url_to_cache_path(url, cache_dir)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest  # 命中缓存，跳过下载

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, timeout=timeout, stream=True,
                                headers={'User-Agent': 'Mozilla/5.0'})
            if resp.status_code != 200:
                continue
            data = resp.content
            if len(data) == 0:
                continue
            tmp = dest + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, dest)
            return dest
        except Exception:
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
    return None


def download_all(urls, cache_dir, workers, timeout, retries):
    """并发下载，返回 {url: 本地路径}（只包含成功的）"""
    urls = list(dict.fromkeys(urls))  # 去重，保序
    total = len(urls)
    result = {}
    if total == 0:
        return result

    print(f'开始下载 {total} 张图片（并发 {workers}）...')
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_one, u, cache_dir, timeout, retries): u for u in urls}
        for fu in as_completed(futures):
            done += 1
            path = fu.result()
            if path:
                result[futures[fu]] = path
            if done % 200 == 0 or done == total:
                elapsed = time.time() - t0
                speed = done / elapsed if elapsed > 0 else 0
                print(f'  下载进度 {done}/{total}  成功 {len(result)}  '
                      f'失败 {done - len(result)}  {speed:.1f} 张/秒', flush=True)

    failed = total - len(result)
    print(f'下载完成：成功 {len(result)} / {total}'
          + (f'，失败 {failed} 张（将被跳过）' if failed else ''))
    return result


# ============ 特征提取 ============

def load_model(model_name, device):
    """加载 DINOv2 模型"""
    import torch
    from transformers import AutoImageProcessor, AutoModel

    print(f'加载模型 {model_name} ...')
    processor = AutoImageProcessor.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name).to(device)
    model.eval()
    dim = model.config.hidden_size
    print(f'模型就绪，特征维度 {dim}，设备 {device}')
    return processor, model, dim


def extract_batch(paths, processor, model, device, batch_size):
    """批量提取特征，返回 (N, dim) 的 L2 归一化向量；无法解码的图片特征为零向量"""
    import numpy as np
    import torch
    from PIL import Image

    feats = []
    ok_flags = []

    for i in range(0, len(paths), batch_size):
        batch = paths[i:i + batch_size]
        images, valid = [], []
        for p in batch:
            try:
                img = Image.open(p).convert('RGB')
                images.append(img)
                valid.append(True)
            except Exception:
                images.append(Image.new('RGB', (224, 224), (0, 0, 0)))
                valid.append(False)

        inputs = processor(images=images, return_tensors='pt').to(device)
        with torch.no_grad():
            out = model(**inputs)
            # DINOv2: (B, seq, dim) → 对 token 维度取平均，得到整图特征
            vec = out.last_hidden_state.mean(dim=1)

        vec = vec.float().cpu().numpy()
        for j, v in enumerate(vec):
            n = np.linalg.norm(v)
            if n > 0 and valid[j]:
                feats.append(v / n)
                ok_flags.append(True)
            else:
                feats.append(np.zeros_like(v))
                ok_flags.append(False)

        if (i // batch_size) % 10 == 0:
            print(f'  特征提取 {min(i + batch_size, len(paths))}/{len(paths)}', flush=True)

    return np.asarray(feats, dtype='float32'), np.asarray(ok_flags)


# ============ 主流程 ============

def main():
    args = parse_args()

    if not os.path.exists(args.input):
        sys.exit(f'错误：找不到输入文件 {args.input}')

    import numpy as np
    import torch

    # 设备选择
    if args.device == 'auto':
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    else:
        device = args.device
    if device == 'cuda' and not torch.cuda.is_available():
        print('警告：未检测到 CUDA，自动改用 CPU')
        device = 'cpu'

    # 1. 读数据
    seeds, database = read_package(args.input)
    print(f'读到数据：已标注（种子）{len(seeds)} 条，未抽样（比对库）{len(database)} 条')
    if not seeds:
        sys.exit('错误：没有「已标注」数据可作为种子，请检查导出时是否勾选了标签与标注结果。')
    if not database:
        sys.exit('错误：没有「未抽样」数据可作为比对库（可能该规则命中的数据已被全部抽样）。')

    # 2. 下载
    os.makedirs(args.cache, exist_ok=True)
    all_urls = [r['URL'] for r in seeds] + [r['URL'] for r in database]
    path_map = download_all(all_urls, args.cache, args.workers, args.timeout, args.retries)

    seed_rows = [r for r in seeds if r['URL'] in path_map]
    db_rows = [r for r in database if r['URL'] in path_map]
    print(f'可用数据：种子 {len(seed_rows)} 条，比对库 {len(db_rows)} 条')
    if not seed_rows:
        sys.exit('错误：所有种子图片都下载失败，无法继续。')
    if not db_rows:
        sys.exit('错误：所有比对库图片都下载失败，无法继续。')

    # 3. 提特征
    processor, model, dim = load_model(args.model, device)

    print('提取比对库特征...')
    db_vecs, db_ok = extract_batch([path_map[r['URL']] for r in db_rows],
                                   processor, model, device, args.batch_size)
    print('提取种子特征...')
    seed_vecs, seed_ok = extract_batch([path_map[r['URL']] for r in seed_rows],
                                       processor, model, device, args.batch_size)

    valid_db = int(db_ok.sum())
    valid_seed = int(seed_ok.sum())
    print(f'有效特征：比对库 {valid_db}/{len(db_rows)}，种子 {valid_seed}/{len(seed_rows)}')
    if valid_db == 0 or valid_seed == 0:
        sys.exit('错误：没有可用的图片特征，无法检索。')

    # 4. 建索引并检索（内积 = 余弦相似度，因为向量已 L2 归一化）
    import faiss

    index = faiss.IndexFlatIP(dim)
    index.add(db_vecs)
    k = min(args.topk, len(db_rows))
    print(f'开始检索（每张种子返回 Top{k}，阈值 {args.threshold}）...')
    scores, indices = index.search(seed_vecs, k)

    # 5. 组装结果
    out_rows = []
    for si, srow in enumerate(seed_rows):
        if not seed_ok[si]:
            continue
        src_anno = str(srow.get('标注结果') or '').strip()
        for rank in range(k):
            di = int(indices[si][rank])
            score = float(scores[si][rank])
            if di < 0 or score < args.threshold:
                continue
            drow = db_rows[di]
            out_rows.append({
                '规则标识': srow.get('规则标识', ''),
                '规则名称': srow.get('规则名称', ''),
                '种子数据行ID': srow.get('数据行ID', ''),
                '种子URL': srow.get('URL', ''),
                '种子标注结果': src_anno,
                '相似数据行ID': drow.get('数据行ID', ''),
                '相似URL': drow.get('URL', ''),
                '相似度': round(score, 4),
            })

    # 6. 写出
    import pandas as pd

    if not out_rows:
        print(f'\n没有找到相似度 ≥ {args.threshold} 的数据。'
              f'可尝试降低 --threshold（如 0.75）后重跑。')
        return

    df = pd.DataFrame(out_rows)
    # 同一条相似数据可能被多个种子命中，按相似度降序并去重
    df = df.sort_values('相似度', ascending=False)
    df = df.drop_duplicates(subset=['相似URL'], keep='first')
    # 输出带 BOM，保证中文 Excel 打开不乱码
    df.to_csv(args.output, index=False, encoding='utf-8-sig')

    print(f'\n完成：共 {len(df)} 条相似数据，已写入 {args.output}')
    print(f'（相似度范围 {df["相似度"].min():.4f} ~ {df["相似度"].max():.4f}）')
    print('\n提示：这些是「推断结果」，标签继承自己标注的种子，'
          '建议抽查确认后再进训练集。')


if __name__ == '__main__':
    main()
