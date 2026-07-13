import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeKiroBody(toolText, { status = "success" } = {}) {
  return {
    conversationState: {
      history: [],
      currentMessage: {
        userInputMessage: {
          userInputMessageContext: {
            toolResults: [
              {
                status,
                content: [{ text: toolText }],
              },
            ],
          },
        },
      },
    },
  };
}

describe("compressWithHeadroom — Kiro/CodeWhisperer conversationState (#122)", () => {
  it("compresses large toolResult text in place via Headroom", async () => {
    const longText = "x".repeat(2000);
    const shortText = "y".repeat(400);
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: [{ role: "user", content: shortText }],
          tokens_before: 500,
          tokens_after: 100,
          tokens_saved: 400,
        }),
        { status: 200 },
      ),
    );

    const body = makeKiroBody(longText);
    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      model: "claude-sonnet-4.5",
      format: "kiro",
      diagnostics,
    });

    expect(stats).not.toBeNull();
    expect(stats.tokens_saved).toBe(400);
    expect(stats.kiro_applied).toBe(1);
    const text =
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults[0].content[0].text;
    expect(text).toBe(shortText);
    expect(text.length).toBeLessThan(longText.length);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://headroom:8787/v1/compress",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("skips error toolResults (preserves traces)", async () => {
    global.fetch = vi.fn();
    const body = makeKiroBody("e".repeat(2000), { status: "error" });
    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
      diagnostics,
    });
    expect(stats).toBeNull();
    expect(diagnostics.reason).toMatch(/no tool text|threshold/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fail-open when Headroom returns non-shrinking content", async () => {
    const longText = "z".repeat(1500);
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: [{ role: "user", content: longText + "extra" }],
        }),
        { status: 200 },
      ),
    );
    const body = makeKiroBody(longText);
    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
      diagnostics,
    });
    expect(stats).toBeNull();
    expect(
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults[0].content[0].text,
    ).toBe(longText);
    expect(diagnostics.reason).toMatch(/did not shrink/i);
  });

  it("detects kiro by conversationState even without format flag", async () => {
    const longText = "a".repeat(1200);
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: [{ role: "user", content: "short" }],
          tokens_saved: 10,
        }),
        { status: 200 },
      ),
    );
    const body = makeKiroBody(longText);
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      // format omitted on purpose
    });
    expect(stats).not.toBeNull();
    expect(
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults[0].content[0].text,
    ).toBe("short");
  });
});
