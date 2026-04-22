---
description: "Phase 11 — Hand off production cutover to the gitops repo"
---

# 🔴 Cutover 01 — Hand Off to Gitops

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 1 of 1

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | A `HANDOFF.md` at repo root + a comment on the draft PR |
| Depends on | Phase 10 verdict = GO |
| Blocks | nothing (handoff is terminal in this repo) |

## Single Goal

Produce a `HANDOFF.md` that points the on-call operator to the gitops cutover playbook with all the context they need (PR URL, merge-ready tag, soak verdict, rollback scenarios).

## What's Being Established

The teslasync repo doesn't deploy to production directly. The actual `helm upgrade` against the prod cluster is gated by a separate prompt sequence in the gitops repo. This prompt makes the handoff explicit and traceable.

## Recommendation

### `HANDOFF.md` template

```markdown
# db-refactor: Production Cutover Handoff

## Status: HANDED OFF TO GITOPS

> Date: <ISO>
> From: teslasync repo (this repo)
> To: -k3s-gitops repo
> Owner: <name>

## Inputs

| Item | Value |
|------|-------|
| Branch | `db-refactor/timescaledb-migration-mo-jsonb-at-all` |
| Merge-ready tag | `db-refactor/merge-ready` |
| Draft PR | <URL from Phase 9.07> |
| Soak verdict | `.github/prompts/db-refactor/SOAK_VERDICT.md` (GO) |
| ADRs | `.github/prompts/db-refactor/adrs/` (9 ADRs, all Accepted) |
| Container image | `ghcr.io/ev-dev-labs/teslasync:<commit-sha>` (built by CI on this branch) |

## Cutover playbook (lives in gitops repo)

> Path: `D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\`

The gitops sequence covers:
1. Pre-cutover prod backup (pg_basebackup or VolumeSnapshot)
2. Maintenance window announcement
3. Helm release replacement (postgres image swap requires StatefulSet recreate or PV migration; gitops repo decides strategy)
4. Migration application gate (apps/teslasync waits for migration 142 success)
5. DNS / ingress no-op (same hostnames; postgres is internal-only)
6. Post-cutover smoke (5 critical user flows)
7. 30-min watch window
8. Rollback gate

## Rollback

If the gitops cutover fails at any step, follow `rollback/99-rollback.prompt.md` scenario C (post-merge, pre-traffic) or D (post-traffic regression) in this repo.

## Sign-off

- [ ] Gitops repo prompt sequence created and reviewed
- [ ] On-call operator named and acknowledges
- [ ] Maintenance window scheduled
- [ ] Backup verification completed

When all 4 boxes check, the gitops repo takes over.
```

## Suggested Fix

1. Fill in the template (PR URL, container image tag, on-call name, window)
2. Open `D:\repos\-k3s-gitops\` in another window — verify or create the `teslasync-ts-cutover/` prompt directory
3. Add a comment on the draft PR linking to HANDOFF.md and the gitops prompt path
4. Commit HANDOFF.md to this repo

## Acceptance Criteria

- [ ] `HANDOFF.md` at repo root, all template fields filled
- [ ] Gitops cutover prompt path exists (or PR opened against gitops repo to create it)
- [ ] Draft PR has handoff comment
- [ ] All 4 sign-off boxes ticked OR explicitly tracked separately
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
Test-Path HANDOFF.md
Test-Path D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\
gh pr view --comments | Select-String -Pattern "HANDOFF.md|teslasync-ts-cutover"
```

## Out of Scope

- The actual production cutover (lives in gitops repo)
- Production database backup commands (gitops repo)
- DNS changes (gitops repo)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add HANDOFF.md
git commit -m "ops(db-refactor): Phase 11 — production cutover handed off to gitops

All gates passed: Phase 9 merge-ready, Phase 10 soak verdict GO.
Cutover playbook lives in -k3s-gitops/.github/prompts/teslasync-ts-cutover/.
Rollback scenarios C/D in this repo's rollback/99-rollback.prompt.md.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 9 prompt 07 (MERGE_READY.md)
- Phase 10 prompt 03 (SOAK_VERDICT.md)
- All ADRs
- Gitops repo: `D:\repos\-k3s-gitops\`
