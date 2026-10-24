@echo off
chcp 65001 >nul
title 地球卫星全息镜像 · ORBITAL MIRROR
cd /d "%~dp0"

set "PORT=5180"
set "MAXPORT=5190"
set "HOST=0.0.0.0"
if /i "%~1"=="local" set "HOST=127.0.0.1"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js。请先安装 Node.js 18+：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

:pickport
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if not errorlevel 1 goto startserver

rem 端口被占用：先看是不是已经在跑本服务
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:%PORT%/api/health' -UseBasicParsing -TimeoutSec 3; $a = (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress -Unique) -join ','; if ($r.Content -match 'ok' -and $a -and $a -notmatch '^(127\.|::1)') { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  echo.
  echo   检测到服务已在 %PORT% 端口运行，直接打开浏览器。
  start "" http://127.0.0.1:%PORT%/
  timeout /t 2 >nul
  exit /b 0
)

set /a PORT+=1
if %PORT% GTR %MAXPORT% (
  echo   [错误] 端口 %MAXPORT% 以内都被占用，请先关闭占用程序（或用 停止.bat）。
  pause
  exit /b 1
)
echo   端口被其它程序占用，改用 %PORT% ...
goto pickport

:startserver
echo.
echo   ==========================================
echo    地球卫星全息镜像 · ORBITAL MIRROR
echo    本机访问: http://127.0.0.1:%PORT%/
if "%HOST%"=="0.0.0.0" (
  echo    局域网:   同一 Wi-Fi 下用 http://^<本机IPv4^>:%PORT%/ ^(ipconfig 可查^)
) else (
  echo    局域网:   已关闭（仅本机模式，加参数 local 以外的默认即开启）
)
echo   ==========================================
echo.
echo   正在启动数据服务，浏览器即将自动打开…
echo   关闭本窗口即停止服务
echo.

start "" cmd /c "timeout /t 3 >nul & start "" http://127.0.0.1:%PORT%/"
node server.mjs --host %HOST% --port %PORT%

echo.
echo   服务已退出。
pause
