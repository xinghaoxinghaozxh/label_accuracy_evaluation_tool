@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

echo ====================================
echo   DIAGNOSTIC MODE (errors shown)
echo ====================================
echo.

for %%f in ("dist\win-unpacked\*.exe") do (
    echo Starting: %%f
    echo.
    "%%f" > diag_run.log 2>&1
    echo EXIT_CODE=!errorlevel! >> diag_run.log
    goto :show
)

echo ERROR: no exe found in dist\win-unpacked\
pause
exit /b

:show
echo ---------- APP OUTPUT ----------
type diag_run.log
echo.
echo ---------- APP RUN LOG ----------
set FOUND_LOG=
for /f "delims=" %%f in ('dir /b "dist\*.txt" 2^>nul') do (
    set FOUND_LOG=1
    echo --- dist\%%f ---
    type "dist\%%f"
)
if not defined FOUND_LOG (
    echo No run log found in dist\. That means main.js never executed.
)
echo.
echo ====================================
echo   Please screenshot ALL text above
echo ====================================
pause
