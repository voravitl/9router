import { claudeToOpenAIRequest } from "../translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../translator/request/openai-to-claude.js";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../translator/request/openai-responses.js";

// Agent contexts can be large; 3s was the main source of "aborted due to timeout"
// when Headroom was reachable but slow. Override with HEADROOM_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.HEADROOM_TIMEOUT_MS || "15000", 10) || 15000,
);

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function messagePayload(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.input)) return body.input;
  return null;
}

/** Sum of Kiro compressible text lengths (tool + user content; diagnostics). */
function kiroCompressTextBytes(body) {
  let n = 0;
  for (const slot of collectKiroCompressSlots(body)) n += slot.text.length;
  return n;
}

function captureSizeSnapshot(body) {
  const messages = messagePayload(body);
  const messageBytes = messages
    ? jsonBytes(messages)
    : (body?.conversationState ? kiroCompressTextBytes(body) : 0);
  return {
    bodyBytes: jsonBytes(body),
    messageBytes,
  };
}

// Minimum chars before we spend a Headroom round-trip on a single Kiro blob.
const KIRO_HEADROOM_MIN_CHARS = 800;
// Cap concurrent blobs in one compress call (keeps payload + latency bounded).
const KIRO_HEADROOM_MAX_SLOTS = 12;

/**
 * Collect compressible text slots from Kiro conversationState:
 * - toolResult content[].text (skips status:"error")
 * - userInputMessage.content string, or array parts with .text
 * Mirrors RTK walk (history + currentMessage).
 * @returns {{ kind: 'tool'|'user', text: string, apply: (s: string) => void }[]}
 */
function collectKiroCompressSlots(body) {
  const slots = [];
  const state = body?.conversationState;
  if (!state) return slots;

  const walk = (msg) => {
    const uim = msg?.userInputMessage;
    if (!uim) return;

    // User content (string or array of text parts)
    const content = uim.content;
    if (typeof content === "string" && content.length > 0) {
      slots.push({
        kind: "user",
        text: content,
        apply: (s) => {
          uim.content = s;
        },
      });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part.text === "string" && part.text.length > 0) {
          slots.push({
            kind: "user",
            text: part.text,
            apply: (s) => {
              part.text = s;
            },
          });
        }
      }
    }

    // Tool results (skip errors — preserve traces)
    const toolResults = uim.userInputMessageContext?.toolResults;
    if (!Array.isArray(toolResults)) return;
    for (const tr of toolResults) {
      if (tr?.status === "error") continue;
      if (!Array.isArray(tr.content)) continue;
      for (const part of tr.content) {
        if (part && typeof part.text === "string" && part.text.length > 0) {
          slots.push({
            kind: "tool",
            text: part.text,
            apply: (s) => {
              part.text = s;
            },
          });
        }
      }
    }
  };

  if (Array.isArray(state.history)) {
    for (const msg of state.history) walk(msg);
  }
  if (state.currentMessage) walk(state.currentMessage);
  return slots;
}

function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const p of content) {
    if (typeof p === "string") parts.push(p);
    else if (p && typeof p.text === "string") parts.push(p.text);
    else if (p && typeof p.content === "string") parts.push(p.content);
  }
  const joined = parts.join("");
  return joined.length ? joined : null;
}

/**
 * Headroom path for Kiro/CodeWhisperer: compress large toolResult + userInput
 * texts in place via a single OpenAI-shaped /v1/compress call, re-inject by index.
 * Fail-open: returns null without mutating on any failure.
 */
