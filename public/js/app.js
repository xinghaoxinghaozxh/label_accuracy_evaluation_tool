/* ============================================================
 * 标签准确率评测工具 - 核心逻辑（多子任务版）
 * ============================================================ */

// ===== 全局状态 =====
const state = {
  subtasks: [],          // 子任务数组
  expandedIndex: -1,     // 当前展开的子任务索引
  allRows: [],           // 解析后的所有行
  headers: [],           // 表头
  imgUrlCol: null,
  videoUrlCol: null,
  ruleSetCol: null,
  pipelineRunning: false, // 子任务创建管线是否在运行
  targetCount: 100,      // 每个任务抽取的数据条数（100~600）
};

const IMAGE_TIMEOUT = 15000;
const MAX_PAIRS = 10;

const $ = (id) => document.getElementById(id);

// ===== 工具函数 =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isNullOrEmpty(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  return s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'none' || s.toLowerCase() === 'nan';
}

function findColumn(headers, possibleNames) {
  const normalized = headers.map((h) => ({ original: h, norm: String(h).trim().toLowerCase().replace(/\s+/g, '') }));
  for (const name of possibleNames) {
    const target = name.trim().toLowerCase().replace(/\s+/g, '');
    const found = normalized.find((h) => h.norm === target);
    if (found) return found.original;
  }
  for (const name of possibleNames) {
    const target = name.trim().toLowerCase().replace(/\s+/g, '');
    const found = normalized.find((h) => h.norm.includes(target));
    if (found) return found.original;
  }
  return null;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 使用浏览器原生 TextDecoder 解码 CSV 字节流，自动兼容以下编码：
//   - UTF-8（带 BOM 或 无 BOM）
//   - GBK / GB2312（中文 Excel 导出的 CSV 常见）
// 优先严格按 UTF-8 解码；失败或检出乱码字符则回退 GBK；最后兜底宽松 UTF-8。
function decodeCsvToText(u8) {
  // 1) 严格 UTF-8
  try {
    const txt = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    if (txt.indexOf('�') === -1) return txt;
  } catch (e) { /* 不是 UTF-8 */ }
  // 2) 回退 GBK / GB2312
  try {
    const txt = new TextDecoder('gbk').decode(u8);
    if (txt.indexOf('�') === -1) return txt;
  } catch (e) { /* 浏览器不支持 gbk */ }
  // 3) 兜底：宽松 UTF-8（允许替换符）
  return new TextDecoder('utf-8').decode(u8);
}

// ===== 界面切换 =====
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const screen = $('screen-' + name);
  if (screen) screen.classList.add('active');
}

function updateLoading(text, progress, count) {
  $('loading-text').textContent = text;
  if (progress !== undefined) $('loading-progress-bar').style.width = progress + '%';
  $('loading-count').textContent = count !== undefined ? count : '';
}

// ===== 上传表单（文本域批量输入规则号与标签）=====
function initUpload() {
  const textarea = $('rules-textarea');

  // 实时统计识别到的规则-标签数量
  textarea.addEventListener('input', () => {
    const pairs = parseRulesText(textarea.value);
    $('pair-count-hint').textContent = '已识别：' + pairs.length + ' 组';
    $('pair-count-hint').style.color = pairs.length > 0 ? 'var(--success)' : 'var(--text-secondary)';
  });

  // 在文本域中按 Tab 键时插入制表符，而不是让焦点跳走
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      textarea.value = val.slice(0, start) + '\t' + val.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + 1;
      // 触发 input 事件以更新计数
      textarea.dispatchEvent(new Event('input'));
    }
  });

  $('file-input').addEventListener('change', () => {
    const file = $('file-input').files[0];
    if (file) $('file-display').textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
  });

  $('upload-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const file = $('file-input').files[0];
    const pairs = parseRulesText(textarea.value);

    if (!file) { alert('请选择表格文件'); return; }
    if (pairs.length === 0) {
      alert('请按格式输入规则号和标签名称（每行一组，规则号与标签名用 Tab 分隔）');
      return;
    }
    if (pairs.length > MAX_PAIRS) {
      alert('最多支持 ' + MAX_PAIRS + ' 组规则号，当前已输入 ' + pairs.length + ' 组，请删减后重试。');
      return;
    }
    for (const p of pairs) {
      if (!p.rule || !p.label) { alert('存在格式不正确的行，请确保每行格式为：规则号 + Tab + 标签名称'); return; }
    }

    // 读取「每个任务抽取的数据条数」
    const sc = parseInt($('sample-count').value, 10);
    state.targetCount = (sc >= 100 && sc <= 600) ? sc : 100;

    // 重置状态
    state.subtasks = [];
    state.expandedIndex = -1;
    state.pipelineRunning = false;

    showScreen('loading');
    updateLoading('正在解析表格文件...', 5);

    const reader = new FileReader();
    reader.onload = (ev) => {
      setTimeout(() => processFile(ev.target.result, pairs, file.name), 50);
    };
    reader.onerror = () => { alert('文件读取失败'); showScreen('upload'); };
    reader.readAsArrayBuffer(file);
  });
}

