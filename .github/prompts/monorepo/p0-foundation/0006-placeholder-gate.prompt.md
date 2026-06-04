---
description: "P0/0006 — Placeholder/stub gate implementing ADR-011 forbidden patterns"
---

# P0 · 0006 — Placeholder gate (`check-placeholders.ps1`)

> **Severity:** Foundational (enforces "no stubs") · **Delegation:** FORBIDDEN · **Prompt:** 6 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/tools/check-placeholders.ps1` + `apps/tools/placeholder-patterns.json` |
| Allowed files | `apps/tools/check-placeholders.ps1`, `apps/tools/placeholder-patterns.json`, the log file |
| Depends on | 0001 |
| Blocks | every UI prompt's gate (P2/P3/P4 call this) |
| ADR refs | ADR-011 (definition of done) |
| Log | `../logs/p0-0006-placeholder-gate.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A scanner that fails (non-zero) when forbidden stub/placeholder patterns appear in app
source — making "no skeletons" a mechanical gate.

## Output — `placeholder-patterns.json` (per-language forbidden patterns)

```json
{
  "common":  ["TODO", "FIXME", "XXX", "Coming soon", "Placeholder", "Lorem ipsum", "not implemented"],
  "kotlin":  ["TODO\\(", "throw NotImplementedError", "Text\\(\"TODO", "Box\\(\\)\\s*\\{\\s*\\}"],
  "csharp":  ["NotImplementedException", "throw new NotImplementedException", "// stub"],
  "swift":   ["fatalError\\(\\\"unimpl", "fatalError\\(\\\"not", "Text\\(\\\"TODO", "EmptyView\\(\\) // placeholder"]
}
```

## Output — scanner behavior

- Args: `-Path <dir>` (default `apps/`), `-Language <kotlin|csharp|swift|all>`.
- Recursively scan source files (`.kt/.kts`, `.cs/.xaml`, `.swift`) excluding `generated/`,
  `build/`, `bin/`, `obj/`, `DerivedData/`, test fixtures.
- For each match: print `FILE:LINE: <pattern>`.
- Emit `PLACEHOLDER_COUNT=<n>`; exit non-zero if n>0.
- Allow an inline opt-out marker `// parity:allow <reason>` on the same line ONLY for
  genuine domain text (e.g. a translation key literally named "todo"); count opt-outs separately
  as `PLACEHOLDER_ALLOWED=<n>` and require a reason.

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write the JSON + scanner.
3. GATE: self-test — create temp files containing `NotImplementedException` and `TODO()`,
   assert the scanner exits non-zero and reports both; create a clean file, assert exit 0.
   Emit `SELFTEST_EXIT=` then `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Scanner detects all common + per-language patterns; honors excludes.
- [ ] Self-test: dirty → non-zero, clean → zero.
- [ ] Opt-out requires a reason; counted separately.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add apps/tools/check-placeholders.ps1 apps/tools/placeholder-patterns.json .github/prompts/monorepo/logs/p0-0006-placeholder-gate.log
git commit -m "chore(monorepo): placeholder/stub gate per ADR-011 (P0/0006)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