async function compressKiroWithHeadroom(body, url, model, timeoutMs, diagnostics) {
  const slots = collectKiroCompressSlots(body);
  const work = slots
    .filter((s) => s.text.length >= KIRO_HEADROOM_MIN_CHARS)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, KIRO_HEADROOM_MAX_SLOTS);

  if (work.length === 0) {
    setDiagnostic(
      diagnostics,
      slots.length === 0
        ? "kiro: no compressible text"
        : "kiro: text below compress threshold",
    );
    return null;
  }

  // Headroom leaves role:user alone unless compress_user_messages=true, and even
  // then often no-ops on large agent blobs. Frame ALL Kiro slots as role:tool so
  // the proxy actually compresses (same trick as tool-only path in v0.10.13).
  // Index order is stable: work[i] ↔ oaiMessages[i] ↔ outMsgs[i].
  const oaiMessages = work.map((s, i) => ({
    role: "tool",
    tool_call_id: `kiro-${s.kind}-${i}`,
    content: s.text,
  }));
  const data = await callCompress(
    url,
    oaiMessages,
    model,
    timeoutMs,
    false,
    diagnostics || {},
  );
  if (!data) return null;

  const outMsgs = data.messages;
  if (!Array.isArray(outMsgs) || outMsgs.length === 0) {
    setDiagnostic(diagnostics, "kiro: headroom returned empty messages");
    return null;
  }

  // Stable index mapping: only apply when Headroom returns enough messages.
  // Never re-order; never grow; never empty (same contract as RTK).
  const n = Math.min(outMsgs.length, work.length);
  let applied = 0;
  for (let i = 0; i < n; i++) {
    const newText = extractMessageText(outMsgs[i]?.content);
    if (!newText || newText.length === 0) continue;
    if (newText.length >= work[i].text.length) continue;
    work[i].apply(newText);
    applied += 1;
  }

  if (applied === 0) {
    setDiagnostic(diagnostics, "kiro: headroom did not shrink any text");
    return null;
  }

  if (diagnostics) {
    diagnostics.kiroSlots = work.length;
    diagnostics.kiroApplied = applied;
    diagnostics.kiroUserSlots = work.filter((s) => s.kind === "user").length;
    diagnostics.kiroToolSlots = work.filter((s) => s.kind === "tool").length;
  }

  return {
    tokens_before: data.tokens_before ?? 0,
    tokens_after: data.tokens_after ?? 0,
    tokens_saved: data.tokens_saved ?? 0,
    messages: data.messages,
    kiro_slots: work.length,
    kiro_tool_slots: work.filter((s) => s.kind === "tool").length,
    kiro_user_slots: work.filter((s) => s.kind === "user").length,
    kiro_applied: applied,
  };
}

function setDiagnostic(diagnostics, reason) {
  if (diagnostics && !diagnostics.reason) diagnostics.reason = reason;
}

function scrubSensitiveUrlText(text) {
  return String(text)
    .replace(/\/\/[^/@\s]+@/g, "//")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, "$1");
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code;
  const message = scrubSensitiveUrlText(cause?.message || error?.message || String(error));
  return code ? `${code}: ${message}` : message;
}

