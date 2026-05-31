import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

type EngineStatus = {
  healthy: boolean;
  ready: boolean;
  started: boolean;
  crashed: boolean;
  pid: number | null;
  message: string;
  lastCheckedAt: string | null;
  error: string | null;
};

type UpdateStatus = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  percent: number | null;
  canInstall: boolean;
  message: string;
  error: string | null;
  lastCheckedAt: string | null;
};

const engineUrl = process.env.MORPHLY_ENGINE_URL || 'http://127.0.0.1:18000';
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || '';
const backendBootGraceMs = 180_000;
const watchdogIntervalMs = 5_000;
const restartDelayMs = 1_500;
const maxHealthFailuresBeforeRestart = 3;

let mainWindow: BrowserWindow | null = null;
let engineProcess: ChildProcessWithoutNullStreams | null = null;
let isQuitting = false;
let hasLoadedRenderer = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let healthFailures = 0;
let lastBackendStartAt = 0;
let engineControlInFlightUntil = 0;
let updateCheckInFlight = false;
let backendOutputTail = '';

let engineStatus: EngineStatus = {
  healthy: false,
  ready: false,
  started: false,
  crashed: false,
  pid: null,
  message: 'Starting voice engine...',
  lastCheckedAt: null,
  error: null,
};

let updateStatus: UpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  percent: null,
  canInstall: false,
  message: 'Ready to check for updates.',
  error: null,
  lastCheckedAt: null,
};

function getPreloadPath() {
  return join(__dirname, 'preload.cjs');
}

function getAppRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }

  return existsSync(join(process.cwd(), 'package.json')) ? process.cwd() : app.getAppPath();
}

function getBackendDir() {
  return app.isPackaged ? join(process.resourcesPath, 'backend') : join(getAppRoot(), 'backend');
}

function getBackendLauncher() {
  const backendDir = getBackendDir();
  const candidates = ['start_http.bat', 'start_http.cmd', 'start_http.exe', 'voice-changer.exe'];
  const launcher = candidates.map((file) => join(backendDir, file)).find((file) => existsSync(file));

  return launcher ? { backendDir, launcher } : null;
}

function isBackendProcessRunning() {
  return Boolean(engineProcess && !engineProcess.killed && engineProcess.exitCode === null);
}

function setEngineStatus(patch: Partial<EngineStatus>) {
  engineStatus = {
    ...engineStatus,
    ...patch,
    lastCheckedAt: new Date().toISOString(),
  };

  mainWindow?.webContents.send('engine-status', engineStatus);
  updateLoadingScreen(engineStatus.message, engineStatus.error || '');
}

function setUpdateStatus(patch: Partial<UpdateStatus>) {
  updateStatus = {
    ...updateStatus,
    ...patch,
    currentVersion: app.getVersion(),
    lastCheckedAt: new Date().toISOString(),
  };

  mainWindow?.webContents.send('update-status', updateStatus);
}

function appendBackendOutput(text: string) {
  backendOutputTail = `${backendOutputTail}${text}`.replace(/\r/g, '');

  if (backendOutputTail.length > 2400) {
    backendOutputTail = backendOutputTail.slice(-2400);
  }
}

