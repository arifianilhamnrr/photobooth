import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import {
  claimNextSyncJob,
  completeSyncJob,
  enqueueSyncJob,
  failSyncJob,
  listSyncQueue,
  openDatabase,
  upsertSessionInDatabase
} from "./index";

const path = "/tmp/photobooth-storage-test.sqlite";

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
});

describe("sync queue", () => {
  it("persists, claims, retries, and completes a job", () => {
    const database = openDatabase(path);
    const now = new Date().toISOString();
    upsertSessionInDatabase(database, {
      id: "SESI-00000000-0000-4000-8000-000000000000",
      templateId: "frame-3",
      filterId: "original",
      captureCount: 3,
      countdownSeconds: 3,
      status: "sync_pending",
      createdAt: now,
      updatedAt: now,
      shots: []
    });
    enqueueSyncJob(database, "SESI-00000000-0000-4000-8000-000000000000");
    expect(listSyncQueue(database)).toHaveLength(1);
    const job = claimNextSyncJob(database);
    expect(job?.attempts).toBe(0);
    failSyncJob(database, job!.sessionId, 1, "offline");
    expect(listSyncQueue(database)[0]).toMatchObject({ status: "failed", attempts: 1, lastError: "offline" });
    enqueueSyncJob(database, job!.sessionId);
    expect(claimNextSyncJob(database)?.sessionId).toBe(job!.sessionId);
    completeSyncJob(database, job!.sessionId);
    expect(listSyncQueue(database)).toHaveLength(0);
    database.close();
  });
});
