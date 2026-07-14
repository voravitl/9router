import { execSync } from "child_process";
import path from "path";

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
// Prefer live endpoints: /readyz and /health include upstream probes and can hang
// when Anthropic/network is slow — that made Docker + dashboard status flap.
const HEADROOM_HEALTH_TIMEOUT_MS = 3000;
const HEADROOM_PROBE_PATHS = ["/livez", "/healthz", "/health"];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

// Raw IP literal (v4 or bracketed v6), as opposed to a stable Docker Compose
// service name like "headroom". Container IPs are ephemeral/unstable across
// restarts, so a non-loopback raw IP is not trustworthy as a routing target.
function isRawIpHeadroomUrl(url) {
  try {
    const { hostname } = new URL(url);
    return IPV4_RE.test(hostname) || (hostname.startsWith("[") && hostname.endsWith("]"));
  } catch {
    return false;
  }
}

let warnedUntrustedEnvUrl = false;

/**
 * Resolve the Headroom proxy URL for runtime compress + status probes.
 *
 * Docker Compose sets HEADROOM_URL=http://headroom:8787. Dashboard users often
 * save http://localhost:8787 (works from the host browser, fails inside the
 * 888router container → ECONNREFUSED / timeout). When env points at a non-loopback
 * sidecar and settings still say localhost, prefer the env URL — unless it's a raw,
 * non-loopback IP (e.g. an ephemeral Docker container IP) rather than a stable
 * service name, in which case it's untrustworthy and we fall back to configured/default.
 */
export function resolveHeadroomUrl(settingsUrl) {
  const envUrl = (process.env.HEADROOM_URL || "").trim();
  const configured = String(settingsUrl || "").trim() || DEFAULT_HEADROOM_URL;
  if (
    envUrl
    && isLoopbackHeadroomUrl(configured)
    && !isLoopbackHeadroomUrl(envUrl)
  ) {
    if (isRawIpHeadroomUrl(envUrl)) {
      if (!warnedUntrustedEnvUrl) {
        warnedUntrustedEnvUrl = true;
        console.warn(`[headroom] HEADROOM_URL="${envUrl}" is a raw IP, not a stable service name — ignoring, using "${configured}"`);
      }
      return configured;
    }
    return envUrl;
  }
  return configured;
}

// Cache CLI/python detection — status is polled often; execSync is slow cold.
let detectCache = { at: 0, path: undefined, python: undefined };
const DETECT_CACHE_TTL_MS = 30_000;

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary() {
  const now = Date.now();
  if (detectCache.path !== undefined && now - detectCache.at < DETECT_CACHE_TTL_MS) {
    return detectCache.path;
  }
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    const found = out ? out.split(/\r?\n/)[0].trim() : null;
    detectCache = { ...detectCache, at: now, path: found };
    return found;
  } catch {
    detectCache = { ...detectCache, at: now, path: null };
    return null;
  }
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
export function findPython310() {
  const now = Date.now();
  if (detectCache.python !== undefined && now - detectCache.at < DETECT_CACHE_TTL_MS) {
    return detectCache.python;
  }
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1])) {
        detectCache = { ...detectCache, at: now, python: candidate };
        return candidate;
      }
    } catch {
      // candidate not present, try next
    }
  }
  detectCache = { ...detectCache, at: now, python: null };
  return null;
}

/** @internal test helper */
export function __resetDetectCache() {
  detectCache = { at: 0, path: undefined, python: undefined };
}

// Probe whether a Headroom proxy is reachable. Prefer /livez|/healthz (process up)
// over /readyz|/health (may wait on upstream and exceed short timeouts).
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  for (const path of HEADROOM_PROBE_PATHS) {
    try {
      const res = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS),
      });
      if (res.ok) return true;
    } catch {
      // try next path
    }
  }
  return false;
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  return { installed, path, running, python, localUrl, canStart: installed && localUrl };
}
