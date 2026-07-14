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

  it("does not cross-slot corrupt when Headroom returns tool_call_ids shuffled (#130)", async () => {
    const toolA = "A".repeat(2000);
    const toolB = "B".repeat(1900);
    const toolC = "C".repeat(1800);
    const shortA = "a".repeat(50);
    const shortB = "b".repeat(60);
    const shortC = "c".repeat(70);

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          // Reversed/reordered relative to send order (kiro-tool-0/1/2) —
          // proves matching is by id, never by response position.
          messages: [
            { role: "tool", tool_call_id: "kiro-tool-2", content: shortC },
            { role: "tool", tool_call_id: "kiro-tool-0", content: shortA },
            { role: "tool", tool_call_id: "kiro-tool-1", content: shortB },
          ],
          tokens_saved: 300,
        }),
        { status: 200 },
      ),
    );

    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "hi",
            userInputMessageContext: {
              toolResults: [
                { status: "success", content: [{ text: toolA }] },
                { status: "success", content: [{ text: toolB }] },
                { status: "success", content: [{ text: toolC }] },
              ],
            },
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
    expect(stats.kiro_applied).toBe(3);
    const results =
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults;
    // Each slot must receive its OWN shortened text keyed by id — never a
    // neighbor's, even though Headroom returned them in a different order.
    expect(results[0].content[0].text).toBe(shortA);
    expect(results[1].content[0].text).toBe(shortB);
    expect(results[2].content[0].text).toBe(shortC);
  });

  it("skips unknown/missing tool_call_id without corrupting other slots (count mismatch)", async () => {
    const toolA = "A".repeat(2000);
    const toolB = "B".repeat(1900);
    const shortA = "a".repeat(50);

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          // Only 1 of 2 sent slots comes back, plus one bogus id Headroom
          // never received — must not be misapplied to any real slot.
          messages: [
            { role: "tool", tool_call_id: "kiro-tool-0", content: shortA },
            { role: "tool", tool_call_id: "kiro-tool-99", content: "z".repeat(10) },
          ],
          tokens_saved: 100,
        }),
        { status: 200 },
      ),
    );

    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "hi",
            userInputMessageContext: {
              toolResults: [
                { status: "success", content: [{ text: toolA }] },
                { status: "success", content: [{ text: toolB }] },
              ],
            },
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
    expect(stats.kiro_applied).toBe(1);
    const results =
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults;
    expect(results[0].content[0].text).toBe(shortA);
    // Slot 1 (toolB) had no matching id in the response — must stay
    // untouched, never overwritten by the bogus "kiro-tool-99" entry.
    expect(results[1].content[0].text).toBe(toolB);
  });

  it("before/after snapshot: only the compressed slot's text changes, rest of body untouched", async () => {
    const longTool = "L".repeat(2000);
    const shortTool = "s".repeat(80);
    const untouchedField = { keep: "me", nested: [1, 2, 3] };

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          messages: [{ role: "tool", tool_call_id: "kiro-tool-0", content: shortTool }],
          tokens_saved: 200,
        }),
        { status: 200 },
      ),
    );

    const body = {
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "hi",
            userInputMessageContext: {
              toolResults: [{ status: "success", content: [{ text: longTool }] }],
            },
          },
        },
      },
      unrelatedTopLevelField: untouchedField,
    };
    const before = JSON.parse(JSON.stringify(body));

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://headroom:8787",
      format: "kiro",
    });

    expect(stats).not.toBeNull();
    // Only the compressed text changed — everything else is byte-identical
    // to the pre-compress snapshot.
    expect(body.unrelatedTopLevelField).toEqual(before.unrelatedTopLevelField);
    expect(body.conversationState.currentMessage.userInputMessage.content).toBe(
      before.conversationState.currentMessage.userInputMessage.content,
    );
    const result =
      body.conversationState.currentMessage.userInputMessage.userInputMessageContext
        .toolResults[0].content[0];
    expect(result.text).toBe(shortTool);
    expect(result.text).not.toBe(longTool);
  });
});
