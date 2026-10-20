@echo off
chcp 65001 >nul
title 地球卫星全息镜像 · ORBITAL MIRROR
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js。
  echo   请先安装 Node.js 18 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   ==========================================
echo    地球卫星全息镜像 · ORBITAL MIRROR
echo    http://127.0.0.1:5180/
echo   ==========================================
echo.
echo   正在启动数据服务，浏览器即将自动打开...
echo   关闭本窗口即可停止服务。
echo.

start "" cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:5180/"
node server.mjs --port 5180

pause