function backendExitDetail(reason: string) {
  const output = backendOutputTail.trim();

  return output ? `${reason}\n${output}` : reason;
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    setUpdateStatus({
      state: 'checking',
      percent: null,
      canInstall: false,
      message: 'Checking for the latest Morphly release...',
      error: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdateStatus({
      state: 'available',
      latestVersion: info.version || null,
      percent: 0,
      canInstall: false,
      message: `Morphly ${info.version} is available. Downloading update...`,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent || 0)),
      canInstall: false,
      message: 'Downloading the latest Morphly installer...',
      error: null,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    setUpdateStatus({
      state: 'not-available',
      latestVersion: info.version || app.getVersion(),
      percent: null,
      canInstall: false,
      message: 'Morphly is up to date.',
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateStatus({
      state: 'downloaded',
      latestVersion: info.version || null,
      percent: 100,
      canInstall: true,
      message: 'Update downloaded. Reinstall to finish the upgrade.',
      error: null,
    });
  });

  autoUpdater.on('error', (error) => {
    updateCheckInFlight = false;
    setUpdateStatus({
      state: 'error',
      percent: null,
      canInstall: false,
      message: 'Could not check for updates.',
      error: error.message,
    });
  });
}

async function checkForAppUpdates() {
  if (!app.isPackaged) {
    setUpdateStatus({
      state: 'not-available',
      percent: null,
      canInstall: false,
      message: 'Update checks are available in the installed Morphly app.',
      error: null,
    });
    return updateStatus;
  }

  if (updateCheckInFlight) {
    return updateStatus;
  }

  if (updateStatus.state === 'available' || updateStatus.state === 'downloading' || updateStatus.state === 'downloaded') {
    return updateStatus;
  }

  updateCheckInFlight = true;

  try {
    await autoUpdater.checkForUpdates();
    return updateStatus;
  } finally {
    updateCheckInFlight = false;
  }
}

function installDownloadedUpdate() {
  if (!updateStatus.canInstall) {
    throw new Error('No downloaded update is ready to install.');
  }

  setUpdateStatus({
    message: 'Restarting Morphly to install the update...',
    error: null,
  });
  isQuitting = true;
  shutdownBackend();
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function loadingHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Morphly Voice Console</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #080b10;
        color: #e2e8f0;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      body {
        display: grid;
        place-items: center;
        background:
          linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
          linear-gradient(135deg, #080b10 0%, #0d1118 48%, #111410 100%);
        background-size: 36px 36px, 36px 36px, 100% 100%;
      }
      .shell {
        width: min(460px, calc(100vw - 48px));
        border: 1px solid rgba(148, 163, 184, 0.15);
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.68);
        padding: 30px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32);
      }
      .brand {
        color: #99f6e4;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.24em;
        margin-bottom: 14px;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        color: #94a3b8;
        font-size: 14px;
        line-height: 1.55;
        margin: 10px 0 0;
      }
      .bar {
        height: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(51, 65, 85, 0.7);
        margin-top: 24px;
      }
      .bar span {
        display: block;
        width: 45%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #2dd4bf, #facc15);
        animation: load 1.2s ease-in-out infinite;
      }
      @keyframes load {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(260%); }
      }
      .detail {
        min-height: 19px;
        color: #fda4af;
        font-size: 12px;
        margin-top: 14px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="brand">Morphly</div>
      <h1 id="message">Starting voice engine...</h1>
      <p>Launching the local w-okada backend on 127.0.0.1:18000.</p>
      <div class="bar"><span></span></div>
      <div class="detail" id="detail"></div>
    </main>
    <script>
      window.setEngineState = function (state) {
        document.getElementById('message').textContent = state.message || 'Starting engine...';
        document.getElementById('detail').textContent = state.detail || '';
      };
    </script>
  </body>
</html>`;
}

function updateLoadingScreen(message: string, detail = '') {
  if (!mainWindow || mainWindow.isDestroyed() || hasLoadedRenderer) {
    return;
  }

  const safeDetail = detail.length > 900 ? `${detail.slice(0, 900)}...` : detail;

  mainWindow.webContents
    .executeJavaScript(`window.setEngineState(${JSON.stringify({ message, detail: safeDetail })})`)
    .catch(() => undefined);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: 'Morphly Voice Console',
    backgroundColor: '#080b10',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml())}`);
}

