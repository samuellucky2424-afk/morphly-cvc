@echo off
setlocal

set "BACKEND_DIR=%~dp0"
cd /d "%BACKEND_DIR%"

if not defined MORPHLY_ENGINE_HOST set "MORPHLY_ENGINE_HOST=127.0.0.1"
if not defined MORPHLY_ENGINE_PORT set "MORPHLY_ENGINE_PORT=18000"

call :install_headless_native_client

rem Prefer the packaged w-okada VCClient Beatrice v2 release.
if exist "%BACKEND_DIR%vcclient-beatrice\dist\main\main.exe" (
  cd /d "%BACKEND_DIR%vcclient-beatrice\dist\main"
  main.exe start --host "%MORPHLY_ENGINE_HOST%" -p %MORPHLY_ENGINE_PORT% --https=False --launch_client=False
  exit /b %ERRORLEVEL%
)

rem RVC .pth voices under voice-mode need the Python voice-changer backend.
if exist "%BACKEND_DIR%voice-mode\manifest.json" (
  if exist "%BACKEND_DIR%start_http.local.bat" (
    call "%BACKEND_DIR%start_http.local.bat"
    exit /b %ERRORLEVEL%
  )
)

rem Prefer a local override when the packaged engine layout differs.
if exist "%BACKEND_DIR%start_http.local.bat" (
  call "%BACKEND_DIR%start_http.local.bat"
  exit /b %ERRORLEVEL%
)

rem Common layout when the upstream w-okada repository is copied into backend\voice-changer.
if exist "%BACKEND_DIR%voice-changer\start_http.bat" (
  rem Forced the launch_client flag to false
  call "%BACKEND_DIR%voice-changer\start_http.bat" --launch_client=False
  exit /b %ERRORLEVEL%
)

rem Common layout for a prepared Python checkout. Keep the server in the foreground
rem so Electron can terminate the full process tree on quit.
if exist "%BACKEND_DIR%voice-changer\server\MMVCServerSIO.py" (
  cd /d "%BACKEND_DIR%voice-changer\server"
  rem Added --launch_client=False flag here as well
  python MMVCServerSIO.py -p %MORPHLY_ENGINE_PORT% --host "%MORPHLY_ENGINE_HOST%" --launch_client=False
  exit /b %ERRORLEVEL%
)

rem Common layout for a compiled or vendor-provided backend executable.
if exist "%BACKEND_DIR%voice-changer.exe" (
  "%BACKEND_DIR%voice-changer.exe" --launch_client=False
  exit /b %ERRORLEVEL%
)

echo Morphly backend launcher could not find a w-okada voice engine.
echo Place the prepared engine under backend\voice-changer or provide start_http.local.bat.
exit /b 1

:install_headless_native_client
set "NATIVE_DIR=%BACKEND_DIR%vcclient-beatrice\dist\main\_internal\native_client"
set "NATIVE_EXE=%NATIVE_DIR%\voice-changer-native-client.exe"
set "NATIVE_REAL=%NATIVE_DIR%\voice-changer-native-client.real.exe"
set "HEADLESS_STUB=%BACKEND_DIR%native-client-headless-stub.exe"

if not exist "%HEADLESS_STUB%" exit /b 0
if not exist "%NATIVE_DIR%" exit /b 0

taskkill /F /IM voice-changer-native-client.exe >nul 2>nul

if not exist "%NATIVE_REAL%" (
  if exist "%NATIVE_EXE%" move /Y "%NATIVE_EXE%" "%NATIVE_REAL%" >nul
)

copy /Y "%HEADLESS_STUB%" "%NATIVE_EXE%" >nul
exit /b 0
