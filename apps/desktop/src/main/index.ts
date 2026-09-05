import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { BrevoEmailService, CloudflareUploadService, GoogleDriveService } from "@photobooth/drive";
import {
  buildShotColor,
  type CameraSource,
  type CloudStatus,
  createSessionId,
  defaultSettings,
  type DriveStatus,
  getTemplate,
  type BoothSettings,
  type FilterId,
  type QueueItem,
  type SessionStatus,
  type StoredSession,
  type StoredShot
} from "@photobooth/domain";
import {
  ensureSessionDirectories,
  openDatabase,
  queueFromSessions,
  readSnapshotFromDatabase,
  upsertSessionInDatabase,
  writeDataUrlToFile,
  writeSettingsToDatabase
} from "@photobooth/storage";

let mainWindow: BrowserWindow | null = null;
const databasePath = join(app.getPath("userData"), "photobooth.sqlite");
const sessionsBaseDir = join(app.getPath("userData"), "sessions");
const stripRendererPath = app.isPackaged
  ? join(process.resourcesPath, "render-strip.cjs")
  : join(app.getAppPath(), "resources", "render-strip.cjs");
const driveAuthPath = join(app.getPath("userData"), "drive-auth.json");
const iconPath = join(app.getAppPath(), "resources", process.platform === "win32" ? "icon.ico" : "icon.png");
const execFileAsync = promisify(execFile);
let selectedCameraSourceId = "webcam:default";
let database = openDatabase(databasePath);
const cloudflareService = new CloudflareUploadService(process.env.PHOTOBOOTH_CLOUD_URL ?? "https://photobooth.collaborationday2026.web.id");
const brevoEmailService = new BrevoEmailService({
  apiKey: process.env.BREVO_API_KEY,
  smtpLogin: process.env.BREVO_SMTP_LOGIN ?? "ab3ed4001@smtp-brevo.com",
  senderEmail: process.env.BREVO_SENDER_EMAIL ?? "noreply@collaborationday2026.web.id",
  senderName: process.env.BREVO_SENDER_NAME ?? "Collaboration Day 2026 Photobooth"
});
const driveService = new GoogleDriveService(
  {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET
  },
  driveAuthPath,
  async (url: string) => {
    await execFileAsync(process.platform === "win32" ? "cmd" : "xdg-open", process.platform === "win32" ? ["/c", "start", "", url] : [url]);
  }
);

interface CreateSessionInput {
  templateId: string;
  filterId: FilterId;
}

interface CaptureShotInput {
  sessionId: string;
  shotIndex: number;
  dataUrl?: string;
  countAsRetake?: boolean;
}

interface PublishSessionInput {
  sessionId: string;
}

interface SendSessionEmailInput {
  sessionId: string;
  recipientEmail: string;
}

interface UpdateSessionConfigInput {
  sessionId: string;
  templateId: string;
  filterId: FilterId;
}

interface SelectCameraSourceInput {
  sourceId: string;
}

async function runGphoto(args: string[]) {
  return execFileAsync("gphoto2", args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
}

async function listCameraSources(): Promise<CameraSource[]> {
  const sources: CameraSource[] = [{ id: "webcam:default", label: "Webcam browser" }];
  try {
    const { stdout } = await runGphoto(["--auto-detect"]);
    const lines = stdout.split("\n").slice(2).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(.*?)\s{2,}(usb:\d+,\d+)$/);
      if (!match) continue;
      const [, model, port] = match;
      sources.push({ id: `gphoto:${port}`, label: `${model.trim()} (${port})` });
    }
  } catch {
    return sources;
  }
  return sources;
}

