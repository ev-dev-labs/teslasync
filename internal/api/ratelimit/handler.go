// Rate-limit status endpoint.
//
// GET /api/v1/system/rate-limits returns ScopeBudget rows for the admin status
// panel. Fleet API spend comes from a durable, cross-process reservation store;
// internal request counters and the burst smoother remain process-local.

package ratelimit

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/platform"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
)

// Severity buckets returned in ScopeBudget.Severity. Lowercase enum
// strings round-trip cleanly through JSON without case-mapping in the
// SPA.
const (
	RateLimitSeverityOK       = "ok"
	RateLimitSeverityWarn     = "warn"
	RateLimitSeverityCritical = "critical"
)

// Scope IDs returned in ScopeBudget.ID. Stable string constants so
// the SPA can pin per-row icons / labels without depending on Name.
const (
	RateLimitScopeTeslaFleetAPIBurst = "tesla.fleet_api.burst"
	RateLimitScopeTeslaDailySpend    = "tesla.fleet_api.daily_spend"
	RateLimitScopeTeslaBackground    = "tesla.fleet_api.background_spend"
	RateLimitScopeAPIInternalMinute  = "api.internal.minute"
	RateLimitScopeAPIWriteMinute     = "api.write.minute"
)

// rateLimitWarnThresholdPct + rateLimitCriticalThresholdPct define the
// severity ladder. Exposed as package vars rather than constants so
// the test file can perturb them without forking the handler logic.
var (
	rateLimitWarnThresholdPct     = 50.0
	rateLimitCriticalThresholdPct = 80.0
)

// ScopeBudget is one row in the rate-limit status response. The shape
// is shared verbatim with web/src/api/types.ts (snake_case JSON tags
// match the camelCaseKeys() transform on the SPA side).
type ScopeBudget struct {
	// ID is a stable scope identifier (see RateLimitScope* consts).
	ID string `json:"id"`
	// Name is the human-readable label shown next to the bar.
	Name string `json:"name"`
	// Current is the observed usage in the same unit as Limit.
	Current float64 `json:"current"`
	// Limit is the per-window cap. Both Current and Limit are
	// floats so fractional bucket states (Tesla limiter) round-trip
	// without precision loss; integer scopes will have whole
	// numbers but the SPA fmtNumber() handles either.
	Limit float64 `json:"limit"`
	// WindowSeconds is the period the Current count is measured
	// over. Zero means "instantaneous snapshot" (token bucket).
	WindowSeconds int `json:"window_seconds"`
	// ResetAt is an optional UTC instant at which the bucket fully
	// refills (token-bucket scopes only). Sliding-window scopes
	// have a continuously-rolling reset and leave this nil.
	ResetAt *time.Time `json:"reset_at,omitempty"`
	// Severity is the colour band the SPA renders. See severity
	// constants above.
	Severity string `json:"severity"`
	// Unit controls value formatting in the SPA. Empty means a raw count.
	Unit string `json:"unit,omitempty"`
	// Detail is a human-readable footnote ("client-side burst",
	// etc.). Surfaced as helper text under each row.
	Detail string `json:"detail,omitempty"`
}

// RateLimitStatusResponse is the JSON envelope returned by GET
// /api/v1/system/rate-limits. Wrapping the slice in a struct keeps
// future fields additive without breaking existing SPA decoders.
type RateLimitStatusResponse struct {
	GeneratedAt time.Time     `json:"generated_at"`
	Scopes      []ScopeBudget `json:"scopes"`
	Warnings    []string      `json:"warnings,omitempty"`
}

const fleetAPIBudgetUnavailableWarning = "Tesla Fleet API spend evidence is unavailable; outbound Fleet API calls fail closed."

// Handler closes over the data sources every scope row needs.
// All dependencies are optional — when a dependency is nil the
// corresponding scope is omitted from the response rather than
// fabricating placeholder data, so callers can never confuse "we
// haven't wired Tesla yet" with "Tesla is healthy".
type Handler struct {
	teslaClient  *tesla.Client
	apiCounter   *platform.WindowCounter
	writeCounter *platform.WindowCounter
	apiLimit     int
	writeLimit   int
	now          func() time.Time
}

// RateLimitHandlerConfig groups the constructor arguments so callers
// don't accidentally swap counter positions when rates are added or
// reordered. apiLimit + writeLimit are the rounded "soft caps" we
// surface in the status panel — they don't enforce anything by
// themselves, the per-route httprate middleware in router.go does
// that. Pick values that match the most permissive aggregate the
// router allows.
type RateLimitHandlerConfig struct {
	TeslaClient  *tesla.Client
	APICounter   *platform.WindowCounter
	WriteCounter *platform.WindowCounter
	APILimit     int
	WriteLimit   int
}

