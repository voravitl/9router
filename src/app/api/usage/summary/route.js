// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { ID_TO_ALIAS as PROVIDER_ID_TO_ALIAS, AI_PROVIDERS } from "@/shared/constants/providers";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials, isAuthExpiredMessage } from "../[connectionId]/route.js";

/**
 * GET /api/usage/summary
 * Aggregates per-provider usage/limits across every active connection.
 *
 * Mirrors the per-connection /api/usage/[connectionId] flow:
 *   - OAuth credentials refreshed BEFORE the usage fetch (sequentially —
 *     parallel refreshes would hammer provider auth endpoints, see
 *     src/shared/services/quotaAutoPing.js).
 *   - Auth-expired responses trigger a single force-refresh + retry.
 *   - Proxy options built with strictProxy:false so quota fetches fall back
 *     to direct on proxy failure.
 *
 * Response shape:
 *   { providers: [{ id, connectionId, alias, name, usage | {authExpired:true} | {skipped:true,reason} }] }
 *
 * `usage` is the raw shape from open-sse/services/usage/<provider>.js
 * (claude: five_hour/seven_day, kiro: weekly, codebuddy: ..., etc.).
 *
 * `connectionId` is included so callers can disambiguate multi-account setups.
 *
 * Cookie-authed (matches /api/models).
 */
async function refreshOAuthSequentially(connections) {
  const refreshed = [];
  for (const conn of connections) {
    const isOAuth = Boolean(conn.refreshToken);
    if (!isOAuth) { refreshed.push(conn); continue; }
    const proxyOptions = buildProxyOptions(conn);
    try {
      const result = await refreshAndUpdateCredentials(conn, false, proxyOptions);
      refreshed.push(result.connection);
    } catch (refreshError) {
      // Keep the stale connection so the fetch can surface authExpired cleanly.
      refreshed.push(conn);
    }
  }
  return refreshed;
}

function buildProxyOptions(conn) {
  // Built lazily per-use; resolveConnectionProxyConfig is async, called at fetch time.
  // For refresh we need a sync object — read the cached config off the connection.
  const cfg = conn._resolvedProxy || {};
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

export async function GET() {
  try {
    const all = await getProviderConnections();
    const active = all.filter((c) => c && c.isActive !== false);

    // Resolve proxy config once per connection (async), stash for sync access.
    // Isolate per-connection failures so one bad row doesn't sink the batch.
    for (const conn of active) {
      try {
        const cfg = await resolveConnectionProxyConfig(conn.providerSpecificData);
        conn._resolvedProxy = cfg;
      } catch (e) {
        console.warn(`[Usage/summary] ${conn.provider}: proxy resolve failed: ${e.message}`);
        conn._resolvedProxy = {};
      }
    }

    // Sequential OAuth refresh — parallel refresh would race on provider auth
    // endpoints and on DB writes (see quotaAutoPing.js).
    const refreshed = await refreshOAuthSequentially(active);

    // Parallel usage fetch — different upstreams, safe to fan out.
    // Per-connection try/catch covers the whole chain (refresh already ran
    // sequentially above; this is the fetch + auth-expiry retry) so one
    // provider's bad day doesn't sink the batch.
    const results = await Promise.all(
      refreshed.map(async (conn) => {
        const id = conn.provider;
        const alias = PROVIDER_ID_TO_ALIAS[id] || id;
        const name = AI_PROVIDERS[id]?.display?.name || id;
        const proxyOptions = buildProxyOptions(conn);
        const isOAuth = Boolean(conn.refreshToken);
        const base = { id, connectionId: conn.id, alias, name };
        try {
          let usage = await getUsageForProvider(conn, proxyOptions);
          // Auth-expired response → force-refresh + retry once (OAuth only).
          if (isOAuth && isAuthExpiredMessage(usage) && conn.refreshToken) {
            try {
              const retry = await refreshAndUpdateCredentials(conn, true, proxyOptions);
              usage = await getUsageForProvider(retry.connection, proxyOptions);
            } catch (e) {
              console.warn(`[Usage/summary] ${id}: force refresh failed: ${e.message}`);
              return { ...base, authExpired: true };
            }
          }
          if (isAuthExpiredMessage(usage)) {
            return { ...base, authExpired: true };
          }
          return { ...base, usage };
        } catch (e) {
          if (isOAuth && /expired|401|unauthorized|re-authorize/i.test(e?.message || "")) {
            return { ...base, authExpired: true };
          }
          console.warn(`[Usage/summary] ${id}: ${e?.message || "fetch_failed"}`);
          return { ...base, skipped: true, reason: e?.message || "fetch_failed" };
        }
      }),
    );

    return NextResponse.json({ providers: results });
  } catch (error) {
    console.error("[API] /api/usage/summary failed:", error);
    return NextResponse.json({ error: "Failed to fetch usage summary" }, { status: 500 });
  }
}
