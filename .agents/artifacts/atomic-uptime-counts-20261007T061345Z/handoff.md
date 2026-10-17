# Atomic uptime-counts SOURCE handoff

## Ownership and limits

- Branch observed: `fix/dashboard-followups`, inherited dirty shared worktree.
- Actual start: 2026-10-07T06:13:05.1106292Z.
- Hard stop: 2026-10-07T06:32:00Z, earlier than actual start plus 20 minutes.
- Repository source writes: ONLY `web\src\features\dashboard\widgets\UptimeMonitorWidget.tsx` and `UptimeMonitorWidget.test.tsx`.
- Exact preimages and SHA-256 manifest captured BEFORE editing in this artifact's `preimages` directory and `preimage-hashes.json`.
- No hook, core, catalog, backend or other repository source edits. Parent owns translation integration; exact six fallback requests are in `fallback-requests.json`.
- SOURCE PAIR RELEASED: both owned files are released to parent integration. No further source writes by this actor after the current immutable capture. No ongoing shell/server/preview was launched.

## Exact old → new band/reference detail map

| Original surface | Current surface | Preservation |
| --- | --- | --- |
| Tall, noncompact `WidgetStatGrid`, DB size and Tables | Actual existing `DashboardSourceBrief`, `dashboard-uptime-snapshot-brief`, two typed `StatMetric` entries | Same `size.rows >= 2 && size.cols > 1` eligibility; no universal wrapper or shared component edits |
| DB size text: `data?.databaseSize || '—'` | `metricId: 'text'`, occurrence `uptime-database-size-text`, raw `data?.databaseSize || null` | Nonempty server text remains verbatim; absent/empty text becomes missing `—`; never parsed or inferred as bytes |
| Tables: `data?.tableCount ?? '—'` | `metricId: 'count'`, occurrence `uptime-database-table-count`, raw `data?.tableCount` | Measured 0 remains 0; missing remains missing `—`; shared count validation handles invalid counts; not a fleet-event count |
| Detail strip without source reference | Real Brief's Review details drawer | Original two values/labels plus source descriptions, scope and provenance; no preexisting detail action removed |
| Local `state` used by shell | One `sourceTrust` from the same `useSystemHealth()` result used by shell AND Brief | Cached HTTP snapshot provenance; initial failure fatal only without data; refresh failure retains payload and marks stale; resolved absent payload explicitly unavailable, not a claimed available source |

No date/vehicle query filtering was introduced. Scope is the server-returned system-health snapshot, without complete fleet-history, uptime-duration or historical-coverage claims. Exact new visible scope:

> Server-returned system-health snapshot · no vehicle or date-range filter; not complete fleet history.

## Data, sections and action map

| Existing section/case | Current source |
| --- | --- |
| Titled WidgetShell and Activity icon | Retained unchanged |
| Overall label and All OK/Degraded/Down/Unknown classification | Retained unchanged |
| Four records: Database, MQTT, Tesla API, Fleet Telemetry | Same SERVICE_KEYS, status classification, WidgetStatusGrid, and 4-column eligibility at cols >= 3 |
| Service consecutive failures and last-error text | Same failures > 0 boundary and combined record value; nothing dropped |
| Compact layout | Same cols <= 1; healthy/total counter, overall badge, no service grid or database Brief |
| Short standard layout | Same service records, no database Brief |
| Initial loading | Same shell skeleton; children/Brief withheld |
| Initial failure | Same full-panel QueryError and retry; Brief withheld |
| Resolved absence | Same overall/unknown records and EmptyState; eligible Brief adds missing values with No source readings |
| Partial payload | Same neutral status defaults; individual metric missing states rather than zero substitution |
| Retained refresh failure | Same cached health/status records, shell warning/freshness error indicator and retry; Brief uses that identical stale state |
| Manual refresh | Existing refetch forwarded unchanged; in-flight freshness control remains guarded by shared component |
| Added Review details | Existing real shared drawer exposes count/text/source reference; not a fabricated or mocked renderer |

API/hook unchanged: `useSystemHealth()` requests `/system/health` using the existing typed `SystemHealth` response and accepts HTTP 503 bodies. No hook URL, field type, formula, service status or recovery policy changed.

## Test map — authored, NOT executed

All original test declarations and their assertions are retained. Existing numeric/unit expectations did not require change: count stays integer and database text stays text. Only the test header and zero-count explanatory comment adapt to the migrated band; `within` is added for real scoped DOM assertions.

Two new focused real-renderer cases:

1. `keeps measured zero distinct from a missing table count and preserves opaque size text in review details`
   - Actual Brief metric markers report count `value` for 0 and `missing` for an omitted count.
   - Opaque server text remains a text value, including in the actual Review details drawer.
   - Scope and no-byte-count reference are exposed; four existing OK records remain after the missing-field fixture.
   - Missing runtime payload is structurally typed with `Omit<SystemHealth, 'tableCount'>`, without new casts.
2. `shares the single health-query trust state, retains counts on refresh failure and excludes ineligible layouts`
   - Retained 0 survives the same query's refresh error, with Cached/stale provenance and Retained readings.
   - Compact 1×2 suppresses Brief and retains 4/4; short 2×1 suppresses Brief and retains four OK records.
   - Initial failure retains the full error surface, not a Brief; resolved absence renders No source readings, two em dashes and original EmptyState.

`source-metadata.json` provides exact old/current test-name arrays, retained/new cases and line counts. This is preservation/source metadata, NOT a test runner or acceptance receipt.

## Validation boundary

Performed only instruction/state/playbook reads, exact preimage/current copies and SHA-256 verification, owned-pair diff inspection, and source preservation/test-name mapping. No tests, TypeScript, lint, build, audit, browser, preview, install, commits, push or deployment executed. No nested agents. No technical or visual acceptance claimed. Consolidated validation belongs to parent after source stabilization.

Current copies and final SHA-256 values are in `current` and `current-hashes.json`; `source-pair.patch` is the exact owned-pair branch diff. Capture and release timestamp is recorded in `source-metadata.json`.
