# ADR-006: PostgreSQL Functions — Triage, Convert, or Move to Go

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend / Data
**Depends on:** ADR-007

---

## Context

The current schema includes **40+ PL/pgSQL functions** (migrations `000058_add_fn_anomaly_count_by_type.up.sql` through `000097_add_fn_weekly_summary.up.sql`):

- `fn_anomaly_*` (4) — anomaly detection over telemetry
- `fn_battery_*` (8) — battery degradation, cell balance, charge cycles, SOH
- `fn_charging_*` (6) — charging analytics (heatmaps, distributions, power timelines)
- `fn_drive_*` (4) — drive scoring
- `fn_driving_*` (8) — driving style, speed/efficiency distributions
- `fn_route_*`, `fn_speed_*`, `fn_sleep_*` (3)
- `fn_true_cost_*` (3) — TCO analytics
- `fn_compare_periods`, `fn_weekly_*`, `fn_regen_*` (4)

Plus three materialized views (`mv_energy_daily`, `mv_position_hourly`, `mv_signal_stats`) and the `enriched_views` family.

Problems with this concentration of logic in the database:
- **Hard to test** — pl/pgsql has no real unit test framework
- **Hard to refactor** — function signatures are coupled to caller queries; renaming requires coordinated migration + deploy
- **Hard to debug** — `RAISE NOTICE` and that's it
- **Versioning is implicit** — a function CREATE OR REPLACE is invisible in code review unless reviewers expand the migration
- **Cannot reuse outside SQL context** — Go services can't call them as native functions
- **Performance is opaque** — query plans hide inside function calls

But: some pl/pgsql logic is genuinely better in the database:
- **Pure aggregations** that map directly to SQL are usually faster as CAGGs
- **Heavy windowed analytics** that move large row sets to the application are wasteful

Triage criteria:
| Logic kind | Best home |
|---|---|
| Pure aggregation over time-series → continuous | TimescaleDB CAGG |
| One-shot rollup (daily/weekly/monthly summary) | TimescaleDB CAGG |
| Complex business logic (drive scoring, anomaly detection) | Go service |
| Simple lookup (find latest, count by category) | Go repo method (parameterized SQL) |
| Heavy data movement avoided by DB-side computation | Stay as pl/pgsql, but reviewed |

## Decision

**Triage all 40+ functions and 3 MVs. Convert hot aggregations to CAGGs. Move complex analytics to Go. Delete the rest.**

### Categorization (binding)

**Convert to Continuous Aggregates (~15 functions + 3 MVs):**
- `mv_energy_daily` → `cagg_energy_daily`
- `mv_position_hourly` → `cagg_position_hourly`
- `mv_signal_stats` → `cagg_signal_stats_hourly`
- `fn_charging_calendar_heatmap`, `fn_charging_hourly_distribution`, `fn_charging_weekday_distribution`, `fn_charging_power_timeline`
- `fn_driving_daily_breakdown`, `fn_driving_speed_distribution`, `fn_driving_acceleration_distribution`
- `fn_battery_capacity_over_time`, `fn_battery_soh_trend`, `fn_battery_charge_cycles`
- `fn_weekly_summary`, `fn_weekly_activity`
- `fn_anomaly_timeline`

These become `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` with refresh policies. Application reads them as views — no behavior change for callers.

**Move to Go services (~10 functions):**
- `fn_drive_score_breakdown`, `fn_drive_score_distribution`, `fn_drive_score_trend`, `fn_drive_scores_recent` → `internal/analytics/drive_score.go`
- `fn_anomaly_count_by_type`, `fn_anomaly_recent`, `fn_anomaly_severity_distribution` → `internal/analytics/anomaly.go`
- `fn_battery_degradation_rate`, `fn_battery_risk_factors` → `internal/analytics/battery_health.go`
- `fn_true_cost_*` (3) → `internal/analytics/tco.go`
- `fn_compare_periods` → `internal/analytics/compare.go`
- `fn_route_efficiency`, `fn_speed_profile_histogram`, `fn_sleep_efficiency` → `internal/analytics/efficiency.go`

These functions contain business logic (thresholds, scoring weights, classification rules) that belong in version-controlled, unit-tested Go code.

**Delete entirely (~15 functions):**
- `fn_battery_cell_balance`, `fn_battery_cell_readings`, `fn_battery_cell_temp_heatmap` — only used by battery cells page; can be replaced by parameterized queries in the repo. No DB function needed.
- `fn_charging_rate_vs_soc`, `fn_charging_temperature` — same; move to parameterized SQL in repo
- `fn_driving_braking_intensity`, `fn_driving_speed_vs_efficiency`, `fn_driving_style_summary`, `fn_driving_week_over_week`, `fn_driving_stats` — same
- `fn_regen_efficiency_trend` — replaced by CAGG
- `enriched_views` family — review during Phase 3; most likely become regular views, not materialized

### enriched_views handling
Per migration `000033_enriched_views.up.sql`. Each view is reviewed individually in Phase 3. Most become regular `CREATE VIEW` (no materialization) since they're cheap projections. The expensive ones become CAGGs.

## Consequences

**Positive:**
- DB schema becomes a data store, not an application platform
- Business logic is testable, reviewable, and refactorable in Go
- CAGGs auto-refresh — no cron, no manual REFRESH MATERIALIZED VIEW
- Reduced surface area for migration history (eliminates 40+ migrations from the squash baseline)
- Plan visibility improves (queries shown directly, not hidden in function bodies)

**Negative:**
- Some queries that hit a single function call now require multiple Go round trips (mitigated by Go-side query batching where it matters)
- Drive scoring / anomaly detection logic must be unit tested in Go (which is a feature, not a bug)
- One-time effort to port ~10 functions to Go (~1-2 weeks)

**Neutral:**
- CAGG refresh policies need tuning (default 1h is fine for most; some metrics need 5m)

**Risks:**
- A dashboard or alert may quietly depend on a function we delete. Mitigation: grep all dashboards (`grafana/`) and alert rules before delete; integration test in staging before prod.
- Go-side analytics may have subtle floating-point differences from pl/pgsql. Mitigation: side-by-side comparison test for ≥1 week in staging.
