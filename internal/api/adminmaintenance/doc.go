// Package adminmaintenance serves the operator maintenance-mode endpoints
// mounted under /api/v1/admin/maintenance and exposes the shared
// maintenance-state provider consumed by system health/status handlers.
//
// The handler owns the persisted system_state row only; effective
// env-vs-DB precedence stays centralized in BuildMaintenanceProvider so
// /system/health, /api/v1/status, and the admin UI agree on the same
// service-mode source.
//
// Layer: handler
package adminmaintenance