// DefaultAPILimitPerMinute / DefaultWriteLimitPerMinute are the
// status-panel "soft caps" picked to match the most permissive
// httprate.LimitByIP cluster in router.go. Adjust here when the
// router's permissive end loosens or tightens — they are advisory
// labels, not enforcement.
const (
	DefaultAPILimitPerMinute   = 600
	DefaultWriteLimitPerMinute = 120
)

// NewHandler wires the production handler. Pass nil for any
// dependency that isn't available at startup; the handler will skip
// the matching row in the response. APILimit / WriteLimit fall back
// to the documented defaults when zero.
func NewHandler(cfg RateLimitHandlerConfig) *Handler {
	apiLimit := cfg.APILimit
	if apiLimit <= 0 {
		apiLimit = DefaultAPILimitPerMinute
	}
	writeLimit := cfg.WriteLimit
	if writeLimit <= 0 {
		writeLimit = DefaultWriteLimitPerMinute
	}
	return &Handler{
		teslaClient:  cfg.TeslaClient,
		apiCounter:   cfg.APICounter,
		writeCounter: cfg.WriteCounter,
		apiLimit:     apiLimit,
		writeLimit:   writeLimit,
		now:          func() time.Time { return time.Now().UTC() },
	}
}

// ServeHTTP fulfils GET /api/v1/system/rate-limits. Method-strict so
// the SPA can't accidentally mutate state by misrouting a POST.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "GET /api/v1/system/rate-limits")
	defer span.End()

	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	resp, err := h.Build(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "rate-limit status partially unavailable")
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("rate-limit status returned partial evidence")
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

// Build composes the response. Exposed (unexported but reachable from
// tests) so tests can assert the scope shape without going through an
// httptest round-trip.
func (h *Handler) Build(ctx context.Context) (RateLimitStatusResponse, error) {
	now := h.now()
	scopes := make([]ScopeBudget, 0, 5)
	if s, ok := h.teslaScope(now); ok {
		scopes = append(scopes, s)
	}
	var warnings []string
	budgetScopes, err := h.teslaBudgetScopes(ctx)
	if err == nil {
		scopes = append(scopes, budgetScopes...)
	} else {
		warnings = append(warnings, fleetAPIBudgetUnavailableWarning)
	}
	if s, ok := h.apiInternalScope(); ok {
		scopes = append(scopes, s)
	}
	if s, ok := h.apiWriteScope(); ok {
		scopes = append(scopes, s)
	}
	return RateLimitStatusResponse{
		GeneratedAt: now,
		Scopes:      scopes,
		Warnings:    warnings,
	}, err
}

func (h *Handler) teslaBudgetScopes(ctx context.Context) ([]ScopeBudget, error) {
	if h.teslaClient == nil {
		return nil, nil
	}
	snapshot, enabled, err := h.teslaClient.BudgetSnapshot(ctx)
	if err != nil {
		return nil, fmt.Errorf("read Tesla Fleet API budget snapshot: %w", err)
	}
	if !enabled || snapshot.DailyLimitMicroUSD <= 0 {
		return nil, nil
	}

	detail := fmt.Sprintf(
		"Shared UTC-day estimate — %d vehicle-data, %d wake, %d command, %d paid-specs, %d other reservations.",
		snapshot.VehicleDataRequests,
		snapshot.WakeUpRequests,
		snapshot.CommandRequests,
		snapshot.VehicleSpecsRequests,
		snapshot.OtherRequests,
	)
	dailyLimit := snapshot.DailyLimitUSD()
	backgroundLimit := snapshot.BackgroundLimitUSD()
	remainingBackgroundMicroUSD := snapshot.RemainingBackgroundMicroUSD()
	remainingVehicleDataCalls := remainingBackgroundMicroUSD /
		tesla.EstimatedCostMicroUSD(tesla.BudgetCategoryVehicleData)
	return []ScopeBudget{
		{
			ID:            RateLimitScopeTeslaDailySpend,
			Name:          "Tesla Fleet API estimated spend",
			Current:       snapshot.EstimatedCostUSD(),
			Limit:         dailyLimit,
			WindowSeconds: 24 * 60 * 60,
			ResetAt:       &snapshot.ResetAt,
			Severity:      severityForPercent(percentOf(snapshot.EstimatedCostUSD(), dailyLimit)),
			Unit:          "usd",
			Detail:        detail,
		},
		{
			ID:            RateLimitScopeTeslaBackground,
			Name:          "Tesla background-read allowance",
			Current:       snapshot.BackgroundCostUSD(),
			Limit:         backgroundLimit,
			WindowSeconds: 24 * 60 * 60,
			ResetAt:       &snapshot.ResetAt,
			Severity:      severityForPercent(percentOf(snapshot.BackgroundCostUSD(), backgroundLimit)),
			Unit:          "usd",
			Detail: fmt.Sprintf(
				"$%.3f remains reserved for wake-ups and commands; current allowance equals up to %d vehicle-data calls before the UTC reset.",
				float64(snapshot.CommandReserveMicroUSD)/float64(tesla.MicroUSDPerUSD),
				remainingVehicleDataCalls,
			),
		},
	}, nil
}

