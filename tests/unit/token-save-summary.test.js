import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  all: vi.fn(),
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({
    get: mocks.get,
    all: mocks.all,
  })),
}));

import { getTokenSaveSummary } from "../../src/lib/db/repos/requestDetailsRepo.js";

describe("getTokenSaveSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates RTK before/after and headroom savings", async () => {
    mocks.get.mockReturnValue({ c: 2 });
    mocks.all.mockReturnValue([
      {
        data: JSON.stringify({
          id: "a",
          timestamp: "2026-07-13T00:00:00.000Z",
          model: "m1",
          provider: "xai",
          rtkStats: {
            bytesBefore: 1000,
            bytesAfter: 400,
            hits: [{ filter: "grep" }, { filter: "ls" }, { filter: "grep" }],
          },
          headroomStats: { savedTokens: 120 },
        }),
      },
      {
        data: JSON.stringify({
          id: "b",
          timestamp: "2026-07-13T01:00:00.000Z",
          model: "m2",
          provider: "xai",
          rtkStats: { bytesBefore: 500, bytesAfter: 500, hits: [] },
          headroomDiagnostics: { reason: "request failed: timeout", beforeBytes: 800, afterBytes: 800 },
        }),
      },
    ]);

    const summary = await getTokenSaveSummary({ startDate: "2026-07-01", endDate: "2026-07-14" });

    expect(summary.period.scanned).toBe(2);
    expect(summary.rtk.bytesBefore).toBe(1500);
    expect(summary.rtk.bytesAfter).toBe(900);
    expect(summary.rtk.bytesSaved).toBe(600);
    expect(summary.rtk.pctSaved).toBe(40);
    expect(summary.rtk.requestsWithSavings).toBe(1);
    expect(summary.rtk.topFilters[0]).toEqual({ name: "grep", count: 2 });
    expect(summary.headroom.tokensSaved).toBe(120);
    expect(summary.headroom.requestsWithSavings).toBe(1);
    expect(summary.recent.length).toBeGreaterThanOrEqual(1);
    expect(summary.notes.caveman).toMatch(/Prompt-only/);
    expect(Array.isArray(summary.series)).toBe(true);
    expect(summary.series.some((d) => d.date === "2026-07-13" && d.saved > 0)).toBe(true);
    expect(Array.isArray(summary.headroom.topSkipReasonsRecent24h)).toBe(true);
  });
});
