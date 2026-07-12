import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

import { buildRequestDetail } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { buildOnStreamComplete } from "../../open-sse/handlers/chatCore/streamingHandler.js";

describe("request detail token-saver stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("buildRequestDetail includes rtk/headroom fields from base", () => {
    const rtkStats = { bytesBefore: 1000, bytesAfter: 400, hits: ["find"] };
    const headroomStats = { savedTokens: 120 };
    const headroomDiagnostics = { beforeBytes: 900, afterBytes: 500 };

    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-test",
      connectionId: "conn-1",
      latency: { ttft: 10, total: 20 },
      tokens: { prompt_tokens: 1, completion_tokens: 2 },
      request: { model: "my-combo", stream: false, messages: [] },
      response: { content: "ok" },
      status: "success",
      rtkStats,
      headroomStats,
      headroomDiagnostics,
    }, { id: "detail_test_1" });

    expect(detail.id).toBe("detail_test_1");
    expect(detail.rtkStats).toEqual(rtkStats);
    expect(detail.headroomStats).toEqual(headroomStats);
    expect(detail.headroomDiagnostics).toEqual(headroomDiagnostics);
    // clientModel preserves combo/alias from original request body
    expect(detail.clientModel).toBe("my-combo");
    expect(detail.model).toBe("gpt-test");
  });

  it("buildRequestDetail defaults token-saver fields to null", () => {
    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-test",
      request: { model: "gpt-test", stream: true, messages: [] },
    });
    expect(detail.rtkStats).toBeNull();
    expect(detail.headroomStats).toBeNull();
    expect(detail.headroomDiagnostics).toBeNull();
  });

  it("stream complete path persists rtk/headroom stats with stable detailId", () => {
    const rtkStats = { bytesBefore: 50, bytesAfter: 10, hits: [] };
    const headroomStats = { savedTokens: 5 };
    const headroomDiagnostics = { phantom: false };

    const { onStreamComplete, streamDetailId } = buildOnStreamComplete({
      provider: "openai",
      model: "gpt-test",
      connectionId: "c1",
      apiKey: null,
      requestStartTime: Date.now() - 100,
      body: { model: "gpt-test", messages: [] },
      stream: true,
      finalBody: { messages: [] },
      translatedBody: { messages: [] },
      clientRawRequest: { endpoint: "/v1/chat/completions" },
      detailId: "detail_stable_abc",
      rtkStats,
      headroomStats,
      headroomDiagnostics,
    });

    expect(streamDetailId).toBe("detail_stable_abc");

    onStreamComplete({ content: "hello", thinking: null }, { prompt_tokens: 3, completion_tokens: 4 }, Date.now());

    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    const payload = saveRequestDetail.mock.calls[0][0];
    expect(payload.id).toBe("detail_stable_abc");
    expect(payload.rtkStats).toEqual(rtkStats);
    expect(payload.headroomStats).toEqual(headroomStats);
    expect(payload.headroomDiagnostics).toEqual(headroomDiagnostics);
    expect(payload.status).toBe("success");
  });
});
