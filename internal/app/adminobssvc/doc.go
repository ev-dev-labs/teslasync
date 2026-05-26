// Layer: app
//
// Package adminobssvc is the application service for Phase-45's admin
// observability surface (schema drift, slow queries, per-vehicle
// cost, disk forecast, secret rotation). It is consumed by
// internal/handler/v1/admin_observability_handler.go and depends on
// internal/database repos + internal/schemacheck + internal/rotation.
package adminobssvc
