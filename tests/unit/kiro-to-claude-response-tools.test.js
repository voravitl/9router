import { describe, expect, it } from "vitest";
import { kiroToClaudeResponse } from "../../open-sse/translator/response/kiro-to-claude.js";

// kiroToClaudeResponse receives OpenAI-shaped chunks (KiroExecutor already
// parses the AWS EventStream). It must survive the same late-name streaming
// hazard as openai-to-claude: a provider that opens the tool call with an id
// and streams the name in a later chunk must NOT produce a tool_use block with
// an empty name (Claude clients reject "No such tool available: ").

function chunk(delta, finish_reason) {
  return { id: "chatcmpl-kiro", model: "kiro", choices: [{ delta, finish_reason }] };
}

function getToolUseBlockStart(events) {
  return events.find((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use")?.content_block;
}

function getInputJsonDelta(events) {
  return events.find((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("kiroToClaudeResponse late-streamed tool name", () => {
  it("resolves the real name when it streams in a later chunk", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_k", function: { name: "" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { name: "Read" } }] }), state);
    const e3 = kiroToClaudeResponse(
      chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/a.js" }) } }] }, "tool_calls"),
      state
    );

    const all = [...(e1 || []), ...(e2 || []), ...(e3 || [])];
    const blockStart = getToolUseBlockStart(all);

    expect(blockStart).toBeDefined();
    expect(blockStart.id).toBe("toolu_k");
    expect(blockStart.name).toBe("Read");
    expect(JSON.parse(getInputJsonDelta(all))).toEqual({ file_path: "/a.js" });
  });

  it("resolves a name split across multiple chunks", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_s", function: { name: "Re" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { name: "ad" } }] }), state);
    const e3 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, "tool_calls"), state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || []), ...(e3 || [])]);
    expect(blockStart?.name).toBe("Read");
  });

  it("resolves the name when it arrives in the first chunk (deepseek/claude shape)", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_f", function: { name: "Read" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, "tool_calls"), state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || [])]);
    expect(blockStart?.id).toBe("toolu_f");
    expect(blockStart?.name).toBe("Read");
  });

  it("skips a tool call whose name never arrives (no nameless tool_use block)", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_n", function: { arguments: "{}" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({}, "tool_calls"), state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || [])]);
    expect(blockStart).toBeUndefined();
  });

  it("does not double the name when the provider re-echoes it each chunk", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_e", function: { name: "Read" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_e", function: { name: "Read", arguments: "{}" } }] }), state);
    const e3 = kiroToClaudeResponse(chunk({}, "tool_calls"), state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || []), ...(e3 || [])]);
    expect(blockStart?.name).toBe("Read");
  });

  it("recovers a name that arrives before the id (provisional slot)", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { name: "Read" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_p", function: { arguments: "{}" } }] }), state);
    const e3 = kiroToClaudeResponse(chunk({}, "tool_calls"), state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || []), ...(e3 || [])]);
    expect(blockStart?.id).toBe("toolu_p");
    expect(blockStart?.name).toBe("Read");
  });

  it("downgrades stop_reason to end_turn when all tool calls are dropped", () => {
    const state = {};

    const e1 = kiroToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "toolu_d", function: { arguments: "{}" } }] }), state);
    const e2 = kiroToClaudeResponse(chunk({}, "tool_calls"), state);

    const all = [...(e1 || []), ...(e2 || [])];
    expect(getToolUseBlockStart(all)).toBeUndefined();
    const delta = all.find((e) => e.type === "message_delta");
    expect(delta?.delta.stop_reason).toBe("end_turn");
  });
});
