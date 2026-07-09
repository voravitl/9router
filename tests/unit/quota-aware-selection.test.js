import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeQuotaRemainingPct,
  partitionByQuotaHealth,
  QUOTA_AVOID_THRESHOLD_PCT,
  QUOTA_SNAPSHOT_MAX_AGE_MS,
} from "open-sse/services/quotaSnapshot.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

describe("computeQuotaRemainingPct", () => {
  it("computes a percentage from remaining+total", () => {
    const usage = { quotas: { session: { remaining: 20, total: 100 } } };
    expect(computeQuotaRemainingPct(usage, "session")).toBe(20);
  });

  it("computes a percentage from used+total when remaining is absent", () => {
    const usage = { quotas: { session: { used: 70, total: 100 } } };
    expect(computeQuotaRemainingPct(usage, "session")).toBe(30);
  });

  it("returns null for an unlimited quota", () => {
    const usage = { quotas: { session: { unlimited: true, remaining: 999, total: 1000 } } };
    expect(computeQuotaRemainingPct(usage, "session")).toBeNull();
  });

  it("returns null when the quotas object is missing or empty", () => {
    expect(computeQuotaRemainingPct({}, "session")).toBeNull();
    expect(computeQuotaRemainingPct({ quotas: {} }, "session")).toBeNull();
  });

  it("returns null when remaining is present but total is absent", () => {
    const usage = { quotas: { session: { remaining: 5 } } };
    expect(computeQuotaRemainingPct(usage, "session")).toBeNull();
  });

  it("never throws on malformed input", () => {
    expect(computeQuotaRemainingPct(null, "session")).toBeNull();
    expect(computeQuotaRemainingPct(undefined, "session")).toBeNull();
    expect(computeQuotaRemainingPct("not-an-object", "session")).toBeNull();
    expect(computeQuotaRemainingPct({ quotas: null }, "session")).toBeNull();
  });
});

describe("partitionByQuotaHealth", () => {
  const opts = { thresholdPct: QUOTA_AVOID_THRESHOLD_PCT, maxAgeMs: QUOTA_SNAPSHOT_MAX_AGE_MS };

  it("puts every connection with no quotaRemainingPct into healthy (regression guard: matches today's behavior)", () => {
    const connections = [{ id: "a" }, { id: "b" }];
    const { healthy, low } = partitionByQuotaHealth(connections, opts);
    expect(healthy).toEqual(connections);
    expect(low).toEqual([]);
  });

  it("splits a fresh low reading from a fresh healthy reading", () => {
    const now = new Date().toISOString();
    const connections = [
      { id: "low", quotaRemainingPct: 5, quotaCheckedAt: now },
      { id: "healthy", quotaRemainingPct: 50, quotaCheckedAt: now },
    ];
    const { healthy, low } = partitionByQuotaHealth(connections, opts);
    expect(healthy.map((c) => c.id)).toEqual(["healthy"]);
    expect(low.map((c) => c.id)).toEqual(["low"]);
  });

  it("returns an empty healthy bucket when all fresh connections are below threshold", () => {
    const now = new Date().toISOString();
    const connections = [
      { id: "a", quotaRemainingPct: 1, quotaCheckedAt: now },
      { id: "b", quotaRemainingPct: 2, quotaCheckedAt: now },
    ];
    const { healthy, low } = partitionByQuotaHealth(connections, opts);
    expect(healthy).toEqual([]);
    expect(low.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("treats a low reading with a stale quotaCheckedAt as healthy (staleness makes it unknown again)", () => {
    const stale = new Date(Date.now() - QUOTA_SNAPSHOT_MAX_AGE_MS - 1000).toISOString();
    const connections = [{ id: "stale-low", quotaRemainingPct: 3, quotaCheckedAt: stale }];
    const { healthy, low } = partitionByQuotaHealth(connections, opts);
    expect(healthy.map((c) => c.id)).toEqual(["stale-low"]);
    expect(low).toEqual([]);
  });
});

describe("getProviderCredentials quota-aware pre-filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
  });

  it("skips a fresh low-quota connection in favor of a healthy connection under fill-first", async () => {
    const now = new Date().toISOString();
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "low-conn",
        provider: "claude",
        authType: "oauth",
        priority: 1,
        isActive: true,
        quotaRemainingPct: 5,
        quotaCheckedAt: now,
      },
      {
        id: "healthy-conn",
        provider: "claude",
        authType: "oauth",
        priority: 2,
        isActive: true,
      },
    ]);

    const result = await getProviderCredentials("claude");

    expect(result.connectionId).toBe("healthy-conn");
  });
});
