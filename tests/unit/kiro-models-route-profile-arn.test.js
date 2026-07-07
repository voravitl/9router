import { describe, it, expect, beforeEach, vi } from "vitest";

// Regression test for the Kiro model-sync profileArn bug (revised).
//
// The list-models route previously injected a hardcoded shared default
// profileArn (KIRO_DEFAULT_PROFILE_ARNS in open-sse/config/kiroConstants.js)
// whenever a Kiro OAuth/social connection had no profileArn stored. That shared
// ARN is NOT bound to the caller's token: AWS CodeWhisperer returns
// AccessDeniedException ("User is not authorized to make this call") for
// Builder-ID tokens, and the bearer-token rejection for social tokens. The
// Verified live: ListAvailableModels strictly enforces profileArn ownership —
// sending the shared default ARN returns 403 for Builder-ID/social tokens whose
// bound profile differs; omitting profileArn returns 200 OK (AWS uses the token's
// own bound profile). The chat translators (claude/openai-to-kiro.js) still inject
// the shared default and rely on GenerateAssistantResponse tolerating it — a
// separate, unverified risk tracked outside this fix.
//
// The route must therefore send ONLY a profileArn it actually has (stored on
// the connection), and omit it (pass "") otherwise — never a hardcoded default.
//
// The "OMITS profileArn" / "does NOT send the hardcoded ... ARN" assertions
// below would have FAILED before the fix (the route called
// resolveDefaultProfileArn(authMethod) and passed the shared ARN) and PASS
// after (the route passes storedProfileArn || "").

const BUILDER_ID_DEFAULT_ARN =
  "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
const SOCIAL_DEFAULT_ARN =
  "arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  listAvailableModels: vi.fn(),
  refreshKiroToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: vi.fn().mockImplementation(function () {
    this.listAvailableModels = mocks.listAvailableModels;
  }),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: mocks.updateProviderCredentials,
  refreshKiroToken: mocks.refreshKiroToken,
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

async function callRoute(connectionId) {
  const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
  const res = await GET(new Request(`http://localhost/api/providers/${connectionId}/models`), {
    params: Promise.resolve({ id: connectionId }),
  });
  return { res, body: await res.json() };
}

describe("Kiro models route — profileArn resolution (omit when unset)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAvailableModels.mockResolvedValue([
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    ]);
  });

  it("OMITS profileArn (passes empty string) for builder-id auth with no stored ARN", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-1",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "builder-id" },
    });

    const { body } = await callRoute("conn-kiro-1");

    // Pre-fix this was called with the hardcoded builder-id default ARN and
    // AWS returned 403 AccessDeniedException. Post-fix it is "" so the service
    // omits profileArn from the request body entirely.
    expect(mocks.listAvailableModels).toHaveBeenCalledWith("kiro-access-token", "");
    expect(body.models).toHaveLength(1);
  });

  it("does NOT send the hardcoded builder-id default ARN (regression for AccessDeniedException)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-1b",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "builder-id" },
    });

    await callRoute("conn-kiro-1b");

    // Explicit negative — guards against re-introducing resolveDefaultProfileArn.
    expect(mocks.listAvailableModels).not.toHaveBeenCalledWith(
      "kiro-access-token",
      BUILDER_ID_DEFAULT_ARN,
    );
  });

  it("OMITS profileArn for google social auth with no stored ARN", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-2",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "google" },
    });

    await callRoute("conn-kiro-2");

    expect(mocks.listAvailableModels).toHaveBeenCalledWith("kiro-access-token", "");
  });

  it("OMITS profileArn for github social auth with no stored ARN", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-2b",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "github" },
    });

    await callRoute("conn-kiro-2b");

    expect(mocks.listAvailableModels).toHaveBeenCalledWith("kiro-access-token", "");
  });

  it("does NOT send the hardcoded social default ARN for any social auth method", async () => {
    for (const authMethod of ["google", "github"]) {
      vi.clearAllMocks();
      mocks.listAvailableModels.mockResolvedValue([]);
      mocks.getProviderConnectionById.mockResolvedValue({
        id: `conn-social-${authMethod}`,
        provider: "kiro",
        accessToken: "kiro-access-token",
        providerSpecificData: { authMethod },
      });

      await callRoute(`conn-social-${authMethod}`);

      expect(mocks.listAvailableModels).not.toHaveBeenCalledWith(
        "kiro-access-token",
        SOCIAL_DEFAULT_ARN,
      );
    }
  });

  it("OMITS profileArn for IDC auth with no stored ARN", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-idc",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "idc" },
    });

    await callRoute("conn-kiro-idc");

    expect(mocks.listAvailableModels).toHaveBeenCalledWith("kiro-access-token", "");
  });

  it("passes empty profileArn for api_key auth with no stored ARN (never the shared default)", async () => {
    // api_key auth has always correctly avoided the shared default — this locks
    // the invariant that api_key and OAuth now share the same resolution path.
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-3",
      provider: "kiro",
      accessToken: "kiro-api-key",
      providerSpecificData: { authMethod: "api_key" },
    });

    await callRoute("conn-kiro-3");

    expect(mocks.listAvailableModels).toHaveBeenCalledWith("kiro-api-key", "");
    expect(mocks.listAvailableModels).not.toHaveBeenCalledWith(
      "kiro-api-key",
      BUILDER_ID_DEFAULT_ARN,
    );
  });

  it("uses the connection's own stored profileArn when present, regardless of authMethod", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-4",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: {
        authMethod: "builder-id",
        profileArn: "arn:aws:codewhisperer:us-east-1:111111111111:profile/OWNPROFILE",
      },
    });

    await callRoute("conn-kiro-4");

    expect(mocks.listAvailableModels).toHaveBeenCalledWith(
      "kiro-access-token",
      "arn:aws:codewhisperer:us-east-1:111111111111:profile/OWNPROFILE",
    );
  });

  it("returns an empty list + error warning when the Kiro models call fails", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-fail",
      provider: "kiro",
      accessToken: "kiro-access-token",
      providerSpecificData: { authMethod: "idc" },
    });
    mocks.listAvailableModels.mockRejectedValue(new Error("boom"));

    const { body } = await callRoute("conn-kiro-fail");

    // Empty list (client keeps built-in static catalog); the actual error is surfaced.
    expect(body.models).toEqual([]);
    expect(body.warning).toBe("Failed to fetch Kiro models: boom");
  });

  it("retries after a successful token refresh, then degrades if the retry still fails", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-kiro-refresh",
      provider: "kiro",
      accessToken: "stale-token",
      refreshToken: "kiro-refresh-token",
      providerSpecificData: { authMethod: "idc" },
    });
    // Both the initial call and the post-refresh retry fail (AccessDenied triggers refresh).
    mocks.listAvailableModels.mockRejectedValue(new Error(
      'Failed to list models: {"__type":"com.amazon.aws.codewhisperer#AccessDeniedException","message":"denied"}',
    ));
    mocks.refreshKiroToken.mockResolvedValue({ accessToken: "fresh-token", expiresIn: 3600 });

    const { body } = await callRoute("conn-kiro-refresh");

    expect(mocks.refreshKiroToken).toHaveBeenCalled();
    expect(mocks.listAvailableModels).toHaveBeenCalledTimes(2);
    expect(body.models).toEqual([]);
    expect(body.warning).toMatch(/^Failed to fetch Kiro models:/);
  });
});
