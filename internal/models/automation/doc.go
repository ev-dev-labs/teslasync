// Package automation hosts persistence + transport DTOs for the
// automation-engine bounded context: per-execution audit history rows
// and cross-automation key-value state.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.10 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `automationmodel "internal/models/automation"`.
//
// Note: The root `Automation` type (trigger / conditions / actions CTI
// tree) already lives in internal/models/automation.go (the standalone
// file). This subpackage carve-out moves only the AutomationHistory +
// AutomationVariable DTOs out of the flat models.go grab-bag.
package automation
