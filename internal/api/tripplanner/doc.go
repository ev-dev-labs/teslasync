// Package tripplanner serves the non-AI trip planner (heuristic) endpoint.
//
// It owns POST /api/v1/trip-planner/plan and its deterministic route,
// energy, charging-stop, and SOC-curve computation helpers. The LLM-backed
// variant stays in the parent api package pending an ai_routes.go refactor.
//
// Layer: handler
package tripplanner
