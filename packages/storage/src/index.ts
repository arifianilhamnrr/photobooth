import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defaultSettings, type AppSnapshot, type QueueItem, type StoredSession } from "@photobooth/domain";

export interface PersistedStore {
  settings: AppSnapshot["settings"];
  sessions: StoredSession[];
}

const EMPTY_STORE: PersistedStore = {
  settings: defaultSettings,
  sessions: []
};

export async function ensureStore(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeStore(filePath, EMPTY_STORE);
  }
}

export async function readStore(filePath: string): Promise<PersistedStore> {
  await ensureStore(filePath);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<PersistedStore>;
  return {
    settings: { ...defaultSettings, ...parsed.settings },
    sessions: parsed.sessions ?? []
  };
}

export async function writeStore(filePath: string, store: PersistedStore): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function upsertSession(store: PersistedStore, session: StoredSession): PersistedStore {
  const sessions = store.sessions.filter((item) => item.id !== session.id);
  sessions.unshift(session);
  return { ...store, sessions };
}

export function queueFromSessions(sessions: StoredSession[]): QueueItem[] {
  return sessions
    .filter((session) => session.status === "sync_pending" || session.status === "published")
    .map((session) => ({
      sessionId: session.id,
      status: session.status === "published" ? "published" : "waiting",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      driveUrl: session.driveUrl
    }));
}

export async function ensureSessionDirectories(baseDir: string, sessionId: string): Promise<{ sessionDir: string; originalsDir: string; outputDir: string }> {
  const sessionDir = join(baseDir, sessionId);
  const originalsDir = join(sessionDir, "originals");
  const outputDir = join(sessionDir, "output");
  await mkdir(originalsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  return { sessionDir, originalsDir, outputDir };
}

export async function writeDataUrlToFile(filePath: string, dataUrl: string): Promise<void> {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image payload");
  const [, , base64] = match;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(base64, "base64"));
}
