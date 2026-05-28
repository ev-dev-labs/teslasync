// Package settingsreset serves POST /api/v1/settings/reset, the sudo-gated
// per-section/global settings reset endpoint consumed by the SPA danger zone.
//
// The handler depends on [SettingsResetExecutor] so production wiring can use
// the settings reset repository while tests stub reset orchestration without a
// live database. The response stays ImportResult-shaped for frontend contract
// compatibility.
//
// Layer: handler
package settingsreset
