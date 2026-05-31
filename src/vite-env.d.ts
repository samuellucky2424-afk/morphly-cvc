/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    getEngineStatus: () => Promise<{
      healthy: boolean;
      ready: boolean;
      started: boolean;
      crashed: boolean;
      pid: number | null;
      message: string;
      lastCheckedAt: string | null;
      error: string | null;
    }>;
    ensureEngineRunning?: () => Promise<unknown>;
    getAppVersion?: () => Promise<string>;
    getUpdateStatus?: () => Promise<{
      state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
      currentVersion: string;
      latestVersion: string | null;
      percent: number | null;
      canInstall: boolean;
      message: string;
      error: string | null;
      lastCheckedAt: string | null;
    }>;
    checkForUpdates?: () => Promise<unknown>;
    installUpdate?: () => Promise<boolean>;
    openExternal?: (url: string) => Promise<boolean>;
    engineUploadFile?: (
      filename: string,
      data: ArrayBuffer,
      timeoutMs?: number
    ) => Promise<{
      ok: boolean;
      status: number;
      text: string;
    }>;
    engineRequest?: (
      path: string,
      options?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
      timeoutMs?: number
    ) => Promise<{
      ok: boolean;
      status: number;
      text: string;
    }>;
    onEngineStatus?: (callback: (status: unknown) => void) => () => void;
    onUpdateStatus?: (callback: (status: unknown) => void) => () => void;
  };
}
