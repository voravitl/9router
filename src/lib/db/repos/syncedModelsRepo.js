import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function entryKey(connectionId, modelId) {
  return `${connectionId}:${modelId}`;
}

export async function getSyncedModelsMap() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = 'syncedModels'`);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, {});
  return out;
}

// entries: [{ connectionId, modelId }]
// Returns the map of just-stamped keys → { lastSyncedAt, firstSeenAt }.
export async function stampSyncedModels(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return {};
  const db = await getAdapter();
  const now = new Date().toISOString();
  const stamped = {};

  db.transaction(() => {
    for (const { connectionId, modelId } of entries) {
      if (!connectionId || !modelId) continue;
      const key = entryKey(connectionId, modelId);
      const row = db.get(`SELECT value FROM kv WHERE scope = 'syncedModels' AND key = ?`, [key]);
      const existing = row ? parseJson(row.value, {}) : {};
      const firstSeenAt = existing.firstSeenAt || now;
      const value = { lastSyncedAt: now, firstSeenAt };
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('syncedModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [key, stringifyJson(value)]
      );
      stamped[key] = value;
    }
  });

  return stamped;
}

export async function upsertSyncedModel(connectionId, modelId) {
  return await stampSyncedModels([{ connectionId, modelId }]);
}
