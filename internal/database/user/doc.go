// Package user holds repository types for the user-facing aggregate that
// is NOT tied to authentication or telemetry: OnboardingRepo (per-user
// first-run state) + UserFeedbackRepo (in-product feedback submissions
// with bug/feature/other categorisation).
//
// Carved from internal/database in Phase R4.8 per ADR-011. Callers
// import as `dbuser` to disambiguate from the runtime user-service
// layers (when added).
//
// Settings + vehicle_settings are deliberately NOT included in this
// carve. settings_repo.go is referenced by parent peers
// vehicle_settings_repo.go + vehicle_settings_resolver.go (which
// hold `*SettingsRepo` fields and `NewUserSettingsLookup(repo *SettingsRepo)`).
// Per Lesson 26, settings stays in parent until vehicle_settings is
// also carved into the same subpackage in a future R4.x batch.
//
// Layer: adapter (database)
package user
