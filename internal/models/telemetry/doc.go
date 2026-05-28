// Package telemetry hosts persistence + transport DTOs for the
// Tesla-Fleet-Telemetry bounded context:
//
//   - Position — high-frequency GPS + motion sample (positions hypertable).
//   - RawTelemetrySignal — opaque raw-signal capture for debugging /
//     reprocessing (signal_log hypertable).
//   - TeslaFleetTelemetryError, TeslaFleetTelemetryErrorVIN — vendor
//     error envelopes surfaced by the Fleet Telemetry pipeline.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.19 (via `git mv` of telemetry.go +
// position.go). Recommended caller alias when importing alongside other
// models subpackages (per ADR-011 §3):
//
//	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
package telemetry
