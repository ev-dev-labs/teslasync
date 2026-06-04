// Package quiethours contains the QuietHoursRepo for the
// notification_quiet_hours table — per-user windows when notifications
// are suppressed (with optional severity bypass).
//
// Layer: adapter
//
// This package owns quiet-hours persistence details:
//   - repo.go      handles ListByUser/ListEnabled/Get/Insert/Update/Delete
//     with HH:MM, IANA timezone, weekday bitmask, and severity-bypass
//     validation.
//   - assertion.go checks conformance to the parent package's
//     SettingsSerializerQuietHoursRepo interface.
//
// The QuietHoursInput payload type stays in the parent package
// (internal/database/quiet_hours_input.go) because it is part of the
// SettingsSerializerQuietHoursRepo interface contract that the settings
// serializer (also still in parent) consumes. Subpkg repo methods
// reference *settingsdb.QuietHoursInput.
//
// Callsites alias this package as `quiethoursdb` per ADR-011.
package quiethours
