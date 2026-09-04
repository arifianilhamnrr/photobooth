export const APP_NAME = "Photobooth";

export type FilterId = "original" | "mono" | "warm" | "cool" | "contrast";

export interface FilterOption {
  id: FilterId;
  label: string;
  cssFilter: string;
}

export interface TemplateSlot {
  id: string;
  photoIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  cornerRadius: number;
}

export interface PhotoTemplate {
  id: string;
  name: string;
  description: string;
  captureCount: number;
  width: number;
  height: number;
  overlayAsset: string;
  slots: TemplateSlot[];
}

export interface SessionShot {
  shotIndex: number;
  attemptsUsed: number;
}

export type SessionStatus =
  | "draft"
  | "capturing"
  | "reviewing"
  | "saved_local"
  | "sync_pending"
  | "published";

export interface StoredShot {
  shotIndex: number;
  revision: number;
  attemptsUsed: number;
  color: string;
  dataUrl?: string;
  filePath?: string;
  capturedAt: string;
}

export interface StoredSession {
  id: string;
  templateId: string;
  filterId: FilterId;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  recipientEmail?: string;
  driveUrl?: string;
  finalStripPath?: string;
  finalStripDataUrl?: string;
  sessionDir?: string;
  shots: StoredShot[];
}

export interface BoothSettings {
  eventName: string;
  accentColor: string;
  retakeLimitPerPhoto: number;
  countdownSeconds: number;
  poseBreakSeconds: number;
  autoResetSeconds: number;
  driveRootFolderName: string;
  slotOverrides: Record<string, TemplateSlot[]>;
}

export interface QueueItem {
  sessionId: string;
  status: "waiting" | "syncing" | "published";
  createdAt: string;
  updatedAt: string;
  driveUrl?: string;
}

export interface CameraSource {
  id: string;
  label: string;
}

export interface DriveStatus {
  mode: "mock" | "configured" | "authenticated";
  email?: string;
  rootFolderId?: string;
  rootFolderName?: string;
}

export interface CloudStatus {
  mode: "unconfigured" | "configured";
  baseUrl?: string;
}

export interface AppSnapshot {
  settings: BoothSettings;
  sessions: StoredSession[];
}

export const filters: FilterOption[] = [
  { id: "original", label: "Original", cssFilter: "none" },
  { id: "mono", label: "Mono", cssFilter: "grayscale(1) contrast(1.08)" },
  { id: "warm", label: "Warm", cssFilter: "sepia(0.26) saturate(1.15) hue-rotate(-6deg) brightness(1.02)" },
  { id: "cool", label: "Cool", cssFilter: "saturate(0.92) hue-rotate(12deg) contrast(1.03) brightness(1.01)" },
  { id: "contrast", label: "Punch", cssFilter: "contrast(1.16) saturate(1.1) brightness(0.98)" }
];

export const defaultSettings: BoothSettings = {
  eventName: "Studio Offline Booth",
  accentColor: "#ff7048",
  retakeLimitPerPhoto: 1,
  countdownSeconds: 3,
  poseBreakSeconds: 2,
  autoResetSeconds: 60,
  driveRootFolderName: "Photobooth Sessions",
  slotOverrides: {}
};