async function captureFromGphoto(sourceId: string): Promise<string> {
  const port = sourceId.replace(/^gphoto:/, "");
  const tempDir = await mkdtemp(join(tmpdir(), "photobooth-canon-"));
  const outputPath = join(tempDir, "capture.jpg");
  try {
    await runGphoto(["--port", port, "--capture-image-and-download", "--filename", outputPath, "--force-overwrite"]);
    const bytes = await readFile(outputPath);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

async function initializePersistence() {
  await mkdir(app.getPath("userData"), { recursive: true });
  database = openDatabase(databasePath);
}

async function saveSession(session: StoredSession) {
  upsertSessionInDatabase(database, session);
  return session;
}

async function renderFinalStripForSession(session: StoredSession): Promise<StoredSession> {
  const baseTemplate = getTemplate(session.templateId);
  const settings = readSnapshotFromDatabase(database).settings;
  const template = {
    ...baseTemplate,
    slots: settings.slotOverrides[baseTemplate.id] ?? baseTemplate.slots
  };
  const overlayPath = app.isPackaged
    ? join(process.resourcesPath, "frames", template.overlayAsset)
    : join(app.getAppPath(), "src", "renderer", "assets", "frames", template.overlayAsset);
  const { sessionDir, outputDir } = await ensureSessionDirectories(sessionsBaseDir, session.id);
  const outputPath = join(outputDir, "strip.jpg");
  const renderer = (await import(stripRendererPath)) as { renderStrip: (input: {
    template: ReturnType<typeof getTemplate>;
    shots: StoredShot[];
    filterId: FilterId;
    overlayPath: string;
    outputPath: string;
  }) => Promise<void> };
  await renderer.renderStrip({
    template,
    shots: session.shots,
    filterId: session.filterId,
    overlayPath,
    outputPath
  });
  const finalBytes = await readFile(outputPath);
  return updateSession(session, {
    finalStripPath: outputPath,
    finalStripDataUrl: `data:image/jpeg;base64,${finalBytes.toString("base64")}`,
    sessionDir
  });
}

function updateSession(session: StoredSession, changes: Partial<StoredSession>): StoredSession {
  return {
    ...session,
    ...changes,
    updatedAt: new Date().toISOString()
  };
}

function nextStatusForShotCount(shots: StoredShot[], captureCount: number): SessionStatus {
  return shots.length >= captureCount ? "reviewing" : "capturing";
}

async function getSession(sessionId: string): Promise<StoredSession> {
  const store = readSnapshotFromDatabase(database);
  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

async function simulatePublish(sessionId: string): Promise<StoredSession> {
  const session = await getSession(sessionId);
  const syncing = updateSession(session, { status: "sync_pending" });
  await saveSession(syncing);

  const eventName = readSnapshotFromDatabase(database).settings.eventName;

  const cloudStatus = cloudflareService.getStatus();
  if (cloudStatus.mode === "configured") {
    const result = await cloudflareService.publishSession(syncing, eventName);
    const published = updateSession(syncing, {
      status: "published",
      driveUrl: result.folderUrl
    });
    await saveSession(published);
    return published;
  }

  const driveStatus = await driveService.getStatus();
  if (driveStatus.mode === "authenticated") {
    const result = await driveService.publishSession({ session: syncing, eventName });
    const published = updateSession(syncing, {
      status: "published",
      driveUrl: result.folderUrl
    });
    await saveSession(published);
    return published;
  }

  await new Promise((resolve) => setTimeout(resolve, 1600));

  const published = updateSession(syncing, {
    status: "published",
    driveUrl: `https://drive.google.com/drive/folders/mock-${sessionId.toLowerCase()}`
  });
  await saveSession(published);
  return published;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    icon: nativeImage.createFromPath(iconPath),
    backgroundColor: "#101112",
    autoHideMenuBar: true,
    fullscreen: true,
    kiosk: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
    return;
  }

  await mainWindow.loadFile(join(app.getAppPath(), "out", "renderer", "index.html"));
}

app.whenReady().then(() => {
  void initializePersistence();
  ipcMain.handle("system:ping", async () => ({ ok: true }));
  ipcMain.handle("app:snapshot", async () => {
    const store = readSnapshotFromDatabase(database);
    return {
      settings: store.settings,
      sessions: store.sessions,
      queue: queueFromSessions(store.sessions),
      cameraSources: await listCameraSources(),
      selectedCameraSourceId,
      driveStatus: await driveService.getStatus(),
      cloudStatus: cloudflareService.getStatus()
    };
  });
  ipcMain.handle("settings:update", async (_event, settings: Partial<BoothSettings>) => {
    const store = readSnapshotFromDatabase(database);
    return writeSettingsToDatabase(database, { ...store.settings, ...settings });
  });
  ipcMain.handle("session:create", async (_event, input: CreateSessionInput) => {
    const now = new Date().toISOString();
    const sessionId = createSessionId(new Date());
    const { sessionDir } = await ensureSessionDirectories(sessionsBaseDir, sessionId);
    const session: StoredSession = {
      id: basename(sessionDir),
      templateId: input.templateId,
      filterId: input.filterId,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      sessionDir,
      shots: []
    };
    return saveSession(session);
  });
  ipcMain.handle("session:capture-shot", async (_event, input: CaptureShotInput) => {
    const session = await getSession(input.sessionId);
    const existing = session.shots.find((item) => item.shotIndex === input.shotIndex);
    const nextRevision = (existing?.revision ?? 0) + 1;
    const dataUrl = selectedCameraSourceId.startsWith("gphoto:") ? await captureFromGphoto(selectedCameraSourceId) : input.dataUrl;
    if (!dataUrl) throw new Error("Capture image not available");
    const { sessionDir, originalsDir } = await ensureSessionDirectories(sessionsBaseDir, session.id);
    const filePath = join(originalsDir, `shot-${String(input.shotIndex + 1).padStart(2, "0")}-r${String(nextRevision).padStart(2, "0")}.jpg`);
    await writeDataUrlToFile(filePath, dataUrl);
    const nextShot: StoredShot = {
      shotIndex: input.shotIndex,
      revision: nextRevision,
      attemptsUsed: (existing?.attemptsUsed ?? 0) + (input.countAsRetake ? 1 : 0),
      color: buildShotColor(input.shotIndex, nextRevision),
      dataUrl,
      filePath,
      capturedAt: new Date().toISOString()
    };
    const shots = [...session.shots.filter((item) => item.shotIndex !== input.shotIndex), nextShot].sort((left, right) => left.shotIndex - right.shotIndex);
    const captureCount = getTemplate(session.templateId).captureCount;
    let nextSession = updateSession(session, {
      status: nextStatusForShotCount(shots, captureCount),
      sessionDir,
      shots
    });
    if (shots.length > 0) nextSession = await renderFinalStripForSession(nextSession);
    return saveSession(nextSession);
  });
  ipcMain.handle("session:publish", async (_event, input: PublishSessionInput) => {
    const session = await getSession(input.sessionId);
    const rendered = session.finalStripPath ? session : await renderFinalStripForSession(session);
    await saveSession(rendered);
    return simulatePublish(input.sessionId);
  });
  ipcMain.handle("session:send-email", async (_event, input: SendSessionEmailInput) => {
    const session = await getSession(input.sessionId);
    const recipientEmail = input.recipientEmail.trim().toLowerCase();
    if (!isValidEmail(recipientEmail)) throw new Error("Email tidak valid");
    if (!session.driveUrl) throw new Error("Link hasil belum tersedia");
    const eventName = readSnapshotFromDatabase(database).settings.eventName;
    const result = await brevoEmailService.sendDownloadLink({
      to: recipientEmail,
      eventName,
      sessionId: session.id,
      publicUrl: session.driveUrl
    });
    if (result.status !== "sent") throw new Error(result.detail ?? "Email gagal dikirim");
    const updated = updateSession(session, { recipientEmail });
    await saveSession(updated);
    return updated;
  });
  ipcMain.handle("session:update-config", async (_event, input: UpdateSessionConfigInput) => {
    const session = await getSession(input.sessionId);
    const nextSession = updateSession(session, {
      templateId: input.templateId,
      filterId: input.filterId
    });
    return saveSession(nextSession);
  });
  ipcMain.handle("queue:list", async (): Promise<QueueItem[]> => {
    const store = readSnapshotFromDatabase(database);
    return queueFromSessions(store.sessions);
  });
  ipcMain.handle("camera:list-sources", async () => listCameraSources());
  ipcMain.handle("camera:select-source", async (_event, input: SelectCameraSourceInput) => {
    selectedCameraSourceId = input.sourceId;
    return { selectedCameraSourceId };
  });
  ipcMain.handle("drive:get-status", async (): Promise<DriveStatus> => driveService.getStatus());
  ipcMain.handle("cloud:get-status", async (): Promise<CloudStatus> => cloudflareService.getStatus());
  ipcMain.handle("drive:sign-in", async (): Promise<DriveStatus> => driveService.signIn());
  ipcMain.handle("drive:sign-out", async (): Promise<DriveStatus> => driveService.signOut());
  ipcMain.handle("drive:create-root-folder", async (_event, input: { name: string }): Promise<DriveStatus> => driveService.createRootFolder(input.name));
  ipcMain.handle("window:set-kiosk", async (_event, value: boolean) => {
    mainWindow?.setKiosk(value);
    if (value) mainWindow?.setFullScreen(true);
    return { kiosk: mainWindow?.isKiosk() ?? false };
  });
  ipcMain.handle("store:reset", async () => {
    database.close();
    database = openDatabase(databasePath);
    database.exec("DELETE FROM shots; DELETE FROM sessions;");
    writeSettingsToDatabase(database, defaultSettings);
    return { ok: true };
  });

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
