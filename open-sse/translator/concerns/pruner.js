import { getCapabilitiesForModel } from "../../providers/capabilities.js";

const DEFAULT_RESERVE_TOKENS = 4000;
const CHARS_PER_TOKEN = 3.5;
const FIXED_IMAGE_TOKENS = 1000;

/**
 * Estimate token count for request body (supports OpenAI, Claude, and Gemini shapes)
 */
export function estimateRequestTokens(body) {
  if (!body) return 0;
  let textLength = 0;
  let mediaCount = 0;

  const processContent = (content) => {
    if (typeof content === "string") {
      textLength += content.length;
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (!item) continue;
        if (typeof item === "string") textLength += item.length;
        else if (item.text && typeof item.text === "string") textLength += item.text.length;
        if (item.type === "image_url" || item.type === "image" || item.type === "input_image") mediaCount++;
        if (item.inlineData || item.fileData) mediaCount++;
      }
    }
  };

  const messages = body.messages || body.input || body.contents || body.request?.contents || [];
  for (const msg of messages) {
    if (!msg) continue;
    const role = msg.role || (msg.author ? String(msg.author) : "");
    if (role === "system" && typeof msg.content === "string") textLength += msg.content.length;
    else processContent(msg.content || msg.parts);
    if (msg.reasoning_content) textLength += msg.reasoning_content.length;
    if (Array.isArray(msg.tool_calls)) textLength += JSON.stringify(msg.tool_calls).length;
  }

  if (Array.isArray(body.tools)) {
    textLength += JSON.stringify(body.tools).length;
  }

  const estimated = Math.ceil(textLength / CHARS_PER_TOKEN) + (mediaCount * FIXED_IMAGE_TOKENS);
  return estimated;
}

/**
 * Group messages into atomic turn groups to ensure tool_use & tool_result pairs are never split.
 * Handles both OpenAI (role: "tool") and Claude (role: "user" with type: "tool_result") shapes.
 */
export function groupMessageTurns(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const groups = [];
  let currentGroup = [];

  const isToolResultMsg = (msg) => {
    if (!msg) return false;
    if (msg.role === "tool" || msg.role === "function") return true;
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return msg.content.some(b => b && (b.type === "tool_result" || b.tool_use_id));
    }
    return false;
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;

    if (msg.role === "system") {
      if (currentGroup.length > 0) {
        groups.push({ messages: currentGroup });
        currentGroup = [];
      }
      groups.push({ isSystem: true, messages: [msg] });
      continue;
    }

    if (msg.role === "user" && !isToolResultMsg(msg)) {
      if (currentGroup.length > 0) {
        groups.push({ messages: currentGroup });
        currentGroup = [];
      }
      currentGroup.push(msg);
    } else {
      // assistant or tool or user tool_result
      currentGroup.push(msg);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ messages: currentGroup });
  }

  if (groups.length > 0) {
    // Mark last non-system group as trailing (must be preserved)
    for (let j = groups.length - 1; j >= 0; j--) {
      if (!groups[j].isSystem) {
        groups[j].isTrailing = true;
        break;
      }
    }
  }

  return groups;
}

/**
 * Prune message history atomically while preserving tool pairs, system prompt, and trailing user turn.
 */
export function pruneMessageHistory(body, provider, model) {
  if (!body || typeof body !== "object") return body;
  const messagesKey = Array.isArray(body.messages)
    ? "messages"
    : Array.isArray(body.input)
    ? "input"
    : Array.isArray(body.contents)
    ? "contents"
    : Array.isArray(body.request?.contents)
    ? "request.contents"
    : null;
  if (!messagesKey) return body;

  const caps = getCapabilitiesForModel(provider, model);
  const contextWindow = caps.contextWindow || 200000;
  const maxOutput = caps.maxOutput || 64000;

  // Safe budget formula: never collapse below 70% of contextWindow even when maxOutput equals contextWindow
  const rawBudget = contextWindow - maxOutput - DEFAULT_RESERVE_TOKENS;
  const budget = Math.max(Math.floor(contextWindow * 0.7), rawBudget);

  const initialEstimate = estimateRequestTokens(body);
  body._prunerStats = {
    tokensBefore: initialEstimate,
    tokensAfter: initialEstimate,
    tokensSaved: 0,
    omittedMessages: 0,
    pruned: false
  };

  if (initialEstimate <= budget) return body;

  const originalMessages = body[messagesKey];
  const groups = groupMessageTurns(originalMessages);
  if (groups.length <= 2) return body; // System + trailing turn only — cannot prune middle

  const systemGroups = groups.filter(g => g.isSystem);
  const trailingGroups = groups.filter(g => g.isTrailing);
  const middleGroups = groups.filter(g => !g.isSystem && !g.isTrailing);

  let prunedMiddle = [...middleGroups];
  let omittedCount = 0;

  // Prune middle groups from oldest to newest until estimated tokens <= budget
  while (prunedMiddle.length > 0) {
    const candidateBody = {
      ...body,
      [messagesKey]: [
        ...systemGroups.flatMap(g => g.messages),
        ...prunedMiddle.flatMap(g => g.messages),
        ...trailingGroups.flatMap(g => g.messages)
      ]
    };
    if (estimateRequestTokens(candidateBody) <= budget) {
      break;
    }
    const removedGroup = prunedMiddle.shift();
    omittedCount += removedGroup.messages.length;
  }

  const tombstoneMsg = {
    role: "user",
    content: `[earlier ${omittedCount || 1} history turns omitted for context limit]`
  };

  const finalMessages = [
    ...systemGroups.flatMap(g => g.messages),
    ...(omittedCount > 0 ? [tombstoneMsg] : []),
    ...prunedMiddle.flatMap(g => g.messages),
    ...trailingGroups.flatMap(g => g.messages)
  ];

  body[messagesKey] = finalMessages;
  const tokensAfter = estimateRequestTokens(body);
  const tokensSaved = Math.max(0, initialEstimate - tokensAfter);
  body._prunerStats = {
    tokensBefore: initialEstimate,
    tokensAfter,
    tokensSaved,
    omittedMessages: omittedCount,
    pruned: omittedCount > 0
  };
  if (omittedCount > 0) {
    body._pruned = true;
    body._omittedTurns = omittedCount;
  }
  return body;
}
