// Package guard wraps every /api/v1/ai/* route in TeslaSync with a
// single, type-system-enforced mount point that honours the ADR-015
// AI-Off Contract.
//
// The contract (ADR-015 §I6): when AI is disabled or the per-feature
// toggle is off, the route returns 404 — not 200 with an empty body
// and not 503. 404 reflects the truth: the route is functionally
// non-existent for this user. Existing non-AI baselines (e.g.
// /api/v1/chat for the heuristic chatbot) are unaffected.
//
// The guard is the *only* sanctioned way to mount an AI handler.
// tools/aivet refuses to merge a router change that introduces a
// `/api/v1/ai/...` route registered via a bare HandlerFunc instead
// of guard.Wrap.
package guard

import (
	"context"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

// Settings is the narrow view of the user's AI configuration the
// guard depends on. It is satisfied by *database.SettingsRepo in
// production wiring and by an in-memory fake in tests.
//
// TeslaSync is single-tenant (one settings row per installation), so
// the interface intentionally does not take a userID. Per-user AI
// preferences are out of scope for this phase (see methodology
// "Future work" §RBAC).
type Settings interface {
	// AIMode returns one of "off" / "local" / "cloud". Implementations
	// MUST return "off" on any unexpected error so the guard fails
	// closed (ADR-015 §I1 default-off).
	AIMode(ctx context.Context) (string, error)

	// AIFeatureEnabled reports whether the named feature toggle is on
	// for the current installation. Implementations MUST return false
	// on any error so the guard fails closed.
	AIFeatureEnabled(ctx context.Context, featureID string) (bool, error)
}

// Guard owns the per-request gate logic. A single instance is built
// at router-construction time and shared across every wrapped route.
type Guard struct {
	settings Settings
}

// New builds a Guard backed by s. The Settings dependency is
// injected so tests can substitute a deterministic fake without
// reaching into the database layer.
func New(s Settings) *Guard {
	if s == nil {
		// A nil Settings would short-circuit the entire AI surface to
		// 500-then-404 chains; reject the misconfiguration loudly at
		// boot rather than silently degrade.
		panic("ai/guard: New called with nil Settings")
	}
	return &Guard{settings: s}
}

// Wrap returns an http.HandlerFunc that delegates to h iff
//
//  1. featureID is a registered feature in the canonical registry, AND
//  2. settings.AIMode(ctx) is not "off", AND
//  3. settings.AIFeatureEnabled(ctx, featureID) is true.
//
// Any other condition responds with 404 (ADR-015 §I6) and consumes
// the request body unread — the route is functionally non-existent.
//
// The featureID check happens at Wrap *call* time (boot) via
// features.IsKnown so a typo panics during router construction
// rather than on the first request. This is the core of P6:
// "compile-time gate for AI components" — the check is moved as
// early in the program lifetime as Go allows.
func (g *Guard) Wrap(featureID string, h http.HandlerFunc) http.HandlerFunc {
	if !features.IsKnown(featureID) {
		panic("ai/guard: Wrap called with unknown feature ID " + featureID +
			" — register it in internal/ai/features/registry.go before mounting the route")
	}
	return func(w http.ResponseWriter, r *http.Request) {
		mode, err := g.settings.AIMode(r.Context())
		if err != nil || mode == "off" {
			http.NotFound(w, r)
			return
		}
		on, err := g.settings.AIFeatureEnabled(r.Context(), featureID)
		if err != nil || !on {
			http.NotFound(w, r)
			return
		}
		h(w, r)
	}
}
