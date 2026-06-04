---
description: "P0/0001 — Create the apps/ monorepo skeleton + top-level README"
---

# P0 · 0001 — `apps/` skeleton

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 1 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/` directory tree + `apps/README.md` (placeholder) |
| Allowed files | `apps/**` (new dirs + `.gitkeep` + `apps/README.md`), the log file |
| Depends on | — (first P0 prompt) |
| Blocks | every other P0/P1/P2/P3/P4 prompt |
| ADR refs | ADR-001 (monorepo layout) |
| Log | `../logs/p0-0001-apps-skeleton.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs/skeletons-as-final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift (git status outside Allowed files → BLOCKED)
10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines
```
> Note: rule 4 forbids stubs **as a final deliverable**. This prompt's *intended*
> deliverable IS the directory skeleton, so empty dirs + `.gitkeep` are correct here.

## Logging (write these sections to the log)

`=== PREFLIGHT ===` (clean tree check) · `=== SURVEY ===` (confirm `apps/` absent) ·
`=== CHANGES ===` (tree created) · `=== GATE ===` (tree assertion + EXIT=) ·
`=== COMMIT ===` (COMMIT_EXIT=).

## Single Goal

Create the exact `apps/` skeleton from ADR-001 so all later programs have stable paths.

## Output — exact tree

```
apps/
  README.md            # placeholder; filled by 0011
  shared/.gitkeep      # KMP core (P1)
  design/.gitkeep      # design tokens (P1, ADR-005)
  parity/.gitkeep      # parity manifest + ledgers (P1, ADR-006)
  windows/.gitkeep     # WinUI 3 solution (P2)
  android/.gitkeep     # Compose project (P3)
  apple/.gitkeep       # SwiftUI workspace (P4)
  tools/.gitkeep       # cross-platform scripts (placeholder gate, codegen)
  docs/.gitkeep        # runbooks (authentik, observability)
```

`apps/README.md` body for now (one line): `# TeslaSync Native Apps — see .github/prompts/monorepo/README.md`.

## Implementation steps

1. `=== PREFLIGHT ===`: `git status --porcelain` must be empty (else BLOCKED, rule 9).
2. Create the dirs + `.gitkeep` files + `apps/README.md` exactly as above.
3. `=== GATE ===` (PowerShell):
   ```powershell
   $req = 'shared','design','parity','windows','android','apple','tools','docs'
   $missing = $req | Where-Object { -not (Test-Path "apps/$_") }
   "MISSING_DIRS=$($missing -join ',')" | Tee-Object $log -Append
   if ($missing) { "EXIT=1`nSTATUS=BLOCKED" | Tee-Object $log -Append } else { "EXIT=0" | Tee-Object $log -Append }
   ```
4. Commit.

## Acceptance Criteria

- [ ] All 8 subdirs exist with `.gitkeep`; `apps/README.md` present.
- [ ] `git status` clean except Allowed files.
- [ ] Log ends `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- No build files, no SDK config, no CI — those are 0002–0004.

## Commit

```powershell
cd D:\repos\teslasync
git add apps ../logs/p0-0001-apps-skeleton.log 2>$null; git add .github/prompts/monorepo/logs/p0-0001-apps-skeleton.log
git commit -m "chore(monorepo): scaffold apps/ skeleton (P0/0001)

Creates the apps/ monorepo layout per ADR-001.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
