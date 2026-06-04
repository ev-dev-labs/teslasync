---
description: "P0/0004 — CI matrix with path filters for Win/macOS/Linux app jobs"
---

# P0 · 0004 — CI matrix + path filters

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 4 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `.github/workflows/apps-shared.yml`, `apps-windows.yml`, `apps-android.yml`, `apps-apple.yml` |
| Allowed files | `.github/workflows/apps-*.yml`, the log file |
| Depends on | 0001, 0003 |
| Blocks | every platform program (gates run here) |
| ADR refs | ADR-007 (branching/order), ADR-010 (gates), ADR-012 (runners) |
| Log | `../logs/p0-0004-ci-matrix.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Stand up path-filtered CI so each platform builds + lints + tests only when its files
change (ADR-001 consequence), on the correct runner (ADR-012).

## Output — workflow spec (write all four)

Each workflow:
- `on: pull_request` + `push` to its program branch, with `paths:` filter:
  - `apps-shared.yml` → `apps/shared/**`, `api/openapi/**`
  - `apps-windows.yml` → `apps/windows/**`, `apps/shared/**`, `api/openapi/**`
  - `apps-android.yml` → `apps/android/**`, `apps/shared/**`, `api/openapi/**`
  - `apps-apple.yml` → `apps/apple/**`, `apps/shared/**`, `api/openapi/**`
- `runs-on`: shared+android → `ubuntu-latest`; windows → `windows-latest`; apple → `macos-latest`.
- Steps = the ADR-010 triad for that platform: **build + strict lint/format + test**, each
  surfacing a non-zero exit on failure (no `continue-on-error`).
- Concurrency group per branch; cache (Gradle/NuGet/SPM) enabled.
- A final step echoes `EXIT=0` only if all prior steps passed (CI's own honesty marker).

> The jobs will be **no-op-but-valid** until each program adds real build files; they MUST
> still be syntactically valid and runnable. Where a build target does not yet exist, the job
> runs a guard step that succeeds iff the program dir has no buildable project yet, and fails
> once a project exists but does not build. (Spell this guard out in the workflow as a
> documented step — do NOT leave a bare `exit 0`.)

## Implementation steps

1. PREFLIGHT: 0001 + 0003 DONE; clean tree.
2. Author the four workflows per spec. Use `actions/checkout`, language setup actions
   (`actions/setup-java`, `actions/setup-dotnet`, `maxim-lobanov/setup-xcode` or equivalent),
   and dependency caches.
3. GATE: validate YAML — `npx --yes @action-validator/cli .github/workflows/apps-*.yml`
   (or `yamllint`); emit `YAML_EXIT=` then `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] Four workflows exist, each with a correct `paths:` filter + correct `runs-on`.
- [ ] Each runs build + strict-lint + test for its platform (no `continue-on-error`).
- [ ] YAML validates; `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- Don't add real Gradle/dotnet/xcode project files — programs add those.
- Don't disable the existing Go/web CI.

## Commit

```powershell
git add .github/workflows/apps-shared.yml .github/workflows/apps-windows.yml .github/workflows/apps-android.yml .github/workflows/apps-apple.yml .github/prompts/monorepo/logs/p0-0004-ci-matrix.log
git commit -m "ci(monorepo): path-filtered app CI matrix (P0/0004)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
