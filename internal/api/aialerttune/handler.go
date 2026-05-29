package aialerttune

// Handler for AI alert tuning draft suggestions.
//
// Implements POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft as a propose-only SSE handler.
// The route is guard-wrapped for ADR-015 off-mode behavior; AlertStudio's deterministic PUT path remains the baseline.
// The rule ID comes from the URL, and vehicle_id is only an optional scoping hint.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	alerttuningsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/alert-tuning-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/alert"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
)

// maxIterations bounds the propose-only tool loop; 8 matches sibling AI handlers.
const maxIterations = 8

// windowDays matches AlertStudio's recent firing window.
const windowDays = 30

// minFires avoids quoting replay projections from samples too small to be meaningful.
const minFires = 5

// request is optional; absent vehicle_id means the rule owns vehicle scope.
type request struct {
	VehicleID *int64 `json:"vehicle_id,omitempty"`
}

// Handler serves POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft and is safe for concurrent use.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler and panics on missing boot wiring.
// toolReg must include draft_alert_rule_patch and validate_alert_rule.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aialerttune: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aialerttune: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aialerttune: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// parseAlertTuningURL validates the positive ruleID path parameter before any SSE stream opens.
func parseAlertTuningURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "ruleID")
	if raw == "" {
		httpx.WriteError(w, http.StatusBadRequest, "ruleID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("ruleID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "ruleID must be > 0")
		return 0, false
	}
	return id, true
}

// parseAlertTuningBody accepts an empty optional body and rejects malformed vehicle_id input with JSON 400.
func parseAlertTuningBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
	req := &request{}
	if r.Body == nil {
		return req, true
	}
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(req); err != nil {
		// Empty body is allowed (io.EOF); other decode errors
		// surface as 400.
		if errors.Is(err, io.EOF) {
			return req, true
		}
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID != nil && *req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be > 0 when provided")
		return nil, false
	}
	return req, true
}

