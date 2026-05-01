# Data Export Coverage — Phase 40 / Prompt 31

_Last updated: Phase 40 / Prompt 31 (2026-Q2)._

## Goal

Two adjacent gaps closed by this prompt:

1. **GDPR-style "Download my data"** — a self-hosted Tesla data app should give the
   user a complete dump of every fleet record we keep about them in one click.
2. **Per-page CSV** — every table and chart should expose a "Download" affordance so
   users can pull the data they're looking at without opening the full export wizard.

## Pre-Phase-40 state

| Capability | Where | Notes |
|---|---|---|
| Async export job pipeline | `internal/export/{worker,processor,types}.go` + `internal/api/export_handler.go` | MQTT-backed worker; status events to SSE; job rows in `export_jobs` table. |
| Existing job types | `drives`, `charging`, `analytics`, `backup`, `import_drives`, `import_charging` | All scoped to a single domain. `backup` returned JSON of the full schema. |
| API surface | `POST /export/jobs`, `GET /export/jobs`, `GET /export/jobs/{id}`, `GET /export/jobs/{id}/download` | All under `/api/v1/`; uniform JSON. |
| Frontend wizard | `web/src/features/system/pages/DataExportPage.tsx` (937 lines) | Step-based wizard for the 6 legacy types, recent-jobs table, format info cards. |
| Dashboard widget | `web/src/features/dashboard/widgets/ExportStatusWidget.tsx` | Merges `useExports()` (legacy v1) + `useExportJobs()` (admin) for a status pill. |
| Dashboard layout export | `web/src/features/dashboard/components/ExportModal.tsx` | JSON-only export of the dashboard layout itself — unrelated to fleet data. |
| API hooks | `web/src/api/hooks/useExports.ts`, `web/src/api/hooks/useAdmin.ts` | Basic `useExports`, `useExport`, `useCreateExport` — no polling, no per-job hook. |
| Per-table CSV | Ad-hoc only — a few feature pages had bespoke "Export CSV" buttons. | `<DataTable>` (~50 callsites) had no built-in support. |
| Per-chart CSV | None. | `<ChartContainer>` only had the existing PNG export from `useChartExport`. |
| Account-level / GDPR export | None. | No "download everything in one ZIP" button anywhere. |

## Post-Phase-40 state

### Backend additions

| File | Change |
|---|---|
| `internal/export/types.go` | New `TypeAccount JobType = "account"`; `MaxAccountRowsPerTable = 250_000`; `AccountSchemaVersion = "1.0.0"`. |
| `internal/export/account.go` (new) | `processAccount(ctx, job, repo)` builds an in-memory ZIP with one CSV per allowed table + `manifest.json`. Schema-agnostic via `row_to_json` snapshots. |
| `internal/export/processor.go` | Wired `case TypeAccount → processAccount`. |
| `internal/database/export_repo.go` (new) | `AllowedAccountTables` whitelist + `FetchTableSnapshot` / `FetchTableSnapshotForVehicle` / `CountTableRows` helpers. |
| `internal/api/export_handler.go` | Accepts `account` in `validTypes`; new `SubmitAccountJob` handler; `.zip` content-type case. |
| `internal/api/router.go` | Registered `POST /export/jobs/account`. |

### Frontend additions

| File | Change |
|---|---|
| `web/src/lib/csvExport.ts` (new) | Pure-JS RFC-4180 CSV builder + browser `downloadCSV`/`downloadRowsAsCSV`/`defaultExportFilename`. |
| `web/src/components/ui/DataTable.tsx` | New `exportable`, `exportFilename`, `exportRow`, `exportAll` props; toolbar "Download CSV" button. |
| `web/src/components/charts/ChartContainer.tsx` | New `exportData` prop; supports PNG-only / CSV-only / 3-dot kebab menu modes. |
| `web/src/components/feedback/JobProgressDrawer.tsx` (new) | Floating, minimizable widget for in-flight + recent export jobs. Polls every 5 s while any job is queued/processing. |
| `web/src/api/hooks/useExports.ts` | Extended with `useExportJobs()` (polling), `useExportJob(id)`, `useCreateAccountExport()`, `exportDownloadUrl(id)`. Backwards-compat `useExports`/`useCreateExport`/`useExport` retained. |
| `web/src/features/system/pages/DataExportPage.tsx` | Added an `AccountExportPanel` GlassPanel (vehicle + date range scope, "Start full export" button) above the existing wizard. Mounted `<JobProgressDrawer />`. |
| `web/src/i18n/en.json` | New `dataExport.account.*`, `table.export.*`, `chart.menu.*`, `chart.exportCsv`, `export.jobDrawer.*`, `export.types.*`, `export.status.*`, `toast.export.*` keys. |

