import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled = typeof settings.enableObservability2 === "boolean"
      ? settings.enableObservability2
      : envEnabled;
    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();

      db.transaction(() => {
        for (const item of items) {
          if (!item.id) item.id = generateDetailId(item.model);
          if (!item.timestamp) item.timestamp = new Date().toISOString();
          if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

          const record = {
            id: item.id,
            provider: item.provider || null,
            model: item.model || null,
            // Client-facing model (combo/alias) before upstream expansion
            clientModel: item.clientModel || item.request?.model || null,
            connectionId: item.connectionId || null,
            timestamp: item.timestamp,
            status: item.status || null,
            latency: item.latency || {},
            tokens: item.tokens || {},
            request: truncateField(item.request, config.maxJsonSize),
            providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
            providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
            response: truncateField(item.response, config.maxJsonSize),
            // Token-saver benchmark fields (must survive flush — dropped previously)
            rtkStats: item.rtkStats || null,
            headroomStats: item.headroomStats || null,
            headroomDiagnostics: item.headroomDiagnostics || null,
          };

          db.run(
            `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
            [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
          );
        }

        const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
        if (cnt && cnt.c > config.maxRecords) {
          db.run(
            `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
            [cnt.c - config.maxRecords]
          );
        }
      });
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  // Flush immediately when token-saver stats or final usage are present so
  // playground/benchmark UIs can read them without waiting the batch interval.
  const hasTokenSaveStats = Boolean(detail?.rtkStats || detail?.headroomStats || detail?.headroomDiagnostics);
  const hasUsage = Boolean(detail?.tokens && (detail.tokens.prompt_tokens || detail.tokens.completion_tokens || detail.tokens.input_tokens || detail.tokens.output_tokens));
  const forceFlush = hasTokenSaveStats || (detail?.status === "success" && hasUsage);

  // Trigger immediate flush if batch threshold reached or forceFlush.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (forceFlush || writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

/**
 * Aggregate RTK + Headroom savings across request details in a time window.
 * Caveman/Ponytail are prompt-only and not metered here.
 */
