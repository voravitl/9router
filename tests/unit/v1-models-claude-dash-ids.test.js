import { beforeEach, describe, expect, it, vi } from "vitest";

// /v1/models must expose Kiro Claude family ids in dash form for Claude Code
// list-then-select. Dot form is misread as model "4". Follow-up to #101 / #102.
// Dashify is Kiro-scoped only — github/Copilot keep dotted registry ids.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getDisabledModels: vi.fn(async () => ({})),
  resolveKiroModels: vi.fn(async () => null),
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

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: mocks.resolveKiroModels,
}));
vi.mock("open-sse/services/kimchiModels.js", () => ({
  resolveKimchiModels: vi.fn(async () => null),
}));
vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(async () => null),
}));
vi.mock("open-sse/services/copilotModels.js", () => ({
  resolveCopilotModels: vi.fn(async () => null),
}));
vi.mock("open-sse/services/clinepassModels.js", () => ({
  resolveClinepassModels: vi.fn(async () => null),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
}));

describe("/v1/models Claude dash ids (#102)", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getProviderConnections.mockReset().mockResolvedValue([]);
    mocks.getCombos.mockReset().mockResolvedValue([]);
    mocks.getCustomModels.mockReset().mockResolvedValue([]);
    mocks.getModelAliases.mockReset().mockResolvedValue({});
    mocks.getDisabledModels.mockReset().mockResolvedValue({});
    mocks.resolveKiroModels.mockReset().mockResolvedValue(null);
  });

  it("static catalog: Kiro Claude ids use dash spelling", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const res = await GET(new Request("http://localhost/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);

    const kiroClaude = ids.filter((id) => id.startsWith("kr/claude-"));
    expect(kiroClaude.length).toBeGreaterThan(0);
    expect(kiroClaude.some((id) => id.includes("claude-opus-4-8"))).toBe(true);
    expect(kiroClaude.some((id) => /claude-(?:opus|sonnet|haiku)-\d+\.\d+/.test(id))).toBe(false);
  });

  it("static catalog: github Claude ids keep dotted registry form (not dashified)", async () => {
    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const res = await GET(new Request("http://localhost/v1/models"));
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);
    const ghClaude = ids.filter((id) => id.startsWith("gh/claude-") || id.startsWith("github/claude-"));
    // If github is in static catalog, must NOT dashify (no reverse for Copilot).
    if (ghClaude.length > 0) {
      expect(ghClaude.some((id) => /claude-(?:opus|sonnet|haiku)-\d+\.\d+/.test(id))).toBe(true);
      expect(ghClaude.some((id) => /claude-opus-4-5$/.test(id) || /claude-opus-4-7$/.test(id))).toBe(false);
    }
  });

  it("active Kiro connection: live dotted catalog is dashified in list", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-kiro-1",
        provider: "kiro",
        isActive: true,
        accessToken: "tok",
        refreshToken: "ref",
        providerSpecificData: {},
      },
    ]);
    mocks.resolveKiroModels.mockResolvedValue({
      models: [
        { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
        { id: "claude-opus-4.8-thinking", name: "Claude Opus 4.8 (Thinking)" },
        { id: "glm-5", name: "GLM 5" },
      ],
    });

    const { GET } = await import("../../src/app/api/v1/models/route.js");
    const res = await GET(new Request("http://localhost/v1/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data || []).map((m) => m.id);

    expect(ids).toContain("kr/claude-opus-4-8");
    expect(ids).toContain("kr/claude-opus-4-8-thinking");
    expect(ids).toContain("kr/glm-5");
    expect(ids).not.toContain("kr/claude-opus-4.8");
  });

  it("round-trip: listed dash id resolves back to Kiro upstream dot via resolveKiroModel", async () => {
    const { resolveKiroModel } = await import("../../open-sse/config/kiroConstants.js");
    const { toClaudeCodeModelId } = await import("../../src/shared/utils/claudeCodeModelId.js");
    const listed = toClaudeCodeModelId("claude-opus-4.8");
    expect(listed).toBe("claude-opus-4-8");
    expect(resolveKiroModel(listed).upstream).toBe("claude-opus-4.8");
  });
});
