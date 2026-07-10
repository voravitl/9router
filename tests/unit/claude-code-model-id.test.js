import { describe, expect, it } from "vitest";

import {
  toClaudeCodeModelId,
  withClaudeCodeSuffix,
  fullModelWithSuffix,
} from "../../src/shared/utils/claudeCodeModelId.js";

// The copy-to-clipboard value must include the "[1m]" suffix IFF the model's
// resolved context window is ≥ 1M. Pure helpers — the context window comes
// from the cached /v1/models lookup (useModelContextWindows), which covers
// live-resolved and provider-updated models, not just the static catalog.
//
// Claude Code only recognises dash version spelling (`claude-opus-4-8`).
// Dot form (`claude-opus-4.8`) is misread (e.g. as model "4"). Copy path
// dashifies Claude family ids before the [1m] suffix.
describe("toClaudeCodeModelId", () => {
  it("converts Claude family N.M dots to dashes", () => {
    expect(toClaudeCodeModelId("claude-opus-4.8")).toBe("claude-opus-4-8");
    expect(toClaudeCodeModelId("claude-sonnet-4.5")).toBe("claude-sonnet-4-5");
    expect(toClaudeCodeModelId("claude-haiku-4.5")).toBe("claude-haiku-4-5");
  });

  it("preserves synthetic -thinking / -agentic suffixes after dashify", () => {
    expect(toClaudeCodeModelId("claude-opus-4.8-thinking")).toBe("claude-opus-4-8-thinking");
    expect(toClaudeCodeModelId("claude-sonnet-4.5-agentic")).toBe("claude-sonnet-4-5-agentic");
    expect(toClaudeCodeModelId("claude-opus-4.8-thinking-agentic")).toBe(
      "claude-opus-4-8-thinking-agentic",
    );
  });

  it("leaves already-dash Claude ids and date-suffixed ids untouched", () => {
    expect(toClaudeCodeModelId("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(toClaudeCodeModelId("claude-opus-4-20250514")).toBe("claude-opus-4-20250514");
    expect(toClaudeCodeModelId("claude-opus-4-1-20250805")).toBe("claude-opus-4-1-20250805");
  });

  it("leaves non-Claude ids with dots untouched", () => {
    expect(toClaudeCodeModelId("glm-5.2")).toBe("glm-5.2");
    expect(toClaudeCodeModelId("gpt-5.5")).toBe("gpt-5.5");
  });

  it("handles non-string / empty without throwing", () => {
    expect(toClaudeCodeModelId("")).toBe("");
    expect(toClaudeCodeModelId(undefined)).toBe("");
    expect(toClaudeCodeModelId(null)).toBe("");
  });
});

describe("withClaudeCodeSuffix", () => {
  it("appends [1m] when contextWindow ≥ 1M", () => {
    expect(withClaudeCodeSuffix("glm-5.2", 1_000_000)).toBe("glm-5.2[1m]");
    expect(withClaudeCodeSuffix("glm-5.2", 1_500_000)).toBe("glm-5.2[1m]");
  });

  it("dashifies Claude family ids then appends [1m] for 1M context", () => {
    expect(withClaudeCodeSuffix("claude-opus-4.8", 1_000_000)).toBe("claude-opus-4-8[1m]");
    expect(withClaudeCodeSuffix("claude-opus-4.8-thinking", 1_000_000)).toBe(
      "claude-opus-4-8-thinking[1m]",
    );
  });

  it("leaves the id bare when contextWindow < 1M", () => {
    expect(withClaudeCodeSuffix("glm-5.1", 200_000)).toBe("glm-5.1");
    expect(withClaudeCodeSuffix("glm-5", 200_000)).toBe("glm-5");
    expect(withClaudeCodeSuffix("claude-opus-4.8", 200_000)).toBe("claude-opus-4-8");
  });

  it("leaves the id bare when contextWindow is undefined/unknown", () => {
    expect(withClaudeCodeSuffix("made-up-model", undefined)).toBe("made-up-model");
    expect(withClaudeCodeSuffix("made-up-model", null)).toBe("made-up-model");
  });

  it("handles non-string / empty id without throwing", () => {
    expect(withClaudeCodeSuffix("", 1_000_000)).toBe("");
    expect(withClaudeCodeSuffix(undefined, 1_000_000)).toBe("");
  });
});

describe("fullModelWithSuffix", () => {
  it("returns alias/model[1m] for 1M models", () => {
    expect(fullModelWithSuffix("glm", "glm-5.2", 1_000_000)).toBe("glm/glm-5.2[1m]");
    expect(fullModelWithSuffix("bpm", "glm-5-2-260617", 1_000_000)).toBe("bpm/glm-5-2-260617[1m]");
  });

  it("returns dash Claude form for Kiro copy path", () => {
    expect(fullModelWithSuffix("kr", "claude-opus-4.8", 1_000_000)).toBe("kr/claude-opus-4-8[1m]");
  });

  it("returns bare alias/model for sub-1M models", () => {
    expect(fullModelWithSuffix("glm", "glm-5.1", 200_000)).toBe("glm/glm-5.1");
  });
});

// Combined suffix behavior from the upstream v0.5.20 merge (ModelRow.js /
// ModelsTable.js copy-string construction): a model that is BOTH a 1M-context
// model AND has a forced thinking level must chain ours' "[1m]" context
// suffix THEN theirs' "(level)" thinking suffix, in that order, so the copied
// string is unambiguous about both properties at once.
function buildCopyText(alias, modelId, contextWindow, thinkingSuffix) {
  const baseCopyText = fullModelWithSuffix(alias, modelId, contextWindow);
  return thinkingSuffix ? `${baseCopyText}(${thinkingSuffix})` : baseCopyText;
}

describe("combined [1m] + thinking-level copy suffix", () => {
  it("chains [1m] then (level) when a model is both 1M-context and has a forced thinking level", () => {
    expect(buildCopyText("glm", "glm-5.2", 1_000_000, "high")).toBe("glm/glm-5.2[1m](high)");
  });

  it("applies only [1m] when there is no forced thinking level", () => {
    expect(buildCopyText("glm", "glm-5.2", 1_000_000, null)).toBe("glm/glm-5.2[1m]");
  });

  it("applies only (level) when the model is sub-1M context", () => {
    expect(buildCopyText("glm", "glm-5.1", 200_000, "high")).toBe("glm/glm-5.1(high)");
  });

  it("applies neither suffix for a plain sub-1M model with no thinking level", () => {
    expect(buildCopyText("glm", "glm-5.1", 200_000, null)).toBe("glm/glm-5.1");
  });

  it("dashifies Claude family before chaining suffixes", () => {
    expect(buildCopyText("kr", "claude-opus-4.8", 1_000_000, "high")).toBe(
      "kr/claude-opus-4-8[1m](high)",
    );
  });
});
