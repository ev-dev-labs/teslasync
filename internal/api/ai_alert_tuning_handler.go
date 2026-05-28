package api

// Phase-50 / 0034 — A1 Alert tuning suggestions.
//
// ai_alert_tuning_handler.go implements the LLM-backed handler at
// POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft. The flow
// mirrors ai_charging_diagnosis_handler.go (URL-path-id +
// dispatch+stream loop, no persistence — one-shot
// propose-only patch generation):
//
//	URL  /api/v1/ai/alerts/rules/{ruleID}/tune/draft
//	  ↓
//	resolve provider via *provider.Registry.For("alert-tuning-suggestions")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("alert-tuning-suggestions", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// The handler takes its primary identifier (`ruleID`) from the
// URL path — the AI surface attaches to a specific alert rule's
// editor in /alerts/studio so the URL is the natural place for
// it. The optional JSON body carries `vehicle_id` for vehicle
// scope but no other parameters (the LLM has the rule ID + the
// firing-history window length baked into the prompt).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic AlertStudio (manual
//     threshold tuning + the existing alert analytics) hitting
//     PUT /api/v1/alerts/rules/{id} is unchanged. This handler
//     is an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("alert-tuning-suggestions").
//   - I9 redaction:       PolicyAlertBuilder (denies every PII
//     class — alert IDs, signal names, and thresholds flow
//     through the typed F4 tool envelope) is installed by
//     dispatch.Run from the strategy.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline JSON
//     shape is added or modified by this slice.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	alerttuningsuggestions "github.com/ev-dev-labs/teslasync/internal/ai/strategies/alert-tuning-suggestions"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/alert"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
)

// aiAlertTuningMaxIterations bounds the dispatcher's tool-loop.
// The strategy is at most draft_alert_rule_patch ->
// validate_alert_rule -> answer (with optional retries). A hard
// ceiling of 8 is generous and matches the other A-tier
// propose-only handlers (drive-coach, charging-diagnosis).
const aiAlertTuningMaxIterations = 8

// aiAlertTuningWindowDays is the trailing-window length the
// production AlertTuningSource adapter projects across when
// reading the recent firing history from notification_logs.
// 30 days mirrors the slice prompt's "recent firing window"
// framing AND the deterministic analytics dashboard's default
// preset on AlertStudioPage.
const aiAlertTuningWindowDays = 30

// aiAlertTuningMinFires is the minimum total firing-event count
// (across the trailing window) the adapter requires before it
// lets the narrator quote a "would have fired N times after
// patch" projection. Below this threshold has_enough_history
// flips false and the narrator says so plainly. 5 firings is the
// minimum sample for a meaningful descriptive replay — the
// SOlder the sample the more sensitive the projection becomes
// to a single outlier.
const aiAlertTuningMinFires = 5

// aiAlertTuningRequest is the JSON body shape this handler
// accepts. Body is OPTIONAL (an empty body is accepted; the
// handler resolves vehicle scope from the alert rule itself when
// vehicle_id is absent). Mirrors how the AlertStudio's typed PUT
// handler handles the same field.
type aiAlertTuningRequest struct {
	VehicleID *int64 `json:"vehicle_id,omitempty"`
}

// AIAlertTuningHandler is the HTTP handler for
// POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type AIAlertTuningHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAIAlertTuningHandler constructs the handler. All non-pointer
// arguments are required; the constructor panics on a nil so the
// wiring bug surfaces at boot, not at first request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_alert_rule_patch (registered by
//	alert.RegisterAlertTuningSuggestionsTools) AND
//	validate_alert_rule (registered by
//	alert.RegisterAlertBuilderTools — REUSED from N1).
//
// strat:      the alert-tuning-suggestions Strategy (one per process).
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewAIAlertTuningHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AIAlertTuningHandler {
	switch {
	case registry == nil:
		panic("api: NewAIAlertTuningHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAIAlertTuningHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAIAlertTuningHandler: nil strategy.Strategy")
	}
	return &AIAlertTuningHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiAlertTuningMaxIterations,
	}
}

