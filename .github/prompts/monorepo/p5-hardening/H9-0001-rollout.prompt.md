---
description: "P5/H9 — Release rollout: staged rollout, tags, release notes, update mechanism, post-release monitoring"
---

# P5 · H9 · 0001 — Release rollout + post-release monitoring

> **Severity:** Release · **Delegation:** FORBIDDEN
> Stage the rollout (small %, then expand), publish release notes, lock the version tags, watch
> the dashboards from H7, and define the rollback trigger before going public.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | Git tags `v1.0.0-{windows,android,apple}`; release notes per platform; rollout schedule + rollback runbook in `apps/shared/release/runbook.md` |
| Allowed files | `apps/**`, `apps/shared/release/**`, the log file |
| Depends on | P5/H8 |
| Blocks | P5/H99 |
| ADR refs | ADR-016 |
| Log | `../logs/p5-h9-0001-rollout.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A staged release that ships to a small percentage first, watches crash-free-rate +
update-adoption + error spikes, expands on green metrics, and has a documented rollback
mechanism (different per store) ready to invoke if any threshold trips.

## Spec

- **Tags + notes**: per-platform tags + a release-notes file per platform listing user-facing
  changes only; link to the H8 artifact + the H7 release-health dashboard.
- **Staging**:
  - Windows: phased rollout via Partner Center (10% → 50% → 100%) over 7 days.
  - Android: Play staged rollout (10% → 25% → 50% → 100%) gated on crash-free-rate ≥ 99.5%.
  - iOS/macOS: App Store Connect phased release (default 7-day schedule).
- **Rollback**: written runbook per platform (Windows: halt rollout + republish previous;
  Android: halt + rollback to previous AAB; iOS: remove from sale + expedited bugfix).
- **Update mechanism**: app shows update-available banner when a newer version is in the store
  (deep-link to store page); no in-app sideloading.
- **Monitoring window**: 72h post-rollout watch with H7 dashboards; explicit thresholds for
  pause/rollback recorded in the runbook.

## Implementation steps

1. Tag + release-notes + runbook authored.
2. Schedule rollouts in each store console (or via API where available).
3. Wire update-available banner per app to a small `latest-version.json` endpoint.
4. 72h watch begins on rollout start; thresholds + on-call documented.

## Gate

```powershell
node ./apps/shared/release/verify-tags.mjs 2>&1 | Tee-Object $log -Append; "TAG_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
node ./apps/shared/release/verify-runbook.mjs 2>&1 | Tee-Object $log -Append; "RUN_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if TAG=0 AND RUN=0 AND a rollout-start record is written per platform.
```

## Acceptance Criteria

- [ ] Tags + release-notes + runbook committed.
- [ ] Phased rollout scheduled per platform with thresholds recorded.
- [ ] Update-available banner wired to a version-info endpoint.
- [ ] 72h watch underway with named on-call.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Marketing launch comms; press; in-app survey/feedback collection redesign.

## Commit

```powershell
git add apps .github/prompts/monorepo/logs/p5-h9-0001-rollout.log
git commit -m "release(apps): staged rollout + monitoring + rollback runbook (P5/H9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
