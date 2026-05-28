# Phase R — Cluster Map (R1 populated, R7 pending)

> **Status:** Backend audit populated in **R1** (this commit). Frontend
> sections remain **SKELETON** awaiting R7 audit.
>
> **Source-of-truth coupling:** Every concrete target listed here MUST
> also appear in `tools/archmetrics/main.go` `plannedSubpackages` so the
> `arch-report` markdown reflects on-disk progress. When you add or
> rename a target, update both files in the same commit.
>
> **Convention:** see ADR-011 §2-§7. Backend uses Option A short
> idiomatic names with the alias suffix table; frontend uses category
> dirs.
>
> **File-count rule (ADR-011 §1):** No subpackage SHOULD exceed 50
> source files. Where an audited cluster would, we sub-split it (see
> `internal/api/ai/*` and `internal/database/automation/*` below).

## How to read each section

```
N files  total in the flat folder TODAY (matches archmetrics raw count)
+M tests breakdown of _test.go files inside the N
→ K     proposed subpackage count after restructure
P parent files that STAY in the flat parent (per ADR-011 §6:
        only doc.go / router.go / composition / Mount wiring)
```

Each subpackage row lists:

1. **Name** (proposed Go package name, short, idiomatic, no stutter).
2. **Files** (count + glob pattern).
3. **Notes** (split rationale, cross-cluster joins, risk).

---

## Backend (Go) — populated in R1

### `internal/models/` (36 files, 2 tests) — owner: **R5**

- **Files moving out of parent:** 33
- **Files staying in parent:** 3 — `doc.go`, `models.go`, `models_test.go`
- **Target subpackages: 12**
- **Composition file:** none — pure types, no registry. Parent
  `models.go` retains any cross-cluster type aliases needed for
  backwards-compatible imports during R5 ramp-up.

| Subpkg | Files | Source files |
| --- | --- | --- |
| `models/alert` | 2 | `alert.go`, `alert_test.go` |
| `models/automation` | 6 | `automation.go`, `automation_step_action.go`, `automation_step_condition.go`, `automation_step_trigger.go`, `enum_automation_steps.go`, `enum_automation_triggers.go` |
| `models/charging` | 1 | `charging.go` |
| `models/dashboard` | 4 | `dashboard_layout.go`, `chart_annotation.go`, `saved_view.go`, `pinned.go` |
| `models/drive` | 2 | `drive.go`, `trip.go` |
| `models/notification` | 9 | `notification.go`, `notification_log.go`, `notification_channel_discord.go`, `notification_channel_email_webhook.go`, `notification_channel_ntfy_pushover.go`, `notification_channel_slack_telegram.go`, `enum_notification_channels.go`, `push_subscription.go`, `quiet_hours.go` |
| `models/security` | 1 | `security.go` |
| `models/signal` | 2 | `signal.go`, `enum_signal_types.go` |
| `models/system` | 1 | `system.go` |
| `models/telemetry` | 2 | `telemetry.go`, `position.go` |
| `models/tesla` | 1 | `tesla.go` |
| `models/vehicle` | 2 | `vehicle.go`, `enum_vehicle_states.go` |

- **Aliases when callers need ≥2 model packages**
  (per ADR-011 §3): `vehiclemodel`, `drivemodel`, `chargingmodel`,
  `alertmodel`, `automationmodel`, `notificationmodel`,
  `telemetrymodel`, `signalmodel`, `securitymodel`, `systemmodel`,
  `dashboardmodel`, `teslamodel`.
- **Risk:** Models are imported by ~140 files across the repo. High
  blast radius. Mitigation: smallest-first execution (alert →
  charging → security → system → tesla → vehicle/drive/signal/
  telemetry → automation → notification → dashboard). Each cluster
  is its own commit so `git bisect` works.
- **Single-file subpkgs (`charging`, `security`, `system`, `tesla`):**
  kept separate not folded — these are distinct bounded contexts.
  Folding would re-create the very flat-folder problem ADR-011 solves.

### `internal/jobs/` (23 files, 11 tests + 1 done in R0.5) — owner: **R6**

- **Files moving out of parent:** 22 (the `embeddings/` subpkg
  already landed in R0.5 canary `5dde1443`).
- **Files staying in parent:** 1 — `doc.go` (plus a new
  `registry.go` introduced by R6 to expose `RegisterCron(s scheduler.S)`
  so `internal/app/new.go` no longer hand-wires each AI job).
- **Target subpackages: 5** (counting the canary).

| Subpkg | Files | Source files |
| --- | --- | --- |
| `jobs/embeddings` *(done R0.5)* | 3 | `doc.go`, `ttl.go`, `ttl_test.go` |
| `jobs/indexers` | 14 | `ai_charge_curve_indexer.{go,_test.go}`, `ai_docs_indexer.{go,_test.go}`, `ai_drive_indexer.{go,_test.go}`, `ai_idle_drain_indexer.{go,_test.go}`, `ai_log_trace_indexer.{go,_test.go}`, `ai_route_indexer.{go,_test.go}`, `ai_update_notes_indexer.{go,_test.go}` |
| `jobs/triage` | 4 | `ai_alert_inbox_categorizer.{go,_test.go}`, `ai_feedback_triage.{go,_test.go}` |
| `jobs/digests` | 4 | `ai_digest_weekly.{go,_test.go}`, `ai_yir_pregen.{go,_test.go}` |

