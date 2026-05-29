// Package settings contains the user-level + per-vehicle settings
// aggregate: global Settings (singleton row, JSON-shaped sections),
// per-vehicle settings overrides, the export/import bundle
// serializer, the reset-section deny-list machinery, and the
// effective-settings resolver that flattens overrides on top of
// defaults at read time.
//
// Layer: adapter
//
// This package is cross-cutting: the serializer and reset machinery
// touch every other settings-bearing repo via abstract interfaces
// (SettingsSerializerSettingsRepo / SettingsSerializerAlertRepo /
// SettingsSerializerGeofenceRepo / SettingsSerializerQuietHoursRepo).
//
// Files:
//   - repo.go              (SettingsRepo: Get/Upsert/GetPollingConfig/
//     GetDashboardLayouts/UpsertDashboardLayouts/
//     AIMode/AIFeatureEnabled/IsAPISuspended)
//   - reset.go             (SettingsResetRepo: section-scoped truncate
//     machinery with deny-list + tx runner port)
//   - serializer.go        (SettingsSerializer: ExportSettings /
//     ImportSettings bundle export/import with
//     per-section equivalence + section interfaces)
//   - vehicle_repo.go      (VehicleSettingsRepo: per-vehicle override
//     CRUD + validation for nickname / mute /
//     charge cost / enum keys)
//   - vehicle_resolver.go  (VehicleSettingsResolver: effective-settings
//     computation overlaying overrides on defaults;
//     VehicleNameLookup interface stub here
//     consumed by alerts / notifications)
//   - quiet_hours_input.go (QuietHoursInput struct — kept with the
//     serializer interface that consumes it; the
//     concrete QuietHoursRepo lives in sibling
//     internal/database/quiethours and references
//     settings.QuietHoursInput)
//
// Callsites alias this package as `settingsdb` per ADR-011.
//
// Cross-package coupling:
//   - geofence subpkg asserts *GeofenceRepo satisfies
//     settings.SettingsSerializerGeofenceRepo (see
//     internal/database/geofence/assertion.go).
//   - quiethours subpkg asserts *QuietHoursRepo satisfies
//     settings.SettingsSerializerQuietHoursRepo (see
//     internal/database/quiethours/assertion.go).
//   - alert subpkg asserts *AlertRuleRepo satisfies
//     settings.SettingsSerializerAlertRepo (see
//     internal/database/alert/settings_serializer_assertion.go).
//   - vehicle subpkg's NameLookup adapter implements
//     settings.VehicleNameLookup against *vehicle.VehicleRepo (see
//     internal/database/vehicle/name_lookup.go).
package settings
