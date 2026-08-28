# Degraded mode: object storage (local / S3 / Azure Blob / GCS)

**Criticality:** degraded-tolerable for live traffic, but it is the
single point of failure for *recoverability*. No read path for fleet
data touches object storage; backups and exports do.

Registered in `ops/runbooks/dependencies.yaml` (`object-storage`).

## Symptoms

- `cmd/backup-verify` exits non-zero: the newest artifact will not round
  trip (download, checksum, or decompress fails).
- Backup runs are recorded as failed at the upload step.
- Export jobs generate their payload successfully and then fail on
  upload, so the user sees "export failed" after a long wait.
- The scheduled restore drill
  (`.github/workflows/backup-restore-drill.yml`) starts failing.

## Confirm

```bash
kubectl -n "$NS" logs job/"$RELEASE"-backup-verify --tail=50
kubectl -n "$NS" logs deploy/"$RELEASE"-export-worker --since=30m | grep -i 'upload\|storage'
```

The verifier emits a JSON result line; read it rather than guessing:

```bash
kubectl -n "$NS" logs job/"$RELEASE"-backup-verify | tail -1 | jq .
```

Distinguish the failure modes — only one of them is an emergency:

| Shape | Evidence | Severity |
|---|---|---|
| Credentials expired/rotated | 401/403 from the provider | high — no new backups |
| Bucket unreachable | timeouts, DNS failures | high — no new backups |
| Checksum mismatch | verifier reports checksum failure | **critical — existing backups are suspect** |
| Quota/disk full | 507, `no space left on device` | high — silent data-protection loss |

## Immediate mitigation

1. **Assume you are currently unprotected.** Until a backup uploads and
   verifies, the effective RPO is "since the last verified artifact",
   not the configured schedule.
2. **Credentials or bucket unreachable:** switch to the `local` storage
   provider as a break-glass target so backups keep being produced to
   the mounted volume:
   configure the backup destination to `local` and confirm the PVC has
   free space. This is the documented fallback, not an improvisation.
3. **Checksum mismatch:** stop overwriting. Do not run another backup
   into the same key prefix until you know whether the corruption is in
   the artifact or in the transfer.
4. **Exports:** failures are retried by the worker. Do not manually
   re-enqueue in bulk — that multiplies the load against a storage
   backend that is already unhealthy.

## Recovery

1. Restore access (rotate credentials, fix networking, free space).
2. Run a backup and verify it explicitly rather than waiting for the
   weekly cron:

   ```bash
   kubectl -n "$NS" create job --from=cronjob/"$RELEASE"-backup-verify backup-verify-manual
   ```

3. Run the restore drill in `roundtrip` mode to prove the whole chain —
   backup, upload, download, checksum, decompress, restore — works end
   to end again:

   ```bash
   gh workflow run backup-restore-drill.yml -f mode=roundtrip
   ```

4. If the artifacts themselves were corrupted, record the window during
   which no valid backup existed. That window is a real RPO gap and
   belongs in the incident record.

## Verify

```bash
go run ./cmd/ops-gate -check restore
```

Then confirm the verifier's JSON result reports a matching checksum and
a non-zero row count for every table in
`ops/restore/drill.yaml` `critical_tables`. A "successful" backup with
zero rows in `vehicles` is a failed backup that exited 0.

## Escalation

Page immediately on a checksum mismatch — that means existing backups
may be unrestorable, which is the one failure here that cannot be fixed
after the fact. For everything else, escalate during business hours, but
do not let it age: every day without a verified artifact extends the
window in which a database loss becomes unrecoverable.
