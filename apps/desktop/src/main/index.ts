import { app, BrowserWindow, ipcMain } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildShotColor,
  type CameraSource,
  createSessionId,
  defaultSettings,
  getTemplate,
  type BoothSettings,
  type FilterId,
  type QueueItem,
  type SessionStatus,
  type StoredSession,
  type StoredShot
} from "@photobooth/domain";
import { renderStrip } from "@photobooth/compositor";
import { ensureSessionDirectories, ensureStore, queueFromSessions, readStore, upsertSession, writeDataUrlToFile, writeStore } from "@photobooth/storage";

let mainWindow: BrowserWindow | null = null;
const storePath = join(app.getPath("userData"), "photobooth-store.json");
const sessionsBaseDir = join(app.getPath("userData"), "sessions");
const overlayPath = join(app.getAppPath(), "src/renderer/assets/photobhoot-transparent.png");
const execFileAsync = promisify(execFile);
let selectedCameraSourceId = "webcam:default";

interface CreateSessionInput {
  templateId: string;
  filterId: FilterId;
}

interface CaptureShotInput {
  sessionId: string;
  shotIndex: number;
  dataUrl?: string;
}

interface PublishSessionInput {
  sessionId: string;
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

async function loadStore() {
  await ensureStore(storePath);
  return readStore(storePath);
}

async function saveSession(session: StoredSession) {
  const store = await loadStore();
  await writeStore(storePath, upsertSession(store, session));
  return session;
}

async function renderFinalStripForSession(session: StoredSession): Promise<StoredSession> {
  const template = getTemplate(session.templateId);
  const { sessionDir, outputDir } = await ensureSessionDirectories(sessionsBaseDir, session.id);
  const outputPath = join(outputDir, "strip.jpg");
  await renderStrip({
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
  const store = await loadStore();
  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

async function simulatePublish(sessionId: string): Promise<StoredSession> {
  const session = await getSession(sessionId);
  const syncing = updateSession(session, { status: "sync_pending" });
  await saveSession(syncing);

  await new Promise((resolve) => setTimeout(resolve, 1600));

  const published = updateSession(syncing, {
    status: "published",
    driveUrl: `https://drive.google.com/drive/folders/mock-${sessionId.toLowerCase()}`
  });
  await saveSession(published);
  return published;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#101112",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL ?? `file://${join(__dirname, "../renderer/index.html")}`);
}

app.whenReady().then(() => {
  ipcMain.handle("system:ping", async () => ({ ok: true }));
  ipcMain.handle("app:snapshot", async () => {
    const store = await loadStore();
    return {
      settings: store.settings,
      sessions: store.sessions,
      queue: queueFromSessions(store.sessions),
      cameraSources: await listCameraSources(),
      selectedCameraSourceId
    };
  });
  ipcMain.handle("settings:update", async (_event, settings: Partial<BoothSettings>) => {
    const store = await loadStore();
    const next = {
      ...store,
      settings: { ...store.settings, ...settings }
    };
    await writeStore(storePath, next);
    return next.settings;
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
      attemptsUsed: Math.max(0, nextRevision - 1),
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
  ipcMain.handle("session:update-config", async (_event, input: UpdateSessionConfigInput) => {
    const session = await getSession(input.sessionId);
    const nextSession = updateSession(session, {
      templateId: input.templateId,
      filterId: input.filterId
    });
    return saveSession(nextSession);
  });
  ipcMain.handle("queue:list", async (): Promise<QueueItem[]> => {
    const store = await loadStore();
    return queueFromSessions(store.sessions);
  });
  ipcMain.handle("camera:list-sources", async () => listCameraSources());
  ipcMain.handle("camera:select-source", async (_event, input: SelectCameraSourceInput) => {
    selectedCameraSourceId = input.sourceId;
    return { selectedCameraSourceId };
  });
  ipcMain.handle("store:reset", async () => {
    await writeStore(storePath, { settings: defaultSettings, sessions: [] });
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
