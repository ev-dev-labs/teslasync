// Package geofence contains the GeofenceRepo for the geofences table —
// user-defined geographic boundaries used by automation rules, alerts,
// and the AI geofence-aware features. Includes both the per-row CRUD
// repo and the bulk import/delete extension.
//
// Layer: adapter
//
// Split from internal/database into focused files:
//   - repo.go        (GeofenceRepo, Create/Update/Delete/GetAll/...,
//     FindByCoordinates with haversine distance check)
//   - repo_bulk.go   (BulkDelete, FilterExistingIDs for import workflows)
//   - assertion.go   (compile-time check vs the parent's
//     SettingsSerializerGeofenceRepo interface; relocated
//     here so the parent never imports a child subpkg)
//
// Callsites alias this package as `geofencedb` per ADR-011.
package geofence