function parseRulesText(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 按 Tab 分隔：规则号\t标签名称
    const parts = trimmed.split('\t');
    if (parts.length >= 2) {
      const rule = parts[0].trim();
      const label = parts.slice(1).join('\t').trim();
      if (rule && label) pairs.push({ rule, label });
    } else {
      // 没有 Tab，尝试用多个连续空格分隔
      const spaceParts = trimmed.split(/\s{2,}/);
      if (spaceParts.length >= 2) {
        const rule = spaceParts[0].trim();
        const label = spaceParts.slice(1).join(' ').trim();
        if (rule && label) pairs.push({ rule, label });
      }
    }
  }
  return pairs;
}

// ===== 文件处理 =====
function processFile(data, pairs, fileName) {
  updateLoading('正在解析表格数据...', 10);

  let workbook;
  try {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isCSV = fileName && String(fileName).toLowerCase().endsWith('.csv');
    if (isCSV) {
      // CSV：先自行解码为字符串（自动兼容 UTF-8 / GBK），再交给 SheetJS 解析
      const text = decodeCsvToText(u8);
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      // Excel 为二进制格式，直接按字节解析
      workbook = XLSX.read(u8, { type: 'array' });
    }
  } catch (err) {
    alert('文件解析失败：' + (err && err.message ? err.message : err) + '\n\n请确认文件格式正确。');
    showScreen('upload');
    return;
  }

  let rows;
  try {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  } catch (err) {
    alert('表格数据读取失败：' + (err && err.message ? err.message : err));
    showScreen('upload');
    return;
  }

  if (!rows || rows.length === 0) {
    alert('表格中没有数据');
    showScreen('upload');
    return;
  }

  updateLoading('正在识别数据列...', 20);
  state.allRows = rows;
  state.headers = Object.keys(rows[0]);

  state.imgUrlCol = findColumn(state.headers, ['图片URL', '图片url', '图片Url', '图片链接', '图片地址']);
  state.videoUrlCol = findColumn(state.headers, ['视频截帧URL', '视频截帧url', '视频截帧Url', '视频截帧链接', '视频截帧地址', '视频URL', '视频url']);
  state.ruleSetCol = findColumn(state.headers, ['实验室命中规则集', '实验室命中规则', '命中规则集', '命中规则']);

  const missing = [];
  if (!state.imgUrlCol) missing.push('图片URL');
  if (!state.videoUrlCol) missing.push('视频截帧URL');
  if (!state.ruleSetCol) missing.push('实验室命中规则集');
  if (missing.length > 0) {
    alert('未找到以下列：' + missing.join('、') + '\n\n表头为：' + state.headers.join('、'));
    showScreen('upload');
    return;
  }

  // 切换到评测界面，开始逐一创建子任务
  showScreen('annotate');
  renderSubtaskList();
  createSubtasks(pairs);
}

// ===== 子任务创建管线 =====
async function createSubtasks(pairs) {
  state.pipelineRunning = true;

  for (let i = 0; i < pairs.length; i++) {
    const subtask = {
      id: i,
      label: pairs[i].label,
      rule: pairs[i].rule,
      status: 'loading',
      allFilteredData: [],
      sampledIds: new Set(),
      displayItems: [],
      totalCount: 0,
      remarks: '',
      result: null,
      expanded: false,
    };
    state.subtasks.push(subtask);
    renderSubtaskList();

    await prepareSubtask(subtask);
    renderSubtaskList();
    updateOverallStatus();

    // 自动展开第一个可评测的子任务
    if (state.expandedIndex === -1 && subtask.status === 'active') {
      expandSubtask(i);
    }
  }

  state.pipelineRunning = false;
  updateOverallStatus();
}

