package quiethours

import "github.com/ev-dev-labs/teslasync/internal/database/settings"

// Compile-time assertion: *QuietHoursRepo satisfies the serializer
// interface declared in the parent settings_serializer.go. Catches
// signature drift at build time without forcing the parent package to
// import this subpackage. See Lesson 30/34 in plan.md §13.
var _ settings.SettingsSerializerQuietHoursRepo = (*QuietHoursRepo)(nil)
