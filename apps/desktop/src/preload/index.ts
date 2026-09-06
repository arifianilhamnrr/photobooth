import { contextBridge, ipcRenderer } from "electron";
import type { BoothSettings, CameraSource, CloudStatus, DriveStatus, QueueItem, RemoteSessionState, RemoteStatus, StoredSession } from "@photobooth/domain";

contextBridge.exposeInMainWorld("photobooth", {
  system: {
    ping: () => ipcRenderer.invoke("system:ping") as Promise<{ ok: boolean }>,
    setKiosk: (value: boolean) => ipcRenderer.invoke("window:set-kiosk", value) as Promise<{ kiosk: boolean }>
  },
  app: {
    snapshot: () => ipcRenderer.invoke("app:snapshot") as Promise<{ settings: BoothSettings; sessions: StoredSession[]; queue: QueueItem[]; cameraSources: CameraSource[]; selectedCameraSourceId: string; driveStatus: DriveStatus; cloudStatus: CloudStatus }>
  },
  camera: {
    listSources: () => ipcRenderer.invoke("camera:list-sources") as Promise<CameraSource[]>,
    selectSource: (sourceId: string) => ipcRenderer.invoke("camera:select-source", { sourceId }) as Promise<{ selectedCameraSourceId: string }>,
    startLiveView: (sourceId: string) => ipcRenderer.invoke("camera:start-live-view", sourceId) as Promise<{ label: string }>,
    getLiveViewFrame: (sourceId: string) => ipcRenderer.invoke("camera:get-live-view-frame", sourceId) as Promise<{ dataUrl?: string; error?: string }>,
    stopLiveView: () => ipcRenderer.invoke("camera:stop-live-view") as Promise<void>
  },
  drive: {
    getStatus: () => ipcRenderer.invoke("drive:get-status") as Promise<DriveStatus>,
    signIn: () => ipcRenderer.invoke("drive:sign-in") as Promise<DriveStatus>,
    signOut: () => ipcRenderer.invoke("drive:sign-out") as Promise<DriveStatus>,
    createRootFolder: (name: string) => ipcRenderer.invoke("drive:create-root-folder", { name }) as Promise<DriveStatus>
  },
  cloud: {
    getStatus: () => ipcRenderer.invoke("cloud:get-status") as Promise<CloudStatus>
  },
  remote: {
    getStatus: () => ipcRenderer.invoke("remote:get-status") as Promise<RemoteStatus>,
    enable: () => ipcRenderer.invoke("remote:enable") as Promise<RemoteStatus>,
    disable: () => ipcRenderer.invoke("remote:disable") as Promise<RemoteStatus>,
    enableHotspot: () => ipcRenderer.invoke("remote:enable-hotspot") as Promise<RemoteStatus>,
    disableHotspot: () => ipcRenderer.invoke("remote:disable-hotspot") as Promise<RemoteStatus>,
    updateState: (state: RemoteSessionState & { stripPath?: string; gifPath?: string }) => ipcRenderer.invoke("remote:update-state", state) as Promise<{ ok: boolean }>,
    updatePreview: (dataUrl?: string) => ipcRenderer.invoke("remote:update-preview", dataUrl) as Promise<{ ok: boolean }>,
    onCommand: (listener: (command: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
      ipcRenderer.on("remote:command", handler);
      return () => ipcRenderer.removeListener("remote:command", handler);
    }
  },
  settings: {
      update: (settings: Partial<BoothSettings>) => ipcRenderer.invoke("settings:update", settings) as Promise<BoothSettings>
  },
  sessions: {
    create: (input: { templateId: string; filterId: StoredSession["filterId"]; captureCount: 3 | 6; countdownSeconds: StoredSession["countdownSeconds"] }) => ipcRenderer.invoke("session:create", input) as Promise<StoredSession>,
    updateConfig: (input: { sessionId: string; templateId: string; filterId: StoredSession["filterId"]; captureCount?: 3 | 6; countdownSeconds?: StoredSession["countdownSeconds"] }) => ipcRenderer.invoke("session:update-config", input) as Promise<StoredSession>,
    applyFilter: (input: { sessionId: string; filterId: StoredSession["filterId"] }) => ipcRenderer.invoke("session:apply-filter", input) as Promise<StoredSession>,
    captureShot: (input: { sessionId: string; shotIndex: number; dataUrl?: string; countAsRetake?: boolean }) => ipcRenderer.invoke("session:capture-shot", input) as Promise<StoredSession>,
    prepare: (input: { sessionId: string }) => ipcRenderer.invoke("session:prepare", input) as Promise<StoredSession>,
    publish: (input: { sessionId: string }) => ipcRenderer.invoke("session:publish", input) as Promise<StoredSession>,
    sendEmail: (input: { sessionId: string; recipientEmail: string }) => ipcRenderer.invoke("session:send-email", input) as Promise<StoredSession>,
    cancel: (input: { sessionId: string }) => ipcRenderer.invoke("session:cancel", input) as Promise<StoredSession>
  },
  queue: {
    list: () => ipcRenderer.invoke("queue:list") as Promise<QueueItem[]>,
    retry: (sessionId: string) => ipcRenderer.invoke("queue:retry", sessionId) as Promise<{ ok: boolean }>,
    onPublished: (listener: (session: StoredSession) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: StoredSession) => listener(session);
      ipcRenderer.on("sync:published", handler);
      return () => ipcRenderer.removeListener("sync:published", handler);
    },
    onFailed: (listener: (failure: { sessionId: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, failure: { sessionId: string; error: string }) => listener(failure);
      ipcRenderer.on("sync:failed", handler);
      return () => ipcRenderer.removeListener("sync:failed", handler);
    }
  },
  debug: {
    reset: () => ipcRenderer.invoke("store:reset") as Promise<{ ok: boolean }>
  }
});

declare global {
  interface Window {
    photobooth: {
      system: {
        ping(): Promise<{ ok: boolean }>;
        setKiosk(value: boolean): Promise<{ kiosk: boolean }>;
      };
      app: {
        snapshot(): Promise<{ settings: BoothSettings; sessions: StoredSession[]; queue: QueueItem[]; cameraSources: CameraSource[]; selectedCameraSourceId: string; driveStatus: DriveStatus; cloudStatus: CloudStatus }>;
      };
      camera: {
        listSources(): Promise<CameraSource[]>;
        selectSource(sourceId: string): Promise<{ selectedCameraSourceId: string }>;
        startLiveView(sourceId: string): Promise<{ label: string }>;
        getLiveViewFrame(sourceId: string): Promise<{ dataUrl?: string; error?: string }>;
        stopLiveView(): Promise<void>;
      };
      drive: {
        getStatus(): Promise<DriveStatus>;
        signIn(): Promise<DriveStatus>;
        signOut(): Promise<DriveStatus>;
        createRootFolder(name: string): Promise<DriveStatus>;
      };
      cloud: {
        getStatus(): Promise<CloudStatus>;
      };
      remote: {
        getStatus(): Promise<RemoteStatus>;
        enable(): Promise<RemoteStatus>;
        disable(): Promise<RemoteStatus>;
        enableHotspot(): Promise<RemoteStatus>;
        disableHotspot(): Promise<RemoteStatus>;
        updateState(state: RemoteSessionState & { stripPath?: string; gifPath?: string }): Promise<{ ok: boolean }>;
        updatePreview(dataUrl?: string): Promise<{ ok: boolean }>;
        onCommand(listener: (command: string) => void): () => void;
      };
      settings: {
        update(settings: Partial<BoothSettings>): Promise<BoothSettings>;
      };
      sessions: {
        create(input: { templateId: string; filterId: StoredSession["filterId"]; captureCount: 3 | 6; countdownSeconds: StoredSession["countdownSeconds"] }): Promise<StoredSession>;
        updateConfig(input: { sessionId: string; templateId: string; filterId: StoredSession["filterId"]; captureCount?: 3 | 6; countdownSeconds?: StoredSession["countdownSeconds"] }): Promise<StoredSession>;
        applyFilter(input: { sessionId: string; filterId: StoredSession["filterId"] }): Promise<StoredSession>;
        captureShot(input: { sessionId: string; shotIndex: number; dataUrl?: string; countAsRetake?: boolean }): Promise<StoredSession>;
        prepare(input: { sessionId: string }): Promise<StoredSession>;
        publish(input: { sessionId: string }): Promise<StoredSession>;
        sendEmail(input: { sessionId: string; recipientEmail: string }): Promise<StoredSession>;
        cancel(input: { sessionId: string }): Promise<StoredSession>;
      };
      queue: {
        list(): Promise<QueueItem[]>;
        retry(sessionId: string): Promise<{ ok: boolean }>;
        onPublished(listener: (session: StoredSession) => void): () => void;
        onFailed(listener: (failure: { sessionId: string; error: string }) => void): () => void;
      };
      debug: {
        reset(): Promise<{ ok: boolean }>;
      };
    };
  }
}

export {};
