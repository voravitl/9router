import { describe, it, expect } from "vitest";
import { capTools } from "../../open-sse/utils/toolCap.js";

describe("capTools", () => {
  it("leaves body alone when under max", () => {
    const body = { tools: [{ name: "a" }, { name: "b" }] };
    const r = capTools(body, 250);
    expect(body.tools).toHaveLength(2);
    expect(r.cappedFrom).toBe(2);
    expect(r.cappedTo).toBe(2);
  });

  it("slices tools to max when over limit", () => {
    const body = {
      tools: Array.from({ length: 266 }, (_, i) => ({ name: `tool_${i}` })),
    };
    const r = capTools(body, 250);
    expect(body.tools).toHaveLength(250);
    expect(body.tools[0].name).toBe("tool_0");
    expect(body.tools[249].name).toBe("tool_249");
    expect(r.cappedFrom).toBe(266);
    expect(r.cappedTo).toBe(250);
  });

  it("no-ops without max or tools", () => {
    expect(capTools({ tools: [{ name: "a" }] }, null).cappedTo).toBe(1);
    expect(capTools({}, 250).cappedFrom).toBe(0);
    expect(capTools(null, 250).cappedFrom).toBe(0);
  });
});
