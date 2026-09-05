import { contextBridge, ipcRenderer } from "electron";
import type { BoothSettings, CameraSource, CloudStatus, DriveStatus, QueueItem, StoredSession } from "@photobooth/domain";

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
    selectSource: (sourceId: string) => ipcRenderer.invoke("camera:select-source", { sourceId }) as Promise<{ selectedCameraSourceId: string }>
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
  settings: {
      update: (settings: Partial<BoothSettings>) => ipcRenderer.invoke("settings:update", settings) as Promise<BoothSettings>
  },
  sessions: {
    create: (input: { templateId: string; filterId: StoredSession["filterId"] }) => ipcRenderer.invoke("session:create", input) as Promise<StoredSession>,
    updateConfig: (input: { sessionId: string; templateId: string; filterId: StoredSession["filterId"] }) => ipcRenderer.invoke("session:update-config", input) as Promise<StoredSession>,
    captureShot: (input: { sessionId: string; shotIndex: number; dataUrl?: string; countAsRetake?: boolean }) => ipcRenderer.invoke("session:capture-shot", input) as Promise<StoredSession>,
    publish: (input: { sessionId: string; recipientEmail: string }) => ipcRenderer.invoke("session:publish", input) as Promise<StoredSession>
  },
  queue: {
    list: () => ipcRenderer.invoke("queue:list") as Promise<QueueItem[]>
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
      settings: {
        update(settings: Partial<BoothSettings>): Promise<BoothSettings>;
      };
      sessions: {
        create(input: { templateId: string; filterId: StoredSession["filterId"] }): Promise<StoredSession>;
        updateConfig(input: { sessionId: string; templateId: string; filterId: StoredSession["filterId"] }): Promise<StoredSession>;
        captureShot(input: { sessionId: string; shotIndex: number; dataUrl?: string; countAsRetake?: boolean }): Promise<StoredSession>;
        publish(input: { sessionId: string; recipientEmail: string }): Promise<StoredSession>;
      };
      queue: {
        list(): Promise<QueueItem[]>;
      };
      debug: {
        reset(): Promise<{ ok: boolean }>;
      };
    };
  }
}

export {};