- **Naming pattern:** drop the `Ai`/`Ai…Indexer` prefix per Go style.
  `jobs/indexers` exposes `RunDrive(ctx, deps) Result`,
  `RunCharge(...)`, `RunDocs(...)`, etc — caller writes
  `indexers.RunDrive(...)` not `ai.RunAiDriveIndexer(...)`.
- **ADR-015 contract preservation:** every `Run*` MUST re-check
  `ai_mode` at every tick + return `Result{} + nil` for
  `mode == "off"` without touching DB. R6 will add a single shared
  `aijobs.GateBy(settings, fn)` helper in `jobs/internal/aigate`
  (private) once the third indexer reproduces the pattern. The
  canary `embeddings.RunTTL` already follows it and stays unchanged.
- **Test:** each subpkg gets a 30-second `make test PKG=./internal/jobs/<x>/...`
  smoke run in the R6 acceptance checklist.
- **Risk:** very low. Only caller is `internal/app/new.go`. All AI
  guards are runtime contracts already centralized in
  `internal/settings`.

### `internal/handler/v1/` (12 files, 4 tests) — owner: **R3**

- **Files moving out of parent:** 9 thin-handler files + helpers.
- **Files staying in parent:** 3 — `doc.go`, new `router.go`
  (composition; calls `<subpkg>.Mount(r, deps)`), `example_thin_handler_test.go`
  (golden template kept at parent so reviewers see the canonical
  shape without descending into a subpkg).
- **Target subpackages: 8**

| Subpkg | Files | Source files | Mounts under |
| --- | --- | --- | --- |
| `handler/v1/admin` | 2 | `admin_audit_handler.go`, `admin_observability_handler.go` | `/admin` |
| `handler/v1/charging` | 1 | `charging_handler.go` | `/charging` |
| `handler/v1/dashboard` | 1 | `dashboard_handler.go` | `/dashboard` |
| `handler/v1/export` | 1 | `export_handler.go` | `/exports` |
| `handler/v1/gdpr` | 1 | `gdpr_export_handler.go` | `/gdpr` |
| `handler/v1/trip` | 1 | `trip_handler.go` | `/trips` |
| `handler/v1/user` | 1 | `user_handler.go` | `/user` |
| `handler/v1/vehicle` | 1 | `vehicle_handler.go` | `/vehicles` |
| `handler/v1/shared` | 1 | `helpers.go` | — (internal helpers) |

- **R3 is the destination shape blueprint for R2.** Once R3 ships,
  R2a-e MUST adopt these exact subpkg names — `internal/api/charging/`
  mirrors `internal/handler/v1/charging/` 1:1 so future Clean Arch
  migrations move handler↔api by symbol rename only.
- **Composition pattern locked here first:** every subpkg exports
  `func Mount(r chi.Router, deps Deps)` where `Deps` is a struct of
  port interfaces. No subpkg reaches into another's internals.

### `internal/ai/tools/` (109 files, 50 tests) — owner: **R6** *(per ADR-015 amendment)*

- **Files moving out of parent:** 99
- **Files staying in parent:** 10 — `doc.go`, `registry.go`,
  `registry_test.go`, `schema.go`, `schema_test.go`,
  `fuzz_schema_test.go`, `builtins.go`, `builtins_test.go`, `tool.go`,
  `validate.go`.
- **Target subpackages: 13**

| Subpkg | Files | Source files |
| --- | --- | --- |
| `tools/alert` | 10 | `alert_builder.{go,_test.go}`, `alert_tuning.{go,_test.go}`, `cross_rule_conflict.{go,_test.go}`, `inbox_auto_categorization.{go,_test.go}`, `quiet_hours_suggestion.{go,_test.go}` |
| `tools/automation` | 4 | `automation_builder.{go,_test.go}`, `suggest_new_geofences.{go,_test.go}` |
| `tools/battery` | 9 | `battery_health_forecast.{go,_test.go}`, `vampire_drain_explanation.{go,_test.go}`, `range_predictor.{go,_test.go}`, `learned_anomaly_baseline.{go,_test.go}`, `anomaly.{go,_test.go}` |
| `tools/charging` | 10 | `charge_curve_clustering.{go,_test.go}`, `charge_curve_clusters.{go,_test.go}`, `charging_diagnosis.{go,_test.go}`, `smart_charge_schedule_suggestion.{go,_test.go}`, `preheat_precool_recommender.{go,_test.go}` |
| `tools/diagnostics` | 15 | `log_trace_summarizer.{go,_test.go}`, `mqtt_sse_inspector_explanations.{go,_test.go}`, `state_machine_debugger_narrator.{go,_test.go}`, `incident_timeline_summarizer.{go,_test.go}`, `data_repair_suggestions.{go,_test.go}`, `software_update_summary.{go,_test.go}`, `predictive_maintenance.{go,_test.go}`, `tire_pressure_trend.go` |
| `tools/drive` | 12 | `drive_coaching.{go,_test.go}`, `drive_search.{go,_test.go}`, `speed_profile.{go,_test.go}`, `route_efficiency.{go,_test.go}`, `auto_trip_naming.{go,_test.go}`, `trip_planner_llm_agent.{go,_test.go}` |
| `tools/feedback` | 2 | `feedback_queue_triage.{go,_test.go}` |
| `tools/forecast` | 6 | `cost_forecast.{go,_test.go}`, `period_compare.{go,_test.go}`, `temperature_impact.{go,_test.go}` |
| `tools/location` | 2 | `auto_name_unnamed_locations.{go,_test.go}` |
| `tools/nl` | 8 | `nl_dashboard_composer.go`, `nl_grafana_panel.go`, `nl_sql_playground.go`, `signal_explorer_nl_filter.{go,_test.go}`, `watch_face_nl_response.{go,_test.go}`, `voice_mode.go` |
| `tools/safety` | 2 | `safety_setting_explainer.{go,_test.go}` |
| `tools/share` | 6 | `share_card_image.{go,_test.go}`, `paint_preview.{go,_test.go}`, `export_redaction_plan.{go,_test.go}` |
| `tools/summary` | 12 | `digest.{go,_test.go}`, `lifetime_stats_qa.{go,_test.go}`, `tco_summary.{go,_test.go}`, `year_review.{go,_test.go}`, `help.{go,_test.go}`, `search.{go,_test.go}` |

