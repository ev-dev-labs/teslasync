---
description: "E2 Desktop Parity LOOP — every route, surface and OS-chrome element renders correctly in the desktop shell (screenshot-gated)"
---

# Electron E2 Desktop Parity LOOP — paste into a running session

You are a **loop**, not a one-shot. Read `.github/prompts/electron/0000-methodology.prompt.md` first.
The **ledger on disk is the ONLY source of truth** — never declare "done" in chat. Re-derive progress
from disk each iteration so you survive context compaction. **Never ask permission or for me to type
"continue."** This phase has **865 units** — it is meant to run for a long time across many
iterations. That is expected; just keep looping.

## Predecessor gate
Verify `ledgers/e1-integration-ledger.json` is 100% `done`. If not → STOP, print
`E2 BLOCKED: E1 not complete`.

## Durable state (read every iteration)
- SPECS (READ-ONLY — never edit these): combine, in this order, by unique id
  1. `.github/prompts/monorepo/parity/page-units.json` (143 routes)
  2. `.github/prompts/monorepo/parity/surface-units.json` (708 surfaces → 698 unique)
  3. `apps/parity/parity-chrome-units.json` (9 web app-shell chrome)
  4. `.github/prompts/electron/units/e2-desktop-chrome-units.json` (15 OS-native chrome)
  (`electron-loop.ps1 -Phase e2 -CountOnly` prints the live total: **865 unique units**.)
- PROGRESS: `.github/prompts/electron/ledgers/e2-desktop-parity-ledger.json` (`[]` if missing).
- REFERENCE: the live web SPA at `http://localhost:3000` is ground truth for visual parity.
- STOP: `.github/prompts/electron/ledgers/STOP-electron-loop`.

## The Electron parity model (read this — it is different from native apps)
The desktop app **embeds the existing `web/` React SPA** as its renderer, so panel/chart/string
content is inherited. A `page`/`surface` unit is therefore satisfied when that route/surface
**renders correctly inside the Electron window** — correct size, fonts, theme, scrollbars, no
white flashes, no broken IPC, no missing native affordances — NOT by re-implementing the panel.
`desktop-chrome` units are real native code (menus, tray, notifications, etc.). Order is enforced by
the driver: chrome shell → dashboard/widgets → pages → everything else.

## One iteration
1. **Read the ledger** fresh from disk.
2. **Pick the next unit** — the highest-ranked row that is missing or `todo`/`in_progress`
   (skip `done`/`blocked`). If none remain → print `=== E2 DESKTOP PARITY COMPLETE ===` and STOP.
3. **Claim it**: `status:"in_progress"`, increment `attempts`. Save.
4. **Implement that ONE unit**:
   - `desktop-chrome` → real main-process native code, covering every `checklist` item.
   - `page`/`surface` → ensure the route/surface loads in the Electron window; fix only the
     **desktop-shell** glue needed (window sizing, CSP/`webSecurity`, asset paths, drag regions,
     focus, zoom, native scrollbars). Never fork or duplicate web components into `apps/electron`.
   Stay within `allowedFiles` / the desktop shell. **Never edit `web/**`, `.github/prompts/monorepo/**`
   or `apps/parity/**`.**
5. **Run the gates** (capture `EXIT=` each): build, lint, typecheck, test, placeholder scan.
6. **VISUAL GATE (mandatory for `page`/`surface`)**: navigate the Electron window to the unit's
   `route`, capture a real screenshot with
   `pwsh .github/prompts/electron/capture-window.ps1 -Route "<route>" -Out logs/shots/<id>.png`,
   compare against the same route in the web SPA, and compute `visualScore` (0–100). `done` for a
   visual unit **requires a real screenshot file on disk AND `visualScore >= 95`.** A black/empty/
   missing PNG ⇒ not done.
7. **Record honestly** in the ledger: `status`, `coveredCount`/`requiredCount`, `visualScore`,
   `shot` (path), `deltas`, `evidenceLog`. Add a `=== PARITY ===` + `=== VISUAL ===` section to the log.
8. **Commit** (preferred): `git commit -m "feat(apps/electron): parity <unitId>"`.
9. **Beacon** — one line: `[e2 {done}/865] unit={id} route={route} status={s} visual={v}`.
10. **Immediately start the next iteration.** No summaries every N units, no pausing, no questions.

## Honesty covenant (the only definition of done)
`done` ⇔ all gates green AND `coveredCount == requiredCount` AND (visual units) a real screenshot
exists with `visualScore >= 95`. Fabricating a score, reusing another unit's PNG, or marking `done`
without the shot is a covenant breach. If a route cannot render because an upstream E1 capability is
missing, set `blocked` and name the dependency. `attempts >= 3` without the bar → `blocked`.

## Stop conditions
Every unit `done`/`blocked`, OR STOP sentinel exists, OR 8 consecutive `blocked` (print the common
blocker and stop).

BEGIN LOOPING NOW — start with the highest-ranked not-done unit (desktop-chrome shell first).
