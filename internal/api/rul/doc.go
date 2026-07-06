// Package rul serves the Remaining Useful Life (RUL) endpoints: predictive
// component prognostics. For each wear component it estimates the remaining
// useful life (in days and km), a projected "replace-by" date, a confidence
// band, and a health status — FORECASTING end-of-life, going beyond the
// AnomalyDashboard / DrivetrainHealth surfaces which only detect issues that
// are already present.
//
// Data sources (all read-only):
//
//   - HV battery — a daily State-of-Health series reconstructed from signal_log
//     EnergyRemaining + BatteryLevel (the same SoH/capacity approach as
//     internal/api/batterydegradation; cagg_battery_daily is the sibling daily
//     roll-up but materialises State-of-Charge, not usable capacity, so the
//     SoH trend is rebuilt from the raw energy/SoC pair). A linear fit gives
//     the degradation rate; the fit's R² + history length give the confidence.
//   - Tires / brakes — distance wear from the drives odometer: km/day from
//     recent accumulation, km-since-reference from the lifetime odometer
//     (a whole-life proxy — there is no per-service reset feed).
//   - 12V battery / cabin filter — age-based from the vehicle's enrollment date
//     versus a nominal calendar life.
//
// The regression (slope + R²), rate math, EOL projection, status
// classification, and forecast-series generation are PURE, deterministic,
// table-tested functions in prognostics.go. The handler only parses/validates
// requests, reads the pgx pool, folds rows through the pure core, and writes
// snake_case JSON. The per-component service-life model is a seeded,
// admin-editable table (migrations/000218_component_lifespans) so the feature
// works self-hosted with no external service-schedule API.
//
// Layer: handler
package rul
