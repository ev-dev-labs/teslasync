// Package alert holds repository types for the alert/notification-rule
// aggregate: AlertRuleRepo (CRUD over user-defined alert rules with
// validateVehicleSelection + dedupAndSortVehicleIDs helpers) and
// AlertRuleStateRepo (per-rule materialised state).
//
// Callers import as `dbalert` to disambiguate this repository package from
// any runtime alert engine package.
//
// The compile-time assertion
//
//	_ settingsdb.SettingsSerializerAlertRepo = (*AlertRuleRepo)(nil)
//
// lives in internal/database/alert/settings_serializer_assertion.go so the
// subpackage can import the parent interface without creating an import cycle.
// Apply the same pattern to future bounded-context repository packages.
//
// Layer: adapter
package alert
