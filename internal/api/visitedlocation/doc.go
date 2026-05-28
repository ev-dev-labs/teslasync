// Package visitedlocation serves GET /api/v1/locations which returns a
// list of locations the fleet has visited.
//
// The handler delegates to internal/database/trip.VisitedLocationRepo
// for storage. Two query modes are supported:
//
//   - no query string ........... GetAll across all vehicles
//   - vehicle_id=<int64> ........ GetByVehicle scoped to one vehicle
//
// The endpoint is read-only and intentionally narrow; place-level enrichment
// (POI naming, geofence matching, etc.) lives in higher-level handlers /
// the trip-detail endpoints.
//
// Layer: handler
package visitedlocation
