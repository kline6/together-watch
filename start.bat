@echo off
chcp 65001 >/dev/null 2>&1
title WatchTogether

set "PATH=C:\Program Files
odejs;%PATH%"
cd /d "%~dp0"
echo Current dir: %cd%
node --version
if errorlevel 1 (
    echo Node.js not found!
    pause
    exit /b 1
)
echo Starting...
call npm run dev
pause
