import { describe, expect, it } from "vitest";

import { withClaudeCodeSuffix, fullModelWithSuffix } from "../../src/shared/utils/claudeCodeModelId.js";

// The copy-to-clipboard value must include the "[1m]" suffix IFF the model's
// resolved context window is ≥ 1M. Pure helpers — the context window comes
// from the cached /v1/models lookup (useModelContextWindows), which covers
// live-resolved and provider-updated models, not just the static catalog.
describe("withClaudeCodeSuffix", () => {
  it("appends [1m] when contextWindow ≥ 1M", () => {
    expect(withClaudeCodeSuffix("glm-5.2", 1_000_000)).toBe("glm-5.2[1m]");
    expect(withClaudeCodeSuffix("glm-5.2", 1_500_000)).toBe("glm-5.2[1m]");
  });

  it("leaves the id bare when contextWindow < 1M", () => {
    expect(withClaudeCodeSuffix("glm-5.1", 200_000)).toBe("glm-5.1");
    expect(withClaudeCodeSuffix("glm-5", 200_000)).toBe("glm-5");
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

  it("returns bare alias/model for sub-1M models", () => {
    expect(fullModelWithSuffix("glm", "glm-5.1", 200_000)).toBe("glm/glm-5.1");
  });
});
