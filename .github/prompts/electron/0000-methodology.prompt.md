---
description: "Electron — methodology, Honesty Covenant, loop contract, logging & gate spec for every Electron loop"
---

# Electron 0000 — Methodology, Loop Contract & Safeguards (READ BEFORE ANY LOOP)

> **Severity:** Governance · **Delegation:** FORBIDDEN inside a unit
> This file is the binding contract for **every** loop under
> `.github/prompts/electron/`. Each loop prompt re-inlines the 10-Rule Honesty
> Covenant (agents skip external references). This file explains the *why* and
> defines the shared **loop**, logging, gate, and parity contracts.

## Why this exists

The db-refactor and monorepo efforts taught us that AI agents, left unconstrained,
will: claim red builds are green, narrow scope to make gates pass, add
stubs/`TODO`s, silently skip work, and "commit DONE" without committing. The
monorepo's `windows-parity-loop` added one more hard lesson: **gates cannot see
pixels**, so a build can be green on a divergent UI. Every safeguard below is a
direct response to one of those failures.

## The loop model (what makes this different from a one-shot prompt)

```
The LEDGER ON DISK is the ONLY source of truth. Never declare "done" in chat.
Re-derive progress from the ledger every iteration so you survive context compaction.

ONE ITERATION:
  1. Read the phase ledger fresh from disk (ledgers/<phase>-ledger.json).
  2. Pick the next unit (no row, or status todo/in_progress; skip done/blocked),
     in the phase's defined order.  If none remain → print "=== <PHASE> COMPLETE ===".
  3. Claim it: write status="in_progress", increment attempts. Save.
  4. Implement THAT ONE UNIT to full completion in apps/electron (+ web/ only if the
     unit explicitly allows it). No stubs, no TODO, no "coming soon".
  5. Run the phase gates (build + lint + typecheck + test + placeholder scan;
     E2 also captures a screenshot and scores it vs the live web app).
  6. Record honestly in the ledger (status, coveredCount, evidence, visualScore).
  7. Commit (preferred). Print a one-line beacon. Immediately start the next iteration.
     No summaries, no pausing, no questions.
```

A unit is `done` ONLY when its gates are green **AND** `coveredCount == requiredCount`
**AND** (E2 only) a real screenshot exists with `visualScore >= 95` and zero
missing/extra desktop chrome. Otherwise it stays `todo` (the next iteration must
improve the same unit) or becomes `blocked` after `attempts >= 3` or for a real
environment gap.

## The 10-Rule Honesty Covenant (inline this verbatim in EVERY loop prompt)

```
1.  No red-as-green — any toolchain EXIT != 0 → that unit is BLOCKED/todo, never done.
2.  No scope narrowing — run the exact gate command; never a subset, never a filter to pass.
3.  No skip-and-assume — can't run a gate (missing SDK, no signing cert, no display) →
    BLOCKED for that unit, never done.
4.  No stubs / no skeletons — no `// TODO`, `throw new Error("not implemented")`,
    empty handlers, dead IPC channels, or "Coming soon" windows. Every surface must
    render real data + loading + empty + error states.
5.  No parity shortcuts — a route/surface is done only at 100% of its unit
    (every panel it renders in the desktop shell + every declared desktop chrome
    behavior + every state + every string). Hiding a surface ≠ implementing it.
6.  No delegation — NO sub-agents, NO parallel, NO background tasks inside a unit.
7.  No predecessor bypass — verify the previous phase's ledger is 100% done first;
    within a phase, respect declared `dependsOn`.
8.  No commit on red — if a unit is BLOCKED, commit ONLY the log + ledger row, never
    half-built code as "done".
9.  No silent drift — `git status` showing files outside the unit's allowedFiles → BLOCKED.
10. Ledger + log MUST record status honestly; the log MUST contain EXIT=<int> and the
    final line PARITY_RESULT (see below). An empty ledger is NOT "complete".
