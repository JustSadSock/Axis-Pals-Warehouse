@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0"

if "%PORT%"=="" set PORT=3000
if "%CLOUDFLARED_TUNNEL%"=="" set CLOUDFLARED_TUNNEL=irgri-tunnel
if "%PUBLIC_TUNNEL_URL%"=="" set PUBLIC_TUNNEL_URL=https://irgri.uk

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js and try again.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Install npm and try again.
  goto fail
)

if not exist node_modules (
  echo Running npm ci...
  npm ci
  if errorlevel 1 goto fail
) else (
  echo Dependencies already installed. Skipping npm ci.
)

if defined CLOUDFLARED_EXE (
  set "CLOUDFLARED_CMD=%CLOUDFLARED_EXE:\"=%""
  if not exist %CLOUDFLARED_CMD% (
    where cloudflared >nul 2>nul
    if errorlevel 1 (
      echo cloudflared was not found. Set CLOUDFLARED_EXE to the executable path.
      goto fail
    ) else (
      for /f "usebackq tokens=*" %%i in (`where cloudflared`) do set "CLOUDFLARED_CMD=%%i"
    )
  )
) else (
  where cloudflared >nul 2>nul
  if errorlevel 1 (
    echo cloudflared was not found. Please install it or set CLOUDFLARED_EXE.
    goto fail
  ) else (
    for /f "usebackq tokens=*" %%i in (`where cloudflared`) do set "CLOUDFLARED_CMD=%%i"
  )
)

:cloudflared_ok
start "axis-pals-local-server" cmd /k "cd /d %~dp0 && set PORT=%PORT% && npm run start"
set "CLOUDFLARED_ARGS=tunnel run %CLOUDFLARED_TUNNEL%"
start "axis-pals-cloudflared" cmd /k call "%CLOUDFLARED_CMD%" %CLOUDFLARED_ARGS%

set "TUNNEL_URL=%PUBLIC_TUNNEL_URL%"
set "WS_URL=%TUNNEL_URL:https://=wss://%"
if not exist scripts mkdir scripts
(
  echo AXIS_PALS_API_URL=%TUNNEL_URL%
  echo AXIS_PALS_WS_URL=%WS_URL%
) > scripts\.axis-pals-tunnel.env

echo Tunnel available: %TUNNEL_URL%
echo Saved tunnel variables to scripts\.axis-pals-tunnel.env

echo All processes started. Press Ctrl+C to exit this launcher.
endlocal
popd
exit /b 0

:fail
echo Failed to start the tunnel. Resolve the issue above and rerun the script.
endlocal
popd
exit /b 1