export const templates: PhotoTemplate[] = [
  {
    id: "frame-1",
    name: "Frame Original",
    description: "Frame awal Collaboration Day dengan komposisi dua kolom.",
    captureCount: 6,
    width: 3765,
    height: 5610,
    overlayAsset: "frame-1.png",
    slots: [
      { id: "slot-1", photoIndex: 0, x: 221, y: 958, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 },
      { id: "slot-2", photoIndex: 1, x: 1937, y: 958, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 },
      { id: "slot-3", photoIndex: 2, x: 221, y: 2263, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 },
      { id: "slot-4", photoIndex: 3, x: 1937, y: 2263, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 },
      { id: "slot-5", photoIndex: 4, x: 221, y: 3567, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 },
      { id: "slot-6", photoIndex: 5, x: 1937, y: 3567, width: 1601, height: 1200, rotation: 0, cornerRadius: 24 }
    ]
  },
  {
    id: "frame-2",
    name: "Frame Aurora",
    description: "Warna cerah dan playful untuk hasil yang lebih rame.",
    captureCount: 6,
    width: 386,
    height: 574,
    overlayAsset: "frame-2.png",
    slots: [
      { id: "slot-1", photoIndex: 0, x: 22, y: 82, width: 141, height: 141, rotation: 0, cornerRadius: 5 },
      { id: "slot-2", photoIndex: 1, x: 219, y: 99, width: 142, height: 119, rotation: 0, cornerRadius: 5 },
      { id: "slot-3", photoIndex: 2, x: 21, y: 232, width: 133, height: 139, rotation: 0, cornerRadius: 5 },
      { id: "slot-4", photoIndex: 3, x: 219, y: 236, width: 142, height: 118, rotation: 0, cornerRadius: 5 },
      { id: "slot-5", photoIndex: 4, x: 22, y: 380, width: 140, height: 140, rotation: 0, cornerRadius: 5 },
      { id: "slot-6", photoIndex: 5, x: 219, y: 373, width: 142, height: 118, rotation: 0, cornerRadius: 5 }
    ]
  },
  {
    id: "frame-3",
    name: "Frame Garden",
    description: "Versi yang paling netral untuk default event booth.",
    captureCount: 6,
    width: 386,
    height: 574,
    overlayAsset: "frame-3.png",
    slots: [
      { id: "slot-1", photoIndex: 0, x: 17, y: 72, width: 158, height: 138, rotation: 0, cornerRadius: 5 },
      { id: "slot-2", photoIndex: 1, x: 210, y: 72, width: 158, height: 138, rotation: 0, cornerRadius: 5 },
      { id: "slot-3", photoIndex: 2, x: 17, y: 218, width: 158, height: 138, rotation: 0, cornerRadius: 5 },
      { id: "slot-4", photoIndex: 3, x: 210, y: 218, width: 158, height: 138, rotation: 0, cornerRadius: 5 },
      { id: "slot-5", photoIndex: 4, x: 17, y: 363, width: 158, height: 138, rotation: 0, cornerRadius: 5 },
      { id: "slot-6", photoIndex: 5, x: 210, y: 363, width: 158, height: 138, rotation: 0, cornerRadius: 5 }
    ]
  },
  {
    id: "frame-4",
    name: "Frame Midnight",
    description: "Nuansa gelap dan lebih dramatis untuk strip malam.",
    captureCount: 6,
    width: 386,
    height: 574,
    overlayAsset: "frame-4.png",
    slots: [
      { id: "slot-1", photoIndex: 0, x: 13, y: 108, width: 166, height: 124, rotation: 0, cornerRadius: 4 },
      { id: "slot-2", photoIndex: 1, x: 207, y: 108, width: 166, height: 124, rotation: 0, cornerRadius: 4 },
      { id: "slot-3", photoIndex: 2, x: 13, y: 237, width: 166, height: 124, rotation: 0, cornerRadius: 4 },
      { id: "slot-4", photoIndex: 3, x: 207, y: 237, width: 166, height: 124, rotation: 0, cornerRadius: 4 },
      { id: "slot-5", photoIndex: 4, x: 13, y: 367, width: 166, height: 124, rotation: 0, cornerRadius: 4 },
      { id: "slot-6", photoIndex: 5, x: 207, y: 367, width: 166, height: 124, rotation: 0, cornerRadius: 4 }
    ]
  },
  {
    id: "frame-5",
    name: "Frame Bloom",
    description: "Pilihan lebih dekoratif dengan warna yang lebih manis.",
    captureCount: 6,
    width: 386,
    height: 574,
    overlayAsset: "frame-5.png",
    slots: [
      { id: "slot-1", photoIndex: 0, x: 31, y: 91, width: 130, height: 98, rotation: 0, cornerRadius: 5 },
      { id: "slot-2", photoIndex: 1, x: 223, y: 127, width: 130, height: 90, rotation: 0, cornerRadius: 5 },
      { id: "slot-3", photoIndex: 2, x: 31, y: 211, width: 130, height: 89, rotation: 0, cornerRadius: 5 },
      { id: "slot-4", photoIndex: 3, x: 223, y: 238, width: 130, height: 90, rotation: 0, cornerRadius: 5 },
      { id: "slot-5", photoIndex: 4, x: 31, y: 322, width: 130, height: 91, rotation: 0, cornerRadius: 5 },
      { id: "slot-6", photoIndex: 5, x: 223, y: 350, width: 130, height: 89, rotation: 0, cornerRadius: 5 }
    ]
  }
];

export function getTemplate(templateId: string): PhotoTemplate {
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  return template;
}

export function createSessionId(date = new Date()): string {
  return `SESI-${date.getTime().toString(36).toUpperCase()}`;
}

export function buildShotColor(shotIndex: number, revision: number): string {
  const hue = (shotIndex * 74 + revision * 39 + 12) % 360;
  return `hsl(${hue}deg 74% 54%)`;
}
