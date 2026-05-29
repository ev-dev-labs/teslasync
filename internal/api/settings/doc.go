// Package settings serves the user settings endpoints, including
// GET/PUT /api/v1/settings, dashboard layout persistence, and the
// settings export/import bundle routes.
//
// The package keeps SettingsHandler, SettingsExportHandler, and
// SettingsImportHandler exported for router wiring while isolating
// settings-specific validation and serialization from internal/api.
//
// Layer: handler
package settings