async function prepareSubtask(subtask) {
  // 筛选匹配规则的数据
  const merged = [];
  state.allRows.forEach((row, index) => {
    const imgUrl = row[state.imgUrlCol];
    const videoUrl = row[state.videoUrlCol];
    const ruleSet = String(row[state.ruleSetCol] || '');

    let url = null;
    if (!isNullOrEmpty(imgUrl)) url = String(imgUrl).trim();
    else if (!isNullOrEmpty(videoUrl)) url = String(videoUrl).trim();

    if (ruleSet.includes(subtask.rule) && url) {
      merged.push({ id: index, url, ruleSet, annotation: null });
    }
  });

  subtask.allFilteredData = merged;
  subtask.totalCount = merged.length;

  if (merged.length === 0) {
    subtask.status = 'no-data';
    subtask.result = { correct: 0, error: 0, evaluated: 0, accuracy: '—', remarks: '无可评测数据' };
    return;
  }

  // 加载图片（循环补抽）
  await loadImagesLoop(subtask);

  if (subtask.displayItems.length === 0) {
    subtask.status = 'no-data';
    subtask.result = { correct: 0, error: 0, evaluated: 0, accuracy: '—', remarks: '无可评测数据' };
  } else {
    subtask.status = 'active';
  }
}

async function loadImagesLoop(subtask) {
  const target = Math.min(state.targetCount, subtask.totalCount);

  while (subtask.displayItems.length < target) {
    const needed = target - subtask.displayItems.length;
    const available = subtask.allFilteredData.filter((item) => !subtask.sampledIds.has(item.id));
    if (available.length === 0) break;

    const batchSize = Math.min(needed, available.length);
    const batch = shuffle(available).slice(0, batchSize);
    batch.forEach((item) => subtask.sampledIds.add(item.id));

    const results = await Promise.all(batch.map((item) => loadImage(item)));
    subtask.displayItems.push(...results.filter((r) => r.loaded));
  }
}

function loadImage(item) {
  return new Promise((resolve) => {
    let resolved = false;
    const img = new Image();
    const done = (loaded) => { if (!resolved) { resolved = true; resolve({ ...item, loaded }); } };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    setTimeout(() => done(false), IMAGE_TIMEOUT);
    img.src = item.url;
  });
}

// ===== 子任务列表渲染 =====
function renderSubtaskList() {
  const container = $('subtask-list');
  container.innerHTML = '';
  state.subtasks.forEach((subtask, index) => {
    container.appendChild(renderSubtaskPanel(subtask, index));
  });
  updateOverallStatus();
}

function renderSubtaskPanel(subtask, index) {
  const panel = document.createElement('div');
  panel.className = 'subtask-panel';
  if (subtask.expanded) panel.classList.add('expanded');
  if (subtask.status === 'completed') panel.classList.add('completed');
  if (subtask.status === 'no-data') panel.classList.add('no-data');
  panel.dataset.subtask = index;

  // 状态图标
  const statusIcons = { loading: '\u23F3', active: '\u25B6', completed: '\u2713', 'no-data': '\u26A0' };
  const statusTexts = { loading: '准备中', active: '待评测', completed: '已完成', 'no-data': '无数据' };

  // 结果摘要
  let summaryHtml = '';
  if (subtask.result) {
    const acc = subtask.result.accuracy;
    const accClass = acc !== '—' && parseFloat(acc) >= 50 ? 'good' : (acc !== '—' ? 'bad' : '');
    summaryHtml = '<span class="subtask-result-summary">' +
      '命中 ' + subtask.totalCount + ' \u00B7 评测 ' + subtask.result.evaluated +
      ' \u00B7 准确率 <span class="acc ' + accClass + '">' + acc + '</span></span>';
  } else if (subtask.status === 'active') {
    const annotated = subtask.displayItems.filter((i) => i.annotation !== null).length;
    summaryHtml = '<span class="subtask-progress">' + annotated + '/' + subtask.displayItems.length + ' 已标注</span>';
  }

  // 展开箭头
  const arrow = subtask.expanded ? '\u25BC' : '\u25B6';

  panel.innerHTML =
    '<div class="subtask-header" data-action="toggle">' +
      '<span class="subtask-status-icon ' + subtask.status + '">' + (statusIcons[subtask.status] || '') + '</span>' +
      '<span class="subtask-title">' + escapeHtml(subtask.label) + '</span>' +
      '<span class="subtask-meta">规则号: ' + escapeHtml(subtask.rule) + ' \u00B7 ' + statusTexts[subtask.status] + '</span>' +
      summaryHtml +
      '<span class="subtask-expand-arrow">' + arrow + '</span>' +
    '</div>' +
    '<div class="subtask-body">' + renderSubtaskBody(subtask, index) + '</div>';

  return panel;
}

