---
description: "E1 Integration LOOP — embed the web SPA, wire auth, secure storage, SSE, deep links, window state"
---

# Electron E1 Integration LOOP — paste into a running session

You are a **loop**, not a one-shot. Read `.github/prompts/electron/0000-methodology.prompt.md` first.
The **ledger on disk is the ONLY source of truth** — never declare "done" in chat. Re-derive progress
from disk each iteration. **Never ask permission or for me to type "continue."**

## Predecessor gate
Before the first iteration, verify `.github/prompts/electron/ledgers/e0-foundation-ledger.json` is
100% `done`. If not, STOP and print `E1 BLOCKED: E0 not complete` (Honesty Covenant rule 7).

## Durable state (read every iteration)
- SPEC: `.github/prompts/electron/units/e1-integration-units.json` (9 units).
- PROGRESS: `.github/prompts/electron/ledgers/e1-integration-ledger.json` (`[]` if missing).
- STOP: `.github/prompts/electron/ledgers/STOP-electron-loop`.
- Reference web app should be running at `http://localhost:3000`.

## Goal of this phase
Make the embedded `web/` SPA a **fully functional desktop client**: it loads, authenticates via
OIDC (system browser, tokens stored in the OS keychain), pulls `/api/v1` + SSE live data, handles
`teslasync://` deep links, and remembers its window state.

## One iteration
1. **Read the ledger** fresh from disk.
2. **Pick the next unit** (`todo`/`in_progress`, skip `done`/`blocked`), honoring `dependsOn`.
   If none remain → print `=== E1 INTEGRATION COMPLETE ===` and STOP.
3. **Claim it**: `status:"in_progress"`, increment `attempts`. Save.
4. **Implement that ONE unit** to full completion — real auth, real token encryption, real SSE
   reconnect, real deep-link routing. No stubs, no plaintext tokens, no fake "logged in" state.
   Stay within `allowedFiles`.
5. **Run the gates** (capture `EXIT=` each): build, lint, typecheck, test, placeholder scan, and
   `npm --prefix apps/electron run e2e` (Playwright `_electron`) for the units that declare it.
6. **Record honestly** in the ledger (`status`, `coveredCount`, `deltas`, `evidenceLog`) with a
   `=== PARITY ===` section in the log.
7. **Commit** (preferred). 8. **Beacon**: `[e1 {done}/9] unit={id} status={s} covered={c}/{r}`.
9. **Immediately start the next iteration.** No summaries, no pausing, no questions.

## Honesty covenant
`done` ⇔ gates green AND `coveredCount == requiredCount`. If the OS secure-storage API is
unavailable, the token-storage unit is `blocked` (never store plaintext). A gate that needs a
display/network you don't have is `blocked`, never `done`. `attempts >= 3` without success → `blocked`.

## Stop conditions
Every unit `done`/`blocked`, OR STOP sentinel exists, OR 5 consecutive `blocked`.

BEGIN LOOPING NOW — start with `e1:renderer/embed`.
