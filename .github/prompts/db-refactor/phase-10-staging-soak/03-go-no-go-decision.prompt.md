---
description: "Phase 10 — Final go/no-go decision; routes to Phase 11 (cutover) or rollback/"
---

# 🔴 Soak 03 — Go/No-Go Decision

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 3 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | `.github/prompts/db-refactor/SOAK_VERDICT.md` |
| Depends on | `02-daily-checks` (all 7 days captured) |
| Blocks | Phase 11 (if go) or `rollback/99-rollback.prompt.md` (if no-go) |

## Single Goal

Aggregate the 7 daily snapshots into a single verdict document. If go: Phase 11 starts. If no-go: jump to `rollback/`.

## Recommendation

### `SOAK_VERDICT.md` template

```markdown
# Phase 10 Soak — Verdict

> Soak window: <day-1 date> through <day-7 date>
> Decided by: <name>, <date>

## Verdict: GO ✅ / NO-GO ❌

## Per-day summary

| Day | Date | Status | Notable |
|----:|------|--------|---------|
| 1   |      | ✅      |         |
| 2   |      | ✅      |         |
| 3   |      | ✅      |         |
| 4   |      | ✅      |         |
| 5   |      | ⚠️      | API p95 on /drives spiked to +90%; mitigated by index added in commit XXX |
| 6   |      | ✅      |         |
| 7   |      | ✅      |         |

## Threshold breaches

| Day | Metric | Severity | Resolution |
|----:|--------|----------|------------|
| 5   | api_p95_ms /drives | warn | Added covering index on (vehicle_id, start_date) |

## CAGG observations

- Daily refresh at 02:00 UTC ran in 4–6s consistently
- First compression policy ran on day 7, compressed 22% of positions chunks
- No retention drops yet (window starts day 8)

## Disk growth

- Total db growth over 7 days: 1.2 GB
- Projected 30-day growth: 5.1 GB (within 50 GB PV budget)

## Decision rationale

<2-3 paragraphs explaining why go or no-go>

## Next step

- If GO: open `.github/prompts/db-refactor/phase-11-prod-cutover/01-handoff-to-gitops.prompt.md`
- If NO-GO: open `.github/prompts/db-refactor/rollback/99-rollback.prompt.md`, scenario B
```

## Suggested Fix

1. Read all 7 day-N snapshots
2. Fill in the per-day summary table
3. List any threshold breaches and how they were resolved
4. Compute disk growth projection
5. Write the rationale paragraph
6. Write GO or NO-GO verdict at the top
7. Commit
8. If GO: continue to Phase 11
9. If NO-GO: open rollback prompt scenario B

## Acceptance Criteria

- [ ] `SOAK_VERDICT.md` exists at `.github/prompts/db-refactor/`
- [ ] Verdict is explicit (GO or NO-GO) with rationale
- [ ] All 7 days summarized
- [ ] Disk projection computed
- [ ] Next-step pointer correct
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
Get-Content .github\prompts\db-refactor\SOAK_VERDICT.md
Select-String -Path .github\prompts\db-refactor\SOAK_VERDICT.md -Pattern "Verdict:\s+(GO|NO-GO)"
```

## Out of Scope

- Don't cutover here (Phase 11)
- Don't roll back here (rollback/ has its own prompt)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add .github/prompts/db-refactor/SOAK_VERDICT.md
git commit -m "ops(db-refactor): Phase 10.03 — soak verdict <GO|NO-GO>

7-day soak complete. <One-line summary of decision and rationale>.
Next: <Phase 11 cutover | rollback scenario B>.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- All Phase 10 prompts
