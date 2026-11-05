# Repair charging classifications on an isolated copy

Never run this command against production. Restore a database backup into a
disposable local PostgreSQL instance, with a database name beginning
`teslasync_charging_repair_`. Retain `signal_log`, geofences, settings, vehicles,
and Tesla charging history when restoring the copy.

The command refuses remote hosts (including connection fallbacks) and other
database names. It does not read the application's database environment variables.

In PowerShell, set `CHARGING_REPAIR_DSN` to the isolated copy's connection string,
then preview a batch:

```powershell
go run .\cmd\repair-charger-types -limit 100
```

Inspect the structured candidate log before applying:

```powershell
go run .\cmd\repair-charger-types -limit 100 -apply
```

`-apply` always logs a complete dry-run first. Use the logged `next_after_id`
with `-after-id` to inspect the next batch; stop when `scanned` is zero.
Repeating a batch is idempotent. Compare-and-swap updates skip rows whose
classification changed after the preview.

The repair uses the same classifier and retained session-window evidence as the
API. Positive vehicle DC evidence and power above 22,000 W override old AC
labels. Tesla fast-charger evidence or an unambiguous overlapping Tesla invoice
can establish Supercharger identity. An address alone cannot establish a brand.
Missing evidence remains unknown; saved Home is a location, not a DC category.

Only `charger_type` changes. Costs, session boundaries, measurements, and billing
records are not rewritten. API rate estimates remain labeled response estimates;
manual and known historical costs retain their precedence.
