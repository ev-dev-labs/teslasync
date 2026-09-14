package journey

import (
	"context"
	"math"
)

// routeHistoryLimit bounds the learning lookback: the ten most recent
// completed trips on a route.
const routeHistoryLimit = 10

// routeFactorBounds clamp the learned multiplier. Below 1.0 the
// history claims the road beats the straight line (partial trips,
// swapped endpoints) — clamped to the line. Above 2.0 a detour-heavy
// past would double every ETA — clamped to twice.
const (
	routeFactorMin = 1.0
	routeFactorMax = 2.0
)

// minRouteTrips is the evidence floor: one trip is an anecdote, two a
// pattern.
const minRouteTrips = 2

// RouteFactor averages per-trip detour ratios into one multiplier.
// Legs with non-positive distance or straight legs drop out (partial
// data, not evidence). Needs minRouteTrips contributors; the mean
// clamps to [routeFactorMin, routeFactorMax]. Returns the contributor
// count for transparency. Pure.
func RouteFactor(legs []RouteLeg) (factor float64, trips int, ok bool) {
	sum := 0.0
	for _, leg := range legs {
		if leg.DistanceM <= 0 || leg.StraightM <= 0 {
			continue
		}
		sum += leg.DistanceM / leg.StraightM
		trips++
	}
	if trips < minRouteTrips {
		return 0, trips, false
	}
	mean := sum / float64(trips)
	return math.Min(routeFactorMax, math.Max(routeFactorMin, mean)), trips, true
}

// routeFactorFor resolves the learned multiplier for a session's
// route: both endpoint names identify the route, in either direction.
// Nil factor without names or history — callers fall back to the
// straight line.
func routeFactorFor(ctx context.Context, trail TrailStore, session *Session) (factor *float64, trips int, err error) {
	if session.OriginName == "" || session.DestName == "" {
		return nil, 0, nil
	}
	legs, err := trail.RouteLegs(ctx, session.VehicleID, session.OriginName, session.DestName, routeHistoryLimit)
	if err != nil {
		return nil, 0, err
	}
	f, n, ok := RouteFactor(legs)
	if !ok {
		return nil, n, nil
	}
	return &f, n, nil
}
