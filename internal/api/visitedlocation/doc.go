// Package visitedlocation serves read-only visited-location queries at
// GET /api/v1/locations, optionally scoped by vehicle_id.
//
// Place-level enrichment such as POI naming and geofence matching belongs in
// higher-level trip handlers, not this narrow listing endpoint.
//
// Layer: handler
package visitedlocation