function startBackend() {
  if (isBackendProcessRunning()) {
    return;
  }

  engineProcess = null;
  backendOutputTail = '';
  lastBackendStartAt = Date.now();

  const backend = getBackendLauncher();

  if (!backend) {
    setEngineStatus({
      healthy: false,
      started: false,
      crashed: false,
      pid: null,
      message: 'Waiting for voice engine...',
      error: `No backend launcher found in ${getBackendDir()}.`,
    });
    return;
  }

  const extension = extname(backend.launcher).toLowerCase();
  const isBatch = extension === '.bat' || extension === '.cmd';
  const command = isBatch ? process.env.ComSpec || 'cmd.exe' : backend.launcher;
  const args = isBatch ? ['/d', '/s', '/c', 'call', backend.launcher] : [];

  engineProcess = spawn(command, args, {
    cwd: backend.backendDir,
    detached: false,
    env: {
      ...process.env,
      MORPHLY_ENGINE_PORT: '18000',
      MORPHLY_ENGINE_HOST: '127.0.0.1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  engineProcess.stdout.on('data', (chunk) => {
    appendBackendOutput(chunk.toString());
  });

  engineProcess.stderr.on('data', (chunk) => {
    appendBackendOutput(chunk.toString());
  });

  setEngineStatus({
    healthy: true,
    started: true,
    crashed: false,
    pid: engineProcess.pid ?? null,
    message: 'Starting voice engine...',
    error: null,
  });

  engineProcess.on('error', (error) => {
    engineProcess = null;
    setEngineStatus({
      healthy: false,
      ready: false,
      crashed: true,
      message: 'Voice engine failed to launch.',
      error: error.message,
    });
    scheduleBackendRestart(backendExitDetail(error.message));
  });

  engineProcess.on('exit', (code, signal) => {
    engineProcess = null;

    if (isQuitting) {
      return;
    }

    setEngineStatus({
      healthy: false,
      ready: false,
      crashed: true,
      message: 'Voice engine stopped unexpectedly.',
      error: backendExitDetail(`Exit code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}.`),
    });
    scheduleBackendRestart(backendExitDetail(`Exit code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}.`));
  });
}

function scheduleBackendRestart(reason: string, delay = restartDelayMs) {
  if (isQuitting || restartTimer) {
    return;
  }

  setEngineStatus({
    healthy: false,
    ready: false,
    started: false,
    crashed: true,
    pid: null,
    message: 'Restarting voice engine...',
    error: reason,
  });

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (!isQuitting) {
      startBackend();
    }
  }, delay);
}

function restartBackend(reason: string) {
  if (isQuitting || restartTimer || Date.now() < engineControlInFlightUntil) {
    return;
  }

  shutdownBackend();
  scheduleBackendRestart(reason);
}

