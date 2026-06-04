// Package aitirepress serves the AI tire-pressure trend reasoning handler.
//
// It owns the LLM narration endpoint at
// POST /api/v1/ai/tire-pressure/trends/explain and its read-only
// TirePressureTrend tool source. It is intentionally distinct from the
// non-AI internal/api/tirepressure package, which owns the deterministic TPMS
// resource endpoints.
//
// Layer: handler
package aitirepress
