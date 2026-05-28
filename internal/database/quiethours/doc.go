// Package quiethours contains the QuietHoursRepo for the
// notification_quiet_hours table — per-user windows when notifications
// are suppressed (with optional severity bypass).
//
// Layer: adapter
//
// Carved out of internal/database during Phase R restructure (R4.25):
//   - repo.go        (QuietHoursRepo: ListByUser/ListEnabled/Get/Insert/
//     Update/Delete with HH:MM + IANA timezone + weekday
//     bitmask + severity-bypass validation)
//   - assertion.go   (compile-time check vs the parent's
//     SettingsSerializerQuietHoursRepo interface,
//     relocated here per Lesson 30/34)
//
// The QuietHoursInput payload type stays in the parent package
// (internal/database/quiet_hours_input.go) because it is part of the
// SettingsSerializerQuietHoursRepo interface contract that the settings
// serializer (also still in parent) consumes. Subpkg repo methods
// reference *database.QuietHoursInput.
//
// Callsites alias this package as `quiethoursdb` per ADR-011.
package quiethours
