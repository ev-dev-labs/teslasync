---
description: "E0 Foundation LOOP — scaffold the Electron app shell to a secure, buildable baseline"
---

# Electron E0 Foundation LOOP — paste into a running session

You are a **loop**, not a one-shot. Read `.github/prompts/electron/0000-methodology.prompt.md`
and `DIVERGENCE.md` first. The **ledger on disk is the ONLY source of truth** — never declare
"done" in chat. Re-derive progress from disk each iteration so you survive context compaction.
**Never ask permission or for me to type "continue."**

## Durable state (read every iteration)
- SPEC: `.github/prompts/electron/units/e0-foundation-units.json` (9 units).
- PROGRESS: `.github/prompts/electron/ledgers/e0-foundation-ledger.json` (you write it; `[]` if missing).
- STOP: if `.github/prompts/electron/ledgers/STOP-electron-loop` exists, stop now.

## Goal of this phase
Stand up `apps/electron/` — an Electron desktop app that will embed the existing `web/` React SPA
as its renderer — to a **secure, buildable, CI-gated empty shell**. No features yet; that is E1/E2.

## One iteration
1. **Read the ledger** fresh from disk.
2. **Pick the next unit** (no row, or status `todo`/`in_progress`; skip `done`/`blocked`) in the
   order listed in the spec, honoring each unit's `dependsOn`. If none remain → print
   `=== E0 FOUNDATION COMPLETE ===` and STOP.
3. **Claim it**: write the row `status:"in_progress"`, increment `attempts`. Save.
4. **Implement that ONE unit** to full completion. Cover every `checklist` item with real code
   (no stubs, no `// TODO`, no `throw new Error("not implemented")`, no dead IPC channels). Stay
   within the unit's `allowedFiles`.
5. **Run the gates** (from repo root; capture `EXIT=` for each — any nonzero ⇒ not done):
   - `npm --prefix apps/electron run build`
   - `npm --prefix apps/electron run lint`
   - `npm --prefix apps/electron run typecheck`
   - `npm --prefix apps/electron test`
   - `pwsh apps/tools/check-placeholders.ps1 -Path apps/electron -Language typescript`
   - security units also: `@electron/fuses` verify + Electronegativity scan; the `e0:gate` unit
     additionally runs `npm --prefix apps/electron run package -- --dir` and launches it.
6. **Record honestly** in the ledger: `status`, `coveredCount` (== `requiredCount` only when truly
   complete), `deltas`, `evidenceLog`. Write a `=== PARITY ===` section in the unit log.
7. **Commit** (preferred): `git add <allowedFiles> <log> <ledger>; git commit -m "feat(apps/electron): <unitId>"`.
8. **Beacon** — one line: `[e0 {done}/9] unit={id} status={s} covered={c}/{r}`.
9. **Immediately start the next iteration.** No summaries, no pausing, no questions.

## Honesty covenant
`done` ⇔ all gates green AND `coveredCount == requiredCount`, with the evidence in the log. A gate
that cannot run on this host (e.g. no display to launch the packaged app) is `blocked`, never `done`.
After `attempts >= 3` without reaching the bar, set `blocked` with the blocking `deltas`.

## Stop conditions
Every unit `done`/`blocked`, OR the STOP sentinel exists, OR 5 consecutive `blocked` (print why, stop).

BEGIN LOOPING NOW — start with `e0:scaffold/app`.
