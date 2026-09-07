@echo off
cd /d "%~dp0"
for %%f in ("dist\win-unpacked\*.exe") do (
    start "" "%%f"
    exit /b
)
echo ERROR: exe not found. Please check dist\win-unpacked\ folder.
pause
