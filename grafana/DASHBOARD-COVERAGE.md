# TeslaSync Grafana Dashboard Coverage

Source of truth for operators: repo JSON + `python scripts/sync_grafana_dashboards.py`.
Helm only ships SLO/RUM dashboards (`helm/teslasync/files/grafana/dashboards/`); everything
below lives in `grafana/dashboards/{system,infra,science}/` and is provisioned via
`grafana/provisioning/dashboards/dashboards.yml` (compose) or the sync script (production).

Conventions: queries are SI (`_m`, `_mps`, `_wh`, `_w`, `_kpa`, `°C` as stored).
Display conversion happens in panel units or the settings-backed SQL converters
(`convert_distance_m`, `convert_speed_mps`, `convert_pressure_pa`, `convert_temp`).
No `_mi/_mph/_kwh` columns in new SQL.

## Existing inventory (57 dashboards — do not clone or duplicate UIDs)

### System (`TeslaSync - System`, 41 files)

| File | UID | Title |
| ---- | --- | ----- |
| alerts-notifications.json | teslasync-alerts-notifications | Alerts & Notifications |
| anomaly-detection.json | teslasync-anomaly-detection | Anomaly Detection |
| battery-cells.json | teslasync-battery-cells | Battery Cells |
| battery-degradation.json | teslasync-battery-degradation | Battery Degradation |
| battery-health.json | teslasync-battery-health | Battery Health |
| charging-curve.json | teslasync-charging-curve | Charging Curve |
| charging-driving-correlation.json | teslasync-charging-driving | Charging vs Driving |
| charging-heatmap.json | teslasync-charging-heatmap | Charging Heatmap |
| charging-sessions.json | teslasync-charging-sessions | Charging Sessions |
| charging-stats.json | teslasync-charging-stats | Charging Analytics |
| charging.json | teslasync-charging | Charging History |
| climate-hvac.json | teslasync-climate-hvac | Climate & HVAC |
| comfort-media.json | teslasync-comfort-media | Comfort & Media |
| compare.json | teslasync-compare | Change Delta Stats |
| cost-analysis.json | teslasync-cost-analysis | Cost Analysis |
| drive-detail.json | teslasync-drive-detail | Drive Detail |
| drive-score.json | teslasync-drive-score | Drive Scores |
| drives.json | teslasync-drives | Drive History |
| drivetrain-thermal.json | teslasync-drivetrain-thermal | Drivetrain Thermal |
| driving-dynamics.json | teslasync-driving-dynamics | Driving Dynamics |
| efficiency.json | teslasync-efficiency | Driving Efficiency |
| energy-flow.json | teslasync-energy-flow | Energy Flow |
| fleet-overview.json | teslasync-fleet-overview | Fleet Overview |
| home.json | teslasync-home | Home |
| locations.json | teslasync-locations | Visited Locations |
| mileage.json | teslasync-mileage | Mileage |
| motor-performance.json | teslasync-motor-performance | Motor Performance |
| projected-range.json | teslasync-projected-range | Range Projection |
| quick-stats.json | teslasync-quick-stats | Quick Stats |
| regen-efficiency.json | teslasync-regen-efficiency | Regen Efficiency |
| route-efficiency.json | teslasync-route-efficiency | Route Efficiency |
| security-access.json | teslasync-security-access | Security & Access |
| sleep-efficiency.json | teslasync-sleep-efficiency | Sleep Efficiency |
| software-updates.json | teslasync-software-updates | Software Updates |
| speed-profile.json | teslasync-speed-profile | Speed Profile |
| statistics.json | teslasync-statistics | Monthly Statistics |
| system-health.json | teslasync-system-health | System Health |
| timeline.json | teslasync-timeline | State Timeline |
| tire-pressure.json | teslasync-tire-pressure | Tire Pressure |
| trips.json | teslasync-trips | Trip History |
| true-cost.json | teslasync-true-cost | True Cost |
| vampire-drain.json | teslasync-vampire-drain | Vampire Drain (%/hr, BatteryLevel) |
| vehicle-intelligence.json | teslasync-vehicle-intelligence | Vehicle Intelligence |
| vehicle-overview.json | teslasync-vehicle-overview | Vehicle Overview |
| weekly-digest.json | teslasync-weekly-digest | Weekly Digest |

### Infra (`TeslaSync - Infra`, 16 files)

| File | UID | Title |
| ---- | --- | ----- |
| api-performance.json | teslasync-infra-api-perf | API Performance |
| auth-deep-dive.json | teslasync-infra-auth-deep-dive | OAuth Initiation Deep-Dive |
| cep-rule-engine.json | teslasync-infra-cep | Rules Engine |
| critical-flows.json | teslasync-infra-critical-flows | Critical Flow Latency |
| db-tesla-breakdown.json | teslasync-infra-db-tesla-breakdown | DB & Tesla API Span Breakdown |
| fleet-telemetry.json | teslasync-infra-fleet-telemetry | Fleet Telemetry Server |
| infrastructure.json | teslasync-infra-health | Infrastructure Health |
| mqtt-pipeline-traces.json | teslasync-infra-mqtt-pipeline-traces | MQTT Pipeline Trace View |
| observability-self-health.json | teslasync-infra-otel-self-health | Observability Self-Health |
| service-graph.json | teslasync-infra-service-graph | Service Graph & Dependencies |
| service-red.json | teslasync-infra-service-red | Service RED |
| sessions-business.json | teslasync-infra-sessions | Sessions & Business Metrics |
| slo-burn.json | teslasync-infra-slo-burn | SLO / Error Budget Board |
| sse-realtime.json | teslasync-infra-sse | SSE & Real-Time |
| telemetry-pipeline.json | teslasync-infra-telemetry | Telemetry Pipeline |
| trace-explorer.json | teslasync-infra-trace-explorer | Trace Explorer |

