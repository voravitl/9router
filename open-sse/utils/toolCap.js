/**
 * Cap tools array length for providers with hard upstream limits
 * (e.g. xAI max 250 tools). Fail-open: no max → unchanged.
 */

/**
 * @param {object} body - request body (mutated in place)
 * @param {number|null|undefined} maxTools
 * @returns {{ tools: any[]|undefined, cappedFrom: number, cappedTo: number }}
 */
export function capTools(body, maxTools) {
  if (!body || !Array.isArray(body.tools)) {
    return { tools: body?.tools, cappedFrom: 0, cappedTo: 0 };
  }
  const max = Number(maxTools);
  if (!Number.isFinite(max) || max <= 0 || body.tools.length <= max) {
    return { tools: body.tools, cappedFrom: body.tools.length, cappedTo: body.tools.length };
  }
  const from = body.tools.length;
  body.tools = body.tools.slice(0, max);
  return { tools: body.tools, cappedFrom: from, cappedTo: body.tools.length };
}
