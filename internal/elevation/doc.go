// Package elevation fills the one geospatial gap Tesla Fleet Telemetry
// never closes on its own: terrain height.
//
// api/proto/tesla/vehicle_data.proto's LocationValue carries only
// latitude and longitude (see LocationValue in that file); there is no
// Elevation field anywhere on the wire. See also
// internal/api/drives/detail.go and internal/api/locsnap/handler.go,
// both of which document "Tesla Fleet Telemetry does not emit
// elevation" at their respective call sites. The positions.altitude_m
// column (migration 000182_positions_si) and drives.elevation_* columns
// (migration 000021_drive_charge_enhancements) have existed for a long
// time waiting for a data source.
//
// Provider is that data source: given a (lat, lon) fix, it returns the
// terrain height in meters by querying an out-of-band digital elevation
// model (DEM), the same way internal/geocoding resolves a place name for
// a (lat, lon) fix instead of expecting Tesla to transmit one.
//
// The reference implementation (Client, in client.go) calls a
// self-hosted, free, worldwide-coverage elevation HTTP service —
// akhenakh/gedtm30api (MIT-licensed:
// https://github.com/akhenakh/gedtm30api) — which serves the free
// GEDTM30 dataset (Global Ensemble Digital Terrain Model, ~30m
// resolution, -65..85 degrees latitude, so it covers every market Tesla
// sells in without the >60N gap that SRTM has). Because the service is
// self-hosted there is no per-call cost, API key, or rate limit; the
// only operational concern is the service's own tile cache warming up
// for a brand-new geographic area, which is why Lookup is guarded by a
// short timeout and a circuit breaker rather than retries.
//
// Elevation lookups are best-effort by design, matching ADR-004 #8's
// "best-effort, no internal retries" contract for the telemetry
// pipeline: a slow or unreachable elevation service must degrade to
// "no elevation for this fix," never to a stalled or failed position
// write. NoopProvider is the zero-configuration default so operators
// who have not deployed a self-hosted elevation service see no
// behavior change.
//
// Layer: platform
package elevation
