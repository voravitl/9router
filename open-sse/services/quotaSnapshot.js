// Quota snapshot helpers: compute a 0-100 "remaining" reading from a usage payload,
// and partition connections into healthy/low-quota buckets for account selection.

export const QUOTA_AVOID_THRESHOLD_PCT = 15;
export const QUOTA_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clampPct(value) {
  return Math.max(0, Math.min(100, value));
}

// Returns a 0-100 remaining-quota percentage, or null when it can't be determined.
export function computeQuotaRemainingPct(usage, quotaKey) {
  try {
    const quota = usage?.quotas?.[quotaKey];
    if (!quota) return null;
    if (quota.unlimited === true) return null;

    if (isFiniteNumber(quota.remaining) && isFiniteNumber(quota.total) && quota.total > 0) {
      return clampPct(Math.round((quota.remaining / quota.total) * 100));
    }

    if (isFiniteNumber(quota.used) && isFiniteNumber(quota.total) && quota.total > 0) {
      return clampPct(Math.round(((quota.total - quota.used) / quota.total) * 100));
    }

    return null;
  } catch (e) {
    console.warn("[QuotaSnapshot] computeQuotaRemainingPct error:", e.message);
    return null;
  }
}

// Splits connections into { healthy, low } based on a cached quotaRemainingPct snapshot.
// Missing, unknown, or stale readings are always treated as healthy (never exclude on missing data).
export function partitionByQuotaHealth(connections, { thresholdPct, maxAgeMs } = {}) {
  const healthy = [];
  const low = [];
  const now = Date.now();

  for (const connection of connections || []) {
    const pct = connection?.quotaRemainingPct;
    if (pct === null || pct === undefined) {
      healthy.push(connection);
      continue;
    }

    const checkedAtMs = new Date(connection?.quotaCheckedAt).getTime();
    if (!Number.isFinite(checkedAtMs) || now - checkedAtMs > maxAgeMs) {
      healthy.push(connection);
      continue;
    }

    if (pct >= thresholdPct) {
      healthy.push(connection);
    } else {
      low.push(connection);
    }
  }

  return { healthy, low };
}
