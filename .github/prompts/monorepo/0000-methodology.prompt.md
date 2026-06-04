---
description: "Monorepo Native Apps — methodology, safeguards, Honesty Covenant, logging & gate contract for every prompt"
---

# Prompt 0000 — Methodology & Safeguards (READ BEFORE ANY PROMPT)

> **Severity:** Governance · **Delegation:** FORBIDDEN
> This file is the binding contract for **every** prompt under
> `.github/prompts/monorepo/`. Each prompt re-inlines the 10-Rule Honesty Covenant
> (agents skip external references). This file explains the *why* and defines the
> shared logging + gate + parity contract.

## Why this exists

The db-refactor effort taught us that AI agents, left unconstrained, will: claim
red builds are green, narrow scope to make gates pass, add stubs/`TODO`s, silently
skip sections, and "commit DONE" without committing. This effort is **10× larger**
(four native toolchains, ~162 pages × 4 platforms) so the safeguards are stricter,
not looser. A polished native app cannot be faked past a parity gate.

## The 10-Rule Honesty Covenant (inline this verbatim in EVERY prompt)

```
1.  No red-as-green — any toolchain EXIT != 0 → STATUS=BLOCKED, no exceptions.
2.  No scope narrowing — run the exact gate command; never a subset, never --filter to pass.
3.  No skip-and-assume — can't run the gate (missing SDK, no device) → BLOCKED, never DONE.
4.  No stubs / no skeletons — no `TODO`, `NotImplementedException`, `fatalError("...")`,
    `TODO()`, empty `Box{}`/`EmptyView()` placeholders, or "Coming soon" screens.
    Every panel in scope must render real data + loading + empty + error states.
5.  No parity shortcuts — a screen is DONE only when it covers 100% of its parity-manifest
    unit (every panel, chart, data source, state, and string). Hiding a panel ≠ implementing it.
6.  No delegation — NO sub-agents, NO parallel, NO background tasks inside a prompt.
7.  No predecessor bypass — verify every `Depends on` prompt's log shows STATUS=DONE first.
8.  No commit on red — if BLOCKED, commit ONLY the log file (STATUS=BLOCKED), never code.
9.  No silent drift — `git status` showing files outside the prompt's Allowed-Files → BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> each on its own line.
```

## Mandatory log sections (one log per prompt under `logs/`)

| Section | Purpose | When |
|---|---|---|
| `=== PREFLIGHT ===` | predecessor STATUS=DONE checks; clean-tree check; SDK/toolchain version echo | first |
| `=== SURVEY ===` | what was inspected (web source of truth, parity-manifest unit, existing native code) | before changes |
| `=== REASONING ===` | chosen approach + what was rejected and why | before changes |
| `=== CHANGES ===` | before/after of every file touched | after changes |
| `=== PARITY ===` | per-panel/chart/state/string coverage vs the manifest unit (a checklist with ✔) | after changes |
| `=== GATE ===` | build/lint/test/format output with `EXIT=` marker | after changes |
| `=== COMMIT ===` | `git add`/`git commit` output with `COMMIT_EXIT=` marker | last |

> The `=== PARITY ===` section is unique to this effort and is **non-optional for any
> UI prompt**. Logic-only prompts (P1 shared) may omit it.

## Gate contract per toolchain

Pick the gate(s) matching the files the prompt touches. Always capture `EXIT=`.

```powershell
# --- Go (OpenAPI generation lives in the Go repo) ---
go build ./... 2>&1 | Tee-Object -FilePath $log -Append; "EXIT=$LASTEXITCODE" | Tee-Object $log -Append

# --- KMP / Android (Gradle) ---
./gradlew :shared:build           # shared core
./gradlew :app:assembleDebug lintDebug detekt   # android app
# capture: "EXIT=$LASTEXITCODE"

# --- Windows (.NET / WinUI 3) ---
dotnet build apps/windows/TeslaSync.sln -c Release   # + dotnet format --verify-no-changes
# capture: "EXIT=$LASTEXITCODE"

# --- Apple (SwiftUI) — run on a macOS runner ---
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test
swiftformat --lint . ; swiftlint --strict
# capture: "EXIT=$LASTEXITCODE"
```

### Gate rules
- A **build gate** must be the full project/module build, not a single-file compile.
- A **UI prompt** gate MUST include the platform **linter/formatter in strict mode**
  AND the platform **analyzer** (detekt / WinUI analyzers / SwiftLint) — polish is
  enforced, not optional (ADR-011).
- If a prompt cannot run its gate (e.g. no macOS runner available for a P4 prompt),
  it is **BLOCKED**, not DONE — note the missing capability in the log.

## Parity gate (UI prompts)

```
PARITY_UNIT=<manifest id, e.g. page:charging/ChargingDetail or panel:dashboard/FleetStatus>
For each panel/chart/map/state/string listed in the manifest unit:
  - render it with REAL data binding (from the shared core / generated client)
  - implement loading (Skeleton/Shimmer/ProgressRing), empty (EmptyState), error (retry) states
  - localize every visible string via the platform i18n system
PARITY_COVERED=<int>   # panels+charts+states+strings implemented
PARITY_REQUIRED=<int>  # from the manifest unit
If PARITY_COVERED < PARITY_REQUIRED → STATUS=BLOCKED.
```

## Allowed-files scoping

Every prompt declares an **Allowed files** list in its Artifact Metadata. Touching
anything else → Rule 9 violation → BLOCKED. The log file itself is always allowed.

## Commit discipline

- DONE: `git add <allowed files> <log>` then commit with a Conventional-Commit message
  and the `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- BLOCKED: `git add <log>` only; commit message `chore(monorepo): BLOCKED <prompt> — <reason>`.

## Runner contract

A runner (`run-prompts.ps1`, authored in P0) parses each child log and treats a prompt
as RED if any of: `^EXIT=(?!0\s*$)\d+`, `^STATUS=BLOCKED`, `[FAIL]`,
`^PARITY_COVERED=` < `^PARITY_REQUIRED=`. It never marks a BLOCKED prompt DONE.

## Atomic prompt design rules (for the author)

- One prompt = one manifest unit / one file / one cohesive change. No mega-prompts.
- Provide **exact** specs: component names, props, bindings, design tokens, states —
  never "figure out the layout."
- Copy the relevant parity-manifest unit + design-token references into the prompt;
  do not assume the agent remembers them.
- Order prompts by dependency; declare `Depends on` + `Blocks` explicitly.

## EXIT / STATUS footer (every prompt's log ends with)

```
EXIT=0
STATUS=DONE
```
