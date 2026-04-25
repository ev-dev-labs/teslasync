---
description: "Phase-17 — Two competing config systems: deprecate secondary, document canonical"
---
# Prompt 07 — Two Competing Config Systems (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-07-competing-config-systems.log` |
| Allowed files to change | `internal/platform/config/config.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**Files:** `internal/config/config.go`, `internal/platform/config/config.go`

Two config packages with overlapping concerns, different parsing strategies, and different
defaults. This causes confusion about which is the source of truth and risks divergent
behavior when one is updated but not the other.

## Task

### 1. Survey both config files

Read both files completely:
- `internal/config/config.go` — understand its struct, parsing, and what it covers
- `internal/platform/config/config.go` — same analysis
- `cmd/teslasync/main.go` — check which config package is imported in the main entry point

### 2. Determine the canonical config

The primary config is the one used in `cmd/teslasync/main.go`. Document your finding
in the log under `=== REASONING ===`.

### 3. Add deprecation comment to the secondary

Add a package-level deprecation comment to `internal/platform/config/config.go`:

```go
// Deprecated: This package is superseded by internal/config.
// New code should use internal/config exclusively.
// This package will be removed in a future phase — do not add new fields here.
// See: .github/prompts/db-refactor/phase-17-security-reliability/README.md
```

Place this comment at the **top of the file**, right after the `package config` line
(or as a doc comment above it if that's more idiomatic).

### 4. Do NOT merge or modify behavior

This prompt is documentation-only. Do NOT:
- Change any logic
- Move any fields
- Modify any imports
- Change any defaults

Merging the two config packages is a separate future task.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify deprecation comment exists:
$deprecated = Select-String -Path internal\platform\config\config.go -Pattern 'Deprecated'
if ($deprecated.Count -eq 0) { Write-Error "FAIL: Deprecated comment not found in platform/config"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/07-competing-config-systems: deprecate internal/platform/config in favor of internal/config

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/07-competing-config-systems` as the commit message prefix.
