/**
 * Unit tests for shrinkKiroPayload() — the reactive CONTENT_LENGTH_EXCEEDS_THRESHOLD
 * shrink strategy called by KiroExecutor.execute() when the Kiro/CodeWhisperer
 * gateway rejects an oversized request (issue #141).
 *
 * Covers:
 *  - Strategy 1: drop oldest history (geometric), preserve currentMessage + tools
 *  - Strategy 2: truncate current-turn content head+tail when history is empty
 *  - Floor: return false when nothing more can be shed
 *  - Orphaned toolResults are reconciled (folded to text) after a drop
 */

import { describe, it, expect } from "vitest";
import { shrinkKiroPayload } from "../../open-sse/translator/request/openai-to-kiro.js";

const userMsg = (content, ctx) => ({
  userInputMessage: { content, modelId: "m", ...(ctx ? { userInputMessageContext: ctx } : {}) },
});
const asstMsg = (content, toolUses) => ({
  assistantResponseMessage: { content, ...(toolUses ? { toolUses } : {}) },
});
const wrap = (history, currentMessage) => ({ conversationState: { history, currentMessage } });

describe("shrinkKiroPayload", () => {
  it("returns false when there is no conversationState", () => {
    expect(shrinkKiroPayload({})).toBe(false);
    expect(shrinkKiroPayload(null)).toBe(false);
  });

  describe("strategy 1: drop oldest history", () => {
    it("drops a turn-pair from the front and returns true", () => {
      const history = [userMsg("u1"), asstMsg("a1"), userMsg("u2"), asstMsg("a2")];
      const payload = wrap(history, userMsg("current"));
      const before = history.length;

      expect(shrinkKiroPayload(payload)).toBe(true);
      expect(payload.conversationState.history.length).toBeLessThan(before);
      // currentMessage is never dropped
      expect(payload.conversationState.currentMessage.userInputMessage.content).toBe("current");
    });

    it("drops an even count taken from the front (stays user-first / alternating)", () => {
      const history = [userMsg("u1"), asstMsg("a1"), userMsg("u2"), asstMsg("a2"), userMsg("u3"), asstMsg("a3")];
      const payload = wrap(history, userMsg("current"));

      shrinkKiroPayload(payload);
      const h = payload.conversationState.history;
      // dropped an even number → remaining head is still a user turn
      expect(h[0].userInputMessage).toBeDefined();
      expect(h.length % 2).toBe(0);
    });

    it("preserves tools schema on currentMessage through the drop", () => {
      const tools = [{ toolSpecification: { name: "read_file" } }];
      const current = userMsg("current", { tools });
      const payload = wrap([userMsg("u1"), asstMsg("a1")], current);

      shrinkKiroPayload(payload);
      expect(payload.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools).toEqual(tools);
    });

    it("folds an orphaned toolResult into text after its toolUse turn is dropped", () => {
      // assistant(toolUse X) + user(toolResult X). Dropping the assistant orphans the result.
      const history = [
        userMsg("kick off"),
        asstMsg("calling tool", [{ toolUseId: "X", name: "read_file", input: {} }]),
        userMsg("here is the file", { toolResults: [{ toolUseId: "X", status: "success", content: [{ text: "FILE_BODY_CONTENT" }] }] }),
      ];
      const payload = wrap(history, userMsg("current"));

      expect(shrinkKiroPayload(payload)).toBe(true);
      const h = payload.conversationState.history;
      // The surviving user turn must have no dangling structured toolResults...
      for (const item of h) {
        const ctx = item.userInputMessage?.userInputMessageContext;
        expect(ctx?.toolResults ?? []).toHaveLength(0);
      }
      // ...and the salvaged content survives as text somewhere in the remaining turns.
      const allText = h.map((i) => i.userInputMessage?.content || "").join("\n");
      expect(allText).toContain("FILE_BODY_CONTENT");
    });
  });

  describe("strategy 2: truncate current-turn content", () => {
    it("truncates a large current message head+tail when history is empty", () => {
      const big = "HEAD_MARKER" + "x".repeat(50000) + "TAIL_MARKER";
      const payload = wrap([], userMsg(big));

      expect(shrinkKiroPayload(payload)).toBe(true);
      const out = payload.conversationState.currentMessage.userInputMessage.content;
      expect(out.length).toBeLessThan(big.length);
      // head + tail preserved, middle dropped
      expect(out.startsWith("HEAD_MARKER")).toBe(true);
      expect(out.endsWith("TAIL_MARKER")).toBe(true);
      expect(out).toContain("truncated");
    });

    it("shrinks progressively across repeated calls", () => {
      const payload = wrap([], userMsg("y".repeat(100000)));
      const l0 = payload.conversationState.currentMessage.userInputMessage.content.length;
      shrinkKiroPayload(payload);
      const l1 = payload.conversationState.currentMessage.userInputMessage.content.length;
      shrinkKiroPayload(payload);
      const l2 = payload.conversationState.currentMessage.userInputMessage.content.length;
      expect(l1).toBeLessThan(l0);
      expect(l2).toBeLessThan(l1);
    });
  });

  describe("floor", () => {
    it("returns false when history is empty and current content is already small", () => {
      const payload = wrap([], userMsg("tiny message"));
      expect(shrinkKiroPayload(payload)).toBe(false);
    });

    it("eventually reaches the floor after enough shrinks", () => {
      const payload = wrap([userMsg("u1"), asstMsg("a1")], userMsg("z".repeat(20000)));
      let guard = 0;
      while (shrinkKiroPayload(payload) && guard < 50) guard++;
      expect(guard).toBeLessThan(50); // converges, does not loop forever
      expect(shrinkKiroPayload(payload)).toBe(false); // stays at floor
    });
  });
});
