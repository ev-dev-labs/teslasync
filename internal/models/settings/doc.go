// Package settings hosts persistence + transport DTOs for the
// legacy application-settings bounded context: top-level user
// preferences (units, theme, language, gas prices) and the
// Tesla-Fleet-API polling-config feature-flag struct.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models. Recommended caller alias when importing alongside
// other models subpackages (per ADR-011 §3):
// `settingsmodel "internal/models/settings"`.
//
// Both LegacySettings and LegacyPollingConfig remain "Deprecated" per the
// original models.go doc comments — superseded by the typed `Setting` and
// `PollingConfig` structs in system.go which mirror the post-migration
// schema. The package is retained so internal/worker,
// internal/database/settings_repo.go, and internal/api/settings_handler.go
// continue to build during migration.
package settings
