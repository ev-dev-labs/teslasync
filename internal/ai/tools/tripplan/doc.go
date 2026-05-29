// Package tripplan hosts AI trip-planner tools for route and charger planning.
//
// Layer: domain
//
// The package registers query_chargers_along_route,
// query_user_charge_dwells, and draft_trip_plan. The `tripplan`
// package covers route planning; the sibling `trip` package covers
// trip enrichment.
//
// When a callsite imports this package with the parent tools package,
// use the alias `tripplantool` to avoid ambiguity.
package tripplan
