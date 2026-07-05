#!/usr/bin/env node
/**
 * 9router → OMC HUD rate-limits provider.
 *
 * Fetches /api/usage/summary from the local 9router instance, normalises the
 * per-provider quotas into the OMC custom-rate-provider bucket contract, and
 * prints a single JSON line on stdout:
 *
 *   { version: 1, generatedAt: <iso>, buckets: [{id,label,usage,resetsAt?}] }
 *
 * Auth: uses ANTHROPIC_AUTH_TOKEN (the 9router API key Claude Code already
 * uses) as a Bearer token. Endpoint also accepts the dashboard cookie.
 *
 * Wired in via ~/.claude/settings.json → omcHud.rateLimitsProvider
 * (run `9router` HUD setup, or see cli/scripts/install-hud.md).
 */
const NINEROUTER_URL = (process.env.NINEROUTER_URL || 'http://localhost:20128').replace(/\/$/, '');
const TOKEN = process.env.AUTH_TOKEN || process.env.NINEROUTER_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || '';
const TIMEOUT_MS = Number(process.env.NINEROUTER_HUD_TIMEOUT_MS || 6000);

function failEmpty() {
  console.log(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), buckets: [] }));
}

function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function shortLabel(k) {
  const m = String(k).match(/\(([^)]+)\)/);
  if (m) return m[1];
  return String(k).replace(/_/g, ' ').slice(0, 12);
}

function bucketsFor(alias, usage) {
  if (!usage || typeof usage !== 'object') return [];
  const out = [];
  for (const [key, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const b = usage[key];
    if (b && typeof b.utilization === 'number') {
      out.push({ id: `${alias}:${key}`, label, usage: { type: 'percent', value: b.utilization }, resetsAt: b.resets_at || null });
    }
  }
  const quotas = usage.quotas || usage.quotaInfo || usage.usage || null;
  if (quotas && typeof quotas === 'object') {
    for (const [qkey, qval] of Object.entries(quotas)) {
      if (!qval || typeof qval !== 'object') continue;
      const pct = qval.used_percentage ?? qval.utilization ?? qval.percent
        ?? (typeof qval.remainingPercentage === 'number' ? 100 - qval.remainingPercentage : undefined);
      const resetsAt = qval.resets_at || qval.reset_at || qval.resetAt || null;
      if (typeof pct === 'number') {
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'percent', value: pct }, resetsAt });
      } else if (typeof qval.used === 'number' && typeof qval.total === 'number') {
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'credit', used: qval.used, limit: qval.total }, resetsAt });
      } else if (typeof qval.remaining === 'number' && typeof qval.total === 'number') {
        const used = qval.total - qval.remaining;
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'credit', used, limit: qval.total }, resetsAt });
      }
    }
  }
  return out;
}

// Resolve the provider alias(es) the user is actually routing through right
// now, so the HUD only shows limits relevant to the active model. Reads the
// same env Claude Code sets (ANTHROPIC_DEFAULT_*_MODEL = "alias/model[1m]").
function activeProviderAliases() {
  const ids = new Set();
  for (const k of ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_MODEL', 'NINEROUTER_MODEL']) {
    const v = process.env[k];
    if (typeof v !== 'string' || !v.includes('/')) continue;
    ids.add(v.slice(0, v.indexOf('/')));
  }
  return ids;
}

async function main() {
  if (!TOKEN) { failEmpty(); return; }
  const url = `${NINEROUTER_URL}/api/usage/summary`;
  const want = activeProviderAliases();
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    }, TIMEOUT_MS);
    if (!res.ok) { failEmpty(); return; }
    const data = await res.json();
    const providers = Array.isArray(data.providers) ? data.providers : [];
    let buckets = [];
    for (const p of providers) {
      if (p.skipped || p.authExpired) continue;
      const alias = p.alias || p.id || p.provider;
      // Only render limits for the provider(s) the active model routes through.
      // Empty want-set → unknown → show all (safe fallback).
      if (want.size > 0 && !want.has(alias)) continue;
      buckets = buckets.concat(bucketsFor(alias, p.usage));
    }
    console.log(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), buckets }));
  } catch {
    failEmpty();
  }
}

main();
