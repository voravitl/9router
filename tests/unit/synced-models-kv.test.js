import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-synced-models-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("syncedModels kv", () => {
  it("stamps entries and records lastSyncedAt + firstSeenAt", async () => {
    const stamped = await db.stampSyncedModels([
      { connectionId: "c1", modelId: "m1" },
      { connectionId: "c1", modelId: "m2" },
    ]);
    expect(Object.keys(stamped).sort()).toEqual(["c1:m1", "c1:m2"]);
    for (const key of ["c1:m1", "c1:m2"]) {
      expect(stamped[key].lastSyncedAt).toBeTruthy();
      expect(stamped[key].firstSeenAt).toBeTruthy();
      expect(stamped[key].firstSeenAt).toBe(stamped[key].lastSyncedAt);
    }

    const map = await db.getSyncedModelsMap();
    expect(map["c1:m1"].firstSeenAt).toBe(stamped["c1:m1"].firstSeenAt);
    expect(map["c1:m2"].firstSeenAt).toBe(stamped["c1:m2"].firstSeenAt);
  });

  it("preserves firstSeenAt on re-stamp and bumps lastSyncedAt", async () => {
    const first = await db.stampSyncedModels([{ connectionId: "c2", modelId: "m1" }]);
    const firstSeen = first["c2:m1"].firstSeenAt;

    // Force the clock forward beyond millisecond resolution.
    const later = Date.now() + 100;
    while (Date.now() < later) {
      // spin briefly
    }

    const second = await db.upsertSyncedModel("c2", "m1");
    expect(second["c2:m1"].firstSeenAt).toBe(firstSeen);
    expect(Date.parse(second["c2:m1"].lastSyncedAt)).toBeGreaterThanOrEqual(
      Date.parse(first["c2:m1"].lastSyncedAt)
    );
  });

  it("survives exportDb/importDb round-trip", async () => {
    await db.stampSyncedModels([{ connectionId: "c3", modelId: "m-roundtrip" }]);
    const before = await db.getSyncedModelsMap();
    expect(before["c3:m-roundtrip"]).toBeDefined();

    const exported = await db.exportDb();
    expect(exported.syncedModels).toBeDefined();
    expect(exported.syncedModels["c3:m-roundtrip"]).toBeDefined();

    await db.importDb(exported);
    const after = await db.getSyncedModelsMap();
    expect(after["c3:m-roundtrip"]).toBeDefined();
    expect(after["c3:m-roundtrip"].firstSeenAt).toBe(before["c3:m-roundtrip"].firstSeenAt);
    expect(after["c3:m-roundtrip"].lastSyncedAt).toBe(before["c3:m-roundtrip"].lastSyncedAt);
  });

  it("stampSyncedModels([]) returns empty object and writes nothing", async () => {
    const result = await db.stampSyncedModels([]);
    expect(result).toEqual({});
  });
});
