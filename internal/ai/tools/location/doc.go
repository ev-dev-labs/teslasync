// Package location hosts the AI tool implementations that propose
// human-readable names for places — currently:
//
//	auto_name_unnamed_locations: drafts a friendly name for a
//	  VisitedLocation that has no user-assigned label yet.
//	suggest_new_geofences: drafts a Geofence (centroid + radius +
//	  name) when a cluster of visits looks like a place the user
//	  might want to track.
//
// Both tools share the LocationSource port (the canonical read-only
// adapter into the VisitedLocation/Geofence catalog) and the
// validate-then-draft two-step pattern, so they live together in
// this subpkg per ADR-011 §2 — bounded-context grouping wins over
// per-tool granularity when the tools share a non-trivial helper
// surface.
//
// Moved out of internal/ai/tools. The exported symbols
// (LocationSource, LocationNameValidator, GeofenceValidator,
// AutoNameUnnamedLocationsSources, SuggestNewGeofencesSources,
// RegisterAutoNameUnnamedLocationsTools, RegisterSuggestNewGeofencesTools)
// keep their verbatim names for git bisectability — only the import
// path moved.
//
// Layer: adapter
//
// ADR-011 §3 alias convention: callers importing this package
// alongside the parent ai/tools should use the alias
// `locationaitools`. At single-import callsites no alias is
// required.
//
// ADR-015 §I12 contract preservation: Import paths moved without changing behavior.
// No AI strategy or tool logic changed. Both /api/v1/ai/auto-name-
// unnamed-locations and /api/v1/ai/suggest-new-geofences routes
// still re-check ai_mode + per-feature toggles on every tick and
// still return {Skipped: 1} with zero side effects when AI is off.
// Verified by `make ai-vet` (PASS) at the cluster commit.
package location
