import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    vercelRelayUrl: "",
  }),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

const originalFetch = globalThis.fetch;

describe("xai OAuth connection test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("tests xai OAuth connection against api.x.ai/v1/models and returns valid", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-xai",
      provider: "xai",
      authType: "oauth",
      accessToken: "valid-access-token",
      refreshToken: "some-refresh-token",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    const { testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );

    // Import side effects (e.g. open-sse/utils/proxyFetch.js) patch globalThis.fetch —
    // install the mock only after module resolution completes.
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await testSingleConnection("conn-xai");

    expect(result.valid).toBe(true);
    expect(result.error).toBe(null);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.x.ai/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer valid-access-token",
        }),
      })
    );
  });
});
