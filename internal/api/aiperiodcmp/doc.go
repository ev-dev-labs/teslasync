// Package aiperiodcmp serves POST /api/v1/ai/analytics/period-compare/narrate,
// the opt-in AI narration layer for deterministic period comparison analytics.
// It owns request validation, provider dispatch, and SSE streaming while the
// canonical period-stat computation remains in package periodstats for baseline reuse.
//
// Layer: handler
package aiperiodcmp
