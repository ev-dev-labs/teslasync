// Package drive hosts persistence + transport DTOs for the drive
// bounded context: Drive (FSM-tracked aggregate of a single contiguous
// trip), DriveTelemetryReading (per-tick row), and ShareToken (signed
// link granting read-only access to a specific drive).
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011, use this alias when importing alongside other models
// subpackages:
//
//	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
package drive
