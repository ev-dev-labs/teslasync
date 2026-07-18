// Package segments serves the Ghost Racing / EV Segments endpoints.
//
// It clusters a vehicle's drives into Strava-style route "segments" (drives
// sharing an approximate start AND end point), then serves a personal-best
// leaderboard (by time and by energy efficiency) and a head-to-head "ghost"
// race between two attempts on the same segment. The haversine clustering and
// the ghost alignment/interpolation are kept in a pure, table-tested core
// (segments.go) with no database, clock, or network dependency.
//
// Layer: handler
package segments
