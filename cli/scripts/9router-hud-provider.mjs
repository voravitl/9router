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
      const pct = qval.used_percentage ?? qval.utilization ?? qval.percent;
      if (typeof pct === 'number') {
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'percent', value: pct }, resetsAt: qval.resets_at || qval.reset_at || null });
      } else if (typeof qval.used === 'number' && typeof qval.total === 'number') {
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'credit', used: qval.used, limit: qval.total }, resetsAt: qval.resets_at || null });
      } else if (typeof qval.remaining === 'number' && typeof qval.total === 'number') {
        const used = qval.total - qval.remaining;
        out.push({ id: `${alias}:${qkey}`, label: `${alias}:${shortLabel(qkey)}`, usage: { type: 'credit', used, limit: qval.total }, resetsAt: qval.resets_at || null });
      }
    }
  }
  return out;
}

async function main() {
  if (!TOKEN) { failEmpty(); return; }
  const url = `${NINEROUTER_URL}/api/usage/summary`;
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
      buckets = buckets.concat(bucketsFor(p.alias || p.id || p.provider, p.usage));
    }
    console.log(JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), buckets }));
  } catch {
    failEmpty();
  }
}

main();
