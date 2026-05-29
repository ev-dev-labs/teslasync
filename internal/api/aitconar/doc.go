// Package aitconar serves POST /api/v1/ai/analytics/tco/narrate,
// the opt-in AI narration layer for the deterministic TCO analytics page.
// It owns request validation, provider dispatch, and SSE streaming while the
// canonical TCO computation remains in package tco for baseline reuse.
//
// Layer: handler
package aitconar
