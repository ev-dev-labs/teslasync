// Package charging hosts persistence + transport DTOs for the
// charging-session bounded context: ChargingSession (FSM-tracked
// per-session aggregate) and ChargeTelemetryReading (per-tick
// power/SOC/voltage sample row).
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was moved out of the formerly-flat
// internal/models in phase-R5.13 (via `git mv` of charging.go).
// Recommended caller alias when importing alongside other models
// subpackages (per ADR-011 §3):
//
//	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
package charging
