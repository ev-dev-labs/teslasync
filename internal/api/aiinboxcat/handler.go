package aiinboxcat

// Inbox auto-categorization handler.
//
// ai_inbox_categorization_handler.go implements the LLM-backed
// handler at POST /api/v1/ai/alerts/inbox/categorize. The flow
// mirrors ai_alert_tuning_handler.go (body-decoded scope +
// dispatch+stream loop, no persistence — one-shot propose-only
// category proposal):
//
//	URL  POST /api/v1/ai/alerts/inbox/categorize
//	  ↓
//	resolve provider via *provider.Registry.For("inbox-auto-categorization")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("inbox-auto-categorization", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// The handler takes its inbox scope from the JSON body (no URL
// path parameters): vehicle_id?, window_days?, severities?[],
// rule_ids?[]. All fields are optional; an empty body asks the
// LLM to categorize the entire inbox over the default 7-day
// window. The frontend's InboxBody composes the body from the
// current NotificationFilterBar URL state so the AI sees the
// same scope the user is looking at.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic NotificationFilterBar
//     + URL-backed inbox at /notifications/inbox is unchanged.
//     This handler is an OPT-IN add-on; off-mode users never see
//     it. The "Apply" mechanism in the SPA copies the suggested
//     rule_ids into the existing filter URL state — same baseline
//     write/state path the user has always had.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("inbox-auto-categorization").
//   - I9 redaction:       PolicyAlertBuilder (denies every PII
//     class — alert IDs, signal names, and notification text flow
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
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	inboxautocategorization "github.com/ev-dev-labs/teslasync/internal/ai/strategies/inbox-auto-categorization"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nl"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
)

// maxIterations bounds the dispatcher's
// tool-loop. The strategy is at most draft_alert_categories ->
// validate_alert_category(per label) -> answer (with optional
// retries). A hard ceiling of 8 is generous and matches the
// other A-tier propose-only handlers.
const maxIterations = 8

// defaultWindowDays is the trailing-window length the production
// InboxCategorizationSource adapter projects across when reading
// recent notification_logs. Seven days mirrors the canonical
// "recent" window used elsewhere.
const defaultWindowDays = 7

