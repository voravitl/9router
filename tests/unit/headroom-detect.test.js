import { describe, it, expect, vi, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(() => { throw new Error("not found"); }),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
}));

import {
  getHeadroomStatus,
  isLoopbackHeadroomUrl,
  probeProxyRunning,
  resolveHeadroomUrl,
  __resetDetectCache,
} from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
  __resetDetectCache();
});

describe("headroom detect", () => {
  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.installed).toBe(false);
    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(status.canStart).toBe(false);
    // Prefer lightweight liveness over /health (upstream-aware, can hang).
    expect(global.fetch).toHaveBeenCalledWith(
      "http://headroom:8787/livez",
      expect.any(Object),
    );
  });

  it("falls back through livez → healthz → health", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/livez")) throw new Error("no livez");
      if (String(url).endsWith("/healthz")) throw new Error("no healthz");
      return new Response("ok", { status: 200 });
    });

    await expect(probeProxyRunning("http://headroom:8787")).resolves.toBe(true);
    expect(global.fetch.mock.calls.map((c) => c[0])).toEqual([
      "http://headroom:8787/livez",
      "http://headroom:8787/healthz",
      "http://headroom:8787/health",
    ]);
  });

  it("recognizes loopback URLs for managed local mode", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });

  it("rewrites localhost settings to HEADROOM_URL when env is a docker sidecar", () => {
    const prev = process.env.HEADROOM_URL;
    process.env.HEADROOM_URL = "http://headroom:8787";
    try {
      expect(resolveHeadroomUrl("http://localhost:8787")).toBe("http://headroom:8787");
      expect(resolveHeadroomUrl("http://127.0.0.1:8787")).toBe("http://headroom:8787");
      // explicit non-loopback settings win
      expect(resolveHeadroomUrl("http://10.0.0.5:8787")).toBe("http://10.0.0.5:8787");
    } finally {
      if (prev === undefined) delete process.env.HEADROOM_URL;
      else process.env.HEADROOM_URL = prev;
    }
  });
});
