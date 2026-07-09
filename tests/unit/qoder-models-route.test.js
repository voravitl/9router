import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the Qoder model-sync bug (#96).
//
// The list-models route had no branch for `qoder`, so a dashboard "Sync
// models" on a Qoder connection fell through to the unsupported-provider
// handler and returned HTTP 400 "Provider qoder does not support models
// listing" — even though the live-catalog fetcher (resolveQoderModels in
// open-sse/services/qoderModels.js) already existed and worked.
//
// The route must now:
//   - return the live catalog via resolveQoderModels (forceRefresh) on success
//   - return 200 + empty models + warning when the catalog can't be fetched
//     (graceful static-catalog fallback, same shape as the Kiro branch) —
//     never the hard 400
//   - warn when the catalog fetches but every model is disabled upstream
//     (seen live on 0-credit / quota-exceeded accounts)

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  resolveQoderModels: vi.fn(),
  stampSyncedModels: vi.fn(),
  getSyncedModelsMap: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: mocks.resolveQoderModels,
}));

// Keep the syncedModels stamping away from any real DB file.
vi.mock("@/lib/db", () => ({
  stampSyncedModels: mocks.stampSyncedModels,
  getSyncedModelsMap: mocks.getSyncedModelsMap,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const QODER_CONNECTION = {
  id: "qoder-conn-1",
  provider: "qoder",
  accessToken: "qoder-access-token",
  refreshToken: "qoder-refresh-token",
  providerSpecificData: {
    userId: "user-1",
    machineId: "machine-1",
    authMethod: "oauth",
  },
};

async function callRoute(connectionId) {
  const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
  const res = await GET(new Request(`http://localhost/api/providers/${connectionId}/models`), {
    params: Promise.resolve({ id: connectionId }),
  });
  return { res, body: await res.json() };
}

describe("Qoder models route — live catalog sync (#96)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue(QODER_CONNECTION);
    mocks.stampSyncedModels.mockResolvedValue(undefined);
    mocks.getSyncedModelsMap.mockResolvedValue({});
  });

  it("returns the live catalog models (was: 400 unsupported)", async () => {
    mocks.resolveQoderModels.mockResolvedValue({
      models: [
        { id: "qmodel_latest", name: "Qwen3.7-Max", contextLength: 180000 },
        { id: "dmodel", name: "DeepSeek-V4-Pro", contextLength: 131072 },
      ],
      rawConfigs: new Map(),
    });

    const { res, body } = await callRoute("qoder-conn-1");

    expect(res.status).toBe(200);
    expect(body.provider).toBe("qoder");
    expect(body.connectionId).toBe("qoder-conn-1");
    expect(body.models.map((m) => m.id)).toEqual(["qmodel_latest", "dmodel"]);
    expect(body.warning).toBeUndefined();
    expect(mocks.resolveQoderModels).toHaveBeenCalledWith(
      QODER_CONNECTION,
      expect.objectContaining({ forceRefresh: true }),
    );
  });

  it("falls back to 200 + empty models + warning when the catalog fetch fails", async () => {
    mocks.resolveQoderModels.mockResolvedValue(null);

    const { res, body } = await callRoute("qoder-conn-1");

    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.warning).toMatch(/Failed to fetch Qoder models/);
  });

  it("warns when the catalog fetches but every model is disabled upstream", async () => {
    mocks.resolveQoderModels.mockResolvedValue({ models: [], rawConfigs: new Map() });

    const { res, body } = await callRoute("qoder-conn-1");

    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.warning).toMatch(/every model is disabled/);
  });

  it("still falls back gracefully when resolveQoderModels throws", async () => {
    mocks.resolveQoderModels.mockRejectedValue(new Error("COSY signing failed"));

    const { res, body } = await callRoute("qoder-conn-1");

    expect(res.status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.warning).toMatch(/COSY signing failed/);
  });
});
