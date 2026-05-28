// Package dashboardlayout owns the /api/v1/dashboard/layouts HTTP handler
// for CRUD over named dashboard layout presets consumed by the dashboard
// LayoutSwitcher and save/apply preset flows.
//
// The legacy /settings/dashboard-layouts blob endpoint stays in the parent API
// package as the in-app sync path; this package is the per-row preset library.
//
// Layer: handler
package dashboardlayout