// teslaScope renders the client-side Fleet API token-bucket gauge.
// USAGE = burst - tokens (i.e. "tokens spent"); LIMIT = burst. This
// orientation matches the other scopes (current usage rises, limit is
// the ceiling) so the SPA bar renderer doesn't need a per-scope
// branch.
func (h *Handler) teslaScope(now time.Time) (ScopeBudget, bool) {
	if h.teslaClient == nil {
		return ScopeBudget{}, false
	}
	snap := h.teslaClient.BucketSnapshot()
	if snap.Burst <= 0 {
		// Defensive: an unconfigured limiter would yield 0 burst,
		// which would NaN-out severity calculations downstream.
		return ScopeBudget{}, false
	}
	burst := float64(snap.Burst)
	tokens := snap.Tokens
	if tokens > burst {
		tokens = burst
	}
	if tokens < 0 {
		tokens = 0
	}
	used := burst - tokens
	scope := ScopeBudget{
		ID:            RateLimitScopeTeslaFleetAPIBurst,
		Name:          "Tesla Fleet API burst",
		Current:       used,
		Limit:         burst,
		WindowSeconds: 0,
		Severity:      severityForPercent(percentOf(used, burst)),
		Detail:        "Client-side token bucket — refills at the configured Fleet API rate.",
	}
	// Reset = "when does the bucket fully refill?" — only meaningful
	// when at least one token has been consumed.
	if snap.Limit > 0 && used > 0 {
		secondsToFull := used / snap.Limit
		reset := now.Add(time.Duration(secondsToFull * float64(time.Second)))
		scope.ResetAt = &reset
	}
	return scope, true
}

// apiInternalScope renders the rolling 60-second count of every
// /api/v1 request the process has served.
func (h *Handler) apiInternalScope() (ScopeBudget, bool) {
	if h.apiCounter == nil {
		return ScopeBudget{}, false
	}
	current := float64(h.apiCounter.Count())
	limit := float64(h.apiLimit)
	return ScopeBudget{
		ID:            RateLimitScopeAPIInternalMinute,
		Name:          "Internal API requests",
		Current:       current,
		Limit:         limit,
		WindowSeconds: int(h.apiCounter.Window().Seconds()),
		Severity:      severityForPercent(percentOf(current, limit)),
		Detail:        "All /api/v1 requests handled by this process in the last minute.",
	}, true
}

// apiWriteScope is the same shape as apiInternalScope but limited to
// mutating HTTP methods (POST/PUT/PATCH/DELETE).
func (h *Handler) apiWriteScope() (ScopeBudget, bool) {
	if h.writeCounter == nil {
		return ScopeBudget{}, false
	}
	current := float64(h.writeCounter.Count())
	limit := float64(h.writeLimit)
	return ScopeBudget{
		ID:            RateLimitScopeAPIWriteMinute,
		Name:          "Internal API writes",
		Current:       current,
		Limit:         limit,
		WindowSeconds: int(h.writeCounter.Window().Seconds()),
		Severity:      severityForPercent(percentOf(current, limit)),
		Detail:        "POST / PUT / PATCH / DELETE requests handled in the last minute.",
	}, true
}

// percentOf is a divide-by-zero-safe percentage. Returns 0 when limit
// is non-positive so the severity ladder defaults to "ok" rather than
// painting a misleading red bar for a misconfigured scope.
func percentOf(current, limit float64) float64 {
	if limit <= 0 {
		return 0
	}
	return (current / limit) * 100.0
}

// severityForPercent maps a percentage onto the {ok, warn, critical}
// ladder. Thresholds live at the top of the file as package vars so
// tests can perturb them deterministically.
func severityForPercent(pct float64) string {
	if pct >= rateLimitCriticalThresholdPct {
		return RateLimitSeverityCritical
	}
	if pct >= rateLimitWarnThresholdPct {
		return RateLimitSeverityWarn
	}
	return RateLimitSeverityOK
}
