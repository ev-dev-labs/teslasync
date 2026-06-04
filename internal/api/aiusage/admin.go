package aiusage

// F8 AI Admin Handler.
//
// /api/v1/ai/admin/redaction-bypass reports redaction bypasses across tenants for
// operators. The __redaction_bypass__ meta-feature mirrors __usage__: off-mode
// returns 404, while any non-off mode bypasses nonexistent per-feature toggles.

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	aidb "github.com/ev-dev-labs/teslasync/internal/database/ai"
)

// AIAdminRedactionBypassFeatureID is the meta-feature ID registered
// in internal/ai/features/registry.go for the bypass-report endpoint.
// Centralising the literal here keeps handler + guard wrapper + the
// registry entry in sync; tools/aivet checks the registry vs the
// route mount but not the handler-side string.
const AIAdminRedactionBypassFeatureID = "__redaction_bypass__"

// adminDefaultBypassWindow is the default lookback window for the
// /redaction-bypass endpoint when the caller does not supply ?since.
// Seven days matches ai_call_log's 7-day chunk interval so the query
// hits at most one chunk in the steady state.
const adminDefaultBypassWindow = 7 * 24 * time.Hour

// adminGuardSettings adapts a guard.Settings to special-case the
// __redaction_bypass__ meta-feature: AIFeatureEnabled returns true
// whenever the underlying mode is non-off, regardless of any
// per-feature toggle (which doesn't exist for __redaction_bypass__).
// Every other feature ID falls through to the inner Settings so
// guard.Wrap on real AI features continues to enforce per-feature
// gating.
//
// Why a wrapper instead of editing guard.go:
// - guard.go is NOT in this slice's allowed-files list (per the
// same constraint that motivated the __usage__ wrapper).
// - The wrapper isolates the meta-feature carve-out at the call
// site so future readers see the special case in context.
type adminGuardSettings struct {
	inner guard.Settings
}

func (a adminGuardSettings) AIMode(ctx context.Context) (string, error) {
	return a.inner.AIMode(ctx)
}

func (a adminGuardSettings) AIFeatureEnabled(ctx context.Context, featureID string) (bool, error) {
	if featureID == AIAdminRedactionBypassFeatureID {
		mode, err := a.inner.AIMode(ctx)
		if err != nil {
			return false, err
		}
		return mode != "off", nil
	}
	return a.inner.AIFeatureEnabled(ctx, featureID)
}

// AdminHandler bundles the admin endpoints with their dependencies.
type AdminHandler struct {
	repo *aidb.AICallLogRepo
}

// NewAdminHandler constructs the handler. repo is required and MUST
// be the same instance the audit decorator writes to so reads see
// recent writes promptly.
func NewAdminHandler(repo *aidb.AICallLogRepo) *AdminHandler {
	if repo == nil {
		panic("api: NewAdminHandler called with nil repo")
	}
	return &AdminHandler{repo: repo}
}

// MountAdminRoutes registers /ai/admin/* under parent. Currently the
// only route is /redaction-bypass. Adding new admin routes MUST go
// through this function so tools/aivet can statically prove the
// /ai/admin subtree stays guarded.
func MountAdminRoutes(
	r chi.Router,
	settings guard.Settings,
	repo *aidb.AICallLogRepo,
) {
	adminGuard := guard.New(adminGuardSettings{inner: settings})
	h := NewAdminHandler(repo)

	r.Route("/ai/admin", func(r chi.Router) {
		r.Get("/redaction-bypass", adminGuard.Wrap(AIAdminRedactionBypassFeatureID, h.RedactionBypass))
	})
}

// RedactionBypass returns the per-(feature, provider) bypass summary
// over the configurable window. ?since accepts either an RFC3339
// timestamp or a Go duration string ("24h", "168h"). Defaults to
// seven days. Reuses parseUsageSince so ?since semantics stay
// identical to /ai/usage/by-feature.
func (h *AdminHandler) RedactionBypass(w http.ResponseWriter, r *http.Request) {
	since, err := parseAdminSince(r.URL.Query().Get("since"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid since parameter: "+err.Error())
		return
	}
	rows, err := h.repo.RedactionBypassByFeature(r.Context(), since)
	if err != nil {
		log.Error().Err(err).Msg("ai_admin RedactionBypass failed")
		httpx.WriteError(w, http.StatusInternalServerError, "ai admin redaction-bypass failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"since": since.UTC().Format(time.RFC3339),
		"rows":  rows,
	})
}

// parseAdminSince mirrors parseUsageSince but with the admin default
// window. Defined separately rather than parameterising parseUsageSince
// so a future change to the admin default doesn't accidentally shift
// the user-facing /usage/by-feature default.
func parseAdminSince(raw string) (time.Time, error) {
	if raw == "" {
		return time.Now().UTC().Add(-adminDefaultBypassWindow), nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC(), nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return time.Time{}, err
	}
	if d <= 0 {
		return time.Time{}, errInvalidSinceDuration
	}
	return time.Now().UTC().Add(-d), nil
}
