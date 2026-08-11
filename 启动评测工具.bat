@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
echo.
echo  ========================================
echo    标签准确率评测工具
echo    正在启动服务...
echo  ========================================
echo.
node server.js
pause