function renderSubtaskBody(subtask, index) {
  if (subtask.status === 'no-data') {
    return '<div class="no-data-msg">\u26A0 该子任务无可评测数据</div>';
  }

  if (subtask.status === 'loading') {
    return '<div class="no-data-msg">\u23F3 正在准备数据...</div>';
  }

  // active 或 completed
  let html = '<div class="subtask-images" data-subtask="' + index + '">';

  subtask.displayItems.forEach((item, imgIndex) => {
    let cardClass = 'image-card';
    if (item.annotation === 'correct') cardClass += ' correct';
    if (item.annotation === 'error') cardClass += ' error';

    html +=
      '<div class="' + cardClass + '" data-item-id="' + item.id + '">' +
        '<div class="card-image-wrapper">' +
          '<span class="card-number">#' + (imgIndex + 1) + '</span>' +
          '<span class="card-status">' + (item.annotation === 'correct' ? '\u2713' : '\u2717') + '</span>' +
          '<a href="' + escapeAttr(item.url) + '" target="_blank">' +
            '<img src="' + escapeAttr(item.url) + '" alt="图片' + (imgIndex + 1) + '" loading="lazy">' +
          '</a>' +
        '</div>' +
        '<div class="card-buttons">' +
          '<button class="btn-correct' + (item.annotation === 'correct' ? ' active' : '') + '" data-action="annotate" data-value="correct">\u2713 正确</button>' +
          '<button class="btn-error' + (item.annotation === 'error' ? ' active' : '') + '" data-action="annotate" data-value="error">\u2717 错误</button>' +
        '</div>' +
      '</div>';
  });

  html += '</div>';

  // 底部操作栏
  const isCompleted = subtask.status === 'completed';
  const allAnnotated = subtask.displayItems.length > 0 && subtask.displayItems.every((i) => i.annotation !== null);
  const btnLabel = isCompleted ? '更新评测结果' : '评测完成';
  const btnDisabled = !isCompleted && !allAnnotated ? ' disabled' : '';

  html +=
    '<div class="subtask-footer">' +
      '<input type="text" class="remarks-input" placeholder="问题备注（可选）" value="' + escapeAttr(subtask.remarks || '') + '" data-action="remarks">' +
      '<div class="footer-btns">' +
        '<button class="btn-batch btn-batch-correct" data-action="batch-correct">未标注批量正确</button>' +
        '<button class="btn-batch btn-batch-error" data-action="batch-error">未标注批量错误</button>' +
        '<button class="btn-complete" data-action="complete"' + btnDisabled + '>' + btnLabel + '</button>' +
      '</div>' +
    '</div>';

  return html;
}

// ===== 展开/折叠 =====
function expandSubtask(index) {
  // 折叠其他，展开当前
  state.subtasks.forEach((s, i) => { s.expanded = (i === index); });
  state.expandedIndex = index;
  renderSubtaskList();
}

function collapseSubtask(index) {
  state.subtasks[index].expanded = false;
  if (state.expandedIndex === index) state.expandedIndex = -1;
  renderSubtaskList();
}

function toggleSubtask(index) {
  const subtask = state.subtasks[index];
  if (subtask.expanded) {
    collapseSubtask(index);
  } else {
    expandSubtask(index);
  }
}

// 完成当前子任务后，自动展开下一个待评测（active 或正在准备 loading 的）子任务
function expandNextSubtask(fromIndex) {
  const isPending = (s) => s.status === 'active' || s.status === 'loading';
  // 先往后找
  for (let i = fromIndex + 1; i < state.subtasks.length; i++) {
    if (isPending(state.subtasks[i])) { expandSubtask(i); return i; }
  }
  // 再从头找（处理尚未轮到的）
  for (let i = 0; i < fromIndex; i++) {
    if (isPending(state.subtasks[i])) { expandSubtask(i); return i; }
  }
  return -1;
}

