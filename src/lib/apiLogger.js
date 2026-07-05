/**
 * Per-route API logging wrapper.
 *
 * Wrap a Next.js App Router route handler with `withLogging` to emit structured
 * request/response logs. Opt-in per route — NOT a replacement for Next.js's
 * built-in logging. Designed to surface silent auth failures (bug #d11fb12)
 * and other 4xx/5xx responses that would otherwise vanish.
 *
 * Logs go through `console.log/warn/error` so they're captured by the existing
 * consoleLogBuffer + server stdout like the rest of `[API]` output.
 */

function logStart(method, url, routeName) {
  console.log(`[API] ${method} ${url} — ${routeName}`);
}

function logEnd(method, url, statusCode, durationMs) {
  console.log(`[API] ${method} ${url} → ${statusCode} (${durationMs}ms)`);
}

function logError(method, url, err) {
  console.error(`[API] ${method} ${url} ✗ ${err?.message || err}`);
  if (err?.stack) console.error(err.stack);
}

/**
 * Inspect a Next.js handler return value for a status code.
 * App Router handlers return either a Response (NextResponse) or sometimes
 * a plain object in tests. Returns undefined when not determinable.
 */
function statusCodeOf(result) {
  if (!result) return undefined;
  if (typeof result.status === "number") return result.status;
  if (typeof result.status === "function") {
    try { return result.status(); } catch {}
  }
  if (typeof result.json === "function") {
    // No status() — default 200 for NextResponse per Next.js semantics.
    return 200;
  }
  return undefined;
}

/**
 * For 4xx/5xx responses, log the body so silent auth/quota failures are
 * debuggable. Reads the body text without consuming the stream when possible.
 */
async function logBodyIfErrorStatus(method, url, status, result) {
  if (status === undefined || status < 400) return;
  if (!result || typeof result.text !== "function") {
    console.warn(`[API] ${method} ${url} ${status} (no inspectable body)`);
    return;
  }
  // NextResponse.text() clones internally; safe to read here.
  let bodyText;
  try { bodyText = await result.text(); }
  catch {
    console.warn(`[API] ${method} ${url} ${status} (body read failed)`);
    return;
  }
  console.warn(`[API] ${method} ${url} ${status} body=${bodyText}`);
}

/**
 * Wrap an App Router route handler with structured logging.
 *
 * @param {function} handler - async (request, ctx) => Response
 * @param {string} routeName - human label, e.g. "GET /api/usage/summary"
 * @returns {function} wrapped handler with the same signature
 */
export function withLogging(handler, routeName) {
  return async function loggedHandler(request, ctx) {
    const method = request?.method || "UNKNOWN";
    const url = request?.url || "";
    logStart(method, url, routeName);
    const startedAt = Date.now();
    try {
      const result = await handler(request, ctx);
      const duration = Date.now() - startedAt;
      const status = statusCodeOf(result);
      logEnd(method, url, status ?? 200, duration);
      await logBodyIfErrorStatus(method, url, status, result);
      return result;
    } catch (err) {
      const duration = Date.now() - startedAt;
      logEnd(method, url, 500, duration);
      logError(method, url, err);
      throw err;
    }
  };
}
