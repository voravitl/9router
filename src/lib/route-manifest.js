// Single source of truth for API route -> auth-requirement mapping.
//
// Consumed by src/dashboardGuard.js. Every category the guard enforces is
// derived from this manifest so adding a new API route only needs one edit
// here (prevents recurrence of bug #d4efde7 where /api/usage/summary was
// missing from PUBLIC_API_PATHS and 403'd under Bearer auth).
//
// authType values mirror the guard's evaluation tiers (in evaluation order):
//   "local-only"       — spawn/host-secret routes; CLI token or local+JWT. 403 if denied.
//   "always-jwt"       — JWT or CLI token required regardless of requireLogin. 401 if denied.
//   "bearer"           — public LLM API prefix; API key (or local/CLI token). 401 if denied.
//   "none"             — no guard auth; route does its own auth (cookie/bearer/none).
//   "default"          — catch-all /api/* deny-by-default: CLI token or JWT/requireLogin.
//
// Each entry uses prefix matching (startsWith) to match the guard's existing
// semantics. `methods: ["*"]` means all methods — the guard is method-agnostic.

export const ROUTE_MANIFEST = [
  // --- local-only: spawn-capable / host-secret routes ----------------------
  {
    path: "/api/cli-tools/cowork-settings",
    authType: "local-only",
    methods: ["*"],
    description: "CLI tool settings writer; spawns local processes.",
  },
  {
    path: "/api/cli-tools/antigravity-mitm",
    authType: "local-only",
    methods: ["*"],
    description: "Antigravity MITM proxy control; spawns local process.",
  },
  {
    path: "/api/mcp/",
    authType: "local-only",
    methods: ["*"],
    description: "MCP plugin message/SSE bridge; host-secret access.",
  },
  {
    path: "/api/tunnel/tailscale-install",
    authType: "local-only",
    methods: ["*"],
    description: "Tailscale install; spawns host process.",
  },
  {
    path: "/api/tunnel/tailscale-enable",
    authType: "local-only",
    methods: ["*"],
    description: "Tailscale enable; mutates host network.",
  },
  {
    path: "/api/tunnel/tailscale-disable",
    authType: "local-only",
    methods: ["*"],
    description: "Tailscale disable; mutates host network.",
  },
  {
    path: "/api/tunnel/tailscale-check",
    authType: "local-only",
    methods: ["*"],
    description: "Tailscale status probe; reads host secrets.",
  },
  {
    path: "/api/tunnel/enable",
    authType: "local-only",
    methods: ["*"],
    description: "Tunnel enable; mutates host network.",
  },
  {
    path: "/api/tunnel/disable",
    authType: "local-only",
    methods: ["*"],
    description: "Tunnel disable; mutates host network.",
  },
  {
    path: "/api/oauth/cursor/auto-import",
    authType: "local-only",
    methods: ["*"],
    description: "Cursor OAuth auto-import; reads host credential store.",
  },
  {
    path: "/api/oauth/kiro/auto-import",
    authType: "local-only",
    methods: ["*"],
    description: "Kiro OAuth auto-import; reads host credential store.",
  },
  {
    path: "/api/auth/reset-password",
    authType: "local-only",
    methods: ["*"],
    description: "Password reset; sensitive host-local operation.",
  },
  {
    path: "/api/headroom/start",
    authType: "local-only",
    methods: ["*"],
    description: "Headroom job start; spawns child process.",
  },
  {
    path: "/api/headroom/stop",
    authType: "local-only",
    methods: ["*"],
    description: "Headroom job stop; controls child process.",
  },
  {
    path: "/api/headroom/proxy",
    authType: "local-only",
    methods: ["*"],
    description: "Headroom dashboard proxy; forwards to local headroom process.",
  },

  // --- always-jwt: require JWT or CLI token regardless of requireLogin -----
  {
    path: "/api/shutdown",
    authType: "always-jwt",
    methods: ["*"],
    description: "Server shutdown; always requires authenticated session.",
  },
  {
    path: "/api/settings/database",
    authType: "always-jwt",
    methods: ["*"],
    description: "Database export/management; always requires auth.",
  },
  {
    path: "/api/version/shutdown",
    authType: "always-jwt",
    methods: ["*"],
    description: "Version manager shutdown; always requires auth.",
  },
  {
    path: "/api/version/update",
    authType: "always-jwt",
    methods: ["*"],
    description: "Version update; mutates install, always requires auth.",
  },
  {
    path: "/api/oauth/cursor/auto-import",
    authType: "always-jwt",
    methods: ["*"],
    description: "Cursor OAuth auto-import; also gated local-only.",
  },
  {
    path: "/api/oauth/kiro/auto-import",
    authType: "always-jwt",
    methods: ["*"],
    description: "Kiro OAuth auto-import; also gated local-only.",
  },

  // --- bearer: public LLM API prefixes (own API key auth) ------------------
  {
    path: "/v1",
    authType: "bearer",
    methods: ["*"],
    description: "OpenAI-compatible v1 API; API key auth in handler.",
  },
  {
    path: "/v1beta",
    authType: "bearer",
    methods: ["*"],
    description: "Gemini v1beta API; API key auth in handler.",
  },
  {
    path: "/api/v1",
    authType: "bearer",
    methods: ["*"],
    description: "Mounted OpenAI v1 API; API key auth in handler.",
  },
  {
    path: "/api/v1beta",
    authType: "bearer",
    methods: ["*"],
    description: "Mounted Gemini v1beta API; API key auth in handler.",
  },
  {
    path: "/codex",
    authType: "bearer",
    methods: ["*"],
    description: "Codex CLI bridge; API key auth in handler.",
  },

  // --- none: no guard auth; route does its own auth (cookie/bearer/none) ---
  {
    path: "/api/health",
    authType: "none",
    methods: ["GET"],
    description: "Health probe; unauthenticated.",
  },
  {
    path: "/api/init",
    authType: "none",
    methods: ["POST"],
    description: "First-run init; unauthenticated bootstrap.",
  },
  {
    path: "/api/locale",
    authType: "none",
    methods: ["GET"],
    description: "Locale bundle fetch; unauthenticated.",
  },
  {
    path: "/api/auth/login",
    authType: "none",
    methods: ["POST"],
    description: "Login endpoint; authenticates the credential itself.",
  },
  {
    path: "/api/auth/logout",
    authType: "none",
    methods: ["POST"],
    description: "Logout; clears cookie, no auth required.",
  },
  {
    path: "/api/auth/status",
    authType: "none",
    methods: ["GET"],
    description: "Auth status probe; unauthenticated.",
  },
  {
    path: "/api/auth/oidc",
    authType: "none",
    methods: ["*"],
    description: "OIDC start/callback/test; bootstrap auth flow.",
  },
  {
    path: "/api/version",
    authType: "none",
    methods: ["GET"],
    description: "Version probe; unauthenticated.",
  },
  {
    path: "/api/settings/require-login",
    authType: "none",
    methods: ["GET"],
    description: "Login-required flag; needed pre-auth to render login.",
  },
  {
    path: "/api/usage/summary",
    authType: "none",
    methods: ["GET"],
    description: "Aggregate usage; does own Bearer-API-key OR cookie auth (see route).",
  },

  // --- default: deny-by-default /api/* — every other /api route implicitly ---
  // No manifest entries needed; the guard's final /api/* branch handles these.
];

