import { describe, it, expect } from "vitest";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";

// resolveKiroModel normalizes the client-facing dash version of a Claude id
// (claude-opus-4-8) to the dot form Kiro upstream expects (claude-opus-4.8).
// Claude Code only recognises the dash spelling, so callers send it; Kiro's
// upstream returns 400 "Invalid model ID" for the dash form.
describe("resolveKiroModel dash->dot normalization", () => {
  it("normalizes opus/sonnet/haiku dash versions to dot", () => {
    expect(resolveKiroModel("claude-opus-4-8").upstream).toBe("claude-opus-4.8");
    expect(resolveKiroModel("claude-sonnet-4-6").upstream).toBe("claude-sonnet-4.6");
    expect(resolveKiroModel("claude-haiku-4-5").upstream).toBe("claude-haiku-4.5");
  });

  it("normalizes together with -thinking / -agentic suffixes", () => {
    expect(resolveKiroModel("claude-opus-4-8-thinking")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: false,
      thinking: true,
    });
    expect(resolveKiroModel("claude-opus-4-8-agentic")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: true,
      thinking: false,
    });
    expect(resolveKiroModel("claude-opus-4-8-thinking-agentic")).toEqual({
      upstream: "claude-opus-4.8",
      agentic: true,
      thinking: true,
    });
  });

  it("leaves already-dotted ids unchanged", () => {
    expect(resolveKiroModel("claude-opus-4.8").upstream).toBe("claude-opus-4.8");
    expect(resolveKiroModel("claude-sonnet-4.5").upstream).toBe("claude-sonnet-4.5");
  });

  it("does NOT corrupt date-suffixed ids (two dash groups, anchored)", () => {
    expect(resolveKiroModel("claude-opus-4-1-20250805").upstream).toBe("claude-opus-4-1-20250805");
    expect(resolveKiroModel("claude-opus-4-20250514").upstream).toBe("claude-opus-4-20250514");
  });

  it("leaves non-claude ids untouched", () => {
    expect(resolveKiroModel("glm-5").upstream).toBe("glm-5");
    expect(resolveKiroModel("deepseek-3.2").upstream).toBe("deepseek-3.2");
    expect(resolveKiroModel("qwen3-coder-next").upstream).toBe("qwen3-coder-next");
    expect(resolveKiroModel("MiniMax-M2.5").upstream).toBe("MiniMax-M2.5");
  });
});
