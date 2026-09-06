import { DatabaseSync } from "node:sqlite";
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

export function openDatabase(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      filter_id TEXT NOT NULL,
      capture_count INTEGER NOT NULL DEFAULT 6,
      countdown_seconds INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      recipient_email TEXT,
      drive_url TEXT,
      final_strip_path TEXT,
      final_strip_data_url TEXT,
      final_gif_path TEXT,
      final_gif_data_url TEXT,
      session_dir TEXT
    );

    CREATE TABLE IF NOT EXISTS shots (
      session_id TEXT NOT NULL,
      shot_index INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      attempts_used INTEGER NOT NULL,
      color TEXT NOT NULL,
      data_url TEXT,
      file_path TEXT,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (session_id, shot_index),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      lease_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  const row = database.prepare("SELECT settings_json FROM app_settings WHERE id = 1").get() as { settings_json: string } | undefined;
  if (!row) {
    database.prepare("INSERT INTO app_settings (id, settings_json) VALUES (1, ?)").run(JSON.stringify(defaultSettings));
  } else {
    const settings = JSON.parse(row.settings_json) as Partial<typeof defaultSettings>;
    if (settings.frameRevision !== defaultSettings.frameRevision) {
      database.prepare("UPDATE app_settings SET settings_json = ? WHERE id = 1").run(JSON.stringify({
        ...defaultSettings,
        ...settings,
        slotOverrides: {},
        frameRevision: defaultSettings.frameRevision
      }));
    }
  }

  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === "recipient_email")) {
    database.exec("ALTER TABLE sessions ADD COLUMN recipient_email TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "final_gif_path")) {
    database.exec("ALTER TABLE sessions ADD COLUMN final_gif_path TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "final_gif_data_url")) {
    database.exec("ALTER TABLE sessions ADD COLUMN final_gif_data_url TEXT");
  }
  if (!sessionColumns.some((column) => column.name === "capture_count")) {
    database.exec("ALTER TABLE sessions ADD COLUMN capture_count INTEGER NOT NULL DEFAULT 6");
  }
  if (!sessionColumns.some((column) => column.name === "countdown_seconds")) {
    database.exec("ALTER TABLE sessions ADD COLUMN countdown_seconds INTEGER NOT NULL DEFAULT 3");
  }

  const storageVersion = database.prepare("PRAGMA user_version").get() as { user_version: number };
  if (storageVersion.user_version < 2) {
    database.exec(`
      UPDATE shots SET data_url = NULL WHERE data_url IS NOT NULL;
      UPDATE sessions SET final_strip_data_url = NULL, final_gif_data_url = NULL
      WHERE final_strip_data_url IS NOT NULL OR final_gif_data_url IS NOT NULL;
      PRAGMA user_version = 2;
    `);
    database.exec("VACUUM");
  }

  return database;
}

export function readSnapshotFromDatabase(database: DatabaseSync): PersistedStore {
  const settingsRow = database.prepare("SELECT settings_json FROM app_settings WHERE id = 1").get() as { settings_json: string };
  const sessionRows = database.prepare(`
    SELECT id, template_id, filter_id, capture_count, countdown_seconds, status, created_at, updated_at, recipient_email, drive_url, final_strip_path, final_gif_path, session_dir
    FROM sessions
    ORDER BY created_at DESC
    LIMIT 100
  `).all() as Array<{
    id: string;
    template_id: string;
    filter_id: StoredSession["filterId"];
    capture_count: StoredSession["captureCount"];
    countdown_seconds: number;
    status: StoredSession["status"];
    created_at: string;
    updated_at: string;
    recipient_email: string | null;
    drive_url: string | null;
    final_strip_path: string | null;
    final_gif_path: string | null;
    session_dir: string | null;
  }>;

  const shotRows = database.prepare(`
    SELECT session_id, shot_index, revision, attempts_used, color, file_path, captured_at
    FROM shots
    WHERE session_id IN (SELECT id FROM sessions ORDER BY created_at DESC LIMIT 100)
  `).all() as Array<{
    session_id: string;
    shot_index: number;
    revision: number;
    attempts_used: number;
    color: string;
    file_path: string | null;
    captured_at: string;
  }>;

  const sessions: StoredSession[] = sessionRows.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    filterId: row.filter_id,
    captureCount: row.capture_count === 3 ? (3 as const) : (6 as const),
    countdownSeconds: ([0, 3, 5, 10].includes(row.countdown_seconds) ? row.countdown_seconds : 3) as StoredSession["countdownSeconds"],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipientEmail: row.recipient_email ?? undefined,
    driveUrl: row.drive_url ?? undefined,
    finalStripPath: row.final_strip_path ?? undefined,
    finalGifPath: row.final_gif_path ?? undefined,
    sessionDir: row.session_dir ?? undefined,
    shots: shotRows
      .filter((shot) => shot.session_id === row.id)
      .sort((left, right) => left.shot_index - right.shot_index)
      .map((shot) => ({
        shotIndex: shot.shot_index,
        revision: shot.revision,
        attemptsUsed: shot.attempts_used,
        color: shot.color,
        filePath: shot.file_path ?? undefined,
        capturedAt: shot.captured_at
      }))
  }));

  return {
    settings: { ...defaultSettings, ...JSON.parse(settingsRow.settings_json) },
    sessions
  };
}

export function writeSettingsToDatabase(database: DatabaseSync, settings: PersistedStore["settings"]): PersistedStore["settings"] {
  database.prepare("UPDATE app_settings SET settings_json = ? WHERE id = 1").run(JSON.stringify(settings));
  return settings;
}

