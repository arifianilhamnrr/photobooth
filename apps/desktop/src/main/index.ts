import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { BrevoEmailService, CloudflareUploadService, GoogleDriveService } from "@photobooth/drive";
import { RemoteControlServer } from "./remote";
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
  type RemoteSessionState,
  type RemoteStatus,
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
const remoteFramesPath = app.isPackaged
  ? join(process.resourcesPath, "frames")
  : join(app.getAppPath(), "src", "renderer", "assets", "frames");
const iconPath = join(app.getAppPath(), "resources", process.platform === "win32" ? "icon.ico" : "icon.png");
const execFileAsync = promisify(execFile);
let selectedCameraSourceId = "webcam:default";
let database = openDatabase(databasePath);
let gphotoQueue: Promise<void> = Promise.resolve();
let gphotoLiveView: {
  sourceId: string;
  process: ChildProcessWithoutNullStreams;
  latestFrame?: Buffer;
  error?: string;
} | null = null;
const remoteServer = new RemoteControlServer(() => mainWindow, remoteFramesPath);

function loadUserEnvironment(): void {
  const configPath = join(app.getPath("userData"), "env");
  if (!existsSync(configPath)) return;
  for (const rawLine of readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadUserEnvironment();

const cloudflareService = new CloudflareUploadService(process.env.PHOTOBOOTH_CLOUD_URL ?? "https://photobooth.collaborationday2026.web.id");
const brevoEmailService = new BrevoEmailService({
  apiKey: process.env.BREVO_API_KEY,
  smtpLogin: process.env.BREVO_SMTP_LOGIN,
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
  captureCount: 3 | 6;
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
  captureCount?: 3 | 6;
}

interface ApplySessionFilterInput {
  sessionId: string;
  filterId: FilterId;
}

interface SelectCameraSourceInput {
  sourceId: string;
}

async function runGphoto(args: string[]) {
  return execFileAsync("gphoto2", args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
}

function withGphotoLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = gphotoQueue.then(operation, operation);
  gphotoQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function detectGphotoCameras(): Promise<Array<{ model: string; port: string }>> {
  const { stdout } = await runGphoto(["--auto-detect"]);
  return stdout
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(.*?)\s{2,}(usb:\d+,\d+)$/);
      return match ? [{ model: match[1].trim(), port: match[2] }] : [];
    });
}

async function resolveGphotoCamera(sourceId: string): Promise<{ model: string; port: string }> {
  const cameras = await detectGphotoCameras();
  const sourceValue = decodeURIComponent(sourceId.replace(/^gphoto:/, ""));
  const camera = sourceValue.startsWith("usb:")
    ? cameras[0]
    : cameras.find((item) => item.model === sourceValue);
  if (!camera) throw new Error("Canon tidak terdeteksi. Cek kabel USB dan pastikan kamera menyala.");
  return camera;
}

async function listCameraSources(): Promise<CameraSource[]> {
  const sources: CameraSource[] = [{ id: "webcam:default", label: "Webcam browser" }];
  if (gphotoLiveView) {
    const model = decodeURIComponent(gphotoLiveView.sourceId.replace(/^gphoto:/, ""));
    sources.push({ id: gphotoLiveView.sourceId, label: model });
    return sources;
  }
  try {
    const cameras = await withGphotoLock(detectGphotoCameras);
    for (const camera of cameras) {
      sources.push({ id: `gphoto:${encodeURIComponent(camera.model)}`, label: camera.model });
    }
  } catch {
    return sources;
  }
  return sources;
}

async function captureFromGphoto(sourceId: string): Promise<string> {
  return withGphotoLock(async () => {
    await stopGphotoLiveView();
    const camera = await resolveGphotoCamera(sourceId);
    const tempDir = await mkdtemp(join(tmpdir(), "photobooth-canon-"));
    const outputPath = join(tempDir, "capture.jpg");
    try {
      await runGphoto(["--port", camera.port, "--capture-image-and-download", "--filename", outputPath, "--force-overwrite"]);
      const bytes = await readFile(outputPath);
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}

function extractJpegFrames(buffer: Buffer): { frames: Buffer[]; remaining: Buffer } {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = buffer.indexOf(Buffer.from([0xff, 0xd8]), offset);
    if (start < 0) return { frames, remaining: buffer.subarray(Math.max(0, buffer.length - 1)) };
    const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
    if (end < 0) return { frames, remaining: buffer.subarray(start) };
    frames.push(buffer.subarray(start, end + 2));
    offset = end + 2;
  }
  return { frames, remaining: Buffer.alloc(0) };
}

async function startGphotoLiveView(sourceId: string): Promise<{ label: string }> {
  if (gphotoLiveView?.sourceId === sourceId && !gphotoLiveView.process.killed) {
    return { label: decodeURIComponent(sourceId.replace(/^gphoto:/, "")) };
  }
  await stopGphotoLiveView();
  const camera = await withGphotoLock(() => resolveGphotoCamera(sourceId));
  const child = spawn("gphoto2", ["--port", camera.port, "--capture-movie", "--stdout"]);
  gphotoLiveView = { sourceId, process: child };
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    const extracted = extractJpegFrames(pending);
    pending = extracted.remaining;
    const latest = extracted.frames.at(-1);
    if (latest && gphotoLiveView?.process === child) gphotoLiveView.latestFrame = Buffer.from(latest);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message && gphotoLiveView?.process === child) gphotoLiveView.error = message;
  });
  child.on("exit", (code) => {
    if (gphotoLiveView?.process === child && code && code !== 0) {
      gphotoLiveView.error ||= `Live view berhenti dengan kode ${code}`;
    }
  });
  return { label: camera.model };
}

