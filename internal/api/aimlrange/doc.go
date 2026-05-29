// Package aimlrange serves the AI range-prediction narrative endpoint.
//
// It owns the LLM narration handler and the read-only drive-stat adapter used by
// query_range_prediction while preserving the deterministic range-projection
// endpoint as the canonical baseline.
//
// Layer: handler
package aimlrange