### What's exportable today

| Category | Per-table CSV | Per-chart CSV | Account ZIP | Notes |
|---|:---:|:---:|:---:|---|
| Vehicles list | ✓ (when DataTable has `exportable`) | — | ✓ `vehicles.csv` | |
| Drives | ✓ | ✓ (chart-by-chart) | ✓ `drives.csv` | Per-drive telemetry stays in the legacy "drives" job for now (large). |
| Charging sessions | ✓ | ✓ | ✓ `charging_sessions.csv` | Per-session telemetry stays in the legacy "charging" job. |
| Positions / GPS | — | — | ✓ `positions.csv` | Bounded by `MaxAccountRowsPerTable`. |
| Addresses | — | — | ✓ `addresses.csv` | |
| Geofences | — | — | ✓ `geofences.csv` | |
| Alerts + alert rules | ✓ | — | ✓ `alerts.csv` + `alert_rules.csv` | |
| Settings | — | — | ✓ `settings.csv` | |
| Daily mileage | ✓ | ✓ | ✓ `daily_mileage.csv` | |
| Vehicle states (FSM) | ✓ | — | ✓ `vehicle_states.csv` | |
| Software updates | ✓ | — | ✓ `software_updates.csv` | |
| Vampire drain events | ✓ | ✓ | ✓ `vampire_drain_events.csv` | |
| Signal log (history) | — | — | ✓ `signal_log.csv` (capped) | Manifest records `truncated: true` when 250k cap is hit. |
| Visited locations | — | — | ✓ `visited_locations.csv` | |
| Trips | — | — | ✓ `trips.csv` | |
| Notifications + logs | ✓ (admin page) | — | ✓ `notifications.csv` + `notification_logs.csv` | |
| Dashboard layout | — | — | — (unrelated) | Existing JSON export via `ExportModal` is layout-only. |
| Manifest | — | — | ✓ `manifest.json` | Schema version, scope, generated-at, per-table row counts + truncation flags. |

### What's intentionally out of scope

- **PNG / PDF chart export** — design-heavy; existing `useChartExport` already does PNG.
- **Recurring / scheduled exports** ("send me my drives every week") — needs job-scheduler UX.
- **Encryption-at-rest for export blobs** — uses the existing temp-file convention.
- **Server-side pagination of every DataTable just for export** — `exportAll` callback is enough for pages that need all rows; everything else exports the current sorted/filtered view.
- **Streaming the ZIP** — full account export is currently held in memory. Acceptable up to a few hundred MB of CSV; signal-log row cap keeps it bounded. Streaming is a future improvement.

## Verification checklist

1. `go test -race ./internal/export/... ./internal/database/...` — backend account-export helpers + ZIP composition.
2. `npm test -- csvExport` — RFC-4180 escaping, BOM, line endings.
3. Manual:
   - Open Drives page table → click **Download CSV** → file matches current sort/filter.
   - Open a chart with `exportData` → 3-dot menu → **Download data as CSV**.
   - `/system/data-export` → fill **Download my data** → click **Start full export** → JobProgressDrawer pops in → toast on completion → **Download** delivers a ZIP with one CSV per category + `manifest.json`.

## File map

```
internal/
  database/export_repo.go         (NEW)
  export/account.go               (NEW)
  export/types.go                 (extended)
  export/processor.go             (extended)
  api/export_handler.go           (extended)
  api/router.go                   (extended)

web/src/
  lib/csvExport.ts                (NEW)
  components/feedback/JobProgressDrawer.tsx  (NEW)
  components/feedback/index.ts    (extended barrel)
  components/ui/DataTable.tsx     (extended)
  components/charts/ChartContainer.tsx       (extended)
  api/hooks/useExports.ts         (extended)
  features/system/pages/DataExportPage.tsx   (extended — added AccountExportPanel + drawer)
  i18n/en.json                    (extended)

docs/audits/export-coverage.md    (NEW — this file)
```
