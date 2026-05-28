// Package security hosts persistence + transport DTOs for the
// vehicle-security bounded context: per-vehicle security events
// (door open while locked, alarm triggered, sentry-mode wake, etc.).
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was moved out of the formerly-flat
// internal/models in phase-R5.16 (via `git mv` of security.go).
// Recommended caller alias when importing alongside other models
// subpackages (per ADR-011 §3):
//
//	securitymodel "github.com/ev-dev-labs/teslasync/internal/models/security"
package security
