---
description: "Phase 41-rewrite - preflight + baseline (verify phase-42a + phase-43a closed; snapshot finding counts)"
---

# Prompt 0000 — Phase-41-rewrite preflight + baseline

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0000-preflight-and-baseline.log` |
| Depends on | `phase-42a-9999-final-gate.log` + `phase-43a-9999-final-gate.log` (both EXIT=0/STATUS=DONE) |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== PREDECESSORS ===`, `=== FINDINGS_BASELINE ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Phase-41-rewrite remediates 15 OPEN findings (F002-F012, F014-F015,
F017-F018) recorded in the session-store `findings` table. These are
the residual Go-quality / correctness issues that survived phase-42a
(pipeline rewrite) and phase-43a (replacement endpoints). This
preflight prompt is the contract baseline:

1. Asserts both predecessor slates closed cleanly.
2. Snapshots the current finding state — any finding marked
   `CLOSED-BY-PHASE-42A-*` or `CLOSED-BY-PHASE-43A-*` between the time
   this slate was authored and the time it runs gets recorded in
   the baseline so downstream prompts can short-circuit.
3. Verifies the `findings` table schema matches what the remediation
   prompts expect (id, severity, dimension, evidence, status columns).

## Action Steps

1. `git status` clean (only the log file may be touched).
2. `=== PREFLIGHT ===` capture HEAD, branch, status.
3. `=== PREDECESSORS ===`:
   - Read `.github/prompts/db-refactor/logs/phase-42a-9999-final-gate.log`. Assert final EXIT=0/STATUS=DONE.
   - Read `.github/prompts/db-refactor/logs/phase-43a-9999-final-gate.log`. Assert final EXIT=0/STATUS=DONE.
   - If either is missing or non-DONE, BLOCK.
4. `=== FINDINGS_BASELINE ===`:
   - Run a SQL probe (via the session store if accessible, otherwise grep the prompt files in this slate). For each F-id in {F002,F003,F004,F005,F006,F007,F008,F009,F010,F011,F012,F014,F015,F017,F018}:
     - Print `Fxxx | <severity> | <dimension> | <status>`.
     - Note any with `status != 'verified'` — those are pre-closed and the corresponding remediation prompt will short-circuit to DONE in its own PREFLIGHT.
5. `=== GATE ===` Assert all 15 findings are accounted for (closed or verified). Write `EXIT=0` + `STATUS=DONE`.
6. `=== COMMIT ===` `git add -f` the log + commit `chore(phase-41-rewrite/0000): preflight + finding baseline snapshot`.

## Rationale

This prompt does NOT modify source. It is a contract anchor so that
the 15 remediation prompts have a stable predecessor and a published
baseline of which findings need work vs. which were already closed by
the upstream slates.
