@echo off
chcp 65001 >nul
title 停止 · ORBITAL MIRROR
echo 正在查找监听 5180-5190 的 node 进程…
setlocal enabledelayedexpansion
set "FOUND=0"
for /L %%P in (5180,1,5190) do (
  for /f "tokens=*" %%I in ('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue ^| Select-Object -First 1 -ExpandProperty OwningProcess"') do (
    if not "%%I"=="" (
      echo   端口 %%P 被 PID %%I 占用，结束中…
      taskkill /PID %%I /F >nul 2>nul
      set "FOUND=1"
    )
  )
)
if "!FOUND!"=="0" (
  echo   没有发现运行中的服务。
) else (
  echo   已停止。
)
timeout /t 2 >nul
