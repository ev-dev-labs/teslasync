package aicrossrule

// Phase-50 / 0036 — A3 cross-rule conflict detection.
// This opt-in AI handler streams propose-only conflict analysis for the current
// AlertStudio rule scope; guard.Wrap enforces ADR-015 off-mode and per-feature
// gating before provider resolution.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	crossruleconflictdetection "github.com/ev-dev-labs/teslasync/internal/ai/strategies/cross-rule-conflict-detection"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnostic"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
)

// aiCrossRuleConflictMaxIterations bounds the dispatcher's
// tool-loop. The strategy is at most query_alert_rules ->
// detect_rule_conflicts -> answer (with optional retries). A
// hard ceiling of 8 is generous and matches the other A-tier
// propose-only handlers.
const aiCrossRuleConflictMaxIterations = 8

// aiCrossRuleConflictDefaultLimit mirrors the tool's default
// (crossRuleConflictDefaultLimit) so a runaway request cannot
// scan an unbounded rule set. 500 is well above the canonical
// AlertStudio's typical surface (~50 rules).
const aiCrossRuleConflictDefaultLimit = 500

// aiCrossRuleConflictMaxLimit is the absolute hard cap the
// body validator enforces. Mirrors the tool's
// crossRuleConflictMaxLimit so a body-side cap never lets a
// caller pass a value the tool would later reject.
const aiCrossRuleConflictMaxLimit = 1000

// aiCrossRuleConflictRequest is the JSON body shape this
// handler accepts. Body is OPTIONAL (an empty body is accepted;
// the handler defaults to EnabledOnly=true across every rule
// the caller owns). Mirrors the shape the tool already
// validates.
type aiCrossRuleConflictRequest struct {
	// VehicleID restricts the analysis to rules that apply
	// to the named vehicle. Optional.
	VehicleID *int64 `json:"vehicle_id,omitempty"`

	// SignalName restricts the analysis to rules on the
	// named signal. Optional.
	SignalName string `json:"signal_name,omitempty"`

	// RuleIDs restricts the analysis to the named subset.
	// Optional. Empty / nil ⇒ no rule_id filter.
	RuleIDs []int64 `json:"rule_ids,omitempty"`

	// EnabledOnly restricts the analysis to enabled rules
	// at the SQL layer. Optional, defaults to true.
	EnabledOnly *bool `json:"enabled_only,omitempty"`

	// Limit caps the result. Optional + bounded.
	Limit *int `json:"limit,omitempty"`
}

// Handler is the HTTP handler for
// POST /api/v1/ai/alerts/rules/conflicts.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired
// once at boot.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler constructs the handler. All
// non-pointer arguments are required; the constructor panics
// on a nil so the wiring bug surfaces at boot, not at first
// request.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aicrossrule: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aicrossrule: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aicrossrule: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiCrossRuleConflictMaxIterations,
	}
}