- **Naming pattern:** each subpkg is a *domain* of AI capability,
  not a 1-tool-per-pkg explosion. `tools/charging` owns 5 distinct
  AI tools (smart-schedule, curve-clustering, preheat, diagnosis,
  curve-buckets) — they share charging-context types and tests.
- **Parent (`internal/ai/tools/`) responsibility per ADR-015
  amendment §I12:** `registry.go` continues to be THE tool
  registration surface — every subpkg's `init()` calls
  `tools.Register(name, schema, handler)`. Schema validation
  (`schema.go`, `validate.go`, `fuzz_schema_test.go`) stays at
  parent because it's the shared contract.
- **AI guard preservation gate (ADR-015 amendment §G3):** the move
  is **pure file relocation**. No `Register` call body changes. No
  handler signature changes. `make ai-vet` MUST be green after
  every subpkg commit. The R6 acceptance checklist runs:
  ```
  ./scripts/check_ai_registry_count.sh  # expect 99 tools
  go test ./internal/ai/... -run TestAIGuard -count=2
  ```
- **Risk:** medium. Registry is `init()`-driven so import-side-effect
  semantics must be preserved — the composition root MUST blank-import
  each new subpkg: `_ "internal/ai/tools/charging"`. R6 adds an
  `internal/ai/tools/all/all.go` (`package all` re-importing every
  subpkg) so callers blank-import one path.

### `internal/database/` (143 files, 35 tests) — owner: **R4**

- **Files moving out of parent:** 124
- **Files staying in parent:** 19 — `doc.go`, `database.go`,
  `database_test.go`, `database_tracing_test.go`, `cache.go`,
  `cache_test.go`, `circuit_breaker.go`, `circuit_breaker_test.go`,
  `from_map.go`, `helpers.go`, `helpers_test.go`, `maintenance.go`,
  `migrate.go`, `mongodb.go`, `query_budget_tracer.go`,
  `query_budget_tracer_test.go`, `retry.go`, `retry_test.go`,
  `write_buffer.go`, `write_buffer_test.go`, `schema_test.go`.
  *(All of these become `internal/database/shared/` candidates in a
  follow-up R4.1 if growth continues. R4 v1 keeps them at parent so
  the `*database.DB` struct definition stays alongside connection
  helpers — sole exception to ADR-011 §6.)*
- **Target subpackages: 21**

| Subpkg | Files | Source files (matched by prefix) |
| --- | --- | --- |
| `database/achievement` | 1 | `achievement_unlock_repo.go` |
| `database/ai` | 4 | `ai_call_log_repo.{go,_test.go}`, `ai_chat_continuations_repo.{go,_test.go}` |
| `database/alert` | 6 | `alert_repo.{go,_test.go}`, `alert_repo_test_helpers_test.go`, `alert_rule_state_repo.{go,_test.go}`, `alert_rule_state_repo_integration_test.go` |
| `database/audit` | 3 | `audit_repo.go`, `audit_log_query_repo.go`, `api_call_log_repo.go` |
| `database/auth` | 10 | `auth_sessions_repo.{go,_test.go}`, `auth_subjects_repo.{go,_test.go}`, `role_permissions_repo.{go,_test.go}`, `sudo_token_repo.go`, `token_repo.go`, `totp_repo.{go,_test.go}` |
| `database/automation` | 11 | `automation_repo.go`, `automation_repo_bulk.go`, `automation_repo_mutation.go`, `automation_repo_query.go`, `automation_history_repo.{go,_test.go}`, `automation_step_repo.go`, `automation_step_child_repo.go`, `automation_step_child_repo_persistence.go`, `automation_step_child_repo_query.go`, `automation_variable_repo.go` |
| `database/backup` | 2 | `backup_config_repo.go`, `backup_run_repo.go` |
| `database/charging` | 2 | `charging_repo.go`, `charge_plan_repo.go` |
| `database/dashboard` | 4 | `dashboard_layout_repo.go`, `chart_annotation_repo.go`, `saved_views_repo.go`, `pinned_repo.go` |
| `database/drive` | 9 | `drive_repo.{go,_backfill_test.go}`, `drive_diagnostic_repo.go`, `mileage_repo.{go,_test.go}`, `vampire_drain_repo.{go,_test.go}`, `trip_repo.go`, `trips_detail_repo.{go,_test.go}` |
| `database/energy` | 1 | `energy_repo.go` |
| `database/export` | 6 | `export_repo.go`, `export_job_repo.go`, `export_job_repo_bulk.go`, `scheduled_export_repo.{go,_test.go}`, `gdpr_artifact_repo.go` |
| `database/feedback` | 2 | `user_feedback_repo.{go,_test.go}` |
| `database/geo` | 4 | `geofence_repo.go`, `geofence_repo_bulk.go`, `places_cache_repo.go`, `visited_location_repo.go` |
| `database/ingest` | 4 | `dlq_replay_audit_repo.go`, `ingest_xray_repo.go`, `raw_telemetry_repo.go`, `fsm_transition_repo.go` |
| `database/notification` | 7 | `notification_channel_repo.go`, `notification_repo.{go,_test.go}`, `notification_schedule_repo.go`, `push_subscriptions_repo.go`, `quiet_hours_repo.{go,_test.go}` |
| `database/onboarding` | 2 | `onboarding_repo.go`, `guard_repo.{go,_test.go}` *(guard rails for onboarding flow)* — **CHECK in R4 audit pass** whether `guard_repo` belongs to `auth/` instead |
| `database/settings` | 9 | `settings_repo.go`, `settings_reset.{go,_test.go}`, `settings_serializer.go`, `share_token_repo.go`, `vehicle_settings_repo.{go,_test.go}`, `vehicle_settings_resolver.go` |
| `database/signal` | 8 | `signal_catalog.go`, `signal_history_writer.go`, `signal_log_reader.go`, `signal_log_reader_aggregations.go`, `signal_log_reader_query.go`, `signal_log_repo.go`, `signals_catalog_repo.{go,_test.go}` |
| `database/system` | 9 | `status_incidents_repo.go`, `slow_queries_repo.go`, `hypertable_metrics_repo.go`, `software_update_repo.{go,_test.go}`, `feature_flag_changes_repo.go`, `worker_status_repo.go`, `worker_status_queue_repo.go`, `system_state_repo.{go,_test.go}` |
| `database/tesla` | 10 | `tesla_charging_history_repo.go`, `tesla_charging_session_repo.go`, `tesla_energy_history_repo.go`, `tesla_energy_live_status_repo.go`, `tesla_energy_site_repo.go`, `tesla_fleet_telemetry_error_repo.go`, `tesla_user_config_repo.go`, `tesla_user_order_repo.go`, `tesla_user_profile_repo.go`, `tesla_vehicle_driver_repo.go` |
| `database/vehicle` | 6 | `vehicle_repo.go`, `vehicle_cost_repo.go`, `vehicle_photo_repo.go`, `vehicle_states_repo.{go,_test.go}`, `position_repo.go` |