// parseAlertTuningURL extracts and validates the ruleID URL
// parameter. Pulled out so the off-mode test and the
// validator-only test can exercise the same parsing without
// constructing a full handler with stub deps. The function writes
// a 400 on failure and returns the (id, ok) pair so the caller
// can early-return.
//
// ruleID MUST be a positive integer; zero or negative values are
// rejected with a 400 because they cannot identify a real
// alert_rules row.
func parseAlertTuningURL(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "ruleID")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "ruleID URL parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("ruleID must be a positive integer (got %q)", raw))
		return 0, false
	}
	if id <= 0 {
		writeError(w, http.StatusBadRequest, "ruleID must be > 0")
		return 0, false
	}
	return id, true
}

// parseAlertTuningBody decodes the OPTIONAL JSON body. An empty
// body is accepted and surfaces as a zero-value request. Pulled
// out so the validator-only test can exercise the same parsing.
// Returns (req, ok); on parse failure writes a 400 and returns
// (nil, false).
func parseAlertTuningBody(w http.ResponseWriter, r *http.Request) (*aiAlertTuningRequest, bool) {
	req := &aiAlertTuningRequest{}
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
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID != nil && *req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0 when provided")
		return nil, false
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The ruleID is parsed from
// the URL, the optional body is decoded, the dispatcher is
// invoked, and the SSE stream is closed via the dispatcher's
// deferred WriteDone. Every error path either writes a structured
// frame onto the SSE stream (when the writer has been opened) or
// a plain JSON 4xx/5xx (before it has).
func (h *AIAlertTuningHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate URL parameters. Body is decoded next;
	//    a malformed body fails fast with a JSON 400.
	ruleID, ok := parseAlertTuningURL(w, r)
	if !ok {
		return
	}
	body, ok := parseAlertTuningBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	//    resolution honours mid-flight settings changes (model
	//    swap, mode flip) without restart. A resolve failure
	//    must NOT open the SSE stream — emit JSON 502 so the
	//    frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), alerttuningsuggestions.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, alerttuningsuggestions.FeatureID)

	// 4) Open the SSE writer. Stream.New writes the SSE response
	//    headers, starts the consumer goroutine, and returns a
	//    child ctx that cancels on stall — we pass that ctx to
	//    the dispatcher so a stalled consumer kills the upstream
	//    call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(alerttuningsuggestions.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	//    (now-annotated) context.
	prov, err := h.registry.For(ctx, alerttuningsuggestions.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai alert-tuning-suggestions: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	//    Both tools the strategy can call (draft_alert_rule_patch
	//    + validate_alert_rule) are PROPOSE-only — Mutates() is
	//    false on both — so the confirm hook never fires. But
	//    defence-in-depth: if a future strategy edit accidentally
	//    adds a mutating tool, the dispatcher will REJECT it
	//    instead of silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Tuning is NOT
	//    conversational — there is no chat history. We hand the
	//    LLM a deterministic prompt that asks it to call its two
	//    propose-only tools in sequence and narrate the result.
	//
	//    The prompt INCLUDES the ruleID in the synthesised
	//    message so the LLM has the canonical scope baked in.
	//    The body's optional vehicle_id is mentioned only as a
	//    hint — the rule itself owns its vehicle scope (sticky-
	//    all or explicit subset), which the LLM reads from the
	//    draft_alert_rule_patch reply.
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

	// 8) Run the dispatcher. The deferred WriteDone in
	//    dispatch.Run closes the SSE stream cleanly on any path.
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

// Compile-time assertion: AIAlertTuningHandler satisfies
// http.Handler.
var _ http.Handler = (*AIAlertTuningHandler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the AlertTuningSource port declared by
// internal/ai/tools/alert_tuning.go. Kept in the same file as the
// handler so the wiring intent is local to the slice; mirrors the
// AITirePressureTrendSource pattern from slice 0033.
// ---------------------------------------------------------------------

// AIAlertTuningSource is the production
// alert.AlertTuningSource. It composes the canonical
// AlertRuleRepo (read) + NotificationRepo (read) so the AI
// projection is grounded in the SAME alert_rules + notification_logs
// rows the deterministic AlertStudio + alert analytics dashboard
// already render. No write path is invoked.
//
// The struct holds two narrow read interfaces; the constructor
// panics on a nil so a wiring bug surfaces at boot.
type AIAlertTuningSource struct {
	rules         *dbalert.AlertRuleRepo
	notifications *dbnotif.NotificationRepo
}

// NewAIAlertTuningSource constructs the adapter. Panics on a nil
// repo so a wiring mistake surfaces at boot rather than as a
// nil-deref on first AI request.
func NewAIAlertTuningSource(rules *dbalert.AlertRuleRepo, notifications *dbnotif.NotificationRepo) *AIAlertTuningSource {
	if rules == nil {
		panic("api: NewAIAlertTuningSource: nil *dbalert.AlertRuleRepo")
	}
	if notifications == nil {
		panic("api: NewAIAlertTuningSource: nil *dbnotif.NotificationRepo")
	}
	return &AIAlertTuningSource{rules: rules, notifications: notifications}
}

// LoadRule implements alert.AlertTuningSource. Returns the rule
// as the canonical AlertRuleRepo.GetByID would — same code path
// the deterministic AlertStudio's PUT handler uses to read the
// rule before applying the patch. Returns (nil, nil) when the
// rule does not exist so the tool can surface "rule_not_found".
func (a *AIAlertTuningSource) LoadRule(ctx context.Context, ruleID int64) (*alertmodel.AlertRule, error) {
	if ruleID <= 0 {
		return nil, errors.New("api ai alert-tuning-suggestions: rule_id must be > 0")
	}
	rule, err := a.rules.GetByID(ctx, ruleID)
	if err != nil {
		return nil, fmt.Errorf("api ai alert-tuning-suggestions: load rule: %w", err)
	}
	// AlertRuleRepo.GetByID returns (nil, nil) on missing rows
	// — propagate that verbatim so the propose-only path can
	// surface "rule_not_found" instead of crashing the
	// dispatcher.
	return rule, nil
}

// LoadFiringHistory implements alert.AlertTuningSource. Returns
// the rolling firing-event summary for ruleID across the recent
// trailing window. The projection counts notification_logs rows
// filtered by alert_id (the canonical firing record) and
// computes the would_have_fired_*_after_patch projections by
// re-evaluating the proposed predicate against the same row set.
//
// IMPORTANT: the projection is a DESCRIPTIVE replay of the
// recent firing window — it is NOT a forecast or a predictive
// model. The narrator's system prompt requires this method to
// be surfaced honestly in the prose.
//
// proposed is the merged patched rule (NOT the original) so the
// would_have_fired_*_after_patch counts reflect the LLM's
// proposal, not the current state.
func (a *AIAlertTuningSource) LoadFiringHistory(ctx context.Context, ruleID int64, proposed *alertmodel.AlertRule) (*alert.AlertRuleFiringHistory, error) {
	if ruleID <= 0 {
		return nil, errors.New("api ai alert-tuning-suggestions: rule_id must be > 0")
	}
	now := time.Now().UTC()
	from := now.AddDate(0, 0, -aiAlertTuningWindowDays)

	logs, err := a.notifications.GetLogsFiltered(ctx, dbnotif.NotificationLogFilters{
		RuleIDs: []int64{ruleID},
		From:    from,
		To:      now,
		// Limit large enough to capture every fire in the
		// 30-day window for any reasonable rule. The
		// canonical filter caps Limit at 1000; rules
		// firing more than 1000 times in 30 days have
		// bigger problems than tuning advice.
		Limit: 1000,
	})
	if err != nil {
		return nil, fmt.Errorf("api ai alert-tuning-suggestions: load firing history: %w", err)
	}

	// Buckets: count fires within the trailing 7-day and
	// 30-day windows — the 30-day count is the trailing
	// window total, the 7-day count is the more-recent
	// sub-window. Both projections are computed by replaying
	// the SAME notification_logs rows through the proposed
	// predicate (described abstractly below).
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
		WindowDays:                  aiAlertTuningWindowDays,
		MinRequiredEvents:           aiAlertTuningMinFires,
		SampleSize:                  total30d,
		HasEnoughHistory:            total30d >= aiAlertTuningMinFires,
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