async function checkBackendReady() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1700);

  try {
    const response = await fetch(`${engineUrl}/api/hello`, {
      method: 'GET',
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForBackendAndLoadRenderer() {
  if (!(await checkBackendReady())) {
    startBackend();
  }

  let attempts = 0;

  while (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    attempts += 1;

    if (await checkBackendReady()) {
      healthFailures = 0;
      setEngineStatus({
        healthy: true,
        ready: true,
        started: true,
        crashed: false,
        message: 'Voice engine is ready.',
        error: null,
      });
      await loadRenderer();
      return;
    }

    if (!isBackendProcessRunning() && !restartTimer) {
      startBackend();
    }

    setEngineStatus({
      ready: false,
      message: 'Waiting for voice engine...',
      error: attempts > 8 ? `Still waiting for ${engineUrl}/api/hello to respond.` : null,
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function startEngineWatchdog() {
  if (watchdogTimer) {
    return;
  }

  watchdogTimer = setInterval(() => {
    void (async () => {
      if (isQuitting) {
        return;
      }

      if (Date.now() < engineControlInFlightUntil) {
        return;
      }

      if (await checkBackendReady()) {
        healthFailures = 0;
        setEngineStatus({
          healthy: true,
          ready: true,
          started: true,
          crashed: false,
          message: 'Voice engine is ready.',
          error: null,
        });
        return;
      }

      if (!isBackendProcessRunning() && !restartTimer) {
        scheduleBackendRestart('Backend process is not running.');
        return;
      }

      const stillBooting = Date.now() - lastBackendStartAt < backendBootGraceMs;
      if (stillBooting) {
        healthFailures = 0;
      } else {
        healthFailures += 1;
      }

      setEngineStatus({
        healthy: false,
        ready: false,
        message: stillBooting ? 'Starting voice engine...' : 'Recovering voice engine...',
        error: stillBooting ? null : 'The local engine health check did not respond.',
      });

      if (!stillBooting && healthFailures >= maxHealthFailuresBeforeRestart) {
        healthFailures = 0;
        restartBackend('The local engine stopped responding to /api/hello.');
      }
    })();
  }, watchdogIntervalMs);
}

async function ensureBackendRunning() {
  if (await checkBackendReady()) {
    healthFailures = 0;
    setEngineStatus({
      healthy: true,
      ready: true,
      started: true,
      crashed: false,
      message: 'Voice engine is ready.',
      error: null,
    });
    return engineStatus;
  }

  if (!isBackendProcessRunning() && !restartTimer) {
    startBackend();
  }

  return engineStatus;
}

async function loadRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  hasLoadedRenderer = true;

  if (rendererDevUrl) {
    await mainWindow.loadURL(rendererDevUrl);
    return;
  }

  await mainWindow.loadFile(join(getAppRoot(), 'dist', 'index.html'));
}

function shutdownBackend() {
  if (!engineProcess?.pid) {
    return;
  }

  const pid = String(engineProcess.pid);

  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/pid', pid, '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      engineProcess.kill('SIGTERM');
    }
  } catch {
    try {
      engineProcess.kill('SIGKILL');
    } catch {
      // Process is already gone.
    }
  } finally {
    engineProcess = null;
  }
}

ipcMain.handle('engine:get-status', () => engineStatus);
ipcMain.handle('engine:ensure-running', () => ensureBackendRunning());
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('update:get-status', () => updateStatus);
ipcMain.handle('update:check', () => checkForAppUpdates());
ipcMain.handle('update:install', () => installDownloadedUpdate());
ipcMain.handle('app:open-external', async (_event, url: string) => {
  const allowedUrls = new Set(['https://vb-audio.com/Cable/']);

  if (!allowedUrls.has(url)) {
    throw new Error('Blocked external URL.');
  }

  await shell.openExternal(url);
  return true;
});
ipcMain.handle('engine:upload-file', async (_event, filename: string, data: ArrayBuffer | Uint8Array, timeoutMs = 180_000) => {
  if (!filename || data == null) {
    throw new Error('Missing upload file data.');
  }

  engineControlInFlightUntil = Math.max(engineControlInFlightUntil, Date.now() + Math.max(Number(timeoutMs) || 180_000, 180_000));

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const body = new FormData();
  body.set('filename', filename);
  body.set('file', new Blob([payload]), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs) || 180_000);

  try {
    const response = await fetch(`${engineUrl}/upload_file`, {
      method: 'POST',
      body,
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
});
ipcMain.handle('engine:request', async (_event, path: string, options: RequestInit = {}, timeoutMs = 8_000) => {
  const allowedLegacyPaths = ['/info', '/performance', '/update_settings', '/load_model', '/onnx', '/optimize_model'];
  const allowedPath =
    typeof path === 'string' &&
    (path.startsWith('/api/') || allowedLegacyPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}?`)));

  if (!allowedPath) {
    throw new Error('Blocked engine request path.');
  }

  const method = options.method || 'GET';
  const isControlRequest =
    method !== 'GET' ||
    path.includes('/local-voice-changer-interface/operation/') ||
    path.includes('/configuration-manager/configuration') ||
    path.includes('/slot-manager/slots');

  if (isControlRequest) {
    engineControlInFlightUntil = Math.max(engineControlInFlightUntil, Date.now() + Math.max(Number(timeoutMs) || 8_000, 30_000));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs) || 8_000);

  try {
    const response = await fetch(`${engineUrl}${path}`, {
      method,
      body: typeof options.body === 'string' ? options.body : undefined,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...((options.headers as Record<string, string> | undefined) || {}),
      },
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
});

app.whenReady().then(() => {
  configureAutoUpdater();

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'speaker-selection');
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'speaker-selection';
  });

  createMainWindow();
  startEngineWatchdog();
  waitForBackendAndLoadRenderer();
  setTimeout(() => {
    void checkForAppUpdates();
  }, 12_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      waitForBackendAndLoadRenderer();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  shutdownBackend();
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('exit', () => {
  shutdownBackend();
});
