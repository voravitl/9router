import { describe, it, expect, beforeEach, vi } from "vitest";
import { OllamaService } from "@/lib/oauth/services/ollama.js";

describe("OllamaService", () => {
  let ollamaService;

  beforeEach(() => {
    ollamaService = new OllamaService();
    vi.clearAllMocks();
  });

  describe("listAvailableModels", () => {
    it("should fetch models from Ollama Cloud API", async () => {
      const mockModels = [
        {
          name: "glm-5.2:cloud",
          display_name: "GLM 5.2 Cloud",
          description: "Alibaba GLM model",
          size: 3000000000,
          modified_at: "2025-06-15T10:00:00Z",
        },
        {
          name: "deepseek-v4-pro:cloud",
          display_name: "DeepSeek v4 Pro",
          size: 4000000000,
        },
      ];

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: mockModels }),
        })
      );

      const result = await ollamaService.listAvailableModels("test-api-key");

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: "glm-5.2:cloud",
        name: "GLM 5.2 Cloud",
        description: "Alibaba GLM model",
      });
      expect(result[1]).toMatchObject({
        id: "deepseek-v4-pro:cloud",
        name: "DeepSeek v4 Pro",
      });
    });

    it("should handle missing API key", async () => {
      await expect(ollamaService.listAvailableModels("")).rejects.toThrow(
        "Ollama API key is required"
      );
    });

    it("should handle 401 unauthorized", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
        })
      );

      await expect(ollamaService.listAvailableModels("invalid-key")).rejects.toThrow(
        "Invalid or expired Ollama API key"
      );
    });

    it("should normalize models correctly", async () => {
      const mockModels = [
        {
          name: "kimi-k2.7-code:cloud",
          display_name: "Kimi K2.7 Code",
          details: { context_length: 128000 },
        },
      ];

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: mockModels }),
        })
      );

      const result = await ollamaService.listAvailableModels("test-key");

      expect(result[0]).toMatchObject({
        id: "kimi-k2.7-code:cloud",
        name: "Kimi K2.7 Code",
        contextLength: 128000,
      });
    });

    it("should filter out models without ID", async () => {
      const mockModels = [
        { name: "valid-model:cloud" },
        { display_name: "Missing ID Model" }, // No id/name
        { id: "model-with-id" },
      ];

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: mockModels }),
        })
      );

      const result = await ollamaService.listAvailableModels("test-key");

      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual([
        "valid-model:cloud",
        "model-with-id",
      ]);
    });
  });

  describe("validateApiKey", () => {
    it("should validate a valid API key", async () => {
      const mockModels = [{ name: "test-model:cloud" }];

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ models: mockModels }),
        })
      );

      const result = await ollamaService.validateApiKey("valid-api-key");

      expect(result).toMatchObject({
        valid: true,
        accessToken: "valid-api-key",
        refreshToken: null,
        modelsCount: 1,
      });
    });

    it("should reject invalid API key", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
        })
      );

      await expect(ollamaService.validateApiKey("invalid-key")).rejects.toThrow(
        "validation failed"
      );
    });
  });
});
