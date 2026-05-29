// Package user holds repository types for the user-facing aggregate that
// is NOT tied to authentication or telemetry: OnboardingRepo (per-user
// first-run state) + UserFeedbackRepo (in-product feedback submissions
// with bug/feature/other categorisation).
//
// Callers import this package as `dbuser` to disambiguate it from
// runtime user-service layers.
//
// Settings + vehicle_settings are deliberately NOT included in this
// carve. settings_repo.go is referenced by parent peers
// vehicle_settings_repo.go + vehicle_settings_resolver.go (which
// hold `*SettingsRepo` fields and `NewUserSettingsLookup(repo *SettingsRepo)`).
// Settings stays in the parent package until vehicle_settings can move
// with it.
//
// Layer: adapter
package user
