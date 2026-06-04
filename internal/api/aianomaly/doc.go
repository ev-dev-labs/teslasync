// Package aianomaly serves the AI anomaly explanation narration endpoint.
//
// It owns POST /api/v1/ai/anomalies/explain and streams LLM-authored
// explanations through the shared AI dispatcher while preserving the
// non-AI anomaly dashboard baseline route in the parent API wiring.
//
// Layer: handler
package aianomaly