// ===== 标注操作 =====
function setAnnotation(subtaskIndex, itemId, value) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask) return;
  const item = subtask.displayItems.find((i) => i.id === itemId);
  if (!item) return;

  if (item.annotation === value) {
    item.annotation = null;
  } else {
    item.annotation = value;
  }

  updateCardUI(subtaskIndex, itemId);
  updateSubtaskProgress(subtaskIndex);
}

function batchAnnotate(subtaskIndex, value) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask) return;
  const unannotated = subtask.displayItems.filter((i) => i.annotation === null);
  if (unannotated.length === 0) { alert('没有未标注的数据'); return; }
  unannotated.forEach((item) => { item.annotation = value; updateCardUI(subtaskIndex, item.id); });
  updateSubtaskProgress(subtaskIndex);
}

function updateCardUI(subtaskIndex, itemId) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask) return;
  const item = subtask.displayItems.find((i) => i.id === itemId);
  if (!item) return;

  const card = document.querySelector('.subtask-panel[data-subtask="' + subtaskIndex + '"] .image-card[data-item-id="' + itemId + '"]');
  if (!card) return;

  card.classList.remove('correct', 'error');
  card.querySelector('.btn-correct').classList.remove('active');
  card.querySelector('.btn-error').classList.remove('active');
  card.querySelector('.card-status').textContent = '';

  if (item.annotation === 'correct') {
    card.classList.add('correct');
    card.querySelector('.btn-correct').classList.add('active');
    card.querySelector('.card-status').textContent = '\u2713';
  } else if (item.annotation === 'error') {
    card.classList.add('error');
    card.querySelector('.btn-error').classList.add('active');
    card.querySelector('.card-status').textContent = '\u2717';
  }
}

function updateSubtaskProgress(subtaskIndex) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask || subtask.status !== 'active') return;

  const annotated = subtask.displayItems.filter((i) => i.annotation !== null).length;
  const total = subtask.displayItems.length;
  const allAnnotated = annotated === total && total > 0;

  // 更新进度文本
  const summaryEl = document.querySelector('.subtask-panel[data-subtask="' + subtaskIndex + '"] .subtask-progress');
  if (summaryEl) summaryEl.textContent = annotated + '/' + total + ' 已标注';

  // 更新完成按钮状态
  const completeBtn = document.querySelector('.subtask-panel[data-subtask="' + subtaskIndex + '"] button[data-action="complete"]');
  if (completeBtn) completeBtn.disabled = !allAnnotated;
}

// ===== 完成/更新子任务 =====
function completeSubtask(subtaskIndex) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask) return;

  // 保存备注
  const remarksInput = document.querySelector('.subtask-panel[data-subtask="' + subtaskIndex + '"] .remarks-input');
  if (remarksInput) subtask.remarks = remarksInput.value.trim();

  // 计算结果
  subtask.result = calculateResult(subtask);
  subtask.status = 'completed';
  subtask.expanded = false;
  if (state.expandedIndex === subtaskIndex) state.expandedIndex = -1;

  renderSubtaskList();
  renderResultsTable();
  updateOverallStatus();

  // 自动展开下一个待评测子任务，并定位到它
  const nextIndex = expandNextSubtask(subtaskIndex);
  requestAnimationFrame(() => scrollToSubtaskTop(nextIndex));
}

// 评测完成后把页面滚回顶部（没有下一个任务时的兜底）
function scrollPageToTop() {
  try {
    window.scrollTo(0, 0);
  } catch (_) {}
  const el = document.scrollingElement || document.documentElement || document.body;
  if (el) el.scrollTop = 0;
}

// 滚动到指定子任务面板的标题位置；index < 0 或找不到时回到页面顶部
function scrollToSubtaskTop(index) {
  const panel = index >= 0
    ? document.querySelector('.subtask-panel[data-subtask="' + index + '"]')
    : null;
  if (!panel) { scrollPageToTop(); return; }
  try {
    const top = panel.getBoundingClientRect().top + (window.pageYOffset || 0) - 16;
    window.scrollTo(0, Math.max(top, 0));
  } catch (_) {
    scrollPageToTop();
    return;
  }
  const el = document.scrollingElement || document.documentElement || document.body;
  if (el && el.scrollTop === 0 && panel.getBoundingClientRect().top > 4) {
    panel.scrollIntoView({ block: 'start' });
  }
}

