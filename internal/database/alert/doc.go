// Package alert holds repository types for the alert/notification-rule
// aggregate: AlertRuleRepo (CRUD over user-defined alert rules with
// validateVehicleSelection + dedupAndSortVehicleIDs helpers) and
// AlertRuleStateRepo (per-rule materialised state).
//
// Carved from internal/database in Phase R4.9 per ADR-011. Callers
// import as `dbalert` to disambiguate from internal/alert (runtime
// alert engine, if added).
//
// Lesson 26 + 30 NEW: the compile-time assertion
//
//	_ database.SettingsSerializerAlertRepo = (*AlertRuleRepo)(nil)
//
// originally lived in parent settings_serializer.go and would create
// a parent -> child cycle after the carve. Solution: relocate the
// assertion to internal/database/alert/settings_serializer_assertion.go
// where the alert subpackage imports parent for the interface type.
// This keeps signature drift detection at build time AND avoids the
// cycle. Apply the same pattern to geofence/quiet_hours carves later.
//
// Layer: adapter (database)
package alert
