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
// ADR-011 §3 recommends this caller alias when importing alongside other
// model subpackages:
//
//	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
package charging
