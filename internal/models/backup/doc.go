// Package backup hosts persistence + transport DTOs for the
// backup/restore bounded context: backup schedule configurations
// and backup/restore execution records.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.3 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `backupmodel "internal/models/backup"`.
package backup
