/**
 * Integration test for KiroExecutor.execute() reactive shrink-retry (issue #141).
 *
 * Unlike kiro-shrink-payload.test.js (which unit-tests the pure shrink function),
 * this drives the REAL execute() loop end-to-end with a mocked upstream:
 * BaseExecutor.prototype.execute (what `super.execute()` resolves to) is spied to
 * return fake Responses, so the loop's detect-400 → clone/read → shrink →
 * cancel-body → retry → transform-on-200 flow runs exactly as in production —
 * without needing a live Kiro connection or credentials.
 *
 * Covers what the pure unit test cannot:
 *  - the while-loop actually retries on 400 content_length and stops on 200
 *  - payload mutation propagates to the retried super.execute() call
 *  - the discarded 400 body is cancelled (HIGH review finding) — once per discard
 *  - a non-content-length 400 is surfaced untouched (no retry, no shrink, no cancel)
 *  - persistent 400 is bounded and finally surfaced (not transformed)
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import KiroExecutor from "../../open-sse/executors/kiro.js";

// Real upstream 400 shape (matches the error the user reported).
const CL_400 = JSON.stringify({
  message: "Input content length exceeds threshold.",
  reason: "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
});

function makeResponse(status, bodyText, cancelLog) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      // records that THIS response's body was cancelled (the discard path)
      cancel: async () => { cancelLog.push(status); },
    },
    clone() {
      return { text: async () => bodyText };
    },
  };
}

// Kiro payload with `pairs` user+assistant turns in history + one current turn.
function makeBody(pairs) {
  const history = [];
  for (let i = 0; i < pairs; i++) {
    history.push({ userInputMessage: { content: `user ${i}`, modelId: "m" } });
    history.push({ assistantResponseMessage: { content: `asst ${i}` } });
  }
  return {
    conversationState: {
      history,
      currentMessage: { userInputMessage: { content: "current turn", modelId: "m" } },
    },
  };
}

describe("KiroExecutor reactive shrink-retry (integration, mocked upstream)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("400 content_length → shrinks payload → retries → 200 success", async () => {
    const cancelLog = [];
    const body = makeBody(6); // 12 history items
    const historyLenAtCall = [];
    let call = 0;

    const spy = vi
      .spyOn(BaseExecutor.prototype, "execute")
      .mockImplementation(async (args) => {
        call++;
        historyLenAtCall.push(args.body.conversationState.history.length);
        const status = call === 1 ? 400 : 200;
        const bodyText = call === 1 ? CL_400 : "";
        return { response: makeResponse(status, bodyText, cancelLog), url: "u", headers: {}, transformedBody: args.body };
      });

    const exec = new KiroExecutor();
    // Skip the real AWS EventStream transform on the 200 — return response as-is.
    vi.spyOn(exec, "transformEventStreamToSSE").mockImplementation((resp) => resp);

    const result = await exec.execute({ model: "kr/gpt-5.6-terra", body, stream: true, log: null });

    expect(spy).toHaveBeenCalledTimes(2);                            // initial + 1 retry
    expect(result.response.ok).toBe(true);                          // ended on 200
    expect(historyLenAtCall[1]).toBeLessThan(historyLenAtCall[0]);  // MUTATION propagated: payload shrank between calls
    expect(cancelLog).toEqual([400]);                               // discarded 400 body cancelled exactly once (HIGH fix)
  });

  it("non-content-length 400 → no retry, no shrink, body preserved for downstream", async () => {
    const cancelLog = [];
    const body = makeBody(6);
    const origLen = body.conversationState.history.length;

    const spy = vi
      .spyOn(BaseExecutor.prototype, "execute")
      .mockImplementation(async (args) => ({
        response: makeResponse(400, JSON.stringify({ message: "invalid model" }), cancelLog),
        url: "u", headers: {}, transformedBody: args.body,
      }));

    const exec = new KiroExecutor();
    const result = await exec.execute({ model: "kr/x", body, stream: true, log: null });

    expect(spy).toHaveBeenCalledTimes(1);                       // no retry
    expect(result.response.status).toBe(400);                   // surfaced as-is
    expect(body.conversationState.history.length).toBe(origLen); // NOT shrunk
    expect(cancelLog).toEqual([]);                              // body untouched → readable by parseUpstreamError
  });

  it("persistent content_length 400 → bounded retries → surfaces final 400 (not transformed)", async () => {
    const cancelLog = [];
    const body = makeBody(6);
    const transformSpy = vi.fn((r) => r);

    const spy = vi
      .spyOn(BaseExecutor.prototype, "execute")
      .mockImplementation(async (args) => ({
        response: makeResponse(400, CL_400, cancelLog),
        url: "u", headers: {}, transformedBody: args.body,
      }));

    const exec = new KiroExecutor();
    exec.transformEventStreamToSSE = transformSpy;

    const result = await exec.execute({ model: "kr/x", body, stream: true, log: null });

    // initial + retries; hard-capped at 1 + KIRO_MAX_SHRINK_RETRIES(5) = 6,
    // but stops earlier when shrink hits the floor (history drained + tiny current turn).
    expect(spy.mock.calls.length).toBeGreaterThan(1);           // did retry
    expect(spy.mock.calls.length).toBeLessThanOrEqual(6);       // bounded
    expect(result.response.status).toBe(400);                   // surfaced, not swallowed
    expect(transformSpy).not.toHaveBeenCalled();                // never transformed an error response
    // one cancel per discarded 400 (every call except the final surfaced one)
    expect(cancelLog.length).toBe(spy.mock.calls.length - 1);
  });

  it("oversized single current turn (empty history) → truncates content → 200", async () => {
    const cancelLog = [];
    const body = {
      conversationState: {
        history: [],
        currentMessage: { userInputMessage: { content: "X".repeat(50000), modelId: "m" } },
      },
    };
    let call = 0;

    vi.spyOn(BaseExecutor.prototype, "execute").mockImplementation(async (args) => {
      call++;
      const status = call === 1 ? 400 : 200;
      return { response: makeResponse(status, call === 1 ? CL_400 : "", cancelLog), url: "u", headers: {}, transformedBody: args.body };
    });

    const exec = new KiroExecutor();
    vi.spyOn(exec, "transformEventStreamToSSE").mockImplementation((r) => r);

    const result = await exec.execute({ model: "kr/x", body, stream: true, log: null });

    expect(result.response.ok).toBe(true);
    expect(body.conversationState.currentMessage.userInputMessage.content.length).toBeLessThan(50000); // truncated
    expect(cancelLog).toEqual([400]);
  });
});
