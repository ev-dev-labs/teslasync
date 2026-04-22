# 99 — Emergency Rollback

**Use when:** Anything in Phases 5-7 needs to be undone.

This is the universal "abort" playbook. Different scenarios use different sections. Read the section that matches your situation.

---

## Scenario A — Phase 5 failure (refactor branch, pre-merge)

**Symptom:** Validation in prompt 07 fails. Branch isn't ready.

**Action:**
- Don't merge. Fix on the branch.
- If the failure indicates a design problem (not just an implementation bug), open the relevant ADR and add a new section "Lessons learned" documenting what went wrong.
- If the design needs rethinking, the entire effort may pause while the affected ADR is revised. That's expected and fine.

**No deployment is touched. Rollback is just "don't merge".**

---

## Scenario B — Phase 6 failure (staging soak)

**Symptom:** A go/no-go criterion fails during the 7-day soak.

**Action:**
1. Stop the soak clock. The 7-day timer resets when issues are resolved.
2. Decide: minor / moderate / major (per prompt 08).
3. **Don't deploy to prod.** Production is still on the old schema and old engine — there's nothing to roll back yet.
4. Fix in a sub-branch, deploy fix to staging, restart the soak.

**No deployment to roll back. Production is untouched.**

---

## Scenario C — Phase 7 failure (prod cutover)

**Symptom:** During the prod cutover (gitops playbook), something goes wrong. Examples:
- Migration fails to apply on prod TimescaleDB
- pg_restore from old PG hits errors
- After cutover, the API doesn't come up healthy
- Smoke test fails

**Action:** Use the gitops repo's dedicated rollback prompt:
**`D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\99-rollback.prompt.md`**

That playbook walks through:
1. Scale teslasync to zero (stop new writes)
2. Restore old PG from the pre-cutover backup (taken in `01-preflight`)
3. Update Helm values to point back at old PG image
4. Scale teslasync back up
5. Verify health
6. Post-mortem the failure; do NOT retry until root cause is known

**Important:** The cutover prompts capture a backup BEFORE making changes. That backup is the rollback target. If for any reason no backup exists, do NOT proceed with cutover.

---

## Scenario D — Post-cutover regression discovered later

**Symptom:** Cutover succeeded; everything looked fine. Days later, a problem emerges (e.g., a specific dashboard shows wrong data, a specific automation isn't firing).

**Action:** This is NOT a candidate for full rollback. The cost of restoring to the old schema (and losing all the new typed data captured since cutover) far exceeds the cost of a forward-fix. Instead:

1. Open a focused bug
2. Reproduce in staging
3. Fix on a normal feature branch
4. Deploy through normal release process

Only do a full rollback if:
- The regression is corrupting data being written
- The regression affects safety-critical functionality (alerts, commands)
- A forward-fix is fundamentally not possible without architecture change

In those rare cases, the rollback is essentially "treat as a new cutover in reverse" — pg_dump from new TimescaleDB, restore into a freshly-deployed old PG. That's a multi-hour operation; plan accordingly.

---

## Universal principles

1. **Backups before changes.** Every prod operation captures a backup first. If you're about to do something irreversible without a backup, stop.

2. **One direction at a time.** Don't simultaneously roll forward AND roll back parts of the system. Pick one.

3. **Communicate.** Tell users a maintenance window is happening, even unscheduled ones.

4. **Post-mortem mandatory.** If you used this rollback playbook, you owe the team a written post-mortem. Include: what triggered the rollback, what was the root cause, what we'll do differently next time. Add to a `postmortems/` directory in the repo.

5. **Don't retry without root cause.** A failed cutover should NOT be re-attempted "to see if it works this time". Find why it failed first.

---

## Useful commands

### Check current Helm release
```powershell
helm list -n teslasync
helm get values teslasync -n teslasync
```

### Force-rollback last Helm revision
```powershell
helm rollback teslasync -n teslasync 0   # 0 means previous
```

### Verify which DB the API is talking to
```powershell
kubectl exec -n teslasync deploy/teslasync -- env | Select-String DATABASE
kubectl exec -n teslasync deploy/teslasync -- psql $DATABASE_URL -c "SELECT version();"
# Look for "TimescaleDB" in the version string
```

### Capture a forensic dump before doing anything destructive
```powershell
kubectl exec -n teslasync postgres-0 -- pg_dump -U teslasync -Fc teslasync > forensic-$(Get-Date -Format yyyyMMdd-HHmm).dump
```

---

## When in doubt

Don't act. Wake someone up. The system is currently in some state — usually a degraded state is recoverable, but a partial-rollback can make things unrecoverable. Five minutes of waiting beats five hours of corruption.
