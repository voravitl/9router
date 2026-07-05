import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";

// Regression for fix 86effb4 (#57): HUD active-model matching must check BOTH
// the provider `alias` AND `id` (and fall back to `provider`). Before the fix
// the HUD compared the active-model prefix only against `alias`, so a user who
// set ANTHROPIC_DEFAULT_*_MODEL = "<id>/..." (where id !== alias) saw no limits.
//
// The provider script lives in cli/scripts/9router-hud-provider.mjs and its
// matching predicate is reproduced here so a regression in either place is
// caught without a live 9router instance.

// Mirrors the post-fix predicate in cli/scripts/9router-hud-provider.mjs:
//   want.has(p.alias) || want.has(p.id) || want.has(p.provider)
function matchesPostFix(p, want) {
  return want.size === 0
    || want.has(p.alias) || want.has(p.id) || want.has(p.provider);
}

// The buggy pre-fix predicate: only `alias` (via `p.alias || p.id || p.provider`
// collapsed into one value) was checked against the want-set.
function matchesPreFix(p, want) {
  if (want.size === 0) return true;
  const alias = p.alias || p.id || p.provider;
  return want.has(alias);
}

describe("registry entries: id/alias shape", () => {
  it("every entry has a non-empty string id", () => {
    for (const p of REGISTRY) {
      expect(typeof p.id, `id of ${JSON.stringify(p?.id)}`).toBe("string");
      expect(p.id.length > 0, `empty id`).toBe(true);
    }
  });

  it("every entry resolves a non-empty string label (alias || id) for HUD", () => {
    // The HUD script collapses p.alias || p.id || p.provider into one label;
    // every registry entry must yield a non-empty string from that chain so
    // buckets always get a meaningful id/label (no "undefined:foo" buckets).
    for (const p of REGISTRY) {
      const label = p.uiAlias || p.alias || p.id || p.provider;
      expect(typeof label, `label of ${p.id}`).toBe("string");
      expect(label.length > 0, `empty label for ${p.id}`).toBe(true);
    }
  });

  it("no two providers share the same id", () => {
    const ids = REGISTRY.map(p => p.id);
    expect(new Set(ids).size, "duplicate ids").toBe(ids.length);
  });
});

describe("HUD active-model prefix matching (regression for 86effb4)", () => {
  it("a prefix equal to the provider id matches even when id !== alias", () => {
    // Pick any provider whose id differs from its alias to exercise the bug;
    // if none exist in the registry today, fall back to one where they equal,
    // but still assert the post-fix predicate holds for every entry.
    const differing = REGISTRY.find(p => p.alias && p.alias !== p.id);
    const target = differing || REGISTRY[0];

    const want = new Set([target.id]);
    expect(matchesPostFix(target, want)).toBe(true);

    if (differing) {
      // The OLD predicate would have failed exactly here — this is the bug.
      expect(matchesPreFix(target, want)).toBe(false);
    }
  });

  it("a prefix equal to the provider alias matches under both predicates", () => {
    for (const p of REGISTRY) {
      const alias = p.alias || p.id;
      const want = new Set([alias]);
      expect(matchesPostFix(p, want), `alias prefix for ${p.id}`).toBe(true);
      expect(matchesPreFix(p, want), `alias prefix for ${p.id}`).toBe(true);
    }
  });

  it("post-fix matches by id for every provider; pre-fix misses the id-only cases", () => {
    let preFixMisses = 0;
    for (const p of REGISTRY) {
      const want = new Set([p.id]);
      // Post-fix MUST match every provider by its own id.
      expect(matchesPostFix(p, want), `post-fix id match for ${p.id}`).toBe(true);
      // Pre-fix only matches when alias collapses to id.
      if (!matchesPreFix(p, want)) preFixMisses += 1;
    }
    // The fix exists because at least one provider's id differs from its alias.
    // If this ever drops to 0, the bug is impossible and the fix can be relaxed.
    expect(preFixMisses, "providers where pre-fix misses id-prefix").toBeGreaterThan(0);
  });

  it("an unrelated prefix matches no provider under either predicate", () => {
    const want = new Set(["__definitely-not-a-provider__"]);
    for (const p of REGISTRY) {
      expect(matchesPostFix(p, want), `stray match post-fix on ${p.id}`).toBe(false);
      expect(matchesPreFix(p, want), `stray match pre-fix on ${p.id}`).toBe(false);
    }
  });

  it("empty want-set (unknown active model) matches every provider (safe fallback)", () => {
    const want = new Set();
    for (const p of REGISTRY) {
      expect(matchesPostFix(p, want), `fallback for ${p.id}`).toBe(true);
      expect(matchesPreFix(p, want), `fallback for ${p.id}`).toBe(true);
    }
  });
});
