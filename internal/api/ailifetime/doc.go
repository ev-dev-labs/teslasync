// Package ailifetime serves the LLM-backed lifetime-stats Q&A route
// at POST /api/v1/ai/analytics/lifetime/qa. It is intentionally
// distinct from internal/api/lifetime, which owns the deterministic
// baseline lifetime statistics endpoints.
//
// Layer: handler
package ailifetime
