@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
chcp 65001 >nul
echo ========================================
echo   一起看吧 · 启动中...
echo ========================================
echo.
echo [1/2] 启动服务端...
cd /d "e:\项目合集\project5\server"
start "服务端" cmd /k npm run dev
timeout /t 3 /nobreak >nul
echo [2/2] 启动客户端...
cd /d "e:\项目合集\project5\client"
start "客户端" cmd /k npm run dev
cd /d "e:\项目合集\project5"
echo.
echo 启动完成！请在浏览器打开 http://localhost:5173
echo.
pause