export async function getTokenSaveSummary({ startDate, endDate, limit = 2000 } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (startDate) {
    conds.push("timestamp >= ?");
    params.push(new Date(startDate).toISOString());
  }
  if (endDate) {
    conds.push("timestamp <= ?");
    params.push(new Date(endDate).toISOString());
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const safeLimit = Math.min(Math.max(Number(limit) || 2000, 1), 5000);

  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalInWindow = cntRow ? cntRow.c : 0;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ?`,
    [...params, safeLimit],
  );

  const rtk = {
    requestsWithStats: 0,
    requestsWithSavings: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    bytesSaved: 0,
    filterHits: {},
  };
  const headroom = {
    requestsWithStats: 0,
    requestsWithSavings: 0,
    tokensSaved: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    bytesSaved: 0,
    skipReasons: {},
    /** @type {Record<string, number>} */
    skipReasonsRecent24h: {},
    skipNewestAt: null,
  };
  const recent = [];
  /** @type {Record<string, { date: string, before: number, after: number, saved: number, requests: number }>} */
  const byDay = {};
  const recent24hCutoff = Date.now() - 24 * 60 * 60 * 1000;

  function noteSkipReason(reason, timestamp) {
    const key = String(reason).slice(0, 120);
    headroom.skipReasons[key] = (headroom.skipReasons[key] || 0) + 1;
    const ts = timestamp ? new Date(timestamp).getTime() : NaN;
    if (Number.isFinite(ts) && ts >= recent24hCutoff) {
      headroom.skipReasonsRecent24h[key] = (headroom.skipReasonsRecent24h[key] || 0) + 1;
    }
    if (Number.isFinite(ts)) {
      const prev = headroom.skipNewestAt ? new Date(headroom.skipNewestAt).getTime() : 0;
      if (ts >= prev) headroom.skipNewestAt = new Date(ts).toISOString();
    }
  }

  for (const row of rows) {
    const detail = parseJson(row.data, {});
    const rtkStats = detail?.rtkStats;
    const hs = detail?.headroomStats;
    const diag = detail?.headroomDiagnostics || {};
    const dayKey = (detail.timestamp && String(detail.timestamp).slice(0, 10)) || "unknown";

    let rtkSaved = 0;
    let rtkPct = 0;
    if (rtkStats && typeof rtkStats.bytesBefore === "number" && typeof rtkStats.bytesAfter === "number") {
      rtk.requestsWithStats += 1;
      rtk.bytesBefore += rtkStats.bytesBefore;
      rtk.bytesAfter += rtkStats.bytesAfter;
      rtkSaved = Math.max(0, rtkStats.bytesBefore - rtkStats.bytesAfter);
      if (rtkSaved > 0) {
        rtk.requestsWithSavings += 1;
        rtk.bytesSaved += rtkSaved;
      }
      if (rtkStats.bytesBefore > 0) {
        rtkPct = Math.round((rtkSaved / rtkStats.bytesBefore) * 100);
      }
      if (Array.isArray(rtkStats.hits)) {
        for (const hit of rtkStats.hits) {
          const key = hit?.filter || hit?.shape || "other";
          rtk.filterHits[key] = (rtk.filterHits[key] || 0) + 1;
        }
      }
      if (!byDay[dayKey]) {
        byDay[dayKey] = { date: dayKey, before: 0, after: 0, saved: 0, requests: 0 };
      }
      byDay[dayKey].before += rtkStats.bytesBefore;
      byDay[dayKey].after += rtkStats.bytesAfter;
      byDay[dayKey].saved += rtkSaved;
      byDay[dayKey].requests += 1;
    }

    let hrTokens = 0;
    let hrBytesSaved = 0;
    if (hs && typeof hs.savedTokens === "number" && hs.savedTokens > 0) {
      headroom.requestsWithStats += 1;
      headroom.requestsWithSavings += 1;
      headroom.tokensSaved += hs.savedTokens;
      hrTokens = hs.savedTokens;
    } else if (diag && (diag.beforeBytes != null || diag.bytesBefore != null)) {
      headroom.requestsWithStats += 1;
      const before = diag.beforeBytes ?? diag.bytesBefore ?? 0;
      const after = diag.afterBytes ?? diag.bytesAfter ?? 0;
      headroom.bytesBefore += before;
      headroom.bytesAfter += after;
      hrBytesSaved = Math.max(0, before - after);
      if (hrBytesSaved > 0) {
        headroom.requestsWithSavings += 1;
        headroom.bytesSaved += hrBytesSaved;
      }
      if (diag.reason) noteSkipReason(diag.reason, detail.timestamp);
    } else if (diag?.reason) {
      noteSkipReason(diag.reason, detail.timestamp);
    }

    if ((rtkSaved > 0 || hrTokens > 0 || hrBytesSaved > 0) && recent.length < 12) {
      recent.push({
        id: detail.id || null,
        timestamp: detail.timestamp || null,
        model: detail.clientModel || detail.model || null,
        provider: detail.provider || null,
        rtkBytesSaved: rtkSaved || 0,
        rtkPct,
        headroomTokensSaved: hrTokens || 0,
        headroomBytesSaved: hrBytesSaved || 0,
      });
    }
  }

  const topFilters = Object.entries(rtk.filterHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const topSkipReasons = Object.entries(headroom.skipReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
  const topSkipReasonsRecent24h = Object.entries(headroom.skipReasonsRecent24h)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));

  // Oldest → newest for charts (unknown last)
  const series = Object.values(byDay)
    .filter((d) => d.date !== "unknown")
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
      scanned: rows.length,
      totalInWindow,
      truncated: totalInWindow > rows.length,
    },
    rtk: {
      ...rtk,
      pctSaved: rtk.bytesBefore > 0 ? Math.round((rtk.bytesSaved / rtk.bytesBefore) * 100) : 0,
      topFilters,
    },
    headroom: {
      ...headroom,
      pctBytesSaved: headroom.bytesBefore > 0
        ? Math.round((headroom.bytesSaved / headroom.bytesBefore) * 100)
        : 0,
      topSkipReasons,
      topSkipReasonsRecent24h,
    },
    // Chart-friendly series: daily RTK tool-blob bytes (not full bill)
    series,
    recent,
    notes: {
      rtk: "Measures tool_result compression in bytes (before → after).",
      headroom: "Measures context compress when proxy succeeds (tokens or bytes).",
      caveman: "Prompt-only: no per-request before/after meter.",
      ponytail: "Prompt-only: no per-request before/after meter.",
    },
  };
}

const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
  process.off("beforeExit", _shutdownHandler);
  process.off("SIGINT", _shutdownHandler);
  process.off("SIGTERM", _shutdownHandler);
  process.off("exit", _shutdownHandler);

  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}

ensureShutdownHandler();