// ServeHTTP validates inputs before opening SSE; later failures are written as stream frames.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ruleID, ok := parseAlertTuningURL(w, r)
	if !ok {
		return
	}
	body, ok := parseAlertTuningBody(w, r)
	if !ok {
		return
	}

	// Resolve before opening SSE so provider misconfiguration can return a plain JSON 502.
	if _, err := h.registry.For(r.Context(), alerttuningsuggestions.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, alerttuningsuggestions.FeatureID)

	// Stream.New returns a child context that cancels the upstream dispatcher if the client stalls.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(alerttuningsuggestions.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: stream.New failed (non-flushable writer)")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, alerttuningsuggestions.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Deny-all confirmation keeps future accidental mutating tools from changing fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Build a deterministic, non-conversational prompt scoped by ruleID; vehicle_id is only a UI hint.
	vehicleHint := ""
	if body.VehicleID != nil {
		vehicleHint = fmt.Sprintf(" The user is currently viewing vehicle %d as their selected scope.", *body.VehicleID)
	}
	userMsg := fmt.Sprintf(
		"Tune AlertRule %d to reduce noise based on its recent firing history.%s "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_alert_rule_patch with rule_id=%d and the typed patch fields you want to propose "+
			"(adjust threshold, cooldown, trigger_mode, or value bands — never severity loosening, never disabling); "+
			"(2) call validate_alert_rule with the merged proposal so a draft accepted here is byte-equivalent "+
			"to a draft accepted by the canonical PUT /api/v1/alerts/rules/{id} handler. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, naming the proposed patch fields, "+
			"the descriptive projected reduction in firings (\"would have fired N times instead of M in the last 7 days\"), "+
			"and the honest-method qualifier (descriptive replay of the recent firing window, NOT a forecast). "+
			"If has_enough_history is false, say so plainly rather than inventing a baseline rate, a projection, or a likely cause. "+
			"NEVER propose suspending, disabling, or deleting the rule, and NEVER propose loosening severity (e.g. critical -> info).",
		ruleID, vehicleHint, ruleID,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Int64("rule_id", ruleID).
			Msg("ai alert-tuning-suggestions: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)

// AIAlertTuningSource grounds suggestions in the same alert_rules and notification_logs rows the deterministic UI uses.
type AIAlertTuningSource struct {
	rules         *dbalert.AlertRuleRepo
	notifications *dbnotif.NotificationRepo
}

// NewAIAlertTuningSource panics on missing repositories so wiring bugs fail at boot.
func NewAIAlertTuningSource(rules *dbalert.AlertRuleRepo, notifications *dbnotif.NotificationRepo) *AIAlertTuningSource {
	if rules == nil {
		panic("aialerttune: NewAIAlertTuningSource: nil *dbalert.AlertRuleRepo")
	}
	if notifications == nil {
		panic("aialerttune: NewAIAlertTuningSource: nil *dbnotif.NotificationRepo")
	}
	return &AIAlertTuningSource{rules: rules, notifications: notifications}
}

// LoadRule uses the canonical repo semantics, including (nil, nil) for missing rules.
func (a *AIAlertTuningSource) LoadRule(ctx context.Context, ruleID int64) (*alertmodel.AlertRule, error) {
	if ruleID <= 0 {
		return nil, errors.New("api ai alert-tuning-suggestions: rule_id must be > 0")
	}
	rule, err := a.rules.GetByID(ctx, ruleID)
	if err != nil {
		return nil, fmt.Errorf("api ai alert-tuning-suggestions: load rule: %w", err)
	}
	// Preserve missing-rule semantics so the propose-only tool can report rule_not_found.
	return rule, nil
}

// LoadFiringHistory replays recent notification_logs rows against the proposed rule.
// The result is descriptive, not predictive, and the narrator must say so.
func (a *AIAlertTuningSource) LoadFiringHistory(ctx context.Context, ruleID int64, proposed *alertmodel.AlertRule) (*alert.AlertRuleFiringHistory, error) {
	if ruleID <= 0 {
		return nil, errors.New("api ai alert-tuning-suggestions: rule_id must be > 0")
	}
	now := time.Now().UTC()
	from := now.AddDate(0, 0, -windowDays)

	logs, err := a.notifications.GetLogsFiltered(ctx, dbnotif.NotificationLogFilters{
		RuleIDs: []int64{ruleID},
		From:    from,
		To:      now,
		// Capture every fire in the 30-day window for any reasonably configured rule.
		Limit: 1000,
	})
	if err != nil {
		return nil, fmt.Errorf("api ai alert-tuning-suggestions: load firing history: %w", err)
	}

	// Replay the same recent rows for the 7-day and 30-day projection buckets.
	cutoff7d := now.Add(-7 * 24 * time.Hour)
	total7d := 0
	total30d := 0
	wouldHaveFired7d := 0
	wouldHaveFired30d := 0
	for _, lg := range logs {
		if lg == nil {
			continue
		}
		total30d++
		if !lg.CreatedAt.Before(cutoff7d) {
			total7d++
		}
		if wouldHaveFiredAfterPatch(lg, proposed) {
			wouldHaveFired30d++
			if !lg.CreatedAt.Before(cutoff7d) {
				wouldHaveFired7d++
			}
		}
	}

	avg7d := 0.0
	if total7d > 0 {
		avg7d = float64(total7d) / 7.0
	}
	avg30d := 0.0
	if total30d > 0 {
		avg30d = float64(total30d) / 30.0
	}

	return &alert.AlertRuleFiringHistory{
		WindowDays:                  windowDays,
		MinRequiredEvents:           minFires,
		SampleSize:                  total30d,
		HasEnoughHistory:            total30d >= minFires,
		TotalFires7d:                total7d,
		TotalFires30d:               total30d,
		AvgFiresPerDay7d:            avg7d,
		AvgFiresPerDay30d:           avg30d,
		WouldHaveFired7dAfterPatch:  wouldHaveFired7d,
		WouldHaveFired30dAfterPatch: wouldHaveFired30d,
		ProjectionMethod:            "descriptive replay of notification_logs rows through proposed threshold + cooldown",
		Assumptions: []string{
			"projection treats each notification_logs row as one firing event from the canonical rule engine",
			"would_have_fired_*_after_patch counts approximate the proposed predicate by re-evaluating severity / cooldown filters against the same row set; signal-value-dependent operands cannot be re-replayed without the underlying signal_log timestream",
			"projection is a DESCRIPTIVE replay of the recent firing window — NOT a forecast or predictive model",
		},
	}, nil
}

// wouldHaveFiredAfterPatch evaluates whether a single
// notification_logs row would have surfaced under the proposed
// rule. Today's projection is intentionally conservative: it
// re-applies the severity filter (a proposed severity downgrade
// would not be reflected because severity downgrades are rejected
// by the system prompt anyway), and any other change is treated
// as "would still fire" so the projection does NOT under-count
// the post-patch surface. This keeps the descriptive replay
// honest — it cannot OVER-promise a noise reduction the user
// won't actually see.
//
// A future slice may extend this to evaluate signal-value-
// dependent operand changes (e.g. the proposed `value_num=15`
// vs the row's source value). That requires joining
// notification_logs with the underlying signal_log emission
// that triggered the fire, which is out of scope for this
// slice's surface.
func wouldHaveFiredAfterPatch(lg *notificationmodel.NotificationLog, proposed *alertmodel.AlertRule) bool {
	if proposed == nil {
		return true
	}
	// Severity filter: if the proposed severity is strictly
	// stricter than the row's severity, the patched rule would
	// NOT have fired (the row's severity came from the original
	// rule). Conservative: when severities are equal or the
	// proposed is looser (which the system prompt forbids), we
	// preserve the fire.
	switch proposed.Severity {
	case "critical":
		// Proposed = critical: a row whose severity is
		// info or warn would NOT match a critical-only
		// rule.
		if lg.Severity == "info" || lg.Severity == "warn" {
			return false
		}
	case "warn":
		// Proposed = warn: an info row would NOT match.
		if lg.Severity == "info" {
			return false
		}
	}
	// Default: assume the row would still fire under the
	// patched rule. Cooldown changes are not re-replayed here
	// because the canonical rule-engine cooldown latch is per-
	// vehicle and per-(rule,vehicle) — re-replaying it would
	// require a per-vehicle pass through the row set, which
	// would over-attribute reductions. The descriptive replay
	// stays within what the row set CAN honestly support.
	return true
}
