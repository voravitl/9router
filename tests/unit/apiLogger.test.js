import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { withLogging } from "@/lib/apiLogger";

/** Minimal Next.js-like Response stub used by the wrapper. */
function makeResponse({ status = 200, body = {} } = {}) {
  const headers = new Map();
  let _status = status;
  let _body = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status: typeof status === "number" ? status : _status,
    get ok() { return _status < 400; },
    async json() { return JSON.parse(_body); },
    async text() { return _body; },
  };
}

/** Minimal Next.js NextResponse stub that exposes status() + json() + text(). */
function makeNextResponse({ status = 200, body = {} } = {}) {
  let _status = status;
  let _body = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status() { return _status; },
    async json() { return JSON.parse(_body); },
    async text() { return _body; },
  };
}

function makeRequest({ method = "GET", url = "http://localhost/api/usage/summary" } = {}) {
  return { method, url, headers: new Map() };
}

describe("withLogging", () => {
  let logSpy, warnSpy, errorSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs start and successful completion with status + duration", async () => {
    const handler = vi.fn(async () => makeNextResponse({ status: 200, body: { ok: true } }));
    const wrapped = withLogging(handler, "GET /api/usage/summary");
    const req = makeRequest();

    const res = await wrapped(req);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe("[API] GET http://localhost/api/usage/summary — GET /api/usage/summary");
    const endLine = logSpy.mock.calls[1][0];
    expect(endLine).toMatch(/\[API\] GET .* → 200 \(\d+ms\)/);
    expect(res.status()).toBe(200);
    // 2xx — no body warn log.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs thrown errors with stack and rethrows", async () => {
    const boom = new Error("kaboom");
    const handler = vi.fn(async () => { throw boom; });
    const wrapped = withLogging(handler, "GET /boom");

    await expect(wrapped(makeRequest({ url: "http://localhost/boom" }))).rejects.toThrow("kaboom");

    // Final log line is the 500 end marker.
    const endLine = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    expect(endLine).toMatch(/→ 500 \(\d+ms\)/);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[API] GET http://localhost/boom ✗ kaboom"));
    expect(errorSpy).toHaveBeenCalledWith(boom.stack);
  });

  it("logs body for 4xx responses", async () => {
    const handler = vi.fn(async () => makeNextResponse({ status: 401, body: { error: "Unauthorized" } }));
    const wrapped = withLogging(handler, "GET /api/usage/summary");

    await wrapped(makeRequest());

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[API] GET http://localhost/api/usage/summary 401 body={"error":"Unauthorized"}'),
    );
  });

  it("logs body for 5xx responses", async () => {
    const handler = vi.fn(async () => makeNextResponse({ status: 500, body: { error: "boom" } }));
    const wrapped = withLogging(handler, "POST /api/x");

    await wrapped(makeRequest({ method: "POST", url: "http://localhost/api/x" }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[API] POST http://localhost/api/x 500 body={"error":"boom"}'),
    );
  });

  it("does not log body for 2xx/3xx responses", async () => {
    const handler = vi.fn(async () => makeNextResponse({ status: 204 }));
    const wrapped = withLogging(handler, "DELETE /api/x");

    await wrapped(makeRequest({ method: "DELETE", url: "http://localhost/api/x" }));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("handles plain Response objects with numeric status", async () => {
    const handler = vi.fn(async () => makeResponse({ status: 403, body: "forbidden" }));
    const wrapped = withLogging(handler, "GET /api/x");

    await wrapped(makeRequest({ url: "http://localhost/api/x" }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[API] GET http://localhost/api/x 403 body=forbidden"),
    );
  });
});