### Helm-only (link, do not clone)

SLO per-endpoint boards (`slo-*.json`), `frontend-rum-overview.json`,
`frontend-synthetic-journeys.json`.

## Gap table (app domain → Grafana)

| App path / domain | Existing Grafana JSON | Gap → action |
| ----------------- | --------------------- | ------------ |
| `/day-log` day log / FSM spine | `timeline.json` (state timeline only) | **NEW** `system/day-log.json`: event counts by field/day, gap hours, caps |
| Tesla Physics cockpit (`/tesla-only/clocks`, gear) | — | **NEW** `system/physics-cockpit.json`: Gear/ChargeState/latch enums from `signal_log` |
| Physics ledger (`/tesla-only/ledger`) | — | **NEW** `system/physics-ledger.json`: Power×dt measured + aero/rolling from `signal_log`, unexplained residual, honesty text (no ledger table on branch) |
| Charge honesty (`/tesla-only/charge-port`) | `charging-curve.json` (curve only) | **NEW** `system/charge-honesty.json`: phase durations, Complete→Disconnected dwell |
| Vampire watts | `vampire-drain.json` (%/hr only) | **NEW** `system/vampire-watts.json`: watts from EnergyRemaining Wh deltas (existing file is %-based, left untouched) |
| Firmware epochs (`/tesla-only/firmware-epochs`) | `software-updates.json` (update events) | **NEW** `system/firmware-epochs.json`: efficiency/residual by Version (correlation honesty) |
| Black box 90s (`/tesla-only/black-box`) | — | **NEW** `system/black-box-90s.json`: high-rate speed/power before Park/unplug |
| Range disagreement (`/tesla-only/range`) | `projected-range.json` (projection) | **NEW** `system/range-disagreement.json`: rated/typical/ideal spread, never one true series |
| Fleet ops / utilization | `fleet-overview.json` (fleet totals) | **NEW** `system/fleet-ops.json`: reservations, assignments, cost centers from fleet tables |
| Outage autobiography | — (infra has traces) | **NEW** `system/outage-autobiography.json`: last-event-time vs broker, gaps |
| Pack capacity proxy | `battery-degradation.json` (SOH product) | **NEW** `system/pack-capacity-proxy.json`: Wh proxy + n, no SOH% |
| Site energy (solar/Powerwall) | `energy-flow.json` (vehicle flow) | **NEW** `system/site-energy.json` from `tesla_energy_history`/`tesla_energy_sites` |
| Ownership tariffs/invoices | `true-cost.json`, `cost-analysis.json` | **EXTEND in place only if needed**; new `system/ownership-cost.json` skipped — tariff tables feed cost honesty note in `site-energy`/true-cost scope (see below) |
| Charging thermal tax / interruptions | `charging-stats.json` (analytics) | **NEW** `system/charging-thermal.json`: pack temp vs power, interruption counts |
| Cabin thermal / preconditioning | `climate-hvac.json` (HVAC state) | **NEW** `system/cabin-thermal.json`: soak/cooldown τ inputs, precondition Wh |
| Science Lab (`/science`) | — | **NEW** `science/lab-inputs.json` (single board, 3 sections): electrochem brick-spread + VI sample counts, thermal/TPMS rows + Wh/km-vs-ambient, latest-session IR inputs + VI coverage. Fits/CIs stay in `GET /science/*` (code exists: `internal/api/science/`); weather + notebook are per-request (not stored) so the board states that with `SELECT 0` honesty stats instead of fake series |
| Phase-42 pipeline (infra) | `telemetry-pipeline.json`, `fleet-telemetry.json` | **NEW** `infra/phase-42-pipeline.json`: writer failures vs codec, normalize throughput, L1/L2 lag, FSM ticks |
| Frontend RUM | helm `frontend-rum-*.json` | Link only, no clone |
| Time machine / twin-lab | — | **Deferred**: no counterfactual tables on branch; no stub |
| SLOs for new APIs | helm `slo-*.json` (generated) | **NEW** `slo/catalog.yaml` entries: `physics_ledger_availability`, `science_lab_availability` (ADR-008 #6; generation stays with CI) |
| Ops home | `system/home.json` | **EXTEND**: links to new UIDs |

## Ownership-cost decision

`true-cost.json` + `cost-analysis.json` already cover measured cost. Tariff/invoice
tables (`utility_tariffs`, `charging_invoices`) are operator-configured, not
measured telemetry — a separate `ownership-cost.json` would duplicate true-cost
scope. Tariff-unknown honesty is noted in `site-energy.json` instead. No new file.
