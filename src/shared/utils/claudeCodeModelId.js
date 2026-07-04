// Claude Code reads context window from a hardcoded binary registry — it does
// NOT honour `context_window` from /v1/models. The only way to activate its
// 1M-context entry for a custom-provider model is to append "[1m]" to the id.
// (Server strips the suffix before forwarding upstream — see chat handler.)
//
// Pure helpers — caller supplies the context window (resolved via the cached
// /v1/models list in useModelContextWindows, or the static catalog).

const ONE_MILLION = 1_000_000;

/**
 * @param {number|undefined} contextWindow - the model's resolved context window
 * @param {string} modelId - bare model id (no alias prefix)
 * @returns the model id, with "[1m]" appended when contextWindow ≥ 1M
 */
export function withClaudeCodeSuffix(modelId, contextWindow) {
  const id = String(modelId ?? "");
  if (!id) return id;
  return typeof contextWindow === "number" && contextWindow >= ONE_MILLION
    ? `${id}[1m]`
    : id;
}

/**
 * Full "alias/model[1m]" string, suffix applied per contextWindow.
 */
export function fullModelWithSuffix(alias, modelId, contextWindow) {
  return `${String(alias || "")}/${withClaudeCodeSuffix(modelId, contextWindow)}`;
}
