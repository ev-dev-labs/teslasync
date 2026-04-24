---
applyTo: ".github/prompts/**"
---

# Prompt Engineering & Agent Safety Instructions

## Lessons from the db-refactor (hard-won)

This project uses AI agent-driven prompt phases for large refactors. These
instructions encode the failure patterns we discovered and the safeguards
that prevent them.

## Prompt Structure (mandatory sections)

Every prompt file MUST have:

```markdown
---
description: "Phase X — one-line summary"
---

# Prompt NN — Title

> **Severity:** Build-fix | Feature | Gate | **Delegation:** FORBIDDEN

## Artifact Metadata (table: log path, depends-on, allowed files)

## Honesty Covenant (10 rules, inlined — not referenced)

## Logging Requirements (SURVEY, REASONING, CHANGES, GATE, COMMIT)

## Problem (exact errors with line numbers)

## Action Steps (exact field mappings, not "figure it out")

## Gate (file-scoped error count, not just exit code)

## Commit (with Co-authored-by trailer)

## Blocked Path (commit only the log with STATUS=BLOCKED)
```

## The 10-Rule Honesty Covenant

Inline this in EVERY prompt. Do NOT reference an external file — agents skip references.

```
1. No red-as-green — EXIT != 0 → STATUS=BLOCKED, no exceptions
2. No scope narrowing — run the exact gate command, no subsets
3. No skip-and-assume — can't run gate → BLOCKED, never DONE
4. No field resurrection — don't add back deleted fields to "fix" things
5. No stubs — no `return nil`, `// TODO`, `panic("not impl")`
6. No delegation — NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass — verify predecessor STATUS=DONE first
8. No commit on red — commit only the log when BLOCKED
9. No silent drift — `git status` outside allowed files → BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines
```

## Logging Requirements

Prompts that don't require structured logging produce opaque logs that can't
be audited. Require these sections:

| Section | Purpose | When |
|---|---|---|
| `=== PREFLIGHT ===` | Predecessor checks, tree-clean check | Always first |
| `=== SURVEY ===` | What the agent inspected (file contents, model shapes) | Before making changes |
| `=== REASONING ===` | Why it chose an approach, what it rejected | Before making changes |
| `=== CHANGES ===` | Before/after code diffs | After making changes |
| `=== GATE ===` | Build/vet/test output with EXIT= marker | After changes |
| `=== COMMIT ===` | git add/commit output with COMMIT_EXIT= marker | Last |

**Why:** Phase 5b Prompt 19 claimed DONE but changes were never committed.
With a `=== COMMIT ===` section, the log would have shown the failed commit.

## Atomic Prompt Design

### DO: Provide exact field mappings

```markdown
## Exact Field Mapping

| Old field | New field | DB column | Type change |
|---|---|---|---|
| `d.StartDate` | `d.StartTs` | `start_ts` | same |
| `d.Distance` | `d.DistanceMi` | `distance_mi` | same |
| `d.SpeedMax` | `d.MaxSpeedMph` | `max_speed_mph` | `float64` → `*float64` |
| `d.StartBatteryLvl` | DELETE | — | removed from model |
```

### DON'T: Say "check the model and figure it out"

```markdown
## Bad — lazy prompt

Check the current model shape and update the repo accordingly.
```

**Why:** The agent will make assumptions, skip fields, or add stubs.
Phase 5f's first attempt had vague prompts and the agent produced
incomplete fixes that left 20 files still broken.

### DO: Specify allowed files explicitly

```markdown
| Allowed files to change | `internal/database/drive_repo.go`, the log file |
```

### DON'T: Leave scope open-ended

```markdown
Fix all the drive-related files.
```

**Why:** The rogue agent in Phase 5d's test prompt tried to fix 37 files
because scope wasn't constrained. It timed out at 45 minutes.

## Gate Design

### File-scoped gates (for per-file prompts)

When fixing one file at a time while the full build is still red, use
file-scoped error counting:

```powershell
go build -gcflags=-e ./... 2>&1 | Tee-Object -FilePath $log -Append
$fileErrors = ([regex]::Matches($gateOut, 'drive_repo\.go:\d+:\d+:')).Count
"DRIVE_REPO_ERROR_COUNT=$fileErrors" | Tee-Object -FilePath $log -Append
if ($fileErrors -ne 0) { "STATUS=BLOCKED" ... }
```

The `-gcflags=-e` flag is CRITICAL — without it, Go stops at ~10 errors
per package and hides failures in other packages.

### Full-scope gates (for acceptance prompts)

```powershell
go build ./... 2>&1 | ...
"EXIT=$LASTEXITCODE" | ...
if ($LASTEXITCODE -ne 0) { "STATUS=BLOCKED" ... }
```

### Gate prompts MUST NOT fix code

```markdown
## CRITICAL: Do NOT fix code. Do NOT launch agents. Only run the gate command.
```

**Why:** Phase 5d's test prompt tried to fix all compile errors instead of
just running `go test`. It launched sub-agents, went rogue, and timed out.

## Runner Contract

The runner (`run-prompts.ps1`) MUST parse child logs for red markers:

```powershell
function Test-LogSaysRed {
    param([string]$LogPath)
    $content = Get-Content $LogPath -Raw
    $reasons = @()
    if ($content -match '(?m)^EXIT=(?!0\s*$)\d+')     { $reasons += 'EXIT non-zero' }
    if ($content -match '(?m)^STATUS=BLOCKED')         { $reasons += 'STATUS=BLOCKED' }
    if ($content -match '\[FAIL\]')                    { $reasons += '[FAIL] marker' }
    if ($content -match '(?m)^UNEXPECTED_COUNT=(?!0)\d+') { $reasons += 'UNEXPECTED_COUNT' }
    return @($reasons.Count -gt 0, ($reasons -join ', '))
}
```

**Why:** Phases 5b and 5c both had the runner mark BLOCKED prompts as DONE
in `done.txt` because it only checked the CLI exit code, not the log contents.

## Phase Design Principles

### Use comprehensive grep, not just build output

Go's "too many errors" limit (10 per package) hides failures. Before
creating a phase, scan ALL files:

```powershell
$env:CGO_ENABLED = "0"
go build -gcflags=-e ./... 2>&1  # extended errors
```

And also grep for field patterns (catches files hidden behind dep chains):
```powershell
Select-String -Recurse -Path internal\*.go -Pattern 'oldField'
```

### Order prompts by dependency

```
Model changes (00-02) → Repo changes (03-10) → Handler changes (11-15) → Gates (16-18)
```

The database package must compile before api/worker/service packages can be checked.

### Include field mapping tables in EVERY consumer prompt

Don't assume the agent remembers what was renamed. Copy the mapping table
into every prompt that touches a file using those models.

## Failure Recovery

When a phase has BLOCKED prompts:

1. **Audit:** Check every log for EXIT= and STATUS= markers
2. **Categorize:** structural (missing types), dirty-tree, predecessor cascade
3. **Fix forward:** Create a new phase for the remaining work (never re-run a BLOCKED prompt in-place)
4. **Comprehensive scan:** Use `-gcflags=-e` AND grep to find ALL remaining issues before creating the next phase
