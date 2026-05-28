// Package alert hosts persistence + transport DTOs for the alert
// bounded context: rule configuration and the per-alert audit
// timeline of notification log events.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api. Imports of stdlib + internal/domain/* (for ToDomain
// helpers) are allowed.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.1. Recommended caller alias when
// importing alongside other models subpackages (per ADR-011 §3):
// `alertmodel "internal/models/alert"`.
package alert