async function stopGphotoLiveView(): Promise<void> {
  const liveView = gphotoLiveView;
  if (!liveView) return;
  gphotoLiveView = null;
  if (liveView.process.exitCode !== null || liveView.process.killed) return;
  liveView.process.kill("SIGINT");
  await Promise.race([
    new Promise<void>((resolve) => liveView.process.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 1500))
  ]);
  if (liveView.process.exitCode === null) liveView.process.kill("SIGKILL");
}

function getGphotoLiveViewFrame(sourceId: string): { dataUrl?: string; error?: string } {
  if (!gphotoLiveView || gphotoLiveView.sourceId !== sourceId) return { error: "Live view Canon belum dimulai." };
  if (gphotoLiveView.latestFrame) {
    return { dataUrl: `data:image/jpeg;base64,${gphotoLiveView.latestFrame.toString("base64")}` };
  }
  return { error: gphotoLiveView.error ?? "Menunggu frame live view Canon." };
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
  const baseSlots = settings.slotOverrides[baseTemplate.id] ?? baseTemplate.slots;
  const template = {
    ...baseTemplate,
    slots: baseSlots.map((slot, index) => ({
      ...slot,
      photoIndex: session.captureCount === 3 ? Math.floor(index / 2) : index
    }))
  };
  const overlayPath = app.isPackaged
    ? join(process.resourcesPath, "frames", template.overlayAsset)
    : join(app.getAppPath(), "src", "renderer", "assets", "frames", template.overlayAsset);
  const { sessionDir, outputDir } = await ensureSessionDirectories(sessionsBaseDir, session.id);
  const outputPath = join(outputDir, "strip.jpg");
  const gifPath = join(outputDir, "slideshow.gif");
  const renderer = (await import(stripRendererPath)) as {
    renderStrip: (input: {
    template: ReturnType<typeof getTemplate>;
    shots: StoredShot[];
    filterId: FilterId;
    overlayPath: string;
    outputPath: string;
  }) => Promise<void>;
    renderGif: (input: {
      shots: StoredShot[];
      filterId: FilterId;
      outputPath: string;
    }) => Promise<void>;
  };
  await renderer.renderStrip({
    template,
    shots: session.shots,
    filterId: session.filterId,
    overlayPath,
    outputPath
  });
  await renderer.renderGif({ shots: session.shots, filterId: session.filterId, outputPath: gifPath });
  const [finalBytes, gifBytes] = await Promise.all([readFile(outputPath), readFile(gifPath)]);
  return updateSession(session, {
    finalStripPath: outputPath,
    finalStripDataUrl: `data:image/jpeg;base64,${finalBytes.toString("base64")}`,
    finalGifPath: gifPath,
    finalGifDataUrl: `data:image/gif;base64,${gifBytes.toString("base64")}`,
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
  void remoteServer.start();
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
      captureCount: input.captureCount,
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
    const captureCount = session.captureCount;
    const nextSession = updateSession(session, {
      status: nextStatusForShotCount(shots, captureCount),
      sessionDir,
      finalStripPath: undefined,
      finalStripDataUrl: undefined,
      finalGifPath: undefined,
      finalGifDataUrl: undefined,
      shots
    });
    return saveSession(nextSession);
  });
  ipcMain.handle("session:publish", async (_event, input: PublishSessionInput) => {
    const session = await getSession(input.sessionId);
    const rendered = session.finalStripPath ? session : await renderFinalStripForSession(session);
    await saveSession(rendered);
    return simulatePublish(input.sessionId);
  });
  ipcMain.handle("session:prepare", async (_event, input: PublishSessionInput) => {
    const session = await getSession(input.sessionId);
    const rendered = session.finalStripPath ? session : await renderFinalStripForSession(session);
    await saveSession(rendered);
    return rendered;
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
      filterId: input.filterId,
      captureCount: input.captureCount ?? session.captureCount,
      finalStripPath: undefined,
      finalStripDataUrl: undefined,
      finalGifPath: undefined,
      finalGifDataUrl: undefined
    });
    return saveSession(nextSession);
  });
  ipcMain.handle("session:apply-filter", async (_event, input: ApplySessionFilterInput) => {
    const session = await getSession(input.sessionId);
    const filtered = updateSession(session, { filterId: input.filterId });
    const rendered = await renderFinalStripForSession(filtered);
    return saveSession(rendered);
  });
  ipcMain.handle("queue:list", async (): Promise<QueueItem[]> => {
    const store = readSnapshotFromDatabase(database);
    return queueFromSessions(store.sessions);
  });
  ipcMain.handle("camera:list-sources", async () => listCameraSources());
  ipcMain.handle("camera:start-live-view", async (_event, sourceId: string) => startGphotoLiveView(sourceId));
  ipcMain.handle("camera:get-live-view-frame", async (_event, sourceId: string) => getGphotoLiveViewFrame(sourceId));
  ipcMain.handle("camera:stop-live-view", async () => stopGphotoLiveView());
  ipcMain.handle("camera:select-source", async (_event, input: SelectCameraSourceInput) => {
    await stopGphotoLiveView();
    selectedCameraSourceId = input.sourceId;
    return { selectedCameraSourceId };
  });
  ipcMain.handle("remote:get-status", async (): Promise<RemoteStatus> => remoteServer.getStatus());
  ipcMain.handle("remote:enable", async (): Promise<RemoteStatus> => remoteServer.enable());
  ipcMain.handle("remote:disable", async (): Promise<RemoteStatus> => remoteServer.disable());
  ipcMain.handle("remote:enable-hotspot", async (): Promise<RemoteStatus> => remoteServer.enableHotspot());
  ipcMain.handle("remote:disable-hotspot", async (): Promise<RemoteStatus> => remoteServer.disableHotspot());
  ipcMain.handle("remote:update-state", async (_event, state: RemoteSessionState & { stripPath?: string; gifPath?: string }) => {
    remoteServer.updateState(state);
    return { ok: true };
  });
  ipcMain.handle("remote:update-preview", async (_event, dataUrl?: string) => {
    remoteServer.updatePreview(dataUrl);
    return { ok: true };
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
  void stopGphotoLiveView();
  if (process.platform !== "darwin") app.quit();
});
