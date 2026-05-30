import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getEngineStatus: () => ipcRenderer.invoke('engine:get-status'),
  ensureEngineRunning: () => ipcRenderer.invoke('engine:ensure-running'),
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
});
