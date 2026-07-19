import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

function getToolUseBlockStart(events) {
  return events.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use")?.content_block;
}

describe("openaiToClaudeResponse tool argument sanitization", () => {
  it("drops invalid Read pages and clamps numeric bounds", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_read", function: { name: "Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/file.js", offset: -5, limit: 999999999, pages: "" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/file.js",
      offset: 0,
      limit: 2000,
    });
  });

  it("keeps valid PDF pages", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_pdf", function: { name: "proxy_Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/doc.pdf", pages: "1-3" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/doc.pdf",
      pages: "1-3",
    });
  });
});

describe("openaiToClaudeResponse late-streamed tool name", () => {
  // GLM 5.2 / GPT / grok stream the tool name in a chunk AFTER the one that
  // opens the tool call (id-first, name-later). deepseek/claude send the name
  // in the first chunk. The translator must resolve the real name in both
  // shapes — never emit a tool_use block with an empty name (Claude clients
  // reject "No such tool available: ").
  it("resolves the real name when it streams in a later chunk (GLM/GPT/grok)", () => {
    const state = createState();

    // Chunk 1: id present, name empty (GLM opens the call before naming it)
    const e1 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_glm", function: { name: "" } }] } }],
    }, state);

    // Chunk 2: the name arrives late
    const e2 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "Read" } }] } }],
    }, state);

    // Chunk 3: arguments + finish
    const e3 = openaiToClaudeResponse({
      id: "chatcmpl-glm",
      model: "glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/a.js" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    const all = [...(e1 || []), ...(e2 || []), ...(e3 || [])];
    const blockStart = getToolUseBlockStart(all);

    expect(blockStart).toBeDefined();
    expect(blockStart.id).toBe("toolu_glm");
    expect(blockStart.name).toBe("Read");
    // args must still round-trip to the correct block
    expect(JSON.parse(getInputJsonDelta(all))).toEqual({ file_path: "/a.js" });
  });

  it("resolves a name split across multiple chunks", () => {
    const state = createState();

    const e1 = openaiToClaudeResponse({
      id: "chatcmpl-split",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_split", function: { name: "Re" } }] } }],
    }, state);
    const e2 = openaiToClaudeResponse({
      id: "chatcmpl-split",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "ad" } }] } }],
    }, state);
    const e3 = openaiToClaudeResponse({
      id: "chatcmpl-split",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, finish_reason: "tool_calls" }],
    }, state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || []), ...(e3 || [])]);
    expect(blockStart?.name).toBe("Read");
  });

  it("resolves the name when it arrives in the first chunk (deepseek/claude)", () => {
    const state = createState();

    // deepseek/claude send id + full name in the first chunk
    const e1 = openaiToClaudeResponse({
      id: "chatcmpl-ds",
      model: "deepseek-v4-pro",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_ds", function: { name: "Read" } }] } }],
    }, state);
    const e2 = openaiToClaudeResponse({
      id: "chatcmpl-ds",
      model: "deepseek-v4-pro",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || [])]);
    expect(blockStart?.id).toBe("toolu_ds");
    expect(blockStart?.name).toBe("Read");
  });

  it("skips a tool call whose name never arrives (no nameless tool_use block)", () => {
    const state = createState();

    // Degenerate: id + args but the provider never sends a name. Emitting a
    // nameless tool_use block is exactly the failure we guard against, so the
    // block must be dropped rather than shipped empty.
    const e1 = openaiToClaudeResponse({
      id: "chatcmpl-noname",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_noname", function: { arguments: "{}" } }] } }],
    }, state);
    const e2 = openaiToClaudeResponse({
      id: "chatcmpl-noname",
      model: "glm-5.2",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    const blockStart = getToolUseBlockStart([...(e1 || []), ...(e2 || [])]);
    expect(blockStart).toBeUndefined();
  });
});