export function upsertSessionInDatabase(database: DatabaseSync, session: StoredSession): StoredSession {
  const saveSession = database.prepare(`
    INSERT INTO sessions (id, template_id, filter_id, capture_count, countdown_seconds, status, created_at, updated_at, recipient_email, drive_url, final_strip_path, final_strip_data_url, final_gif_path, final_gif_data_url, session_dir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      template_id = excluded.template_id,
      filter_id = excluded.filter_id,
      capture_count = excluded.capture_count,
      countdown_seconds = excluded.countdown_seconds,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      recipient_email = excluded.recipient_email,
      drive_url = excluded.drive_url,
      final_strip_path = excluded.final_strip_path,
      final_strip_data_url = excluded.final_strip_data_url,
      final_gif_path = excluded.final_gif_path,
      final_gif_data_url = excluded.final_gif_data_url,
      session_dir = excluded.session_dir
  `);
  const saveShot = database.prepare(`
    INSERT INTO shots (session_id, shot_index, revision, attempts_used, color, data_url, file_path, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, shot_index) DO UPDATE SET
      revision = excluded.revision,
      attempts_used = excluded.attempts_used,
      color = excluded.color,
      data_url = excluded.data_url,
      file_path = excluded.file_path,
      captured_at = excluded.captured_at
  `);
  const deleteMissingShots = database.prepare("DELETE FROM shots WHERE session_id = ? AND shot_index = ?");
  const existingShotIndexes = new Set<number>((database.prepare("SELECT shot_index FROM shots WHERE session_id = ?").all(session.id) as Array<{ shot_index: number }>).map((row) => row.shot_index));

  database.exec("BEGIN");
  try {
    saveSession.run(
      session.id,
      session.templateId,
      session.filterId,
      session.captureCount,
      session.countdownSeconds,
      session.status,
      session.createdAt,
      session.updatedAt,
      session.recipientEmail ?? null,
      session.driveUrl ?? null,
      session.finalStripPath ?? null,
      null,
      session.finalGifPath ?? null,
      null,
      session.sessionDir ?? null
    );

    for (const shot of session.shots) {
      saveShot.run(
        session.id,
        shot.shotIndex,
        shot.revision,
        shot.attemptsUsed,
        shot.color,
        null,
        shot.filePath ?? null,
        shot.capturedAt
      );
      existingShotIndexes.delete(shot.shotIndex);
    }

    for (const shotIndex of existingShotIndexes) {
      deleteMissingShots.run(session.id, shotIndex);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return session;
}

export interface SyncJob {
  sessionId: string;
  attempts: number;
}

export function enqueueSyncJob(database: DatabaseSync, sessionId: string): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO sync_jobs (session_id, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      status = 'pending', next_attempt_at = excluded.next_attempt_at,
      lease_until = NULL, last_error = NULL, updated_at = excluded.updated_at
  `).run(sessionId, now, now, now);
}

export function claimNextSyncJob(database: DatabaseSync): SyncJob | null {
  const now = new Date();
  const nowIso = now.toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare(`
      SELECT session_id, attempts FROM sync_jobs
      WHERE status IN ('pending', 'failed') AND next_attempt_at <= ?
        AND (lease_until IS NULL OR lease_until < ?)
      ORDER BY created_at ASC LIMIT 1
    `).get(nowIso, nowIso) as { session_id: string; attempts: number } | undefined;
    if (!row) {
      database.exec("COMMIT");
      return null;
    }
    database.prepare("UPDATE sync_jobs SET status = 'running', lease_until = ?, updated_at = ? WHERE session_id = ?")
      .run(new Date(now.getTime() + 120_000).toISOString(), nowIso, row.session_id);
    database.exec("COMMIT");
    return { sessionId: row.session_id, attempts: row.attempts };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function completeSyncJob(database: DatabaseSync, sessionId: string): void {
  database.prepare("DELETE FROM sync_jobs WHERE session_id = ?").run(sessionId);
}

export function failSyncJob(database: DatabaseSync, sessionId: string, attempts: number, error: string): void {
  const now = new Date();
  const delay = Math.min(15 * 60_000, 5_000 * 3 ** Math.min(attempts, 5));
  database.prepare(`
    UPDATE sync_jobs SET status = 'failed', attempts = ?, next_attempt_at = ?,
      lease_until = NULL, last_error = ?, updated_at = ? WHERE session_id = ?
  `).run(attempts, new Date(now.getTime() + delay).toISOString(), error.slice(0, 500), now.toISOString(), sessionId);
}

export function listSyncQueue(database: DatabaseSync): QueueItem[] {
  return database.prepare(`
    SELECT j.session_id, j.status, j.attempts, j.last_error, j.created_at, j.updated_at, s.drive_url
    FROM sync_jobs j JOIN sessions s ON s.id = j.session_id ORDER BY j.created_at ASC
  `).all().map((value) => {
    const row = value as { session_id: string; status: string; attempts: number; last_error: string | null; created_at: string; updated_at: string; drive_url: string | null };
    return {
      sessionId: row.session_id,
      status: row.status === "running" ? "syncing" : row.status === "failed" ? "failed" : "waiting",
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      driveUrl: row.drive_url ?? undefined
    } as QueueItem;
  });
}

export function recoverSyncJobs(database: DatabaseSync): void {
  database.prepare("UPDATE sync_jobs SET status = 'pending', lease_until = NULL WHERE status = 'running'").run();
}
