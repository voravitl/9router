import { describe, it, expect, beforeEach, vi } from "vitest";

// Spy surface for the kv helpers.
const stampMock = vi.fn(async (entries) => {
  const out = {};
  const now = new Date().toISOString();
  for (const { connectionId, modelId } of entries || []) {
    const key = `${connectionId}:${modelId}`;
    out[key] = { lastSyncedAt: now, firstSeenAt: now };
  }
  return out;
});

const getMapMock = vi.fn(async () => ({}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => {
      const res = {
        status: init?.status || 200,
        json: async () => body,
      };
      return res;
    },
  },
}));

vi.mock("@/lib/db", () => ({
  getSyncedModelsMap: getMapMock,
  stampSyncedModels: stampMock,
}));

// Stub heavy deps so the route module loads cleanly without provider wiring.
vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: () => false,
  isAnthropicCompatibleProvider: () => false,
}));
vi.mock("@/lib/oauth/services/kiro", () => ({ KiroService: class {} }));
vi.mock("@/lib/oauth/services/ollama", () => ({ OllamaService: class {} }));
vi.mock("@/lib/oauth/constants/oauth", () => ({ GEMINI_CONFIG: {} }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  refreshKiroToken: vi.fn(),
}));
vi.mock("open-sse/config/providers.js", () => ({ resolveOllamaLocalHost: () => "http://localhost" }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: vi.fn(),
}));

const { buildModelsResponse } = await import("@/app/api/providers/[id]/models/route.js");

function bodyOf(res) {
  // NextResponse.json returns a Response; tests just need the payload.
  return res.json.bind(res);
}

describe("buildModelsResponse — synced-models stamping", () => {
  beforeEach(() => {
    stampMock.mockClear();
    getMapMock.mockClear();
  });

  it("stamps and enriches every model with lastSyncedAt", async () => {
    const now = "2026-07-07T12:00:00.000Z";
    const stamped = {
      "c1:m1": { lastSyncedAt: now, firstSeenAt: now },
      "c1:m2": { lastSyncedAt: now, firstSeenAt: now },
    };
    stampMock.mockResolvedValueOnce(stamped);
    getMapMock.mockResolvedValueOnce(stamped);

    const res = await buildModelsResponse({
      provider: "openai",
      connectionId: "c1",
      models: [{ id: "m1" }, { id: "m2" }],
    });

    expect(stampMock).toHaveBeenCalledTimes(1);
    expect(stampMock.mock.calls[0][0]).toEqual([
      { connectionId: "c1", modelId: "m1" },
      { connectionId: "c1", modelId: "m2" },
    ]);
    const payload = await bodyOf(res)();
    expect(payload.models).toHaveLength(2);
    for (const m of payload.models) {
      expect(m.lastSyncedAt).toBe(now);
      expect(m.firstSeenAt).toBe(now);
    }
    expect(payload.provider).toBe("openai");
    expect(payload.connectionId).toBe("c1");
    expect(payload.warning).toBeUndefined();
  });

  it("does NOT stamp when models list is empty", async () => {
    const res = await buildModelsResponse({
      provider: "kiro",
      connectionId: "c1",
      models: [],
      warning: "static fallback",
    });

    expect(stampMock).not.toHaveBeenCalled();
    const payload = await bodyOf(res)();
    expect(payload.models).toEqual([]);
    expect(payload.warning).toBe("static fallback");
  });

  it("carries warning through when supplied alongside models", async () => {
    const stamped = { "c1:m1": { lastSyncedAt: "t", firstSeenAt: "t" } };
    stampMock.mockResolvedValueOnce(stamped);
    getMapMock.mockResolvedValueOnce(stamped);

    const res = await buildModelsResponse({
      provider: "ollama",
      connectionId: "c1",
      models: [{ id: "m1" }],
      warning: "partial",
    });
    const payload = await bodyOf(res)();
    expect(payload.warning).toBe("partial");
    expect(payload.models[0].lastSyncedAt).toBe("t");
  });

  it("tolerates stamp failure without throwing (degrades to null timestamps)", async () => {
    stampMock.mockRejectedValueOnce(new Error("kv locked"));
    getMapMock.mockResolvedValueOnce({});

    const res = await buildModelsResponse({
      provider: "openai",
      connectionId: "c1",
      models: [{ id: "m1" }],
    });
    const payload = await bodyOf(res)();
    expect(payload.models[0].lastSyncedAt).toBeNull();
    expect(payload.models[0].firstSeenAt).toBeNull();
  });

  it("filters out models without a truthy id", async () => {
    stampMock.mockResolvedValueOnce({ "c1:m1": { lastSyncedAt: "t", firstSeenAt: "t" } });
    getMapMock.mockResolvedValueOnce({ "c1:m1": { lastSyncedAt: "t", firstSeenAt: "t" } });

    const res = await buildModelsResponse({
      provider: "openai",
      connectionId: "c1",
      models: [{ id: "m1" }, { id: "" }, { noId: true }, null],
    });
    const payload = await bodyOf(res)();
    expect(payload.models).toHaveLength(1);
    expect(payload.models[0].id).toBe("m1");
    // stamp call receives only the truthy-id entries
    expect(stampMock.mock.calls[0][0]).toEqual([{ connectionId: "c1", modelId: "m1" }]);
  });
});