- **Heaviest subpkg:** `database/automation` at 11 files — below the
  ADR-011 §1 50-file ceiling but worth watching during R4 — if
  `automation_repo_query.go` grows we sub-split into
  `automation/core` + `automation/history` + `automation/steps`.
- **Cross-cluster joins that need decision:**
  - `position_repo` lives under `vehicle/` (current state + position)
    not `telemetry/`. Rationale: position is queried via
    `vehicleRepo.GetCurrent(...)` in 12 callers vs. 2 in telemetry.
    If R4 audit shows otherwise, flip.
  - `fsm_transition_repo` lives under `ingest/` (it's an audit trail
    written during the MQTT pipeline). Could alternatively be
    `database/state/`. R4 decision: keep with `ingest` for now;
    revisit if `fsm_transition` becomes a query surface.
- **Composition file:** `internal/database/database.go` stays as the
  `*DB` aggregate struct. Each subpkg exposes a constructor
  `New(pool *pgxpool.Pool) *Repo`. The `database.DB` aggregate
  holds one field per subpkg-Repo and the constructor wires them.
  This preserves the existing `database.DB{}.VehicleRepo.Get(...)`
  call sites verbatim — only the **field type** changes from
  `*database.VehicleRepo` to `*vehicledb.Repo`.
- **Risk:** the double-touch budget per rubber-duck #3. ~140
  `internal/api/*` files will need 1-2 import line updates each.
  Mitigated by smallest-first ordering (achievement → energy →
  backup → onboarding → feedback → audit → ai → dashboard → charging
  → geo → ingest → settings → notification → alert → drive →
  signal → system → vehicle → automation → tesla → auth) and the
  `tools/migration-snapshots/` harness from R2.0.
- **Aliases at multi-import sites (ADR-011 §3 table):**
  `vehicledb`, `chargingdb`, `drivedb`, `automationdb`, `alertdb`,
  `notificationdb`, `signaldb`, `telemetrydb` *(parent legacy)*,
  `auditdb`, `authdb`, `settingsdb`, `exportdb`, `geodb`, `ingestdb`,
  `systemdb`, `tesladb`, `aidb`, `dashboarddb`, `energydb`,
  `feedbackdb`, `onboardingdb`, `backupdb`, `achievementdb`.

### `internal/api/` (434 files, 163 tests) — owner: **R2** *(split R2a–R2e)*

- **Files moving out of parent:** ~390
- **Files staying in parent:** ~44 — `doc.go`, `router.go`,
  `router_middleware.go`, `router_routes_admin.go`,
  `router_routes_telemetry.go`, `ai_routes.go`, `helpers.go`,
  `helpers_extra_test.go`, `errors.go`, `safe.go`, `converters.go`,
  `metrics.go`, `security.go`, `security_validation_test.go`,
  `api_test.go`, `handlers_test.go`, `acceptance_test.go` + the
  *middleware set* (decided in R2a):
  `middleware.go`, `middleware_test.go`, `middleware_extra_test.go`,
  `middleware_metrics_test.go`, `forward_auth_middleware.go`,
  `sudo_middleware.go`, `sudo_middleware_test.go`,
  `api_call_log_middleware.go`, `api_call_log_middleware_test.go`,
  `apikey_middleware.go`. *(After R2e the middleware set graduates
  to `internal/api/middleware/` and parent drops to ~7 files —
  doc, router, the 3 route maps, ai_routes, safe.)*
