---
description: "Phase 5 gate - go vet + golangci-lint"
---

# 🟢 Build 69 - go vet + golangci-lint

> **Severity:** Critical | **Priority:** High | **Prompt #:** 69 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | (verification only - no source changes) |
| Depends on | `phase-5-go-models/01-66` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-001, ADR-002, ADR-004, ADR-005 |
| Estimated effort | small (~5-15 min) |

## Single Goal

Static analysis on the changed packages must be clean.

## Verification

```powershell
cd D:\repos\teslasync
go vet ./internal/models/... ./internal/database/...
golangci-lint run ./internal/models/... ./internal/database/...
```

## Acceptance Criteria

- `go vet` exits 0.
- `golangci-lint run` exits 0 (or only pre-existing baseline warnings).

## Out of Scope

Source code changes. This is a gate prompt - if it fails, fix the upstream prompt and re-run.

## Commit When Done

No commit unless a fix was required upstream.
