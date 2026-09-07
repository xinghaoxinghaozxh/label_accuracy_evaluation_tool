# 用 Git Bash 把项目推到 GitHub（电脑小白版）

> 我已经帮你把**本地仓库建好并提交好了**（在 `C:\Users\EDY\WorkBuddy\2026-08-10-00-36-53` 这个文件夹里）。
> 所以你**不需要**自己敲 `git init` / `git add` / `git commit`，直接从下面的「第 1 步」开始，做 **GitHub 网站上的操作** 和 **连接+推送** 就行。
> 全程你只需要：在浏览器点几下 + 在 Git Bash 里粘贴几条命令。

---

## 前置：你机器上已经有的
- ✅ **Git Bash**（已安装，版本 2.54.0）—— 开始菜单搜 “Git Bash” 就能打开。
- ❓ **GitHub 账号**：没有的话先去 https://github.com 注册一个（免费）。

---

## 第 1 步：在 GitHub 网站上「新建仓库」（用浏览器，不用 Git Bash）

1. 登录 https://github.com
2. 点页面右上角的 **`+`** → 选 **`New repository`**（新建仓库）
3. 填写：
   - **Repository name（仓库名）**：随便起，比如 `label-accuracy-tool`
   - **Description**：可留空，或写「标签准确率评测工具」
   - 选 **Public**（公开，方便分享；想私有的话选 Private 也行）
   - ⚠️ **不要**勾选 “Initialize this repository with a README”（因为本地已经有文件了，勾了反而冲突）
   - 其他默认，点 **`Create repository`**
4. 创建后会看到一个快速上手页面，里面有你的仓库地址，长这样：
   ```
   https://github.com/你的用户名/仓库名.git
   ```
   👉 **把这条地址复制下来**（后面第 5 步要用）。

---

## 第 2 步：生成一个「访问令牌」（Personal Access Token，简称 PAT）

> 为什么需要它：GitHub 从 2021 年起**不允许用账号密码推代码**，必须用这种“令牌”当密码。

1. 在 GitHub 页面，点右上角**头像** → **`Settings`**
2. 拉到页面最底部，点 **`Developer settings`**
3. 左侧点 **`Personal access tokens`** → **`Tokens (classic)`**
4. 点 **`Generate new token (classic)`**
5. 填写：
   - **Note（备注）**：随便写，如 `push-tool`
   - **Expiration（有效期）**：选 `90 days`（90天）或 `No expiration`（永不过期）
   - **勾选权限 scopes**（重点！）：
     - ☑ **`repo`** —— 点一下它会自动勾上它下面所有子项
     - ☑ **`workflow`** —— **这个一定要单独勾！** 因为仓库里带了 Mac 自动构建的配置，没它会被拒绝
6. 拉到最下面点 **`Generate token`**
7. ⚠️ **立即复制这串 token 并保存到记事本！** 它**只显示这一次**，关掉页面就再也看不到了。
   - 样子类似：`ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

## 第 3 步：打开 Git Bash

- 点电脑「开始」菜单 → 搜 **Git Bash** → 打开（会弹出一个黑色/深色窗口，这就是命令行）。

---

## 第 4 步：进入项目文件夹

**新手推荐做法**：在 Git Bash 里先输入 `cd `（cd 后面加一个空格），然后**把项目文件夹从文件资源管理器直接拖进 Git Bash 窗口**，路径会自动填好，按回车。

> 项目文件夹就是 `C:\Users\EDY\WorkBuddy\2026-08-10-00-36-53`

如果拖拽不方便，也可以直接粘贴这行（路径里有连字符，用引号包住更安全）：
```bash
cd "/c/Users/EDY/WorkBuddy/2026-08-10-00-36-53"
```

---

## 第 5 步：连接 GitHub 仓库

把下面命令里的地址**换成你第 1 步复制的仓库地址**，整行粘贴到 Git Bash 回车：
```bash
git remote add origin https://github.com/你的用户名/仓库名.git
```

验证是否连上（会显示两行 fetch/push 地址就对了）：
```bash
git remote -v
```

---

## 第 6 步：把代码推到 GitHub

```bash
git branch -M main
git push -u origin main
```

- 第一次推送会**弹窗或在窗口里要你登录**：
  - **Username**：填你的 GitHub 用户名
  - **Password**：**粘贴第 2 步复制的那串 PAT**（注意：输入密码时屏幕**不会显示任何字符**，这是正常的；粘贴用 **右键 → 粘贴** 或 **Shift+Insert**）
- 成功后会看到一连串 `100%` 的上传进度，最后显示 `main -> main`。

---

## 第 7 步：推送一个「版本标签」来触发 Mac 构建（⚠️ 关键！）

> Mac 版不是推代码就自动做的，而是**只在收到 `v` 开头的标签时才自动构建**。所以这一步一定要做！

```bash
git tag v1.0.0
git push origin v1.0.0
```
（这里可能又要登录一次，同样粘贴 PAT）

---

## 第 8 步：等 Mac 版构建完成，下载 `.dmg`

1. 回到你的 GitHub 仓库页面 → 点上方 **`Actions`** 标签
2. 你会看到 **`Build macOS Release`** 正在跑，点进去能看到日志，大概 **3–6 分钟**
3. 跑完变绿 ✅ 后，会自动发布到 **`Releases`**
4. 在仓库页面右侧点 **`Releases`**（或进 Actions 里点对应的发布）→ 下载 **`标签准确率评测工具-1.0.0-mac.dmg`**
5. Mac 用户拿到 dmg 后：
   - **右键 / Control+点击 → 打开**（不要直接双击）
   - 如果还是被拦截，去 **`系统设置 → 隐私与安全性 → 仍要打开`**
   - 这是“未签名”版的正常现象，不影响使用。

---

## 以后改了代码，怎么再发一版？

```bash
git add .
git commit -m "写一句你改了什么"
git push origin main
git tag v1.0.1
git push origin v1.0.1
```
（版本号每次 +0.0.1 即可：v1.0.1、v1.0.2……）

---

## 常见问题 / 排错

| 现象 | 原因 & 解决 |
|------|------------|
| 推送报 `403` 或被拒绝 | 多半是 PAT **没勾 `workflow` 权限**，或你填的是 GitHub **登录密码**而不是 token。回到第 2 步重新生成一个带 `workflow` 的 token。 |
| 提示密码一直错 | 确认粘贴的是 **PAT（ghp_ 开头）**，不是你的 GitHub 登录密码。 |
| 输入密码时屏幕没反应 | 正常！命令行下输入/粘贴密码都不显示字符，粘完直接回车即可。 |
| Mac 的 dmg 打不开 | 未签名版正常现象，按第 8 步「右键打开 / 隐私与安全性放行」。 |
| `git remote add` 报 “already exists” | 说明之前连过。先 `git remote remove origin` 再重连第 5 步。 |

---

## ⚠️ 两个重要提醒

1. **Windows 用户怎么给？**
   直接用你电脑上已经生成的这个文件：
   ```
   C:\Users\EDY\WorkBuddy\2026-08-10-00-36-53\dist\标签准确率评测工具-1.0.0-win.zip
   ```
   解压后双击 `标签准确率评测工具.exe` 即可用。
   👉 **这个 zip 不会上传到 GitHub**（被 `.gitignore` 忽略了），所以请把它**另存到安全地方**（比如桌面，或直接发给同事），别把项目文件夹删了导致丢失。

2. **GitHub 仓库里有什么？**
   只有「源代码 + Mac 自动构建配置」。`node_modules`（依赖）和那个大 zip 都不会上传——GitHub 在构建 Mac 版时会自动重新安装依赖，完全没问题。