// parseCrossRuleConflictBody decodes the OPTIONAL JSON body.
// An empty body is accepted and surfaces as a zero-value
// request. Pulled out so the validator-only tests can exercise
// the same parsing without a full handler. Returns (req, ok);
// on parse failure writes a 400 and returns (nil, false).
//
// vehicle_id and rule_id values must be positive when
// provided; signal_name length is capped at 128 chars; limit
// must be in [1, aiCrossRuleConflictMaxLimit].
func parseCrossRuleConflictBody(w http.ResponseWriter, r *http.Request) (*aiCrossRuleConflictRequest, bool) {
	req := &aiCrossRuleConflictRequest{}
	if r.Body == nil {
		return req, true
	}
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(req); err != nil {
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
	if len(req.SignalName) > 128 {
		writeError(w, http.StatusBadRequest, "signal_name must be ≤ 128 chars when provided")
		return nil, false
	}
	for _, rid := range req.RuleIDs {
		if rid <= 0 {
			writeError(w, http.StatusBadRequest, "rule_ids entries must all be > 0")
			return nil, false
		}
	}
	if req.Limit != nil {
		if *req.Limit < 1 || *req.Limit > aiCrossRuleConflictMaxLimit {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("limit must be between 1 and %d when provided", aiCrossRuleConflictMaxLimit))
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
	body, ok := parseCrossRuleConflictBody(w, r)
	if !ok {
		return
	}

	if _, err := h.registry.For(r.Context(), crossruleconflictdetection.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai cross-rule-conflict-detection: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, crossruleconflictdetection.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(crossruleconflictdetection.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai cross-rule-conflict-detection: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, crossruleconflictdetection.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai cross-rule-conflict-detection: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// Build the dispatcher with the deny-all confirm hook. Both
	// tools the strategy can call (query_alert_rules +
	// detect_rule_conflicts) are PROPOSE-only so the confirm
	// hook never fires. Defence-in-depth: if a future strategy
	// edit accidentally adds a mutating tool, the dispatcher
	// will REJECT it instead of silently mutating fleet state.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// Compose the user message. Conflict detection is NOT
	// conversational — there is no chat history. We hand the
	// LLM a deterministic prompt that asks it to call its two
	// propose-only tools in sequence and narrate the result.
	scopeHint := ""
	if body.VehicleID != nil {
		scopeHint = fmt.Sprintf(" The user is currently viewing vehicle %d as their selected scope.", *body.VehicleID)
	}
	signalHint := ""
	if body.SignalName != "" {
		signalHint = fmt.Sprintf(" The current signal_name filter is %q.", body.SignalName)
	}
	ruleHint := ""
	if len(body.RuleIDs) > 0 {
		ids := make([]string, 0, len(body.RuleIDs))
		for _, id := range body.RuleIDs {
			ids = append(ids, fmt.Sprintf("%d", id))
		}
		ruleHint = fmt.Sprintf(" The current rule_id filter is [%s].", strings.Join(ids, ", "))
	}
	enabledOnlyHint := " EnabledOnly defaults to true."
	if body.EnabledOnly != nil && !*body.EnabledOnly {
		enabledOnlyHint = " The caller asked for ALL rules (enabled_only=false), but disabled rules are skipped by the structural detector regardless."
	}

	userMsg := fmt.Sprintf(
		"Detect cross-rule conflicts in the user's alert rules.%s%s%s%s "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_alert_rules with the in-scope filter (vehicle_id, signal_name, rule_ids, enabled_only — pass only the fields the user supplied); "+
			"(2) call detect_rule_conflicts with the SAME scope so the conflict report is byte-equivalent to the deterministic structural detector. "+
			"Narrate the result in 2-3 sentences grounded strictly in the tool reply, naming the conflicting rule pairs (by id), the conflict kind (redundant_duplicate or overlapping_threshold), "+
			"and the honest-method qualifier (\"structural overlap analysis of the current rule definitions\", NOT a runtime firing prediction or a claim that one rule shadows the other). "+
			"If has_enough_rules is false (fewer than 2 enabled rules in scope), say so plainly rather than inventing a conflict. "+
			"If the conflict envelope is empty (no structural conflicts found), say so plainly and DO NOT manufacture a conflict from severity differences, cooldown differences, or trigger-mode differences alone. "+
			"NEVER propose merging two rules, deleting either rule, auto-disabling either rule, lowering severity, or any other rule mutation — your role is to surface the structural conflict so the user can click \"Review rule\" and edit the offending rule themselves.",
		scopeHint, signalHint, ruleHint, enabledOnlyHint,
	)

	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Msg("ai cross-rule-conflict-detection: dispatcher returned error")
	}
}

// Compile-time assertion: Handler satisfies
// http.Handler.
var _ http.Handler = (*Handler)(nil)

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

// ---------------------------------------------------------------------
// Production wiring for the CrossRuleConflictSource port declared by
// internal/ai/tools/cross_rule_conflict.go. Kept in the same file as
// the handler so the wiring intent is local to the slice; mirrors the
// AIInboxCategorizationSource pattern from slice 0035.
// ---------------------------------------------------------------------

// Source is the production
// diagnostic.CrossRuleConflictSource. It composes the canonical
// AlertRuleRepo (read-only) so the AI projection is grounded
// in the SAME alert_rules rows the deterministic AlertStudio
// renders. No write path is invoked.
//
// The struct holds one narrow read interface; the constructor
// panics on a nil so a wiring bug surfaces at boot.
type Source struct {
	rules *dbalert.AlertRuleRepo
}

// NewSource constructs the adapter. Panics
// on a nil repo so a wiring mistake surfaces at boot rather
// than as a nil-deref on first AI request.
func NewSource(rules *dbalert.AlertRuleRepo) *Source {
	if rules == nil {
		panic("aicrossrule: NewSource: nil *dbalert.AlertRuleRepo")
	}
	return &Source{rules: rules}
}

// LoadRules implements diagnostic.CrossRuleConflictSource. Reads the
// canonical alert_rules table via AlertRuleRepo.GetAll and
// applies the in-scope filters in memory.
//
// AlertRuleRepo.GetAll today returns every rule the user has
// access to (no per-user scoping enforced at the repo layer
// because TeslaSync is single-tenant per deployment); the
// in-memory filter applies vehicle_id / signal_name / rule_id
// / enabled_only restrictions before returning to the tool.
//
// The Limit field caps the returned slice so a runaway request
// cannot blow past the canonical 500-row cap.
func (a *Source) LoadRules(ctx context.Context, f diagnostic.CrossRuleConflictFilters) ([]*alertmodel.AlertRule, error) {
	limit := f.Limit
	if limit <= 0 || limit > aiCrossRuleConflictMaxLimit {
		limit = aiCrossRuleConflictDefaultLimit
	}

	all, err := a.rules.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("api ai cross-rule-conflict-detection: load alert_rules: %w", err)
	}

	// Pre-build the rule_id filter map so the inner loop is O(1).
	var ruleIDFilter map[int64]struct{}
	if len(f.RuleIDs) > 0 {
		ruleIDFilter = make(map[int64]struct{}, len(f.RuleIDs))
		for _, id := range f.RuleIDs {
			ruleIDFilter[id] = struct{}{}
		}
	}

	out := make([]*alertmodel.AlertRule, 0, len(all))
	for _, r := range all {
		if r == nil {
			continue
		}
		if f.EnabledOnly && !r.Enabled {
			continue
		}
		if f.SignalName != "" && r.SignalName != f.SignalName {
			continue
		}
		if ruleIDFilter != nil {
			if _, ok := ruleIDFilter[r.ID]; !ok {
				continue
			}
		}
		if f.VehicleID != nil {
			vid := *f.VehicleID
			// AllVehicles=true ⇒ the rule applies to every
			// vehicle the user owns, including the named one.
			// Otherwise the rule must mention vid in its
			// VehicleIDs subset.
			if !r.AllVehicles {
				match := false
				for _, x := range r.VehicleIDs {
					if x == vid {
						match = true
						break
					}
				}
				if !match {
					continue
				}
			}
		}
		out = append(out, r)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}
