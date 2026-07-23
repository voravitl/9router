import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getDisabledModels: vi.fn(async () => ({})),
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(async () => {}),
  fetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: mocks.refreshGoogleToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn(async () => null) }));

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

describe("Antigravity live model resolver in v1/models", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = mocks.fetch;
    mocks.getProviderConnections.mockReset().mockResolvedValue([]);
    mocks.getCombos.mockReset().mockResolvedValue([]);
    mocks.getCustomModels.mockReset().mockResolvedValue([]);
    mocks.getModelAliases.mockReset().mockResolvedValue({});
    mocks.getDisabledModels.mockReset().mockResolvedValue({});
    mocks.refreshGoogleToken.mockReset();
    mocks.updateProviderCredentials.mockReset();
    mocks.fetch.mockReset();
  });

  it("resolves live models on successful fetch", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-ag-1",
        provider: "antigravity",
        isActive: true,
        accessToken: "ag-access-token",
        refreshToken: "ag-refresh-token",
      },
    ]);

    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: "gemini-3.5-flash-low", displayName: "Gemini 3.5 Flash (Medium)" },
          { id: "gemini-3-flash-agent" },
        ],
      }),
    });

    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const res = await GET(new Request("http://localhost/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);

    expect(ids).toContain("ag/gemini-3.5-flash-low");
    expect(ids).toContain("ag/gemini-3-flash-agent");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes Google token on 401 and retries the fetch with new token", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-ag-1",
        provider: "antigravity",
        isActive: true,
        accessToken: "stale-access-token",
        refreshToken: "ag-refresh-token",
      },
    ]);

    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ id: "gemini-3.5-flash-low", displayName: "Gemini 3.5 Flash (Medium)" }],
        }),
      });

    mocks.refreshGoogleToken.mockResolvedValue({
      accessToken: "fresh-access-token",
      refreshToken: "ag-refresh-token",
      expiresIn: 3600,
    });

    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const res = await GET(new Request("http://localhost/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);

    expect(ids).toContain("ag/gemini-3.5-flash-low");
    expect(mocks.refreshGoogleToken).toHaveBeenCalledWith(
      "ag-refresh-token",
      expect.any(String),
      expect.any(String)
    );
    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith("conn-ag-1", {
      accessToken: "fresh-access-token",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
