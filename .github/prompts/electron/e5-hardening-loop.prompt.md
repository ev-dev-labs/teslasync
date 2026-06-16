---
description: "E5 Hardening LOOP — package, sign, auto-update, e2e, perf, a11y, l10n, security review, GA release"
---

# Electron E5 Hardening LOOP — paste into a running session

You are a **loop**, not a one-shot. Read `.github/prompts/electron/0000-methodology.prompt.md` first.
The **ledger on disk is the ONLY source of truth** — never declare "done" in chat. Re-derive progress
from disk each iteration. **Never ask permission or for me to type "continue."**

## Predecessor gate
Verify `ledgers/e2-desktop-parity-ledger.json` is 100% `done` (or every remaining row is a
documented `blocked`). If E2 is still open → STOP, print `E5 BLOCKED: E2 not complete`.

## Durable state (read every iteration)
- SPEC: `.github/prompts/electron/units/e5-hardening-units.json` (12 units).
- PROGRESS: `.github/prompts/electron/ledgers/e5-hardening-ledger.json` (`[]` if missing).
- STOP: `.github/prompts/electron/ledgers/STOP-electron-loop`.

## Goal of this phase
Take the parity-complete app to a **signed, auto-updating, accessible, localized, security-reviewed
GA release** for Windows, macOS, and Linux.

## One iteration
1. **Read the ledger** fresh from disk.
2. **Pick the next unit** (`todo`/`in_progress`, skip `done`/`blocked`), honoring `dependsOn`.
   If none remain → print `=== E5 HARDENING COMPLETE ===` and STOP.
3. **Claim it**: `status:"in_progress"`, increment `attempts`. Save.
4. **Implement that ONE unit** for real — real installers, real signing config, real auto-update
   feed, real Playwright `_electron` e2e, real axe-core a11y assertions, real `i18n` coverage check,
   real `@electron/fuses` + Electronegativity security review. No mock certificates presented as
   signed, no skipped-test suites counted as passing. Stay within `allowedFiles`.
5. **Run the gates** (capture `EXIT=` each), plus the unit's own command, e.g.:
   - `npm --prefix apps/electron run package` (per target: `--win` / `--mac` / `--linux`)
   - `npm --prefix apps/electron run e2e`
   - perf: cold-start + memory budget script; a11y: axe scan; l10n: missing-key check
   - security: `@electron/fuses` verify + Electronegativity (zero high findings)
6. **Record honestly**: `status`, `coveredCount`, artifact paths/hashes, scan output, `deltas`,
   `evidenceLog`, with a `=== PARITY ===` section in the log.
7. **Commit** (preferred). 8. **Beacon**: `[e5 {done}/12] unit={id} status={s} covered={c}/{r}`.
9. **Immediately start the next iteration.** No summaries, no pausing, no questions.

## Honesty covenant
`done` ⇔ gates green AND the unit's artifact/scan evidence is real and on disk. Signing or
notarization that needs credentials/hardware you don't have is `blocked` (document exactly what is
required) — **never** fake a signature or claim notarization. `attempts >= 3` without the bar →
`blocked`. The terminal `e5:release/ga` unit may only be `done` when every other E5 unit is `done`.

## Stop conditions
Every unit `done`/`blocked`, OR STOP sentinel exists, OR 5 consecutive `blocked`.

BEGIN LOOPING NOW — start with `e5:package/win`.
