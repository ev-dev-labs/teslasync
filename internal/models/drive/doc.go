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
// Per ADR-011 this package was moved out of the formerly-flat
// internal/models in phase-R5.14 (via `git mv` of drive.go).
// Recommended caller alias when importing alongside other models
// subpackages (per ADR-011 §3):
//
//	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
package drive
