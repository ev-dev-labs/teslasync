// Package aibatthealth serves the AI battery-health forecast narrative endpoint.
//
// It owns the LLM narration handler and the read-only forecaster adapter used by
// query_battery_health_forecast while preserving the deterministic battery
// degradation endpoints as the canonical baseline.
//
// Layer: handler
package aibatthealth
