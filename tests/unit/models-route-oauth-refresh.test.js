import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test: the generic PROVIDER_MODELS_CONFIG path in the models route
// had no OAuth token refresh, so short-lived OAuth tokens (xai, qwen, codex,
// iflow, ...) returned 401/403 on the models list even though chat requests
// refresh fine. Verified live for xai: expired token -> 403 "OAuth2 access
// token could not be validated"; after refresh -> 200 + models.
// github is explicitly NOT covered: its bearer is a Copilot token minted
// separately from its OAuth token, so refreshing the OAuth token would not
// mint a new Copilot token and the refresh-retry block is skipped for it.

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  refreshProviderCredentials: vi.fn(),
  updateProviderCredentials: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  refreshKiroToken: vi.fn(),
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: mocks.refreshProviderCredentials,
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

describe("Models route — generic OAuth refresh-and-retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
  });

  it("refreshes an expired OAuth token (xai) on 403, persists it, and retries with the new token", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-xai",
      provider: "xai",
      accessToken: "stale-access-token",
      refreshToken: "xai-refresh-token",
    });

    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "OAuth2 access token could not be validated",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "grok-4" }] }),
      });

    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "fresh-access-token",
      refreshToken: "xai-refresh-token",
      expiresIn: 3600,
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-xai/models"), {
      params: Promise.resolve({ id: "conn-xai" }),
    });
    const body = await res.json();

    expect(mocks.refreshProviderCredentials).toHaveBeenCalledWith(
      "xai",
      expect.objectContaining({ id: "conn-xai", provider: "xai" }),
      console
    );
    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith("conn-xai", {
      accessToken: "fresh-access-token",
      refreshToken: "xai-refresh-token",
      expiresIn: 3600,
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [, retryInit] = mocks.fetch.mock.calls[1];
    expect(retryInit.headers.Authorization).toBe("Bearer fresh-access-token");

    expect(body.models).toEqual([{ id: "grok-4" }]);
  });

  it("does not attempt a refresh for an apikey provider (deepseek) with no refreshToken", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-deepseek",
      provider: "deepseek",
      apiKey: "deepseek-key",
    });

    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-deepseek/models"), {
      params: Promise.resolve({ id: "conn-deepseek" }),
    });
    const body = await res.json();

    expect(mocks.refreshProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.updateProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(body.error).toBe("Failed to fetch models: 403");
  });

  it("does not retry when the refresh fails and returns the original error", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-xai",
      provider: "xai",
      accessToken: "stale-access-token",
      refreshToken: "xai-refresh-token",
    });

    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "OAuth2 access token could not be validated",
    });

    mocks.refreshProviderCredentials.mockResolvedValue(null);

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-xai/models"), {
      params: Promise.resolve({ id: "conn-xai" }),
    });
    const body = await res.json();

    expect(mocks.updateProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(body.error).toBe("Failed to fetch models: 403");
  });

  it("rebuilds the authQuery request with the fresh token on retry (gemini)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-gemini",
      provider: "gemini",
      accessToken: "stale-key",
      refreshToken: "gemini-refresh-token",
    });

    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ id: "gemini-pro" }] }),
      });

    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "fresh-key",
      refreshToken: "gemini-refresh-token",
      expiresIn: 3600,
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-gemini/models"), {
      params: Promise.resolve({ id: "conn-gemini" }),
    });
    const body = await res.json();

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [retryUrl] = mocks.fetch.mock.calls[1];
    expect(retryUrl).toContain("key=fresh-key");

    expect(body.models).toEqual([{ id: "gemini-pro" }]);
  });

  it("qwen: retries against the NEW shard URL from refreshed providerSpecificData.resourceUrl", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-qwen",
      provider: "qwen",
      accessToken: "stale-access-token",
      refreshToken: "qwen-refresh-token",
      providerSpecificData: { resourceUrl: "https://old-shard.example/v1" },
    });

    mocks.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "qwen3-coder" }] }),
      });

    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "fresh-access-token",
      refreshToken: "qwen-refresh-token",
      expiresIn: 3600,
      providerSpecificData: { resourceUrl: "https://new-shard.example/v1" },
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-qwen/models"), {
      params: Promise.resolve({ id: "conn-qwen" }),
    });
    const body = await res.json();

    expect(mocks.updateProviderCredentials).toHaveBeenCalledWith(
      "conn-qwen",
      expect.objectContaining({
        providerSpecificData: { resourceUrl: "https://new-shard.example/v1" },
      })
    );

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [retryUrl, retryInit] = mocks.fetch.mock.calls[1];
    expect(retryUrl).toBe("https://new-shard.example/v1/models");
    expect(retryInit.headers.Authorization).toBe("Bearer fresh-access-token");

    expect(body.models).toEqual([{ id: "qwen3-coder" }]);
  });

  it("github: is excluded from the generic refresh block (bearer is a Copilot token, not the OAuth token)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-github",
      provider: "github",
      refreshToken: "github-refresh-token",
      providerSpecificData: { copilotToken: "stale-copilot-token" },
    });

    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-github/models"), {
      params: Promise.resolve({ id: "conn-github" }),
    });
    const body = await res.json();

    expect(mocks.refreshProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.updateProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(403);
    expect(body.error).toBe("Failed to fetch models: 403");
  });
});