// minEvents is the minimum total
// notification_logs row count (across the trailing window) the
// adapter requires before it lets the narrator quote per-
// category counts. Below this threshold has_enough_history flips
// false and the narrator says so plainly. 10 is the minimum
// sample for a meaningful descriptive tally — fewer notifications
// makes any per-category breakdown statistically meaningless.
const minEvents = 10

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// request is the JSON body shape this
// handler accepts. Body is OPTIONAL (an empty body is accepted;
// the handler defaults to the entire inbox over the last
// defaultWindowDays days). Mirrors how the
// canonical NotificationFilterBar URL params already work.
type request struct {
	// VehicleID restricts the recent window to a single
	// vehicle. Optional — when absent the handler returns
	// the per-category counts across every vehicle the
	// caller owns. The AI guard's per-feature toggle gate
	// runs upstream; ownership scoping is handled by the
	// canonical NotificationRepo path the source adapter
	// goes through.
	VehicleID *int64 `json:"vehicle_id,omitempty"`

	// WindowDays is the lookback in days. Defaults to
	// defaultWindowDays when nil.
	// Capped at 90 by the tool's input validator so a
	// runaway request cannot scan an unbounded range.
	WindowDays *int `json:"window_days,omitempty"`

	// Severities optionally restricts the tally to a
	// subset of severity tiers. Empty / nil ⇒ no severity
	// filter.
	Severities []string `json:"severities,omitempty"`

	// RuleIDs optionally restricts the tally to a subset
	// of alert rule IDs. Empty / nil ⇒ no rule filter.
	RuleIDs []int64 `json:"rule_ids,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/alerts/inbox/categorize.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired once
// at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics on
// a nil so the wiring bug surfaces at boot, not at first
// request.
//
// registry:   AI provider registry (decorator chain already applied).
// toolReg:    process-wide tool registry. MUST contain
//
//	draft_alert_categories AND validate_alert_category
//	(both registered by
//	nl.RegisterInboxAutoCategorizationTools).
//
// strat:      the inbox-auto-categorization Strategy (one per process).
// headerName: forward-auth header name; used to extract subject
//
//	for audit.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aiinboxcat: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aiinboxcat: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aiinboxcat: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

// parseInboxCategorizationBody decodes the OPTIONAL JSON body.
// An empty body is accepted and surfaces as a zero-value
// request. Pulled out so the validator-only tests can exercise
// the same parsing without a full handler. Returns (req, ok);
// on parse failure writes a 400 and returns (nil, false).
//
// Severity values are validated against the canonical {info,
// warn, critical} set; vehicle_id and rule_id values must be
// positive when provided; window_days must be in [1, 90].
func parseInboxCategorizationBody(w http.ResponseWriter, r *http.Request) (*request, bool) {
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
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return nil, false
	}
	if req.VehicleID != nil && *req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be > 0 when provided")
		return nil, false
	}
	if req.WindowDays != nil {
		if *req.WindowDays < 1 || *req.WindowDays > 90 {
			writeError(w, http.StatusBadRequest, "window_days must be between 1 and 90 when provided")
			return nil, false
		}
	}
	for _, sev := range req.Severities {
		switch sev {
		case "info", "warn", "critical":
		default:
			writeError(w, http.StatusBadRequest, fmt.Sprintf("severity must be one of info|warn|critical (got %q)", sev))
			return nil, false
		}
	}
	for _, rid := range req.RuleIDs {
		if rid <= 0 {
			writeError(w, http.StatusBadRequest, "rule_ids entries must all be > 0")
			return nil, false
		}
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The optional JSON body
// is decoded, the dispatcher is invoked, and the SSE stream is
// closed via the dispatcher's deferred WriteDone. Every error
// path either writes a structured frame onto the SSE stream
// (when the writer has been opened) or a plain JSON 4xx/5xx
// (before it has).
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate body. A malformed body fails fast
	//    with a JSON 400 before any provider lookup.
	body, ok := parseInboxCategorizationBody(w, r)
	if !ok {
		return
	}

	// 2) Resolve provider via the registry. Per-request
	//    resolution honours mid-flight settings changes (model
	//    swap, mode flip) without restart. A resolve failure
	//    must NOT open the SSE stream — emit JSON 502 so the
	//    frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), inboxautocategorization.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai inbox-auto-categorization: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 3) Subject + feature-id annotations for audit/rate-limit.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, inboxautocategorization.FeatureID)

	// 3b) Install the request-validated inbox scope so the
	//     draft_alert_categories tool can refuse any LLM-supplied
	//     vehicle_id that does not match what the caller actually
	//     asked for (defence against prompt-injection exfiltration
	//     — a malicious notification title/body cannot trick the
	//     LLM into loading a different vehicle's inbox). Mirrors
	//     the WithScopedLogTraceWindow / WithScopedFSMTraceWindow
	//     pattern used by the sibling summarization handlers.
	scopedVehicleID := int64(0)
	if body.VehicleID != nil {
		scopedVehicleID = *body.VehicleID
	}
	ctx = nl.WithScopedInboxCategorizationWindow(ctx, nl.ScopedInboxCategorizationWindow{
		VehicleID: scopedVehicleID,
	})

	// 4) Open the SSE writer. Stream.New writes the SSE response
	//    headers, starts the consumer goroutine, and returns a
	//    child ctx that cancels on stall — we pass that ctx to
	//    the dispatcher so a stalled consumer kills the upstream
	//    call.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(inboxautocategorization.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai inbox-auto-categorization: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 5) Resolve the per-feature provider from the
	//    (now-annotated) context.
	prov, err := h.registry.For(ctx, inboxautocategorization.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai inbox-auto-categorization: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 6) Build the dispatcher with the deny-all confirm hook.
	//    Both tools the strategy can call (draft_alert_categories
	//    + validate_alert_category) are PROPOSE-only — Mutates()
	//    is false on both — so the confirm hook never fires. But
	//    defence-in-depth: if a future strategy edit accidentally
	//    adds a mutating tool, the dispatcher will REJECT it
	//    instead of silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 7) Synthesise the user message. Categorization is NOT
	//    conversational — there is no chat history. We hand the
	//    LLM a deterministic prompt that asks it to call its two
	//    propose-only tools in sequence and narrate the result.
	//
	//    The prompt INCLUDES the in-scope vehicle/window/severity
	//    hints so the LLM has the canonical scope baked in. The
	//    body's optional vehicle_id is mentioned only as a hint
	//    — the typed envelope returned by draft_alert_categories
	//    is the source of truth.
	windowDays := defaultWindowDays
	if body.WindowDays != nil {
		windowDays = *body.WindowDays
	}

	scopeHint := ""
	if body.VehicleID != nil {
		scopeHint = fmt.Sprintf(" The user is currently viewing vehicle %d as their selected scope.", *body.VehicleID)
	}
	sevHint := ""
	if len(body.Severities) > 0 {
		sevHint = fmt.Sprintf(" The current severity filter is [%s].", strings.Join(body.Severities, ", "))
	}
	ruleHint := ""
	if len(body.RuleIDs) > 0 {
		ids := make([]string, 0, len(body.RuleIDs))
		for _, id := range body.RuleIDs {
			ids = append(ids, fmt.Sprintf("%d", id))
		}
		ruleHint = fmt.Sprintf(" The current rule_id filter is [%s].", strings.Join(ids, ", "))
	}

	userMsg := fmt.Sprintf(
		"Categorize the inbox over the last %d days.%s%s%s "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call draft_alert_categories with the in-scope filter (vehicle_id, window_days, severities, rule_ids — pass only the fields the user supplied); "+
			"(2) call validate_alert_category on EVERY proposed label so a label accepted here is byte-equivalent to a label drawn from the closed taxonomy. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, naming the top 1-3 dominant categories, "+
			"the descriptive counts (\"23 of 47 in the last %d days are battery\"), "+
			"and the honest-method qualifier (descriptive tally of the recent notification window grouped by signal_name -> category mapping, NOT a forecast or predictive model). "+
			"If has_enough_history is false, say so plainly rather than inventing a baseline rate, a category breakdown, or a likely cause. "+
			"NEVER propose archiving, deleting, marking-read, or re-classifying any notification — your role is to surface the dominant categories so the user can apply a filter themselves.",
		windowDays, scopeHint, sevHint, ruleHint, windowDays,
	)

	// 8) Run the dispatcher. The deferred WriteDone in
	//    dispatch.Run closes the SSE stream cleanly on any path.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Msg("ai inbox-auto-categorization: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

// ---------------------------------------------------------------------
// Production wiring for the InboxCategorizationSource port declared by
// internal/ai/tools/inbox_auto_categorization.go. Kept in the same file
// as the handler so the wiring intent is local to the slice; mirrors
// the AIAlertTuningSource pattern from slice 0034.
// ---------------------------------------------------------------------

// Source is the production
// nl.InboxCategorizationSource. It composes the canonical
// NotificationRepo (read) + AlertRuleRepo (read) so the AI
// projection is grounded in the SAME notification_logs +
// alert_rules rows the deterministic InboxBody renders. No
// write path is invoked.
//
// The struct holds two narrow read interfaces; the constructor
// panics on a nil so a wiring bug surfaces at boot.
type Source struct {
	notifications *dbnotif.NotificationRepo
	rules         *dbalert.AlertRuleRepo
}

// NewSource constructs the adapter. Panics
// on a nil repo so a wiring mistake surfaces at boot rather
// than as a nil-deref on first AI request.
func NewSource(notifications *dbnotif.NotificationRepo, rules *dbalert.AlertRuleRepo) *Source {
	if notifications == nil {
		panic("aiinboxcat: NewSource: nil *dbnotif.NotificationRepo")
	}
	if rules == nil {
		panic("aiinboxcat: NewSource: nil *dbalert.AlertRuleRepo")
	}
	return &Source{notifications: notifications, rules: rules}
}

// LoadCategoryCounts implements
// nl.InboxCategorizationSource. Reads the
// notification_logs window via the canonical
// NotificationRepo.GetLogsFiltered, looks up each unique
// alert_id's signal_name via AlertRuleRepo.GetByID, buckets the
// rows via nl.BucketByCategory, and returns the sorted
// per-category tally.
//
// The returned counts slice is sorted by Count DESC then Label
// ASC so the LLM's narration is reproducible across calls with
// the same window. totalInWindow equals the sum of
// CategoryCount.Count across the returned slice (NOT the raw
// notification_logs row count — rows whose alert_id is missing
// from the rules lookup bucket into "other").
func (a *Source) LoadCategoryCounts(ctx context.Context, f dbnotif.NotificationLogFilters) ([]nl.CategoryCount, int, int, error) {
	// Defence in depth: clamp the limit so a runaway caller
	// cannot blow past the canonical 1000-row cap. The tool
	// already sets Limit=1000; this is belt-and-suspenders.
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 1000
	}

	logs, err := a.notifications.GetLogsFiltered(ctx, f)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("api ai inbox-auto-categorization: load notification_logs: %w", err)
	}

	// Build the alert_id -> signal_name lookup table from the
	// canonical AlertRuleRepo. We only fetch the unique alert
	// IDs the row set actually references — there is no need
	// to scan the entire alert_rules table.
	uniqueAlertIDs := make(map[int64]struct{}, len(logs))
	for _, lg := range logs {
		if lg == nil || lg.AlertID == nil {
			continue
		}
		uniqueAlertIDs[*lg.AlertID] = struct{}{}
	}

	signalLookup := make(map[int64]string, len(uniqueAlertIDs))
	for id := range uniqueAlertIDs {
		rule, err := a.rules.GetByID(ctx, id)
		if err != nil {
			// One missing rule must not collapse the entire
			// categorization — log + treat as "other" by
			// leaving the lookup absent.
			log.Warn().Err(err).Int64("alert_id", id).Msg("ai inbox-auto-categorization: AlertRuleRepo.GetByID failed; row will bucket into other")
			continue
		}
		if rule == nil {
			// Rule was deleted after the notification fired
			// — bucket into "other" by leaving the lookup
			// absent.
			continue
		}
		// Computed_metric rules don't have a signal_name; use
		// the metric_id as the substring source so the
		// bucketing helper can still classify them.
		if rule.SignalName != "" {
			signalLookup[id] = rule.SignalName
		} else if rule.MetricID != nil {
			signalLookup[id] = *rule.MetricID
		}
	}

	counts := nl.BucketByCategory(logs, signalLookup)

	// totalInWindow is the sum of the bucketed counts so the
	// envelope's HasEnoughHistory threshold compares
	// like-with-like (the per-category Count is what the LLM
	// sees; the unclamped row count would be misleading if a
	// large fraction failed to bucket).
	total := 0
	for _, c := range counts {
		total += c.Count
	}

	return counts, total, minEvents, nil
}
