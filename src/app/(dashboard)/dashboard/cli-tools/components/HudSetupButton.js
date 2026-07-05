"use client";

import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// One-click copy of the AI prompt that installs the OMC HUD provider for
// 9router. The prompt instructs Claude Code to read install-hud.md out of
// the running container and follow it — no manual steps for the user.
const HUD_SETUP_PROMPT =
  "Install the 9router OMC HUD provider: read the setup instructions from `docker exec 888router cat /app/cli/scripts/install-hud.md` and follow them step by step, then summarize the result for me.";

export default function HudSetupButton() {
  const { copied, copy } = useCopyToClipboard();
  const COPIED_KEY = "9router-hud-prompt";
  const isCopied = copied === COPIED_KEY;

  return (
    <button
      onClick={() => copy(HUD_SETUP_PROMPT, COPIED_KEY)}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-sidebar px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-sidebar-hover hover:text-text"
      title="Copy the AI prompt that installs the OMC HUD provider for 9router — paste it into Claude Code and the agent runs the setup for you."
    >
      <span className="material-symbols-outlined text-sm">{isCopied ? "check" : "content_copy"}</span>
      {isCopied ? "Copied!" : "Copy AI prompt: install HUD"}
    </button>
  );
}
