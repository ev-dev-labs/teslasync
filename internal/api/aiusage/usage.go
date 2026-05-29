package aiusage

// AI usage handler.
//
// /api/v1/ai/usage/* exposes the per-call audit log through the same guarded
// middleware stack as other AI routes. The __usage__ meta-feature opens whenever
// ai_mode is non-off, leaving guard.Wrap unchanged for all real features.

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	aidb "github.com/ev-dev-labs/teslasync/internal/database/ai"
)

// AIUsageFeatureID is the special-case meta-feature ID registered in
// internal/ai/features/registry.go. Centralising the literal here
// keeps the handler + the guard wrapper in sync; tools/aivet checks
// the registry vs the route mount but not the handler-side string.
const AIUsageFeatureID = "__usage__"

// usageDefaultByFeatureWindow is the default lookback window for the
// /by-feature endpoint when the caller does not supply ?since. Seven
// days matches the chunk-time-interval on the hypertable so the query
// hits at most one chunk in the steady state.
const usageDefaultByFeatureWindow = 7 * 24 * time.Hour

// usageDefaultRecentLimit is the default limit for /recent when the
// caller does not supply ?limit. 50 fits the AiUsageCard's "recent
// activity" tab without paginating.
const usageDefaultRecentLimit = 50

// usageGuardSettings adapts a guard.Settings to special-case the
// __usage__ meta-feature: AIFeatureEnabled("__usage__") returns true
// whenever the underlying mode is non-off, regardless of the
// per-feature toggle (which doesn't exist for __usage__). Every other
// feature ID falls through to the inner Settings so guard.Wrap on
// real AI features continues to enforce the per-feature toggle.
//
// Why a wrapper instead of editing guard.go:
//   - The wrapper isolates the meta-feature carve-out at the call
//     site (this file) so future readers see the special case in
//     context rather than buried in the guard package.
type usageGuardSettings struct {
	inner guard.Settings
}

func (u usageGuardSettings) AIMode(ctx context.Context) (string, error) {
	return u.inner.AIMode(ctx)
}

func (u usageGuardSettings) AIFeatureEnabled(ctx context.Context, featureID string) (bool, error) {
	if featureID == AIUsageFeatureID {
		mode, err := u.inner.AIMode(ctx)
		if err != nil {
			return false, err
		}
		return mode != "off", nil
	}
	return u.inner.AIFeatureEnabled(ctx, featureID)
}

// UsageHandler bundles the three usage endpoints with the dependencies
// they need.
type UsageHandler struct {
	repo       *aidb.AICallLogRepo
	headerName string // FORWARD_AUTH_HEADER name; "" in open mode.
}

// NewUsageHandler constructs the handler. Both repo and headerName
// are required; repo MUST be the same instance the audit decorator
// writes to so reads see the writes promptly.
func NewUsageHandler(repo *aidb.AICallLogRepo, headerName string) *UsageHandler {
	if repo == nil {
		panic("api: NewUsageHandler called with nil repo")
	}
	return &UsageHandler{repo: repo, headerName: headerName}
}

// MountUsageRoutes registers the /ai/usage/* endpoints under the
// supplied parent router (typically the /api/v1 subroute). The routes
// are wrapped by a usage-aware guard so off-mode returns 404 and any
// non-off mode returns the user's data without requiring a separate
// per-feature toggle.
//
// Adding a new usage route MUST go through this function so tools/aivet
// can statically prove the /ai/usage subtree stays guarded.
func MountUsageRoutes(
	r chi.Router,
	settings guard.Settings,
	repo *aidb.AICallLogRepo,
	headerName string,
) {
	usageGuard := guard.New(usageGuardSettings{inner: settings})
	h := NewUsageHandler(repo, headerName)

	r.Route("/ai/usage", func(r chi.Router) {
		r.Get("/today", usageGuard.Wrap(AIUsageFeatureID, h.Today))
		r.Get("/by-feature", usageGuard.Wrap(AIUsageFeatureID, h.ByFeature))
		r.Get("/recent", usageGuard.Wrap(AIUsageFeatureID, h.Recent))
	})
}

// Today returns the user's aggregate spend + volume since 00:00 UTC.
// Open mode reads the empty-subject rows; forward-auth mode scopes by
// the FORWARD_AUTH_HEADER subject value.
func (h *UsageHandler) Today(w http.ResponseWriter, r *http.Request) {
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	agg, err := h.repo.Today(r.Context(), subject)
	if err != nil {
		log.Error().Err(err).Msg("ai_usage Today failed")
		httpx.WriteError(w, http.StatusInternalServerError, "ai usage today failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, agg)
}

// ByFeature returns the per-feature breakdown over a configurable
// window. ?since accepts either an RFC3339 timestamp or a Go duration
// string ("24h", "7d-equivalent like 168h"). Defaults to seven days.
func (h *UsageHandler) ByFeature(w http.ResponseWriter, r *http.Request) {
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	since, err := parseUsageSince(r.URL.Query().Get("since"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid since parameter: "+err.Error())
		return
	}
	rows, err := h.repo.ByFeature(r.Context(), subject, since)
	if err != nil {
		log.Error().Err(err).Msg("ai_usage ByFeature failed")
		httpx.WriteError(w, http.StatusInternalServerError, "ai usage by-feature failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"since": since.UTC().Format(time.RFC3339),
		"rows":  rows,
	})
}

// Recent returns the last N audit rows for the user, newest-first.
// ?limit defaults to usageDefaultRecentLimit and is clamped server-
// side to AICallRecentMax so a misbehaving client cannot pump the row
// count.
func (h *UsageHandler) Recent(w http.ResponseWriter, r *http.Request) {
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	limit := parseUsageLimit(r.URL.Query().Get("limit"))
	rows, err := h.repo.Recent(r.Context(), subject, limit)
	if err != nil {
		log.Error().Err(err).Msg("ai_usage Recent failed")
		httpx.WriteError(w, http.StatusInternalServerError, "ai usage recent failed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"limit": limit,
		"rows":  rows,
	})
}

// parseUsageSince accepts:
//   - "" → default 7-day window (now - 7d).
//   - RFC3339 timestamp → that exact instant.
//   - Go duration string ("24h", "168h", "30m") → now - duration.
//
// Returns the resolved instant in UTC. Negative durations are rejected
// because "since the future" makes no sense and would silently return
// zero rows.
func parseUsageSince(raw string) (time.Time, error) {
	if raw == "" {
		return time.Now().UTC().Add(-usageDefaultByFeatureWindow), nil
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

// errInvalidSinceDuration is returned by parseUsageSince when the
// supplied duration is non-positive.
var errInvalidSinceDuration = stringError("since duration must be positive")

// parseUsageLimit returns a clamped, valid limit for /recent. Values ≤
// 0 fall back to the default; values > AICallRecentMax clamp to the
// max. Non-numeric input also falls back to the default — a typo
// shouldn't 400 a read endpoint that can be served safely with a
// reasonable default.
func parseUsageLimit(raw string) int {
	if raw == "" {
		return usageDefaultRecentLimit
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return usageDefaultRecentLimit
	}
	if n <= 0 {
		return usageDefaultRecentLimit
	}
	if n > aidb.AICallRecentMax {
		return aidb.AICallRecentMax
	}
	return n
}

// stringError is a zero-allocation error type for the package's small
// constant errors.
type stringError string

func (s stringError) Error() string { return string(s) }
