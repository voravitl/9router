import { describe, expect, it } from "bun:test";
import { resolveComboContextWindow } from "@/app/api/v1/models/route.js";

describe("Combo context window resolution", () => {
  it("resolves context window for combos with provider-prefixed models", () => {
    const combo = {
      name: "test-combo-1",
      models: ["kr/claude-sonnet-4.6", "openai/gpt-4o"],
    };
    // min(1000000, 128000) => 128000
    const cw = resolveComboContextWindow(combo);
    expect(cw).toBe(128000);
  });

  it("resolves context window for combos with bare model names (slashless)", () => {
    const combo = {
      name: "test-combo-2",
      models: ["claude-opus-4.7", "gpt-4o"],
    };
    // min(1000000, 128000) => 128000
    const cw = resolveComboContextWindow(combo);
    expect(cw).toBe(128000);
  });

  it("returns undefined for empty combo models", () => {
    expect(resolveComboContextWindow({ models: [] })).toBeUndefined();
  });
});
