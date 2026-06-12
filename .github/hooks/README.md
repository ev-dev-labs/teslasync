# Copilot Hooks

This directory contains [GitHub Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference)
that run automatically during Copilot **CLI** sessions and **cloud agent** jobs in this repository.
Every `*.json` file here is loaded and merged, so each hook lives in its own file.

The hook commands use the cross-platform `command` field (Node.js), so they work on
Linux, macOS, Windows (PowerShell), and the cloud-agent Linux sandbox. Node 20 is already
provisioned by [`.github/copilot-setup-steps.yml`](../copilot-setup-steps.yml).

## Hooks

| File | Event | Type | What it does |
| --- | --- | --- | --- |
| `00-command-guard.json` | `preToolUse` | guard (blocking) | Denies forbidden/destructive shell commands. |
| `10-guidelines-audit.json` | `postToolUse` | advisory | Scans edited files for prohibited patterns and warns the agent. |
| `20-session-context.json` | `sessionStart` | context | Injects a reminder of the key engineering conventions. |

### `00-command-guard.json` — command guard

Runs [`scripts/command-guard.js`](scripts/command-guard.js) before any `bash`/`powershell`
tool call and **denies** commands that violate the working agreement or are catastrophic:

- `git push` (including force-push) — use the `report_progress` / create-PR tools instead.
- Recursive force-delete of a root or home path (`rm -rf /`, `rm -rf ~`, …).
- Any access to `.github/agents` (instructions for other agents — off-limits).
- Shallow/depth-limited `git clone|fetch|pull --depth` (banned before merge/rebase).

`preToolUse` hooks are **fail-closed**: a crash would deny *every* command, so the script
is wrapped in try/catch and defaults to *allow* (`{}`, exit 0). Only an explicit rule match
emits a `deny` decision.

### `10-guidelines-audit.json` — guidelines audit

Runs [`scripts/guidelines-audit.js`](scripts/guidelines-audit.js) after each `edit`/`create`.
It re-reads the touched file and reports likely violations of
[`.github/copilot-instructions.md`](../copilot-instructions.md) as `additionalContext`
(advisory only — it never blocks or fails the tool result):

- **Web** (`web/src/**/*.{ts,tsx}`, excluding `web/src/components/**`): inline static
  CSS-var styles, direct `recharts`/`react-leaflet`/`framer-motion` imports, old `../api`
  imports, `dangerouslySetInnerHTML`.
- **API hooks** (`web/src/api/hooks/**`): double `/api/v1/` prefix, camelCase query params.
- **Go** (`**/*.go`): legacy unit-suffixed fields / JSON tags (Phase-48 SI canonical).

### `20-session-context.json` — session context

Runs [`scripts/session-context.js`](scripts/session-context.js) at session start and injects
a concise reminder of the conventions agents most often miss (SI units, shared components,
API-hook rules, i18n, no direct `git push`).

## Testing locally

```bash
# Guard: should DENY
echo '{"toolName":"bash","toolArgs":{"command":"git push"}}' | node .github/hooks/scripts/command-guard.js

# Guard: should ALLOW ({} output)
echo '{"toolName":"bash","toolArgs":{"command":"ls -la"}}' | node .github/hooks/scripts/command-guard.js

# Audit: should warn on a flagged file
echo '{"toolName":"edit","toolArgs":{"path":"web/src/api/hooks/useFoo.ts"}}' | node .github/hooks/scripts/guidelines-audit.js
```

## Disabling

Set `"disableAllHooks": true` in your local `.github/copilot/settings.local.json`
(or `~/.copilot/settings.json`) to opt out without deleting these files.
Policy-level hooks cannot be disabled this way.
