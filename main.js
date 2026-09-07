const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('path');
const os = require('os');
const fsSync = require('fs');

// 把所有未捕获错误与启动进度写到日志，便于排查「白屏/打不开」
// 同时写到系统临时目录与项目根目录：临时目录一定可写，保证诊断信息不丢
function logLine(msg) {
  const text = `[${new Date().toISOString()}] ${msg}\n`;
  const targets = [];
  try { targets.push(path.join(os.tmpdir(), '评测工具运行日志.txt')); } catch (_) {}
  try { targets.push(path.join(path.dirname(app.getPath('exe')), '..', '..', '评测工具运行日志.txt')); } catch (_) {}
  for (const p of targets) {
    try { fsSync.appendFileSync(p, text); } catch (_) {}
  }
}
function logErr(tag, e) {
  logLine(`${tag}: ${e && e.stack ? e.stack : e}`);
}
process.on('uncaughtException', (e) => logErr('uncaughtException', e));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', e));

logLine('=== 启动：main.js 已加载 ===');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: '标签准确率评测工具',
    show: false, // 等页面加载完再显示，避免白屏闪烁
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('did-fail-load', (e, code, desc, url) => logErr('did-fail-load', `${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (e, details) => logErr('render-process-gone', JSON.stringify(details)));
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (level >= 2) logErr(`console[${level}]`, `${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-finish-load', () => {
    logLine('PAGE_LOADED_OK 页面加载完成');
    win.show();
  });

  logLine('开始加载页面...');
  win.loadFile(path.join(__dirname, 'public', 'index.html')).catch((e) => logErr('loadFile', e));
}

app.whenReady().then(() => {
  logLine('APP_READY 主进程已就绪');

  // 拦截页面触发的下载（导出 Excel/CSV），弹出「另存为」对话框
  // 放在 whenReady 内部：即使这行出错也不会阻断窗口创建
  try {
    session.defaultSession.on('will-download', (event, item) => {
      const ext = path.extname(item.getFilename()).toLowerCase().replace('.', '');
      const filters = ext === 'csv'
        ? [{ name: 'CSV 文件', extensions: ['csv'] }]
        : [{ name: 'Excel 文件', extensions: ['xlsx'] }];
      const savePath = dialog.showSaveDialogSync({
        title: '保存导出文件',
        defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
        filters,
      });
      if (savePath) item.setSavePath(savePath);
      else item.cancel();
    });
    logLine('下载拦截器注册成功');
  } catch (e) {
    logErr('will-download 注册失败（不影响主功能）', e);
  }

  try {
    createWindow();
  } catch (e) {
    logErr('createWindow 失败', e);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => logErr('whenReady 失败', e));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