function updateSubtaskResult(subtaskIndex) {
  const subtask = state.subtasks[subtaskIndex];
  if (!subtask) return;

  const remarksInput = document.querySelector('.subtask-panel[data-subtask="' + subtaskIndex + '"] .remarks-input');
  if (remarksInput) subtask.remarks = remarksInput.value.trim();

  subtask.result = calculateResult(subtask);
  subtask.expanded = false;
  if (state.expandedIndex === subtaskIndex) state.expandedIndex = -1;

  renderSubtaskList();
  renderResultsTable();
  updateOverallStatus();

  requestAnimationFrame(() => scrollToSubtaskTop(subtaskIndex));
}

function calculateResult(subtask) {
  const correct = subtask.displayItems.filter((i) => i.annotation === 'correct').length;
  const error = subtask.displayItems.filter((i) => i.annotation === 'error').length;
  const evaluated = correct + error;
  const accuracy = evaluated > 0 ? ((correct / evaluated) * 100).toFixed(2) + '%' : '—';
  return { correct, error, evaluated, accuracy };
}

// ===== 结果汇总表 =====
function renderResultsTable() {
  const completed = state.subtasks.filter((s) => s.result !== null);
  if (completed.length === 0) {
    $('results-section').style.display = 'none';
    return;
  }

  $('results-section').style.display = 'block';
  const tbody = $('results-tbody');
  tbody.innerHTML = '';

  completed.forEach((subtask) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(subtask.label) + '</td>' +
      '<td>' + escapeHtml(subtask.rule) + '</td>' +
      '<td>' + subtask.totalCount + '</td>' +
      '<td>' + subtask.result.evaluated + '</td>' +
      '<td class="accuracy-cell">' + subtask.result.accuracy + '</td>' +
      '<td>' + escapeHtml(subtask.remarks || (subtask.status === 'no-data' ? '无可评测数据' : '-')) + '</td>';
    tbody.appendChild(tr);
  });
}

// ===== 整体状态更新 =====
function updateOverallStatus() {
  const total = state.subtasks.length;
  const completed = state.subtasks.filter((s) => s.status === 'completed' || s.status === 'no-data').length;

  $('info-total-tasks').textContent = '子任务: ' + total;
  $('info-completed-tasks').textContent = '已完成: ' + completed + '/' + total;

  const allDone = total > 0 && completed === total && !state.pipelineRunning;

  if (allDone) {
    $('export-data-btn').style.display = '';
    $('export-btn').style.display = '';
    $('new-eval-btn').style.display = '';
  } else {
    $('export-data-btn').style.display = 'none';
    $('export-btn').style.display = 'none';
    $('new-eval-btn').style.display = 'none';
  }
}

