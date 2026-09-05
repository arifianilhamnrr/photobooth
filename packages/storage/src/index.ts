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
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      recipient_email TEXT,
      drive_url TEXT,
      final_strip_path TEXT,
      final_strip_data_url TEXT,
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

  return database;
}

export function readSnapshotFromDatabase(database: DatabaseSync): PersistedStore {
  const settingsRow = database.prepare("SELECT settings_json FROM app_settings WHERE id = 1").get() as { settings_json: string };
  const sessionRows = database.prepare(`
    SELECT id, template_id, filter_id, status, created_at, updated_at, recipient_email, drive_url, final_strip_path, final_strip_data_url, session_dir
    FROM sessions
    ORDER BY created_at DESC
  `).all() as Array<{
    id: string;
    template_id: string;
    filter_id: StoredSession["filterId"];
    status: StoredSession["status"];
    created_at: string;
    updated_at: string;
    recipient_email: string | null;
    drive_url: string | null;
    final_strip_path: string | null;
    final_strip_data_url: string | null;
    session_dir: string | null;
  }>;

  const shotRows = database.prepare(`
    SELECT session_id, shot_index, revision, attempts_used, color, data_url, file_path, captured_at
    FROM shots
  `).all() as Array<{
    session_id: string;
    shot_index: number;
    revision: number;
    attempts_used: number;
    color: string;
    data_url: string | null;
    file_path: string | null;
    captured_at: string;
  }>;

  const sessions = sessionRows.map((row) => ({
    id: row.id,
    templateId: row.template_id,
    filterId: row.filter_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipientEmail: row.recipient_email ?? undefined,
    driveUrl: row.drive_url ?? undefined,
    finalStripPath: row.final_strip_path ?? undefined,
    finalStripDataUrl: row.final_strip_data_url ?? undefined,
    sessionDir: row.session_dir ?? undefined,
    shots: shotRows
      .filter((shot) => shot.session_id === row.id)
      .sort((left, right) => left.shot_index - right.shot_index)
      .map((shot) => ({
        shotIndex: shot.shot_index,
        revision: shot.revision,
        attemptsUsed: shot.attempts_used,
        color: shot.color,
        dataUrl: shot.data_url ?? undefined,
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
    INSERT INTO sessions (id, template_id, filter_id, status, created_at, updated_at, recipient_email, drive_url, final_strip_path, final_strip_data_url, session_dir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      template_id = excluded.template_id,
      filter_id = excluded.filter_id,
      status = excluded.status,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      recipient_email = excluded.recipient_email,
      drive_url = excluded.drive_url,
      final_strip_path = excluded.final_strip_path,
      final_strip_data_url = excluded.final_strip_data_url,
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
      session.status,
      session.createdAt,
      session.updatedAt,
      session.recipientEmail ?? null,
      session.driveUrl ?? null,
      session.finalStripPath ?? null,
      session.finalStripDataUrl ?? null,
      session.sessionDir ?? null
    );

    for (const shot of session.shots) {
      saveShot.run(
        session.id,
        shot.shotIndex,
        shot.revision,
        shot.attemptsUsed,
        shot.color,
        shot.dataUrl ?? null,
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