// Subset helpers — preserve the guard's existing per-category semantics.
// Each returns the list of path prefixes the guard matches with .startsWith().
export const LOCAL_ONLY_PATHS = ROUTE_MANIFEST
  .filter((r) => r.authType === "local-only")
  .map((r) => r.path);

export const ALWAYS_PROTECTED = ROUTE_MANIFEST
  .filter((r) => r.authType === "always-jwt")
  .map((r) => r.path);

export const PUBLIC_PREFIXES = ROUTE_MANIFEST
  .filter((r) => r.authType === "bearer")
  .map((r) => r.path);

export const PUBLIC_API_PATHS = ROUTE_MANIFEST
  .filter((r) => r.authType === "none")
  .map((r) => r.path);

// True iff `pathname` is registered under any manifest entry (prefix match).
export function isRouteInManifest(pathname) {
  return ROUTE_MANIFEST.some((r) => pathname === r.path || pathname.startsWith(`${r.path}/`));
}

// Resolve the authType the guard will apply to `pathname`, or "default" for
// the catch-all /api/* branch, or "unmanaged" for paths outside guard scope.
export function resolveAuthType(pathname) {
  if (!pathname || typeof pathname !== "string") return "unmanaged";
  for (const r of ROUTE_MANIFEST) {
    if (pathname === r.path || pathname.startsWith(`${r.path}/`)) {
      return r.authType;
    }
  }
  if (pathname.startsWith("/api/")) return "default";
  return "unmanaged";
}
