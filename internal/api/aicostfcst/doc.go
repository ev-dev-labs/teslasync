// Package aicostfcst serves POST /api/v1/ai/charging/costs/forecast/narrate,
// the opt-in AI narration layer for the deterministic charging cost forecast.
// It owns request validation, provider dispatch, and SSE streaming while the
// canonical forecast computation remains in package api for baseline reuse.
//
// Layer: handler
package aicostfcst
