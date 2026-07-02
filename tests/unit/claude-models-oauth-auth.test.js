import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test: the `claude` provider is OAuth-only (category: "oauth" in
// open-sse/providers/registry/claude.js), so its /v1/models config must
// authenticate with `Authorization: Bearer <token>` (like the chat transport),
// not `x-api-key` (which Anthropic rejects for OAuth tokens with 401
// "invalid x-api-key"). The `anthropic` entry is a separate API-key provider
// and must keep using x-api-key.

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
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

describe("claude models OAuth auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
  });

  it("fetches claude models with Authorization: Bearer <accessToken> and an oauth Anthropic-Beta header", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-claude",
      provider: "claude",
      accessToken: "sk-ant-oat01-secret",
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "claude-opus-4-8" }, { id: "claude-sonnet-4-6" }] }),
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-claude/models"), {
      params: Promise.resolve({ id: "conn-claude" }),
    });
    const body = await res.json();

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models");
    expect(init.headers.Authorization).toBe("Bearer sk-ant-oat01-secret");
    expect(init.headers["Anthropic-Beta"]).toContain("oauth-2025-04-20");
    // Guard the exact regression: the OAuth token must NOT go via x-api-key (401).
    expect(init.headers["x-api-key"]).toBeUndefined();
    expect(body.models.map((m) => m.id)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
  });
});
