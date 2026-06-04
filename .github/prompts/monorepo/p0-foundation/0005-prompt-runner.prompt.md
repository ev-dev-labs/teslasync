---
description: "P0/0005 — Prompt runner implementing the methodology runner contract"
---

# P0 · 0005 — Prompt runner (`run-prompts.ps1`)

> **Severity:** Foundational · **Delegation:** FORBIDDEN · **Prompt:** 5 of 12 (P0)

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `.github/prompts/monorepo/run-prompts.ps1` + `done.txt` (empty) |
| Allowed files | `.github/prompts/monorepo/run-prompts.ps1`, `.github/prompts/monorepo/done.txt`, the log file |
| Depends on | 0001 |
| Blocks | optional automation of all later prompts |
| ADR refs | methodology (runner contract) |
| Log | `../logs/p0-0005-prompt-runner.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Provide a runner that parses each child log for RED markers and NEVER records a BLOCKED
prompt as DONE — the exact failure db-refactor's runner had.

## Output — required function (must be present verbatim in logic)

```powershell
function Test-LogSaysRed {
    param([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return @($true, 'log missing') }
    $c = Get-Content $LogPath -Raw
    $reasons = @()
    if ($c -match '(?m)^EXIT=(?!0\s*$)\d+')            { $reasons += 'EXIT non-zero' }
    if ($c -match '(?m)^STATUS=BLOCKED')               { $reasons += 'STATUS=BLOCKED' }
    if ($c -match '\[FAIL\]')                          { $reasons += '[FAIL] marker' }
    if ($c -match '(?m)^COMMIT_EXIT=(?!0\s*$)\d+')     { $reasons += 'commit failed' }
    # Parity gate: COVERED < REQUIRED is RED
    if ($c -match '(?m)^PARITY_COVERED=(\d+)' ) {
        $cov = [int]$Matches[1]
        if ($c -match '(?m)^PARITY_REQUIRED=(\d+)') { if ($cov -lt [int]$Matches[1]) { $reasons += 'parity gap' } }
    }
    return @($reasons.Count -gt 0, ($reasons -join ', '))
}
```

Runner behavior:
- Accept a phase directory; enumerate `*.prompt.md` in ascending order.
- For each, expect a corresponding `logs/<id>.log` after execution; call `Test-LogSaysRed`.
- Append `<id> DONE` to `done.txt` ONLY when not red; otherwise print the reason and STOP
  (do not continue past a red prompt unless `-ContinueOnRed` is explicitly passed).
- Print a summary table (id, RED?, reason).

## Implementation steps

1. PREFLIGHT: 0001 DONE + clean tree.
2. Write the runner with the function above + behavior; create empty `done.txt`.
3. GATE: self-test — create a temp fake log containing `STATUS=BLOCKED`, assert
   `Test-LogSaysRed` returns `$true`; create one with `EXIT=0`/`STATUS=DONE`, assert `$false`.
   Emit `SELFTEST_EXIT=` then `EXIT=`.
4. Commit.

## Acceptance Criteria

- [ ] `Test-LogSaysRed` present and detects EXIT≠0, STATUS=BLOCKED, [FAIL], commit fail, parity gap.
- [ ] Self-test passes (both positive and negative cases).
- [ ] Runner never appends a red prompt to `done.txt`.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Commit

```powershell
git add .github/prompts/monorepo/run-prompts.ps1 .github/prompts/monorepo/done.txt .github/prompts/monorepo/logs/p0-0005-prompt-runner.log
git commit -m "chore(monorepo): prompt runner with red-marker parsing (P0/0005)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