// ===== 导出结果 =====
function downloadResults() {
  const completed = state.subtasks.filter((s) => s.result !== null);
  if (completed.length === 0) { alert('暂无评测结果'); return; }

  const data = completed.map((s) => ({
    '标签名称': s.label,
    '规则号': s.rule,
    '命中数量': s.totalCount,
    '评测数据量': s.result.evaluated,
    '准确率': s.result.accuracy,
    '问题备注': s.remarks || (s.status === 'no-data' ? '无可评测数据' : ''),
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 40 }];

  // 第二个 sheet：所有被抽样评测数据的明细
  const detailAoa = [['规则号', '标签名称', 'URL', '标注结果']];
  completed.forEach((s) => {
    (s.displayItems || []).forEach((item) => {
      const anno = item.annotation === 'correct' ? '正确'
        : (item.annotation === 'error' ? '错误' : '未标注');
      detailAoa.push([s.rule, s.label, item.url, anno]);
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet(detailAoa);
  ws2['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 70 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '评测结果');
  XLSX.utils.book_append_sheet(wb, ws2, '抽样明细');
  XLSX.writeFile(wb, '评测结果汇总.xlsx');
}

// ===== 开始新评测 =====
function startNewEvaluation() {
  state.subtasks = [];
  state.expandedIndex = -1;
  state.allRows = [];
  state.headers = [];
  state.imgUrlCol = null;
  state.videoUrlCol = null;
  state.ruleSetCol = null;
  state.pipelineRunning = false;

  $('upload-form').reset();
  $('file-display').textContent = '点击或拖拽文件到此处';
  $('rules-textarea').value = '';
  $('pair-count-hint').textContent = '已识别：0 组';
  $('pair-count-hint').style.color = 'var(--text-secondary)';
  $('results-section').style.display = 'none';
  $('results-tbody').innerHTML = '';

  showScreen('upload');
}

// ===== 导出数据（第 5、6 步 + 泛化数据包）=====

// 当前勾选的「标注结果」筛选值：all / correct / error
function getExportAnnoFilter() {
  const checked = document.querySelector('input[name="export-anno"]:checked');
  return checked ? checked.value : 'all';
}

// 当前勾选的子任务
function getSelectedSubtasks() {
  const picked = [];
  document.querySelectorAll('#export-task-list input[type="checkbox"]').forEach((b) => {
    if (b.checked) picked.push(state.subtasks[parseInt(b.value, 10)]);
  });
  return picked;
}

// 某子任务中「已标注」的数据（标注结果存于 displayItems）
function collectAnnotated(subtask, filter) {
  return (subtask.displayItems || []).filter((i) => {
    if (i.annotation !== 'correct' && i.annotation !== 'error') return false;
    if (filter === 'correct') return i.annotation === 'correct';
    if (filter === 'error') return i.annotation === 'error';
    return true;
  });
}

// 某子任务中「未被抽样」的数据（窄范围：该规则命中但没被抽到）
function collectUnsampled(subtask) {
  return (subtask.allFilteredData || []).filter((item) => !subtask.sampledIds.has(item.id));
}

function annoText(v) {
  return v === 'correct' ? '正确' : v === 'error' ? '错误' : '';
}

// 打开面板：渲染标签勾选列表
function openExportModal() {
  const list = $('export-task-list');
  list.innerHTML = '';
  const usable = state.subtasks.filter((s) => s.displayItems && s.displayItems.length > 0);
  if (usable.length === 0) { alert('当前没有可导出的数据。'); return; }

  usable.forEach((subtask) => {
    const idx = state.subtasks.indexOf(subtask);
    const items = subtask.displayItems || [];
    const correct = items.filter((i) => i.annotation === 'correct').length;
    const error = items.filter((i) => i.annotation === 'error').length;
    const unsampled = collectUnsampled(subtask).length;

    const row = document.createElement('label');
    row.className = 'export-task-item';
    row.innerHTML =
      '<input type="checkbox" value="' + idx + '" checked>' +
      '<span class="eti-main"><span class="eti-label">' + escapeHtml(subtask.label) + '</span>' +
      '<span class="eti-rule">规则号 ' + escapeHtml(subtask.rule) + '</span></span>' +
      '<span class="eti-count">正确 ' + correct + ' ｜ 错误 ' + error + ' ｜ 未抽样 ' + unsampled + '</span>';
    list.appendChild(row);
  });

  $('export-modal').style.display = '';
  updateExportSummary();
}

function closeExportModal() {
  $('export-modal').style.display = 'none';
}

function setExportTasksChecked(v) {
  document.querySelectorAll('#export-task-list input[type="checkbox"]').forEach((b) => { b.checked = v; });
  updateExportSummary();
}

function updateExportSummary() {
  const picked = getSelectedSubtasks();
  const filter = getExportAnnoFilter();
  let annotated = 0, unsampled = 0;
  picked.forEach((st) => {
    annotated += collectAnnotated(st, filter).length;
    unsampled += collectUnsampled(st).length;
  });
  const ftext = filter === 'correct' ? '仅正确' : filter === 'error' ? '仅错误' : '全部';
  $('export-summary').textContent =
    '已选 ' + picked.length + ' 个标签 ｜ 标注结果：' + ftext +
    ' ｜ 标注数据 ' + annotated + ' 条；泛化比对库 ' + unsampled + ' 条（未抽样）';
}

// 第 6 步：详细结果表（规则标识 / 规则名称 / 数据行ID / URL / 标注结果）
function exportDetailTable() {
  const picked = getSelectedSubtasks();
  if (picked.length === 0) { alert('请至少选择一个标签。'); return; }
  const filter = getExportAnnoFilter();

  const rows = [];
  picked.forEach((st) => {
    collectAnnotated(st, filter).forEach((item) => {
      rows.push({
        '规则标识': st.rule,
        '规则名称': st.label,
        '数据行ID': item.id,
        'URL': item.url,
        '标注结果': annoText(item.annotation),
      });
    });
  });
  if (rows.length === 0) { alert('所选条件下没有数据可导出。'); return; }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 32 }, { wch: 10 }, { wch: 60 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '标注明细');
  XLSX.writeFile(wb, '标注结果明细.xlsx');
  closeExportModal();
}

// 第 7 步：泛化数据包 —— 已标注数据（种子）+ 未抽样数据（比对库），供 Python 脚本使用
function exportGeneralizePackage() {
  const picked = getSelectedSubtasks();
  if (picked.length === 0) { alert('请至少选择一个标签。'); return; }
  const filter = getExportAnnoFilter();

  const rows = [];
  picked.forEach((st) => {
    collectAnnotated(st, filter).forEach((item) => {
      rows.push({
        '规则标识': st.rule,
        '规则名称': st.label,
        '数据行ID': item.id,
        'URL': item.url,
        '数据类型': '已标注',
        '标注结果': annoText(item.annotation),
      });
    });
    collectUnsampled(st).forEach((item) => {
      rows.push({
        '规则标识': st.rule,
        '规则名称': st.label,
        '数据行ID': item.id,
        'URL': item.url,
        '数据类型': '未抽样',
        '标注结果': '',
      });
    });
  });
  if (rows.length === 0) { alert('所选条件下没有数据可导出。'); return; }

  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  // 加 BOM，保证中文 Excel 打开不乱码（Python 端用 utf-8-sig 读取即可）
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '泛化数据包.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  closeExportModal();
}

// ===== 事件绑定（事件委托）=====
function bindAnnotateEvents() {
  const list = $('subtask-list');

  list.addEventListener('click', (e) => {
    const panel = e.target.closest('.subtask-panel');
    if (!panel) return;
    const subtaskIndex = parseInt(panel.dataset.subtask, 10);
    const subtask = state.subtasks[subtaskIndex];
    if (!subtask) return;

    // 点击 header → 展开/折叠
    const header = e.target.closest('.subtask-header');
    if (header) {
      // 不在 loading/no-data 上响应展开（no-data 可以展开看消息）
      if (subtask.status === 'loading') return;
      toggleSubtask(subtaskIndex);
      return;
    }

    // 标注按钮
    const annotateBtn = e.target.closest('[data-action="annotate"]');
    if (annotateBtn) {
      e.preventDefault();
      const card = annotateBtn.closest('.image-card');
      const itemId = parseInt(card.dataset.itemId, 10);
      setAnnotation(subtaskIndex, itemId, annotateBtn.dataset.value);
      return;
    }

    // 批量正确
    if (e.target.closest('[data-action="batch-correct"]')) {
      batchAnnotate(subtaskIndex, 'correct');
      return;
    }

    // 批量错误
    if (e.target.closest('[data-action="batch-error"]')) {
      batchAnnotate(subtaskIndex, 'error');
      return;
    }

    // 完成/更新
    const completeBtn = e.target.closest('[data-action="complete"]');
    if (completeBtn && !completeBtn.disabled) {
      if (subtask.status === 'completed') {
        updateSubtaskResult(subtaskIndex);
      } else {
        completeSubtask(subtaskIndex);
      }
      return;
    }
  });

  // 备注输入（失焦保存）
  list.addEventListener('blur', (e) => {
    if (e.target.classList && e.target.classList.contains('remarks-input')) {
      const panel = e.target.closest('.subtask-panel');
      if (!panel) return;
      const subtaskIndex = parseInt(panel.dataset.subtask, 10);
      state.subtasks[subtaskIndex].remarks = e.target.value.trim();
    }
  }, true);

  // 导出结果汇总
  $('export-btn').addEventListener('click', downloadResults);

  // 导出数据（打开选择面板）
  $('export-data-btn').addEventListener('click', openExportModal);
  $('export-cancel-btn').addEventListener('click', closeExportModal);
  $('export-select-all').addEventListener('click', () => setExportTasksChecked(true));
  $('export-select-none').addEventListener('click', () => setExportTasksChecked(false));
  $('export-detail-btn').addEventListener('click', exportDetailTable);
  $('export-generalize-btn').addEventListener('click', exportGeneralizePackage);
  document.querySelectorAll('input[name="export-anno"]').forEach((r) => {
    r.addEventListener('change', updateExportSummary);
  });
  $('export-task-list').addEventListener('change', updateExportSummary);
  $('export-modal').addEventListener('click', (e) => {
    if (e.target === $('export-modal')) closeExportModal();
  });

  // 开始新评测
  $('new-eval-btn').addEventListener('click', startNewEvaluation);
}

// ===== 初始化 =====
function init() {
  initUpload();
  bindAnnotateEvents();
}

document.addEventListener('DOMContentLoaded', init);
