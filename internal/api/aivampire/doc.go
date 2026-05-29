// Package aivampire serves the LLM-backed vampire-drain explanation route
// at POST /api/v1/ai/charging/vampire-drain/explain. It is intentionally
// distinct from internal/api/vampiredrain, which owns the deterministic
// baseline vampire-drain metrics endpoints.
//
// Layer: handler
package aivampire
