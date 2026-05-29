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
// ADR-011 §3 recommends the caller alias `backupmodel` when importing
// alongside other model subpackages.
package backup
