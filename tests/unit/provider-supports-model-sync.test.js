import { describe, it, expect } from "vitest";
import { providerSupportsModelSync } from "@/shared/constants/providers.js";

// Gates the "Sync Models" UI button. True only for providers whose upstream can list
// LLM models; false for media/search/embedding providers (serviceKinds without "llm")
// and web-cookie providers (session auth, no models API).
describe("providerSupportsModelSync", () => {
  it("returns true for LLM providers (dedicated handler + config-backed)", () => {
    for (const id of ["kiro", "ollama", "openai", "glm", "azure", "deepseek"]) {
      expect(providerSupportsModelSync(id)).toBe(true);
    }
  });

  it("returns true for openai/anthropic compatible dynamic providers", () => {
    expect(providerSupportsModelSync("openai-compatible-myhost")).toBe(true);
    expect(providerSupportsModelSync("anthropic-compatible-myhost")).toBe(true);
  });

  it("returns false for media providers (tts/stt/image)", () => {
    for (const id of ["elevenlabs", "deepgram", "black-forest-labs", "fal-ai"]) {
      expect(providerSupportsModelSync(id)).toBe(false);
    }
  });

  it("returns false for search and embedding providers", () => {
    for (const id of ["brave-search", "tavily", "jina-ai", "voyage-ai"]) {
      expect(providerSupportsModelSync(id)).toBe(false);
    }
  });

  it("returns false for web-cookie providers (no models API)", () => {
    for (const id of ["grok-web", "perplexity-web"]) {
      expect(providerSupportsModelSync(id)).toBe(false);
    }
  });

  it("returns false for unknown providers", () => {
    expect(providerSupportsModelSync("does-not-exist")).toBe(false);
    expect(providerSupportsModelSync(undefined)).toBe(false);
  });
});
