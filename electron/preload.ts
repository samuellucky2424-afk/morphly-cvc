import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getEngineStatus: () => ipcRenderer.invoke('engine:get-status'),
  ensureEngineRunning: () => ipcRenderer.invoke('engine:ensure-running'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  engineUploadFile: (filename: string, data: ArrayBuffer, timeoutMs?: number) => ipcRenderer.invoke('engine:upload-file', filename, data, timeoutMs),
  engineRequest: (path: string, options = {}, timeoutMs?: number) => ipcRenderer.invoke('engine:request', path, options, timeoutMs),
  onEngineStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('engine-status', listener);

    return () => {
      ipcRenderer.removeListener('engine-status', listener);
    };
  },
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('update-status', listener);

    return () => {
      ipcRenderer.removeListener('update-status', listener);
    };
  },
});