- **Target subpackages: 28** (incl. 4 shared infra subpkgs from
  R2.0 PREP)

#### R2.0 PREP shared subpackages (extract BEFORE R2a–R2e)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/httpx` | 5 | `helpers.go` (split: writeJSON/writeError/decode + their test); `errors.go`; `converters.go`; `safe.go` (HTML safety); `security.go` (response security headers helpers) |
| `api/apiparams` | 1 | New extraction: pagination/sort/filter param parsing. Today scattered across `analytics_handler*.go`, `drive_handler_listing.go`, etc. — extract the duplicated `parseLimitOffset`, `parseTimeRange`, `parseSortDir` helpers. |
| `api/apitest` | 4 | `api_test.go`, `handlers_test.go`, `acceptance_test.go`, `security_validation_test.go` — generic `setupTestRouter`, `doRequest`, `assertStatus` helpers, fixture loaders |
| `api/middleware` | 10 | the 10 middleware files listed above |

#### R2a — shared + system + admin-lite + SSE (~24 files)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/system` | 8 | `system_handler.{go,_test.go}`, `status_v1_handler.{go,_test.go}`, `status_incidents_handler.go`, `system_auth_mode_handler.{go,_test.go}`, `slo_handler.go` |
| `api/health` | 2 | `health.go`, `health_test.go` |
| `api/sse` | 2 | `sse_handler.go`, `sse_handler_tracing_test.go` |
| `api/openapi` | 1 | `openapi_handler.go` |
| `api/devtools` | 5 | `devtools_handler.{go,_test.go}`, `devtools_handler_database.go`, `devtools_handler_dtos.go`, `devtools_handler_logs.go` |
| `api/observability` | 6 | `admin_log_stream_handler.{go,_test.go}`, `admin_observability_handler.go` *(moves from `internal/handler/v1/` is NOT happening — that's a separate ADR-009 exception handler — stays at `handler/v1/admin`)*, `metrics.go` *(stays at parent for now — handler middleware metric collectors)*, `error_tracker.{go,_test.go}`, `fleet_telemetry_error_handler.go` |

#### R2b — read-only resource handlers (~62 files)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/analytics` | 8 | `analytics_handler.{go,_test.go}`, `analytics_handler_dtos.go`, `analytics_handler_queries.go`, `period_stats_handler.go`, `range_projection_handler.{go,_test.go}`, `range_projection_handler_compute.go`, `range_projection_handler_dtos.go` |
| `api/anomaly` | 2 | `anomaly_handler.{go,_test.go}` |
| `api/lifetime` | 2 | `lifetime_handler.{go,_test.go}` |
| `api/mileage` | 2 | `mileage_handler.{go,_test.go}` |
| `api/sleep` | 1 | `sleep_handler.go` |
| `api/regen` | 1 | `regen_handler.go` |
| `api/vampiredrain` | 2 | `vampire_drain_handler.{go,_test.go}` |
| `api/tco` | 3 | `tco_handler.go`, `tco_summary.go`, `tco_summary_test.go` |
| `api/tempimpact` | 1 | `temp_impact_handler.go` |
| `api/speed` | 1 | `speed_profile_handler.go` |
| `api/routeeff` | 1 | `route_efficiency_handler.go` |
| `api/signal` | 4 | `signal_handler.{go,_test.go}`, `signals_catalog_handler.{go,_test.go}`, `signals.go` |
| `api/dataquality` | 1 | `dataquality_handler.go` |
| `api/fsm` | 3 | `fsm_handler.go`, `fsm_handler_query.go`, `fsm_handler_dtos.go` |
| `api/search` | 2 | `search_handler.{go,_test.go}` |
| `api/diagnostic` | 2 | `diagnostic_handler.{go,_test.go}` |
| `api/cost` | 1 | `cost_forecast_handler.go` |

#### R2c — core writes: vehicle/charging/drive/trip/telemetry (~95 files)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/vehicle` | 14 | `vehicle_handler.{go,_test.go}`, `vehicle_config_handler.{go,_test.go}`, `vehicle_info_handler.go`, `vehicle_states_handler.{go,_test.go}`, `vehicle_access_handler.go`, `vehicle_photo_handler.{go,_test.go}`, `vehicle_settings_handler.{go,_test.go}`, `command_handler.go`, `polling_handler.go` |
| `api/vehiclesys` | 16 | `battery_handler.{go,_test.go}`, `battery_cells_handler.{go,_test.go}`, `battery_degradation_handler.{go,_test.go}`, `battery_degradation_handler_calculations.go`, `battery_degradation_handler_dtos.go`, `motor_handler.{go,_test.go}`, `tire_pressure_handler.{go,_test.go}`, `climate_handler.{go,_test.go}`, `media_handler.{go,_test.go}`, `drivetrain_health_handler.{go,_test.go}` |
| `api/charging` | 14 | `charging_handler.{go,_test.go}`, `charging_bulk_handler.go`, `charging_heatmap_handler.go`, `charging_telemetry_handler.{go,_test.go}`, `charge_planner_handler.{go,_test.go}`, `charge_planner_handler_compute.go`, `charge_planner_handler_dtos.go`, `charging_optimizer_handler.go`, `charging_optimizer_handler_compute.go`, `charging_optimizer_handler_dtos.go` |
| `api/drive` | 10 | `drive_handler.go`, `drive_handler_listing.go`, `drive_handler_detail.{go,_test.go}`, `drive_diagnostic_handler.{go,_test.go}`, `drive_dynamics_handler.{go,_test.go}`, `drives_bulk_handler.go`, `driving_coach_handler.go` |
| `api/trip` | 7 | `trip_handler.go`, `trip_planner_handler.{go,_test.go}`, `trip_planner_handler_compute.go`, `trip_planner_handler_dtos.go`, `trips_detail_handler.{go,_test.go}` |
| `api/telemetry` | 16 | `telemetry_handler.{go,_test.go}`, `telemetry_handler_capture.go`, `telemetry_handler_ingest.go`, `telemetry_handler_wiring.go`, `telemetry_handler_integration_test.go`, `telemetry_alerts.go`, `telemetry_sessions.{go,_test.go}`, `telemetry_sessions_charge_tracking.{go,_test.go}`, `telemetry_sessions_drive_tracking.{go,_test.go}`, `telemetry_sessions_flush_backfill.go`, `telemetry_sessions_recovery.{go,_test.go}`, `telemetry_sessions_signal_helpers.go` |
| `api/fleet` | 4 | `fleet_telemetry_handler.{go,_test.go}`, `fleet_telemetry_error_handler.go` *(if not absorbed into R2a observability)* |
| `api/energy` | 4 | `energy_handler.go`, `energy_flow_handler.{go,_test.go}`, `energy_site_handler.go` |
| `api/teslaapi` | 10 | `tesla_charging_history_handler.go`, `tesla_charging_session_handler.go`, `tesla_energy_history_handler.go`, `tesla_energy_history_handler_dtos.go`, `tesla_energy_history_handler_query.go`, `tesla_energy_live_status_handler.go`, `tesla_user_config_handler.go`, `tesla_user_order_handler.go`, `tesla_user_profile_handler.go`. *(Tesla-vendor-specific REST passthrough; uses `tesla` prefix in URL.)* |

#### R2d — cross-cutting: AI + admin + automation + alert + notification (~158 files)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/ai` *(parent of 14 AI sub-subpkgs)* | 1 | `ai_routes.go` becomes `api/ai/router.go` mounting each AI subpkg's `Mount(r, deps)` |
| `api/ai/internal` | 1 | `ai_internal_handler.go` *(admin-only AI ops)* |
| `api/ai/usage` | 2 | `ai_usage_handler.{go,_test.go}` |
| `api/ai/alert` | 12 | `ai_alert_handler.{go,_test.go}`, `ai_alert_tuning_handler.{go,_test.go}`, `ai_anomaly_handler.{go,_test.go}`, `ai_cross_rule_conflict_handler.{go,_test.go}`, `ai_quiet_hours_suggestion_handler.{go,_test.go}`, `ai_inbox_categorization_handler.{go,_test.go}` |
| `api/ai/automation` | 6 | `ai_automation_handler.{go,_test.go}`, `ai_geofence_aware_automation_handler.{go,_test.go}`, `ai_suggest_new_geofences_handler.{go,_test.go}` |
| `api/ai/battery` | 10 | `ai_battery_health_handler.{go,_test.go}`, `ai_ml_anomaly_baseline_handler.{go,_test.go}`, `ai_ml_anomaly_safe_ranges_parity_test.go`, `ai_ml_range_handler.{go,_test.go}`, `ai_ml_range_fallback_parity_test.go`, `ai_vampire_drain_handler.{go,_test.go}` |
| `api/ai/charging` | 10 | `ai_charging_curve_clustering_handler.{go,_test.go}`, `ai_charging_diagnosis_handler.{go,_test.go}`, `ai_climate_schedule_handler.{go,_test.go}`, `ai_smart_charge_schedule_handler.{go,_test.go}`, `ai_ml_charging_curve_handler.{go,_test.go}`, `ai_ml_charging_curve_parity_test.go` |
| `api/ai/diagnostics` | 16 | `ai_data_repair_handler.{go,_test.go}`, `ai_incident_timeline_summarizer_handler.{go,_test.go}`, `ai_log_trace_summarization_handler.{go,_test.go}`, `ai_mqtt_sse_inspector_explanations_handler.{go,_test.go}`, `ai_predictive_maintenance_handler.{go,_test.go}`, `ai_software_update_changelog_summarizer_handler.{go,_test.go}`, `ai_state_machine_debugger_narrator_handler.{go,_test.go}`, `ai_tire_pressure_trend_handler.{go,_test.go}` |
| `api/ai/drive` | 12 | `ai_drive_coach_handler.{go,_test.go}`, `ai_drive_search_handler.{go,_test.go}`, `ai_drive_search_hydrator.go`, `ai_route_efficiency_handler.{go,_test.go}`, `ai_speed_profile_handler.{go,_test.go}`, `ai_temperature_impact_handler.{go,_test.go}`, `ai_trip_planner_llm_handler.{go,_test.go}` |
| `api/ai/forecast` | 8 | `ai_cost_forecast_narration_handler.{go,_test.go}`, `ai_period_compare_narration_handler.{go,_test.go}`, `ai_tco_narration_handler.{go,_test.go}`, `ai_lifetime_stats_qa_handler.{go,_test.go}` |
| `api/ai/share` | 6 | `ai_pii_redaction_shared_exports_handler.{go,_test.go}`, `ai_trip_postcard_share_card_image_handler.{go,_test.go}`, `ai_vehicle_paint_preview_handler.{go,_test.go}` |
| `api/ai/summary` | 12 | `ai_year_review_handler.{go,_test.go}`, `ai_digest_handler.{go,_test.go}`, `ai_feedback_triage_handler.{go,_test.go}`, `ai_rag_help_handler.{go,_test.go}`, `ai_search_handler.{go,_test.go}`, `ai_search_hydrator.go` |
| `api/ai/nl` | 10 | `ai_chatbot_handler.{go,_test.go}`, `ai_nl_dashboard_composer_handler.{go,_test.go}`, `ai_nl_grafana_panel_handler.{go,_test.go}`, `ai_nl_sql_playground_handler.{go,_test.go}`, `ai_signal_explorer_nl_filter_handler.{go,_test.go}`, `ai_voice_mode_handler.{go,_test.go}`, `ai_watch_face_nl_response_handler.{go,_test.go}` |
| `api/ai/safety` | 6 | `ai_safety_setting_explainer_handler.{go,_test.go}`, `ai_admin_handler.{go,_test.go}`, `ai_settings_validate_handler.{go,_test.go}` |
| `api/ai/location` | 4 | `ai_auto_name_unnamed_locations_handler.{go,_test.go}`, `ai_auto_trip_name_handler.{go,_test.go}` |
| `api/admin` | 14 | `admin_feedback_handler.{go,_test.go}`, `admin_maintenance_handler.{go,_test.go}`, `flags_handler.{go,_test.go}`, `dlq_handler.{go,_test.go}`, `impersonate_handler.{go,_test.go}`, `rate_limit_handler.{go,_test.go}`, `synthetic_handler.go`, `queue_status_handler.{go,_test.go}` |
| `api/automation` | 13 | `automation_handler.{go,_test.go}`, `automation_handler_crud.go`, `automation_handler_decode.go`, `automation_handler_dtos.go`, `automation_handler_history.go`, `automation_handler_step_parsers.go`, `automation_handler_test_run.go`, `automation_events.go`, `automation_mqtt_reloader.go`, `automations_bulk_handler.go`, `rule_engine.{go,_test.go}`, `computed_metrics.go`, `computed_metric_evaluator.go` |
| `api/alert` | 11 | `alert_handler.{go,_test.go}`, `alert_handler_dtos.go`, `alert_handler_multivehicle_test.go`, `alert_handler_rules.go`, `alert_message_handler.go`, `alerts_handler.{go,_test.go}`, `alerts_bulk_handler.go`, `chart_annotation_handler.{go,_test.go}` |
| `api/notification` | 9 | `notification_handler.{go,_test.go}`, `notification_channel_handler.{go,_test.go}`, `notification_schedule_handler.go`, `push_handler.{go,_test.go}`, `quiet_hours_handler.{go,_test.go}`, `weekly_digest_handler.go` |
| `api/chatbot` | 6 | `chatbot_handler.{go,_test.go}`, `chatbot_handler_chat.go`, `chatbot_handler_dtos.go`, `chatbot_responder.go`, `year_review_handler.go` |
| `api/feedback` | 2 | `feedback_handler.{go,_test.go}` |
| `api/data_repair` | 1 | `data_repair_handler.go` |
| `api/dashboard` | 3 | `dashboard_layout_handler.{go,_test.go}`, `pinned_handler.{go,_test.go}` |
| `api/saved_views` | 2 | `saved_views_handler.{go,_test.go}` |

#### R2e — final cleanup + auth + ingest + share + exports + settings + bulk (~36 files)

| Subpkg | Files | Source files |
| --- | --- | --- |
| `api/auth` | 11 | `auth_handler.go`, `auth_session_handler.{go,_test.go}`, `apikey_handler.go`, `totp_handler.{go,_test.go}`, `rbac_handler.{go,_test.go}`, `session_handler.{go,_test.go}`, `user_preference_handler.{go,_test.go}` |
| `api/onboarding` | 2 | `onboarding_handler.{go,_test.go}` |
| `api/user` | 2 | `user_handler.go`, `guard_handler.{go,_test.go}` |
| `api/settings` | 7 | `settings_handler.go`, `settings_export_handler.{go,_test.go}`, `settings_import_handler.{go,_test.go}`, `settings_reset_handler.{go,_test.go}` |
| `api/share` | 1 | `share_handler.go` |
| `api/exports` | 5 | `export_handler.go`, `exports_bulk_handler.go`, `exports_columns_handler.{go,_test.go}`, `scheduled_exports_handler.{go,_test.go}` |
| `api/ingest` | 4 | `ingest_xray_handler.{go,_test.go}`, `import_handler.go`, `backup_handler.go`, `backup_restore_handler.go` |
| `api/geo` | 6 | `geofence_handler.{go,_test.go}`, `geofences_bulk_handler.go`, `visited_location_handler.go`, `location_snapshot_handler.{go,_test.go}`, `geocode_handler.go`, `gas_price_handler.go` |
| `api/safety` | 3 | `safety_handler.{go,_test.go}`, `security_handler.{go,_test.go}` |
| `api/bulk` | 3 | `bulk_helpers.go`, `bulk_handlers_test.go`, `bulk_handlers_phase45_test.go` *(or fold into individual subpkgs)* |
| `api/api_call_log` | 1 | `api_call_log_handler.go` *(or fold into `audit/`)* |
| `api/audit` | 3 | `audit_handler.go`, `audit.go`, `audit_test.go` |
| `api/maintenance` | 1 | `maintenance_handler.go` |
| `api/software_update` | 1 | `software_update_handler.go` |
| `api/watch` | 1 | `watch_handler.go` |
| `api/webhook` | 4 | `webhook_handler.go`, `webhook_receiver_handler.{go,_test.go}`, `web_errors_handler.{go,_test.go}` |
| `api/webvitals` | 2 | `web_vitals_handler.{go,_test.go}` |

- **Routing composition (R2.0 PREP enabling all waves):** `router.go`
  becomes 100% mount calls. Today's `router_routes_admin.go` and
  `router_routes_telemetry.go` get folded into the relevant
  subpkg's `Mount` — they exist today only because router.go was
  unmanageably long.
- **`ai_routes.go`** stays at parent ONLY until R2d, when it
  migrates to `api/ai/router.go` and the parent's `router.go`
  switches to calling `ai.Mount(r, deps)`. Per ADR-015 amendment,
  the AI sub-tree gets one composition file because the AI router
  has special middleware ordering (AI guard MUST wrap every AI
  handler — see `internal/api/ai/router.go.Mount` contract).
- **Heaviest planned subpkg:** `api/telemetry` at 16 files — well
  under the 50-file ceiling. `api/ai/diagnostics` at 16 also fine.
- **Single-file subpkgs (`api/sleep`, `api/regen`, `api/share`,
  `api/cost`, etc.):** kept distinct rather than folded because each
  represents a top-level URL route and reviewers should be able to
  find a handler by URL prefix alone. Folding would re-create the
  flat-folder problem.
- **Risk per ADR-015 amendment §G3 (AI guard preservation):** R2d
  has its own gate — every AI subpkg's `Mount` MUST invoke the
  shared `aiguard.Wrap(handler)` decorator. R2d acceptance script:
  ```
  go test ./internal/api/ai/... -run TestAIGuardWrapped -count=2
  ./scripts/check_ai_routes_count.sh  # expect 94 AI routes
  ```

---

## Frontend (TS/React) — populated in R7

### `web/src/lib/` (104 files) — owner: **R11**

- **Target subdirs:** _TBD per R7 audit; candidates include `format/`,
  `geo/`, `dom/`, `calc/`, `data/`, `broadcast/`, `automation/`,
  `ui/`, `csv/`, `time/`, `string/`, `validation/`._
- **Public-entrypoint pattern:** allow direct imports from
  `@/lib/format/date`, `@/lib/geo/distance`, etc. NO barrel
  required (per rubber-duck #14; barrels strict only for
  `components/*`).
- **Risk notes:** Leaf dep for hooks AND widgets. Moved EARLIEST
  in the frontend sequence to avoid double-touching downstream.

### `web/src/hooks/` (64 files) — owner: **R10**

- **Target subdirs:** _TBD per R7 audit; candidates include `ui/`,
  `data/`, `browser/`, `lifecycle/`, `formatting/`, `behavior/`._
- **Public-entrypoint pattern:** direct imports from
  `@/hooks/ui/useBreadcrumbs` etc. (same as `lib`).
- **Risk notes:** Depends on `lib/` (move after R11).

### `web/src/api/hooks/` (67 files) — owner: **R8**

- **Target subdirs:** Mirror the backend bounded contexts from R4
  (each `useXxx.ts` lives in the subdir matching its
  `internal/database/<x>/`).
- **Public-entrypoint pattern:** direct imports from
  `@/api/hooks/charging/useCharging`.
- **Risk notes:** Depends on `lib/` (R11) AND on knowing the
  backend's `internal/database/` subpkg names (R4). Move after both.

### `web/src/features/dashboard/widgets/` (121 files) — owner: **R9**

- **Target subdirs:** _TBD per R7 audit; candidates include_
  `battery/`, `charging/`, `climate/`, `drive/`, `energy/`,
  `automation/`, `ai/`, `security/`, `vehicles/`, `alerts/`,
  `system/`, `misc/`.
- **Existing `widgets/registry/` subdirectory** stays as-is.
- **Public-entrypoint pattern:** widgets re-exported from
  `features/dashboard/widgets/index.ts` barrel.
- **Risk notes:** Imports from lib/hooks/api/hooks heavily. Move
  after R11/R10/R8.

### `web/src/components/ai/` (61 files) — owner: **R12** *(per ADR-015 amendment)*

- **Target subdirs:** _TBD per R7 audit; per-AI-feature subdirs._
- **Public-entrypoint pattern:** strict barrel
  `components/ai/index.ts` (per rubber-duck #14 — barrels strict
  for components).
- **Risk notes:** ADR-015-amendment scope. AI guard wrapping
  preserved.

### `web/src/components/feedback/` (62 files) — owner: **R12**

- **Target subdirs:** _TBD per R7 audit; candidates `loading/`,
  `error/`, `empty/`, `alerts/`, `prompts/`._
- **Public-entrypoint pattern:** strict barrel
  `components/feedback/index.ts`.

### `web/src/components/data-display/` (46 files) — owner: **R12**

- **Target subdirs:** _TBD per R7 audit; candidates `metrics/`,
  `cards/`, `tables/`, `lists/`, `timeline/`, `badges/`._
- **Public-entrypoint pattern:** strict barrel
  `components/data-display/index.ts`.

## Acceptance criteria for this document

This map is fleshed out as R1/R7 progress. By end of R7 every
"_TBD per R7 audit_" placeholder above MUST be replaced with a
concrete file-to-subpackage mapping, with each subpackage's file
count noted.

Per ADR-011 §1, no subpackage SHOULD exceed 50 files. If the audit
shows a candidate cluster > 50 files, sub-split it.
