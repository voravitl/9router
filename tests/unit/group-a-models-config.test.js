import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the Group A batch: apikey providers wired into
// PROVIDER_MODELS_CONFIG so the models route can list them via the generic
// OpenAI-style handler (GET {url} with Bearer apiKey, parsing {data:[...]}).
// glm's /v4/models endpoint was verified live to return the OpenAI shape.

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

describe("Group A models config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
  });

  it("lists glm models via the generic config using connection.apiKey", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-glm",
      provider: "glm",
      apiKey: "glm-secret",
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ object: "list", data: [{ id: "glm-4.6" }, { id: "glm-4.5" }] }),
    });

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const res = await GET(new Request("http://localhost/api/providers/conn-glm/models"), {
      params: Promise.resolve({ id: "conn-glm" }),
    });
    const body = await res.json();

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.z.ai/api/coding/paas/v4/models");
    expect(init.headers.Authorization).toBe("Bearer glm-secret");
    expect(body.models.map((m) => m.id)).toEqual(["glm-4.6", "glm-4.5"]);
  });

  it("wires each new Group A provider to its /models endpoint", async () => {
    const expected = {
      blackbox: "https://api.blackbox.ai/v1/models",
      kimi: "https://api.kimi.com/coding/v1/models",
      minimax: "https://api.minimax.io/v1/models",
      "minimax-cn": "https://api.minimaxi.com/v1/models",
      "opencode-go": "https://opencode.ai/zen/go/v1/models",
      venice: "https://api.venice.ai/api/v1/models",
      "vercel-ai-gateway": "https://ai-gateway.vercel.sh/v1/models",
      "xiaomi-mimo": "https://api.xiaomimimo.com/v1/models",
    };

    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");

    for (const [provider, url] of Object.entries(expected)) {
      mocks.getProviderConnectionById.mockResolvedValue({ id: `c-${provider}`, provider, apiKey: "k" });
      mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m1" }] }) });

      const res = await GET(new Request(`http://localhost/api/providers/c-${provider}/models`), {
        params: Promise.resolve({ id: `c-${provider}` }),
      });
      const body = await res.json();

      expect(mocks.fetch.mock.calls.at(-1)[0], provider).toBe(url);
      expect(body.models, provider).toEqual([{ id: "m1" }]);
    }
  });
});
