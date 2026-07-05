# 9router HUD setup — instruction for the AI agent

> Run this when the user says "set up 9router HUD" / "install 9router HUD" / "ติดตั้ง 9router HUD" / "setup omc hud for 9router" or similar.

This wires the OMC HUD's `rateLimitsProvider` to 9router's `/api/usage/summary` so the HUD displays weekly/hourly usage limits for every provider the user has connected (Claude, Kiro, CodeBuddy, Codex, GitHub, Google, BytePlus, …) — not just Anthropic.

## What it does

1. Copy the provider script to `~/.claude/scripts/9router-hud-provider.mjs` (host, not container).
2. Add `omcHud.rateLimitsProvider` to `~/.claude/settings.json` so OMC HUD calls the script.
3. Verify the endpoint + script return data.

## Prerequisites (verify before starting)

- The 9router container is running (`docker ps | grep 888router`).
- `~/.claude/settings.json` has `ANTHROPIC_BASE_URL` pointing at 9router (e.g. `http://localhost:20128/v1`) and `ANTHROPIC_AUTH_TOKEN` set to a 9router API key. The script reuses these — no new env needed.

## Steps

### 1. Copy the provider script to the host

The script is shipped inside the container at `/app/cli/scripts/9router-hud-provider.mjs`. Copy it to the host:

```bash
mkdir -p ~/.claude/scripts
docker cp 888router:/app/cli/scripts/9router-hud-provider.mjs ~/.claude/scripts/9router-hud-provider.mjs
chmod +x ~/.claude/scripts/9router-hud-provider.mjs
```

### 2. Register it in `~/.claude/settings.json`

Add (or merge into) the `omcHud` key:

```json
{
  "omcHud": {
    "rateLimitsProvider": {
      "type": "custom",
      "command": "node ~/.claude/scripts/9router-hud-provider.mjs"
    }
  }
}
```

Use the absolute path (no `~` tilde) when writing the file — expand it via `$HOME` so the value is portable. Preserve all other keys in settings.json.

### 3. Verify

```bash
# Endpoint reachable with the API key?
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" \
  ${NINEROUTER_URL:-http://localhost:20128}/api/usage/summary
# expect: 200

# Script produces a buckets array?
AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN" node ~/.claude/scripts/9router-hud-provider.mjs | head -c 200
# expect: {"version":1,...,"buckets":[ ... ]}
```

If the endpoint returns 401, the API key in `ANTHROPIC_AUTH_TOKEN` is not in the 9router `apiKeys` table — generate one in the Web Dashboard (Token Saver page) and update settings.json.

If `buckets` is `[]`, the script ran but no provider returned parseable usage — open the Web Dashboard usage page to confirm providers are connected.

### 4. Tell the user

The HUD reads `settings.json` on the next statusline render (within ~1–2 s, no Claude Code restart needed). The first buckets appear within the rate-limits cache TTL (≤30 s).

## Rollback

Remove the `omcHud.rateLimitsProvider` key from `~/.claude/settings.json` and delete `~/.claude/scripts/9router-hud-provider.mjs`.
