import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeKiroBody(toolText, { status = "success", userContent = "" } = {}) {
  return {
    conversationState: {
      history: [],
      currentMessage: {
        userInputMessage: {
          content: userContent,
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
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      // Must send tool role (user blobs are not compressed by Headroom by default)
      expect(payload.messages[0].role).toBe("tool");
      expect(payload.messages[0].tool_call_id).toBeTruthy();
      expect(payload.config?.compress_user_messages).toBeFalsy();
      return new Response(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "kiro-tool-0", content: shortText }],
          tokens_before: 500,
          tokens_after: 100,
          tokens_saved: 400,
        }),
        { status: 200 },
      );
    });

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

  it("compresses large userInputMessage content string (framed as tool)", async () => {
    const longUser = "U".repeat(1500);
    const shortUser = "u".repeat(200);
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      // User content is framed as role:tool so Headroom actually shrinks it
      expect(payload.messages[0].role).toBe("tool");
      expect(payload.messages[0].tool_call_id).toMatch(/kiro-user-/);
      expect(payload.config?.compress_user_messages).toBeFalsy();
      return new Response(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "kiro-user-0", content: shortUser }],
          tokens_before: 400,
          tokens_after: 50,
          tokens_saved: 350,
        }),
        { status: 200 },
      );
    });

    const body = makeKiroBody("ok", { userContent: longUser });
    // tool "ok" is below threshold — only user content should be sent
    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
      diagnostics,
    });

    expect(stats).not.toBeNull();
    expect(stats.kiro_user_slots).toBe(1);
    expect(stats.kiro_applied).toBe(1);
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe(shortUser);
    expect(diagnostics.kiroUserSlots).toBe(1);
  });

  it("compresses user content array text parts", async () => {
    const longPart = "A".repeat(1200);
    const shortPart = "a".repeat(100);
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      expect(payload.messages).toHaveLength(1);
      expect(payload.messages[0].role).toBe("tool");
      return new Response(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "kiro-user-0", content: shortPart }],
          tokens_saved: 50,
        }),
        { status: 200 },
      );
    });

    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: [{ text: longPart }],
          },
        },
      },
    };
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
    });
    expect(stats).not.toBeNull();
    expect(body.conversationState.currentMessage.userInputMessage.content[0].text).toBe(
      shortPart,
    );
  });

  it("multi-slot: tool + user mapped by stable index; preserves error tools", async () => {
    const longTool = "T".repeat(2000);
    const longUser = "U".repeat(1800);
    const errTool = "E".repeat(2000);
    const shortTool = "t".repeat(300);
    const shortUser = "u".repeat(250);

    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      // Sorted by length desc: tool (2000) then user (1800); error skipped
      expect(payload.messages).toHaveLength(2);
      expect(payload.messages[0].role).toBe("tool");
      expect(payload.messages[0].content).toBe(longTool);
      expect(payload.messages[0].tool_call_id).toMatch(/kiro-tool-/);
      expect(payload.messages[1].role).toBe("tool");
      expect(payload.messages[1].content).toBe(longUser);
      expect(payload.messages[1].tool_call_id).toMatch(/kiro-user-/);
      expect(payload.config?.compress_user_messages).toBeFalsy();
      return new Response(
        JSON.stringify({
          messages: [
            { role: "tool", tool_call_id: "kiro-tool-0", content: shortTool },
            { role: "tool", tool_call_id: "kiro-user-1", content: shortUser },
          ],
          tokens_saved: 100,
        }),
        { status: 200 },
      );
    });

    const body = {
      conversationState: {
        history: [
          {
            userInputMessage: {
              content: longUser,
              userInputMessageContext: {
                toolResults: [
                  { status: "error", content: [{ text: errTool }] },
                  { status: "success", content: [{ text: longTool }] },
                ],
              },
            },
          },
        ],
        currentMessage: {
          userInputMessage: { content: "hi" },
        },
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
    });

    expect(stats).not.toBeNull();
    expect(stats.kiro_applied).toBe(2);
    const hist = body.conversationState.history[0].userInputMessage;
    expect(hist.content).toBe(shortUser);
    expect(hist.userInputMessageContext.toolResults[0].content[0].text).toBe(errTool);
    expect(hist.userInputMessageContext.toolResults[1].content[0].text).toBe(shortTool);
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
    expect(diagnostics.reason).toMatch(/no compressible|threshold/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fail-open when Headroom returns non-shrinking content", async () => {
    const longText = "z".repeat(1500);
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "kiro-tool-0", content: longText + "extra" }],
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
          messages: [{ role: "tool", tool_call_id: "kiro-tool-0", content: "short" }],
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
