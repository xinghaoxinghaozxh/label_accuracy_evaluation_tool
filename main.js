const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: '标签准确率评测工具',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 允许页面加载远程图片（命中数据URL来自外部图床/CDN），无需开启 nodeIntegration
    },
  });

  // 直接加载本地静态页面，所有解析/标注逻辑均在页面内完成，无需后端服务
  win.loadFile(path.join(__dirname, 'public', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
