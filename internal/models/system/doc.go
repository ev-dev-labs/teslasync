// Package system hosts persistence + transport DTOs for the
// system/admin bounded context.
//
// Types:
//
//   - SettingsKind, Setting — typed key-value app configuration.
//   - PollingConfig — typed Tesla-API polling cadence config.
//   - PlaceCategory, Place — user-defined geographic places.
//   - GeofenceCategory, Geofence — user-defined geofences.
//   - ElectricityCost — per-vehicle utility-rate samples.
//   - GasGrade, GasPrice — per-region gas-price samples.
//   - AuditLog — append-only system audit trail.
//   - CommandStatus, CommandExecution — async Tesla-command lifecycle
//     (includes IsTerminal() method).
//   - FSMTransition — finite-state-machine transition log.
//   - Settings — aggregate root for legacy settings I/O (export/import).
//   - Embedding — pgvector-backed semantic search records.
//   - SessionRepairKind, SessionRepairRule, SessionRepairConfidence,
//     SessionRepairEvidenceSource, SessionRepairEvidence,
//     SessionRepairSuggestion, SessionRepairReport — read-only
//     evidence-based diagnosis DTOs for the /data-repair worklist.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Recommended caller alias (per ADR-011 §3) — mandatory at any callsite
// importing alongside other model subpackages because the short name
// "system" is generic and prone to collision:
//
//	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
package system
