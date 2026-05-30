@echo off
setlocal

set "BACKEND_DIR=%~dp0"
set "SERVER_DIR=%BACKEND_DIR%voice-changer\server"
set "PYTHON_EXE=%BACKEND_DIR%.venv\Scripts\python.exe"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

if not defined MORPHLY_ENGINE_HOST set "MORPHLY_ENGINE_HOST=127.0.0.1"
if not defined MORPHLY_ENGINE_PORT set "MORPHLY_ENGINE_PORT=18000"

if not exist "%PYTHON_EXE%" (
  echo Morphly backend venv was not found: %PYTHON_EXE%
  exit /b 1
)

if not exist "%SERVER_DIR%\MMVCServerSIO.py" (
  echo w-okada server was not found: %SERVER_DIR%\MMVCServerSIO.py
  exit /b 1
)

cd /d "%SERVER_DIR%"
if not exist "%SERVER_DIR%\model_dir" mkdir "%SERVER_DIR%\model_dir"
"%PYTHON_EXE%" -c "import os; from const import getSampleJsonAndModelIds; from downloader.Downloader import download_no_tqdm; urls, _ = getSampleJsonAndModelIds('production'); [download_no_tqdm({'url': url, 'saveTo': os.path.basename(url), 'position': 0}) for url in urls if (not os.path.exists(os.path.basename(url)) or os.path.getsize(os.path.basename(url)) < 100)]"
if errorlevel 1 exit /b %ERRORLEVEL%
"%PYTHON_EXE%" -m uvicorn MMVCServerSIO:app_socketio --host "%MORPHLY_ENGINE_HOST%" --port %MORPHLY_ENGINE_PORT% --log-level error --no-access-log
