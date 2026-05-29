// Package aiyir serves the LLM-backed year-in-review narration endpoint
// mounted at POST /api/v1/ai/analytics/year-in-review/narrate. It preserves
// the baseline deterministic year-review route and only handles the opt-in AI
// SSE narration surface behind the shared AI guard.
//
// Layer: handler
package aiyir
