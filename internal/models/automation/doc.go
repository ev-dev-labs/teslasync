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
// ADR-011 §3 recommends the caller alias `automationmodel` when importing
// alongside other model subpackages.
//
// The root `Automation` type and its CTI tree live in
// internal/models/automation.go. This subpackage contains only the
// AutomationHistory and AutomationVariable DTOs.
package automation
