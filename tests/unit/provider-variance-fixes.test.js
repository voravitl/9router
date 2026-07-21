import { describe, expect, it } from "vitest";
import { processStreamThinkingTags } from "../../open-sse/translator/concerns/reasoning.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import { getCapabilitiesForModel, resolveKnownContextWindow } from "../../open-sse/providers/capabilities.js";

describe("Stateful processStreamThinkingTags", () => {
  it("processes inline <think> tags split across multiple SSE chunks statefully", () => {
    const state = {};

    // Chunk 1: Open tag
    const c1 = processStreamThinkingTags("<think>", state);
    expect(c1.thinking).toBe("");
    expect(c1.text).toBe("");
    expect(state.inInlineThinking).toBe(true);

    // Chunk 2: Thinking content
    const c2 = processStreamThinkingTags("secret reasoning content", state);
    expect(c2.thinking).toBe("secret reasoning content");
    expect(c2.text).toBe("");
    expect(state.inInlineThinking).toBe(true);

    // Chunk 3: Close tag
    const c3 = processStreamThinkingTags("</think>Final answer", state);
    expect(c3.thinking).toBe("");
    expect(c3.text).toBe("Final answer");
    expect(state.inInlineThinking).toBe(false);
  });

  it("handles mid-tag split chunks statefully without leaking tags or content into text", () => {
    const state = {};

    // Chunk 1: Partial open tag "<thi"
    const c1 = processStreamThinkingTags("<thi", state);
    expect(c1.text).toBe("");
    expect(c1.thinking).toBe("");

    // Chunk 2: Remainder of open tag + body "nk>thinking step"
    const c2 = processStreamThinkingTags("nk>thinking step", state);
    expect(c2.thinking).toBe("thinking step");
    expect(c2.text).toBe("");

    // Chunk 3: Partial close tag "</thi"
    const c3 = processStreamThinkingTags("</thi", state);
    expect(c3.thinking).toBe("");
    expect(c3.text).toBe("");

    // Chunk 4: Remainder of close tag + text "nk>Result"
    const c4 = processStreamThinkingTags("nk>Result", state);
    expect(c4.thinking).toBe("");
    expect(c4.text).toBe("Result");
    expect(state.inInlineThinking).toBe(false);
  });
});

describe("Ollama num_ctx injection", () => {
  it("injects catalog-resolved context window for known models", () => {
    const req = openaiToOllamaRequest("qwen2.5-coder:32b", { messages: [] }, true);
    expect(req.options?.num_ctx).toBeDefined();
    expect(req.options.num_ctx).toBe(1000000);
  });

  it("does NOT fabricate 200k num_ctx for unknown models", () => {
    const req = openaiToOllamaRequest("completely-unknown-custom-model-xyz", { messages: [] }, true);
    expect(req.options?.num_ctx).toBeUndefined();
  });

  it("allows explicit body.options.num_ctx override to win", () => {
    const req = openaiToOllamaRequest("qwen2.5-coder:32b", {
      messages: [],
      options: { num_ctx: 16384 }
    }, true);
    expect(req.options.num_ctx).toBe(16384);
  });
});

describe("Capabilities contextWindow boundaries", () => {
  it("resolves Claude Opus 4.6+ adaptive to 1M context", () => {
    expect(getCapabilitiesForModel("cc", "claude-opus-4.6").contextWindow).toBe(1000000);
  });

  it("keeps older Opus 4.5 at 200k context", () => {
    expect(getCapabilitiesForModel("cc", "claude-opus-4-5-20251101").contextWindow).toBe(200000);
  });

  it("keeps Claude 3.5 Sonnet at 200k context", () => {
    expect(getCapabilitiesForModel("cc", "claude-3-5-sonnet-20241022").contextWindow).toBe(200000);
  });
});