function buildCompressEndpoint(url) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/v1/compress`;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const raw = String(url).replace(/#.*$/, "");
    const [base, query = ""] = raw.split("?", 2);
    const endpoint = `${base.replace(/\/$/, "")}/v1/compress`;
    return query ? `${endpoint}?${query}` : endpoint;
  }
}

function maskEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(endpoint).replace(/\/\/[^/@\s]+@/, "//").replace(/[?#].*$/, "");
  }
}

function hasUnsafeResponsesInputForCompression(body) {
  if (!Array.isArray(body?.input)) return false;
  return body.input.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return typeof item.type === "string" && item.type !== "message";
  });
}

// POST messages to Headroom /v1/compress; returns compressed messages + stats or null.
async function callCompress(url, messages, model, timeoutMs, compressUserMessages, diagnostics) {
  const endpoint = buildCompressEndpoint(url);
  diagnostics.endpoint = maskEndpoint(endpoint);
  const payload = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error?.name || "";
    if (name === "TimeoutError" || name === "AbortError" || /aborted|timeout/i.test(error?.message || "")) {
      setDiagnostic(
        diagnostics,
        `request failed: timeout after ${timeoutMs}ms (check URL; Docker needs http://headroom:8787 not localhost)`,
      );
    } else {
      setDiagnostic(diagnostics, `request failed: ${describeFetchError(error)}`);
    }
    return null;
  }
  if (!res.ok) {
    setDiagnostic(diagnostics, `proxy returned HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!Array.isArray(data?.messages)) {
    setDiagnostic(diagnostics, "proxy response missing messages[]");
    return null;
  }
  return data;
}

// Compress request body via Headroom proxy. Fail-open: returns null on any error.
// /v1/compress only understands OpenAI shape, so Claude bodies are translated
// to OpenAI, compressed, then translated back using 9Router's own translators.
export async function compressWithHeadroom(body, { enabled, url, model, format, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS, diagnostics = null } = {}) {
  if (!enabled) {
    setDiagnostic(diagnostics, "disabled");
    return null;
  }
  if (!url) {
    setDiagnostic(diagnostics, "missing proxy URL");
    return null;
  }
  if (!body) {
    setDiagnostic(diagnostics, "missing request body");
    return null;
  }

  try {
    if (diagnostics) diagnostics.before = captureSizeSnapshot(body);

    // Kiro / CodeWhisperer: conversationState (not messages[]). Compress large
    // toolResult + userInput texts via OpenAI-shaped Headroom, re-inject in place (#122).
    if (format === "kiro" || body.conversationState) {
      const data = await compressKiroWithHeadroom(body, url, model, timeoutMs, diagnostics || {});
      if (!data) return null;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // Claude shape: translate → OpenAI → compress → translate back.
    if (format === "claude") {
      const oai = claudeToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) {
        setDiagnostic(diagnostics, "Claude request did not translate to messages[]");
        return null;
      }
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      const claudeBody = openaiToClaudeRequest(model, { ...oai, messages: data.messages }, false);
      if (Array.isArray(claudeBody?.messages)) body.messages = claudeBody.messages;
      if (claudeBody?.system !== undefined) body.system = claudeBody.system;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI Responses shape (Codex): body.input holds Responses items, NOT OpenAI
    // messages. Translate input -> OpenAI -> compress -> translate back to input so
    // body.input keeps the Responses contract (the proxy only understands OpenAI). (#1998)
    if (format === "openai-responses") {
      if (hasUnsafeResponsesInputForCompression(body)) {
        setDiagnostic(diagnostics, "skipped: openai-responses tool/reasoning input is not safe to compress");
        return null;
      }
      const oai = openaiResponsesToOpenAIRequest(model, body, false);
      if (!Array.isArray(oai?.messages)) return null;
      const data = await callCompress(url, oai.messages, model, timeoutMs, compressUserMessages, diagnostics || {});
      if (!data) return null;
      // input: undefined so the translator rebuilds input from the compressed
      // messages instead of returning the original input unchanged.
      const responsesBody = openaiToOpenAIResponsesRequest(
        model,
        { ...oai, input: undefined, messages: data.messages },
        false
      );
      if (Array.isArray(responsesBody?.input)) body.input = responsesBody.input;
      if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
      return data;
    }

    // OpenAI shape: messages/input go straight to the proxy.
    const key = Array.isArray(body.messages) ? "messages"
      : Array.isArray(body.input) ? "input"
      : null;
    if (!key) {
      setDiagnostic(diagnostics, `unsupported ${format || "unknown"} request shape`);
      return null;
    }
    const data = await callCompress(url, body[key], model, timeoutMs, compressUserMessages, diagnostics || {});
    if (!data) return null;
    body[key] = data.messages;
    if (diagnostics) diagnostics.after = captureSizeSnapshot(body);
    return data;
  } catch (error) {
    setDiagnostic(diagnostics, `unexpected error: ${error?.message || String(error)}`);
    return null;
  }
}

export function formatHeadroomLog(stats) {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const delta = stats.tokens_saved || 0;
  const pct = before > 0 ? ((delta / before) * 100).toFixed(1) : "0";
  return `reported token delta=${delta} before=${before}${after ? ` after=${after}` : ""} (${pct}%)`.trim();
}

export function formatHeadroomSizeLog(diagnostics) {
  const before = diagnostics?.before;
  const after = diagnostics?.after;
  if (!before || !after) return "";
  return `body=${before.bodyBytes}B→${after.bodyBytes}B messages=${before.messageBytes}B→${after.messageBytes}B`;
}

export function isHeadroomPhantomSavings(stats, diagnostics, minShrinkRatio = 0.05) {
  if (!stats?.tokens_saved || stats.tokens_saved <= 0) return false;
  const before = diagnostics?.before?.bodyBytes || 0;
  const after = diagnostics?.after?.bodyBytes || 0;
  if (before <= 0 || after <= 0) return false;
  return after >= before * (1 - minShrinkRatio);
}