```

## Mandatory log sections (one log per unit under `logs/`)

| Section | Purpose | When |
|---|---|---|
| `=== PREFLIGHT ===` | previous-phase ledger 100% check; clean-tree check; toolchain version echo | first |
| `=== SURVEY ===` | what was inspected (web source of truth, the unit spec, existing electron code) | before changes |
| `=== REASONING ===` | chosen approach + what was rejected and why | before changes |
| `=== CHANGES ===` | before/after of every file touched | after changes |
| `=== PARITY ===` | per-checklist-item coverage with ✔ + binding evidence (file + symbol) | after changes (UI/chrome units) |
| `=== GATE ===` | build/lint/typecheck/test/placeholder output, each with an `EXIT=` marker | after changes |
| `=== VISUAL ===` | (E2 only) screenshot path + visualScore + concrete deltas vs the live web route | after changes |
| `=== COMMIT ===` | `git add`/`git commit` output with `COMMIT_EXIT=` marker | last |

## Gate contract (Electron toolchain)

Run from the repo root. Always capture `EXIT=` after each command.

```powershell
# --- Renderer + main/preload build (electron-vite / Vite) ---
npm --prefix apps/electron run build          ; "BUILD_EXIT=$LASTEXITCODE"
# --- Lint + type safety ---
npm --prefix apps/electron run lint           ; "LINT_EXIT=$LASTEXITCODE"
npm --prefix apps/electron run typecheck       ; "TYPECHECK_EXIT=$LASTEXITCODE"  # tsc --noEmit
# --- Unit tests ---
npm --prefix apps/electron test               ; "TEST_EXIT=$LASTEXITCODE"
# --- No stubs/placeholders ---
pwsh apps/tools/check-placeholders.ps1 -Path apps/electron -Language typescript ; "PLACEHOLDER_EXIT=$LASTEXITCODE"
# --- Package smoke (E0/E5) ---
npm --prefix apps/electron run package -- --dir ; "PACKAGE_EXIT=$LASTEXITCODE"
# --- E2E (E1/E5) — Playwright _electron ---
npm --prefix apps/electron run e2e            ; "E2E_EXIT=$LASTEXITCODE"
```

### Gate rules
- A **build gate** must be the full app build (main + preload + renderer), not a
  single-file compile.
- An **Electron security gate** (E0/E5 units) MUST include `@electron/fuses`
  verification and an Electronegativity (or equivalent) scan — security is enforced,
  not optional.
- If a unit cannot run its gate on this host (no code-signing cert, no macOS runner
  for notarization, no display for a window screenshot), it is **BLOCKED**, not done —
  note the missing capability in the log and the ledger `deltas`.

## Parity / visual gate (E2 desktop-parity units)

```
UNIT = a web route/surface (page-units / surface-units) OR a desktop-chrome unit.
The live web app at http://localhost:3000 is the visual + behavioral oracle.

For a route/surface unit:
  - the SAME route must render correctly inside the packaged Electron window
    (no blank frame, no devtools error, no broken asset/CSP violation),
  - desktop affordances that apply to it work (native context menu, export via
    native save dialog, deep-link entry, notifications it raises).
For a desktop-chrome unit:
  - implement every item in its parityChecklist with real behavior + states.

coveredCount = checklist items implemented; requiredCount = from the unit spec.
visualScore 0–100 from screenshot vs the live web route; deltas list missing/extra
components or color/spacing/typography mismatches in the desktop chrome.
done ⇔ gates green AND coveredCount==requiredCount AND visualScore>=95 AND no
missing/extra chrome AND a real shotPath on disk. Else todo (or blocked).
```

## Allowed-files scoping

Every unit spec declares `allowedFiles` (globs). Touching anything else → Rule 9 →
BLOCKED. The unit's log file and its ledger row are always allowed. No unit may
modify files under `.github/prompts/monorepo/**` or `apps/parity/**` (those belong to
the native effort) — the Electron parity loop READS the shared specs there but never
writes them.

## Commit discipline

- **done:** `git add <allowedFiles> <log> <ledger>` then a Conventional-Commit message
  `feat(apps/electron): <unitId> ...` with the
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- **blocked:** `git add <log> <ledger>` only; message
  `chore(apps/electron): BLOCKED <unitId> — <reason>`.

## Ledger schema (`ledgers/<phase>-ledger.json`, an array of rows)

```jsonc
{
  "unitId":        "string",   // matches a unit id from the phase spec
  "phase":         "e0|e1|e2|e5",
  "status":        "todo|in_progress|done|blocked",
  "coveredCount":  0,
  "requiredCount": 0,
  "visualScore":   0,          // E2 only; 0 for non-visual phases
  "shotPath":      "",         // E2 only; path to screenshot evidence on disk
  "deltas":        [],         // missing/extra components, mismatches, block reasons
  "attempts":      0,
  "promptId":      "electron-<phase>-loop",
  "evidenceLog":   ""          // path to the unit log with === PARITY ===/=== GATE ===
}
```

## Runner contract

`electron-loop.ps1` parses each unit log and refuses to accept a claimed `done`
unless: no `^.*_EXIT=(?!0)` markers, `coveredCount == requiredCount`, and (E2) a real
`shotPath` exists with `visualScore >= VisualThreshold`. A claimed-done unit failing
any of these is reverted to `todo` (or `blocked` at max attempts). It NEVER marks a
BLOCKED unit done.

## EXIT / STATUS footer (every unit log ends with)

```
EXIT=0
PARITY_RESULT unitId=<id> status=<done|blocked|todo> covered=<n> required=<n> visual=<0-100> shot=<path|->
```
