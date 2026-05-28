// Package geocode serves the forward + reverse geocoding endpoints under
// /api/v1/geocode/*.
//
// Two endpoints:
//
//	GET /api/v1/geocode/search?q=...&limit=5   — forward search (Nominatim
//	                                             OSM by default); capped
//	                                             at 10 results.
//	GET /api/v1/geocode/reverse?lat=X&lon=Y    — reverse lookup using the
//	                                             configured commercial
//	                                             provider (Google or
//	                                             Azure Maps).
//
// Both endpoints are rate-limited by IP at the router (30/min) — see
// the router wiring for the canonical limit.
//
// Layer: handler
package geocode
