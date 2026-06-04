// Package lifetime serves all-time driving and charging analytics.
//
// ComputeLifetimeStats is read-only so the AI QA tool and chart share identical
// aggregates; only Handler persists achievement unlocks and broadcasts SSE.
//
// Layer: handler
package lifetime
