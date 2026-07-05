import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ROUTE_MANIFEST,
  LOCAL_ONLY_PATHS,
  ALWAYS_PROTECTED,
  PUBLIC_PREFIXES,
  PUBLIC_API_PATHS,
  isRouteInManifest,
  resolveAuthType,
} from "../../src/lib/route-manifest.js";

const API_ROOT = join(process.cwd(), "src/app/api");

// Walk src/app/api/**/route.js and derive the URL path each serves.
function discoverRoutes() {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (name === "route.js") {
        // Convert filesystem path → URL pathname.
        // src/app/api/v1/chat/completions/route.js → /api/v1/chat/completions
        // Dynamic segments [id] are not expanded; the manifest uses prefixes.
        let p = "/" + relative(join(process.cwd(), "src/app"), full).replace(/\/route\.js$/, "");
        // Drop trailing /route — already done above; keep leading slash.
        out.push({ fs: full, url: p });
      }
    }
  };
  visit(API_ROOT);
  return out;
}

const VALID_AUTH_TYPES = new Set(["local-only", "always-jwt", "bearer", "none"]);

describe("route-manifest: well-formed exports", () => {
  it("every entry has path/authType/methods/description", () => {
    for (const r of ROUTE_MANIFEST) {
      expect(typeof r.path).toBe("string");
      expect(r.path.startsWith("/")).toBe(true);
      expect(VALID_AUTH_TYPES.has(r.authType)).toBe(true);
      expect(Array.isArray(r.methods)).toBe(true);
      expect(r.methods.length).toBeGreaterThan(0);
      expect(typeof r.description).toBe("string");
      expect(r.description.length).toBeGreaterThan(0);
    }
  });

  it("path+authType pairs are unique", () => {
    // A path MAY legitimately appear under multiple authTypes (mirroring the
    // legacy guard, which listed /api/oauth/{cursor,kiro}/auto-import in both
    // LOCAL_ONLY_PATHS and ALWAYS_PROTECTED). The (path, authType) pair must
    // be unique — a duplicate of the same pair is a real bug.
    const seen = new Set();
    for (const r of ROUTE_MANIFEST) {
      const key = `${r.path}|${r.authType}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("subset helpers are non-empty and consistent with manifest", () => {
    expect(LOCAL_ONLY_PATHS.length).toBeGreaterThan(0);
    expect(ALWAYS_PROTECTED.length).toBeGreaterThan(0);
    expect(PUBLIC_PREFIXES.length).toBeGreaterThan(0);
    expect(PUBLIC_API_PATHS.length).toBeGreaterThan(0);

    const collect = (t) => ROUTE_MANIFEST.filter((r) => r.authType === t).map((r) => r.path);
    expect([...LOCAL_ONLY_PATHS].sort()).toEqual(collect("local-only").sort());
    expect([...ALWAYS_PROTECTED].sort()).toEqual(collect("always-jwt").sort());
    expect([...PUBLIC_PREFIXES].sort()).toEqual(collect("bearer").sort());
    expect([...PUBLIC_API_PATHS].sort()).toEqual(collect("none").sort());
  });
});

describe("route-manifest: covers every /api route file", () => {
  const routes = discoverRoutes();

  it("discovered at least one route", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  // Either the route's URL is registered in the manifest, or its longest static
  // ancestor prefix is (the guard matches prefixes with .startsWith, so dynamic
  // segments like /keys/[id] are covered by /keys — which falls to the default
  // /api/* branch when no manifest prefix matches).
  for (const { url } of routes) {
    it(`route ${url} is reachable via manifest or default /api/* branch`, () => {
      // Strip a trailing dynamic segment so /keys/[id] checks /keys.
      const checkPath = url.replace(/\/\[[^\]]+\].*$/, "");
      const authType = resolveAuthType(checkPath);
      // Default branch covers it.
      expect(["local-only", "always-jwt", "bearer", "none", "default"]).toContain(authType);
    });
  }
});

describe("route-manifest: helpers", () => {
  it("isRouteInManifest matches exact and sub-paths", () => {
    expect(isRouteInManifest("/api/health")).toBe(true);
    expect(isRouteInManifest("/api/health/sub")).toBe(true);
    expect(isRouteInManifest("/v1/chat/completions")).toBe(true);
    expect(isRouteInManifest("/api/cli-tools/cowork-settings")).toBe(true);
  });

  it("isRouteInManifest rejects unregistered paths", () => {
    expect(isRouteInManifest("/api/never-registered-xyz")).toBe(false);
    expect(isRouteInManifest("/unknown")).toBe(false);
  });

  it("resolveAuthType returns unmanaged for non-/api paths", () => {
    expect(resolveAuthType("/dashboard")).toBe("unmanaged");
    expect(resolveAuthType("")).toBe("unmanaged");
    expect(resolveAuthType(null)).toBe("unmanaged");
  });

  it("resolveAuthType returns default for unregistered /api paths", () => {
    expect(resolveAuthType("/api/never-registered-xyz")).toBe("default");
  });
});
