// Phase-50 / 0036 — A3 Cross-rule conflict detection.
//
// cross_rule_conflict.go ships TWO new propose-only tools:
//
//   - `query_alert_rules` — accept an optional rule scope
//     (vehicle_id?, signal_name?, rule_ids?, enabled_only?,
//     limit?), read the alert_rules table via the
//     CrossRuleConflictSource port, and return a typed envelope
//     { rules: [...], total, source } the LLM can ground its
//     follow-up detect_rule_conflicts call against.
//
//   - `detect_rule_conflicts` — accept an optional rule scope
//     (same shape as query), read the same rules, run the
//     pure-functional structural conflict detector (see
//     DetectRuleConflicts below), and return a typed envelope
//     { conflicts: [...], total, source, has_enough_rules,
//     sample_size } that the SPA renders as a list of
//     conflict cards.
//
// Both tools are PROPOSE-ONLY: they read the canonical
// alert_rules table via a narrow read-only port and compose a
// typed DTO but do NOT touch the database write path. No rule
// is created, updated, or deleted; the "Review rule" mechanism
// in the SPA copies the offending rule_id into the existing
// baseline AlertStudio editor's selection state, not into a
// new write path. The dispatcher's deny-all confirm gate is
// therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and
//     never bypasses existing handlers." → both tools delegate
//     to the CrossRuleConflictSource port (a narrow read-only
//     view of AlertRuleRepo). There is NO write surface on the
//     port.
//
//   - "the LLM never writes raw SQL" → every read happens
//     through the canonical AlertRuleRepo.GetAll path via the
//     port; the structural conflict detection is pure-functional
//     Go.
//
//   - "no duplicate write paths" → there is no `merge_rules`,
//     `delete_rule`, or `disable_rule` tool. The frontend
//     renders the conflict list and the user clicks "Review
//     rule" which selects the offending rule in the existing
//     baseline AlertStudio sidebar list — same selection state
//     the user has always had.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ---------------------------------------------------------------------------
// Closed taxonomy.
// ---------------------------------------------------------------------------

// ConflictKind enumerates the structural conflict kinds the
// detector can produce. EVERY conflict the LLM narrates MUST
// carry one of these kinds — the strategy's system prompt
// restates the closed list so the LLM never proposes a kind
// the detector wouldn't produce.
//
// Cut from the original 4-kind taxonomy (overlapping_threshold,
// shadowed_severity, redundant_duplicate, contradictory_operator)
// to TWO per the rubber-duck critique:
//
//   - shadowed_severity was cut because it depends on runtime
//     suppression semantics the AI engine cannot prove from
//     rule definitions alone. The severity delta is surfaced
//     as METADATA on a regular overlapping_threshold conflict
//     instead.
//
//   - contradictory_operator was cut because rules like
//     `battery_level<20` and `battery_level>80` are often
//     legitimate paired low/high boundary alerts, not
//     misconfigurations. Calling them "contradictory" would
//     erode user trust.
//
// Adding a new kind requires:
//
//  1. extending this list;
//  2. extending DetectRuleConflicts below to actually produce
//     it under deterministic structural conditions;
//  3. extending goldens.yaml so the eval harness exercises the
//     new kind;
//  4. updating the strategy's system prompt + the closed-
//     taxonomy line in goldens.yaml so the LLM learns the new
//     kind.
const (
	ConflictKindRedundantDuplicate   = "redundant_duplicate"
	ConflictKindOverlappingThreshold = "overlapping_threshold"
)

// ConflictKinds is the canonical ordered list — query_alert_rules
// returns it inside the typed envelope so the LLM (and the SPA)
// can validate any narrated kind against the closed taxonomy.
var ConflictKinds = []string{
	ConflictKindRedundantDuplicate,
	ConflictKindOverlappingThreshold,
}

// ---------------------------------------------------------------------------
// Typed envelopes.
// ---------------------------------------------------------------------------

// AlertRuleSummary is the projection of models.AlertRule the
// query_alert_rules tool returns. Mirrors the fields the
// detector (and the SPA conflict card) actually need; we
// intentionally do NOT echo back the full models.AlertRule so
// the LLM never sees fields it doesn't need (msg_template,
// snoozed_until, etc.).
type AlertRuleSummary struct {
	ID           int64    `json:"id"`
	Name         string   `json:"name"`
	Enabled      bool     `json:"enabled"`
	Kind         string   `json:"kind"`
	SignalName   string   `json:"signal_name"`
	Op           string   `json:"op"`
	ValueNum     *float64 `json:"value_num,omitempty"`
	ValueText    *string  `json:"value_text,omitempty"`
	ValueBool    *bool    `json:"value_bool,omitempty"`
	ValueMin     *float64 `json:"value_min,omitempty"`
	ValueMax     *float64 `json:"value_max,omitempty"`
	Severity     string   `json:"severity"`
	CooldownMin  int      `json:"cooldown_min"`
	TriggerMode  string   `json:"trigger_mode"`
	AllVehicles  bool     `json:"all_vehicles"`
	VehicleIDs   []int64  `json:"vehicle_ids"`
}

// AlertRuleListEnvelope is the typed envelope query_alert_rules
// returns. Total reflects the number of rules in the returned
// list (post-filter, pre-truncation by Limit). Source names the
// canonical reader so the LLM can attribute the data to the
// canonical repo path.
type AlertRuleListEnvelope struct {
	Rules  []AlertRuleSummary `json:"rules"`
	Total  int                `json:"total"`
	Source string             `json:"source"`
	// Status: "ok" or "no_rules". Mirrors the
	// CategoryProposal.Status pattern from A2.
	Status string `json:"status"`
	// AllowedKinds is the closed conflict taxonomy. Echoed
	// back so the LLM (and downstream code reading the
	// envelope) can validate any narrated kind against the
	// canonical list.
	AllowedKinds []string `json:"allowed_kinds"`
}

// RuleConflict is one entry in the detect_rule_conflicts
// envelope. Every conflict carries:
//
//   - Kind: drawn STRICTLY from the closed taxonomy
//     (ConflictKinds). The narrator's system prompt forbids
//     any other kind.
//   - RuleAID / RuleBID: the conflicting rule pair, sorted ASC
//     so the same conflict is always reported with the same
//     ordering across calls.
//   - Reason: a one-line human-readable description of the
//     structural overlap (e.g. "rule 1 (battery_level<20)
//     subsumes rule 2 (battery_level<15) for vehicle 1").
//   - SeverityMismatch / CooldownMismatch / TriggerModeMismatch:
//     METADATA flags the SPA renders as supplementary chips on
//     the conflict card. Per the rubber-duck critique these are
//     explicitly NOT separate conflict kinds.
//   - Subsumes: true when one rule's predicate is a strict
//     superset of the other (the broader rule fires whenever
//     the narrower would). Stays as METADATA, not a conflict
//     kind.
type RuleConflict struct {
	Kind                 string `json:"kind"`
	RuleAID              int64  `json:"rule_a_id"`
	RuleBID              int64  `json:"rule_b_id"`
	RuleAName            string `json:"rule_a_name"`
	RuleBName            string `json:"rule_b_name"`
	SignalName           string `json:"signal_name"`
	Reason               string `json:"reason"`
	SeverityMismatch     bool   `json:"severity_mismatch"`
	CooldownMismatch     bool   `json:"cooldown_mismatch"`
	TriggerModeMismatch  bool   `json:"trigger_mode_mismatch"`
	Subsumes             bool   `json:"subsumes"`
}

// RuleConflictEnvelope is the typed envelope
// detect_rule_conflicts returns. Conflicts is sorted by
// (Kind ASC, RuleAID ASC, RuleBID ASC) so the LLM's narration
// is reproducible across calls with the same input.
//
// HasEnoughRules flips false when SampleSize < 2 (you need at
// least two rules to have a conflict). The narrator's system
// prompt requires the LLM to disclose this rather than invent
// a conflict.
type RuleConflictEnvelope struct {
	Conflicts        []RuleConflict `json:"conflicts"`
	Total            int            `json:"total"`
	SampleSize       int            `json:"sample_size"`
	HasEnoughRules   bool           `json:"has_enough_rules"`
	MinRequiredRules int            `json:"min_required_rules"`
	AllowedKinds     []string       `json:"allowed_kinds"`
	Status           string         `json:"status"`
	Method           string         `json:"method"`
	Source           string         `json:"source"`
}

// ---------------------------------------------------------------------------
// Narrow port.
// ---------------------------------------------------------------------------

// CrossRuleConflictSource is the narrow port the
// query_alert_rules + detect_rule_conflicts tools delegate to.
// In production it is satisfied by *api.AICrossRuleConflictSource
// (which composes AlertRuleRepo.GetAll); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update /
// Delete method here would defeat the read-only contract that
// ADR-015 §I3 + the slice prompt mandate.
//
// The filter is intentionally narrow (no offset, no time
// range): conflict detection works against the CURRENT rule
// definitions, so historical state is irrelevant. The Limit
// field caps the row count so a runaway request cannot scan an
// unbounded rule set; today's max is 500 (the canonical
// AlertStudio rarely surfaces more than ~50).
type CrossRuleConflictSource interface {
	// LoadRules returns the rules matching the filter. Returns
	// (nil, nil) when no rule matches — the tool surfaces this
	// as a "no_rules" status so the LLM can explain the
	// situation to the user without crashing the dispatcher.
	//
	// Implementations MUST scope by the authenticated user's
	// account / tenant before applying the filter; supplying a
	// rule_id that belongs to a different user MUST surface as
	// the rule being absent from the result, not as a leak of
	// foreign rule metadata.
	LoadRules(ctx context.Context, f CrossRuleConflictFilters) ([]*models.AlertRule, error)
}

// CrossRuleConflictFilters is the narrow filter struct passed
// to LoadRules. All fields are optional; an empty value asks
// the adapter to return every rule visible to the caller.
type CrossRuleConflictFilters struct {
	// VehicleID restricts the result to rules that apply to
	// the named vehicle (either AllVehicles=true or the
	// vehicle_id is in the rule's VehicleIDs subset). Optional.
	VehicleID *int64
	// SignalName restricts the result to rules with the
	// matching signal_name. Optional.
	SignalName string
	// RuleIDs restricts the result to the named subset.
	// Optional. Empty / nil ⇒ no rule_id filter.
	RuleIDs []int64
	// EnabledOnly restricts the result to rules where
	// Enabled=true. Default false (return both enabled +
	// disabled). The conflict detector ALWAYS skips disabled
	// rules regardless of this flag — EnabledOnly is just an
	// efficiency hint that lets the adapter filter at the SQL
	// layer when the caller knows it.
	EnabledOnly bool
	// Limit caps the number of returned rules at the source
	// layer. Defaults to crossRuleConflictDefaultLimit when
	// zero / negative. Capped at crossRuleConflictMaxLimit by
	// the input validator.
	Limit int
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// crossRuleConflictDefaultLimit is the default cap on the
// number of rules query_alert_rules + detect_rule_conflicts
// will scan when the LLM (or handler) doesn't supply a Limit.
// Set generously high — the canonical AlertStudio rarely
// surfaces more than ~50 rules per user, but a power user could
// have several hundred.
const crossRuleConflictDefaultLimit = 500

// crossRuleConflictMaxLimit is the absolute hard cap the input
// validator enforces. 1000 mirrors the NotificationRepo limit
// used by the A2 inbox-categorization slice.
const crossRuleConflictMaxLimit = 1000

// crossRuleConflictMinRules is the minimum number of enabled
// rules in scope before the detector can produce a meaningful
// conflict report. Below this threshold has_enough_rules flips
// false and the narrator must say so plainly.
const crossRuleConflictMinRules = 2

// ---------------------------------------------------------------------------
// Tool: query_alert_rules.
// ---------------------------------------------------------------------------

// alertRulesQueryInput is the typed input shape the dispatcher
// decodes the LLM's tool-call arguments JSON into. Validation
// failures bounce as Tool.Validate errors before any port method
// runs. Mirrors the shape of the handler body so the LLM and
// the SPA see the same scope.
type alertRulesQueryInput struct {
	// VehicleID restricts to rules that apply to the named
	// vehicle. Optional + positive when present.
	VehicleID *int64 `json:"vehicle_id,omitempty" desc:"Optional vehicle scope. Omit to return rules across every vehicle the user owns."`
	// SignalName restricts to rules on the named signal.
	// Optional.
	SignalName string `json:"signal_name,omitempty" validate:"omitempty,lte=128" desc:"Optional signal_name filter (e.g. battery_level)."`
	// RuleIDs restricts to the named subset. Optional.
	RuleIDs []int64 `json:"rule_ids,omitempty" validate:"omitempty,dive,gte=1" desc:"Optional explicit rule_id subset. Each entry must be > 0."`
	// EnabledOnly restricts to enabled rules at the SQL
	// layer. Optional, defaults to true (the typical
	// intent for conflict detection — disabled rules can't
	// fire and don't conflict at runtime).
	EnabledOnly *bool `json:"enabled_only,omitempty" desc:"When true (default), only enabled rules are returned."`
	// Limit caps the result. Optional + bounded.
	Limit *int `json:"limit,omitempty" validate:"omitempty,gte=1,lte=1000" desc:"Result cap (1-1000). Defaults to 500."`
}

// queryAlertRules is the propose-only tool that returns a typed
// rule envelope for the in-scope set. It is the FIRST tool the
// LLM is expected to call (per the strategy's system prompt).
//
// Execution is a read: the CrossRuleConflictSource port performs
// the rule read against the canonical repo. There is no DB
// write; no SQL beyond what the port's adapter issues. The
// dispatcher's deny-all confirm gate is bypassed because
// Mutates() returns false.
type queryAlertRules struct {
	source CrossRuleConflictSource
}

// Name implements [Tool].
func (t *queryAlertRules) Name() string { return "query_alert_rules" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// conflict-kind allowlist appended so the model knows which
// kinds the follow-up detect_rule_conflicts call can produce.
func (t *queryAlertRules) Description() string {
	return "Read the user's alert rules in scope. " +
		"PROPOSE-ONLY: this tool is a read of the canonical alert_rules table; it does NOT save or modify any rule. " +
		"Returns {rules: [{id, name, signal_name, op, value_*, severity, cooldown_min, trigger_mode, vehicle_ids, all_vehicles, enabled, kind}], total, allowed_kinds, status: ok|no_rules, source}. " +
		"Use this BEFORE detect_rule_conflicts so the conflict detector grounds its analysis in the SAME rule set you narrate. " +
		"Allowed conflict kinds (returned in `allowed_kinds`): " + ConflictKindRedundantDuplicate + ", " + ConflictKindOverlappingThreshold + ". " +
		"Filters are all optional — omit a field to widen the scope. EnabledOnly defaults to true."
}

// InputSchema implements [Tool].
func (t *queryAlertRules) InputSchema() json.RawMessage {
	return cachedSchema(alertRulesQueryInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryAlertRules) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *queryAlertRules) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *queryAlertRules) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then runs explicit pointer-aware range checks for the optional
// numeric fields. The shared validator's gte/lte rules can't
// reach through *int / *int64 pointers (it falls through the
// numeric switch when v.Kind() is reflect.Ptr), so each optional
// numeric pointer field gets a manual range check here. Mirrors
// the alert-tuning-suggestions / inbox-auto-categorization
// pattern.
func (t *queryAlertRules) Validate(raw json.RawMessage) (any, error) {
	parsed, err := ValidateStruct[alertRulesQueryInput](raw)
	if err != nil {
		return nil, err
	}
	in := parsed.(alertRulesQueryInput)
	if in.VehicleID != nil {
		if *in.VehicleID < 1 {
			return nil, &ValidationError{Field: "vehicle_id", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
	}
	if in.Limit != nil {
		v := *in.Limit
		if v < 1 {
			return nil, &ValidationError{Field: "limit", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
		if v > crossRuleConflictMaxLimit {
			return nil, &ValidationError{Field: "limit", Rule: "lte=1000", Msg: "must be ≤ 1000"}
		}
	}
	return parsed, nil
}

// Execute implements [Tool]. Loads the rules via the port,
// projects each into AlertRuleSummary, and returns the typed
// envelope. Never returns an error from the validator path —
// empty result sets surface as status="no_rules" in the
// envelope so the LLM's follow-up prose can describe the
// situation rather than the dispatcher relaying an error frame.
//
// A nil source is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests
// that instantiate the tool directly.
func (t *queryAlertRules) Execute(ctx context.Context, in any) (any, error) {
	input := in.(alertRulesQueryInput)
	if t.source == nil {
		return nil, errors.New("query_alert_rules: no CrossRuleConflictSource wired")
	}

	enabledOnly := true
	if input.EnabledOnly != nil {
		enabledOnly = *input.EnabledOnly
	}
	limit := crossRuleConflictDefaultLimit
	if input.Limit != nil && *input.Limit >= 1 && *input.Limit <= crossRuleConflictMaxLimit {
		limit = *input.Limit
	}

	filters := CrossRuleConflictFilters{
		SignalName:  input.SignalName,
		RuleIDs:     append([]int64(nil), input.RuleIDs...),
		EnabledOnly: enabledOnly,
		Limit:       limit,
	}
	if input.VehicleID != nil {
		filters.VehicleID = input.VehicleID
	}

	rules, err := t.source.LoadRules(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("query_alert_rules: load rules: %w", err)
	}

	summaries := make([]AlertRuleSummary, 0, len(rules))
	for _, r := range rules {
		if r == nil {
			continue
		}
		summaries = append(summaries, projectRuleSummary(r))
	}
	// Deterministic order so the LLM's follow-up call passes a
	// stable rule set to the detector.
	sort.SliceStable(summaries, func(i, j int) bool {
		return summaries[i].ID < summaries[j].ID
	})

	status := "ok"
	if len(summaries) == 0 {
		status = "no_rules"
	}

	out := &AlertRuleListEnvelope{
		Rules:        summaries,
		Total:        len(summaries),
		Source:       "reader: internal/database/alert_repo.go AlertRuleRepo.GetAll (filtered by CrossRuleConflictSource adapter)",
		Status:       status,
		AllowedKinds: append([]string(nil), ConflictKinds...),
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Tool: detect_rule_conflicts.
// ---------------------------------------------------------------------------

// detectRuleConflictsInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// Mirrors alertRulesQueryInput so the LLM can pass the SAME
// scope to query first then detect.
type detectRuleConflictsInput struct {
	VehicleID   *int64  `json:"vehicle_id,omitempty" desc:"Optional vehicle scope."`
	SignalName  string  `json:"signal_name,omitempty" validate:"omitempty,lte=128" desc:"Optional signal_name filter."`
	RuleIDs     []int64 `json:"rule_ids,omitempty" validate:"omitempty,dive,gte=1" desc:"Optional explicit rule_id subset. Each entry must be > 0."`
	EnabledOnly *bool   `json:"enabled_only,omitempty" desc:"When true (default), only enabled rules are analyzed."`
	Limit       *int    `json:"limit,omitempty" validate:"omitempty,gte=1,lte=1000" desc:"Result cap (1-1000). Defaults to 500."`
}

// detectRuleConflicts is the propose-only tool that runs the
// pure-functional structural conflict detector over the
// in-scope rule set and returns a typed envelope of conflicts.
// It is the SECOND tool the LLM is expected to call (per the
// strategy's system prompt).
//
// Execution is a read + a pure-functional analysis: the
// CrossRuleConflictSource port performs the rule read against
// the canonical repo, then DetectRuleConflicts runs in pure Go.
// There is no DB write; no SQL beyond what the port's adapter
// issues. The dispatcher's deny-all confirm gate is bypassed
// because Mutates() returns false.
type detectRuleConflicts struct {
	source CrossRuleConflictSource
}

// Name implements [Tool].
func (t *detectRuleConflicts) Name() string { return "detect_rule_conflicts" }

// Description implements [Tool].
func (t *detectRuleConflicts) Description() string {
	return "Detect structural conflicts across the user's alert rules. " +
		"PROPOSE-ONLY: this tool runs a deterministic structural overlap analysis over the canonical alert_rules definitions; it does NOT save, merge, delete, or modify any rule. " +
		"Returns {conflicts: [{kind, rule_a_id, rule_b_id, rule_a_name, rule_b_name, signal_name, reason, severity_mismatch, cooldown_mismatch, trigger_mode_mismatch, subsumes}], total, sample_size, has_enough_rules, min_required_rules, allowed_kinds, status: ok|no_data|no_conflicts, method, source}. " +
		"Allowed conflict kinds: " + ConflictKindRedundantDuplicate + " (byte-identical predicate + same vehicle scope) and " + ConflictKindOverlappingThreshold + " (same signal_name, overlapping vehicle scope, predicate intervals overlap). " +
		"Severity / cooldown / trigger-mode differences are surfaced as METADATA flags on a conflict, NOT as standalone conflict kinds. " +
		"Use this AFTER query_alert_rules with the SAME scope so the conflict report is grounded in the same rule set you'll narrate. " +
		"Filters are all optional — omit a field to widen the scope. EnabledOnly defaults to true and disabled rules are always skipped by the detector regardless."
}

// InputSchema implements [Tool].
func (t *detectRuleConflicts) InputSchema() json.RawMessage {
	return cachedSchema(detectRuleConflictsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form.
func (t *detectRuleConflicts) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *detectRuleConflicts) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *detectRuleConflicts) RequiredScope() string { return "" }

// Validate implements [Tool]. Same shape as query_alert_rules.
func (t *detectRuleConflicts) Validate(raw json.RawMessage) (any, error) {
	parsed, err := ValidateStruct[detectRuleConflictsInput](raw)
	if err != nil {
		return nil, err
	}
	in := parsed.(detectRuleConflictsInput)
	if in.VehicleID != nil {
		if *in.VehicleID < 1 {
			return nil, &ValidationError{Field: "vehicle_id", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
	}
	if in.Limit != nil {
		v := *in.Limit
		if v < 1 {
			return nil, &ValidationError{Field: "limit", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
		if v > crossRuleConflictMaxLimit {
			return nil, &ValidationError{Field: "limit", Rule: "lte=1000", Msg: "must be ≤ 1000"}
		}
	}
	return parsed, nil
}

// Execute implements [Tool]. Loads the rules via the port, runs
// DetectRuleConflicts over the loaded rules, and returns the
// typed envelope. Never returns an error from the validator
// path — empty result sets / single-rule sets surface as
// status="no_data" in the envelope, and zero-conflict sets
// surface as status="no_conflicts" so the LLM's follow-up
// prose can describe the situation rather than the dispatcher
// relaying an error frame.
//
// A nil source is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests
// that instantiate the tool directly.
func (t *detectRuleConflicts) Execute(ctx context.Context, in any) (any, error) {
	input := in.(detectRuleConflictsInput)
	if t.source == nil {
		return nil, errors.New("detect_rule_conflicts: no CrossRuleConflictSource wired")
	}

	enabledOnly := true
	if input.EnabledOnly != nil {
		enabledOnly = *input.EnabledOnly
	}
	limit := crossRuleConflictDefaultLimit
	if input.Limit != nil && *input.Limit >= 1 && *input.Limit <= crossRuleConflictMaxLimit {
		limit = *input.Limit
	}

	filters := CrossRuleConflictFilters{
		SignalName:  input.SignalName,
		RuleIDs:     append([]int64(nil), input.RuleIDs...),
		EnabledOnly: enabledOnly,
		Limit:       limit,
	}
	if input.VehicleID != nil {
		filters.VehicleID = input.VehicleID
	}

	rules, err := t.source.LoadRules(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("detect_rule_conflicts: load rules: %w", err)
	}

	conflicts := DetectRuleConflicts(rules)

	// SampleSize counts ENABLED rules — disabled rules are
	// skipped by the detector regardless of EnabledOnly.
	enabledCount := 0
	for _, r := range rules {
		if r != nil && r.Enabled {
			enabledCount++
		}
	}

	status := "ok"
	switch {
	case enabledCount < crossRuleConflictMinRules:
		status = "no_data"
	case len(conflicts) == 0:
		status = "no_conflicts"
	}

	out := &RuleConflictEnvelope{
		Conflicts:        conflicts,
		Total:            len(conflicts),
		SampleSize:       enabledCount,
		HasEnoughRules:   enabledCount >= crossRuleConflictMinRules,
		MinRequiredRules: crossRuleConflictMinRules,
		AllowedKinds:     append([]string(nil), ConflictKinds...),
		Status:           status,
		Method:           "deterministic structural overlap analysis (same-signal + vehicle-scope-overlap + predicate-interval-overlap)",
		Source:           "reader: internal/database/alert_repo.go AlertRuleRepo.GetAll (filtered by CrossRuleConflictSource adapter); detector in internal/ai/tools/cross_rule_conflict.go DetectRuleConflicts",
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Pure-functional helpers.
// ---------------------------------------------------------------------------

// projectRuleSummary copies the AlertRule fields the AI surface
// needs into the typed AlertRuleSummary. Pulled out so the
// detector + the unit tests can build summaries without the
// repo IO.
//
// VehicleIDs is copied (not aliased) so a downstream caller
// that mutates the summary slice cannot leak through to the
// repo's pooled rule struct.
func projectRuleSummary(r *models.AlertRule) AlertRuleSummary {
	out := AlertRuleSummary{
		ID:          r.ID,
		Name:        r.Name,
		Enabled:     r.Enabled,
		Kind:        r.Kind,
		SignalName:  r.SignalName,
		Op:          r.Op,
		Severity:    r.Severity,
		CooldownMin: r.CooldownMin,
		TriggerMode: r.TriggerMode,
		AllVehicles: r.AllVehicles,
	}
	if len(r.VehicleIDs) > 0 {
		out.VehicleIDs = append([]int64(nil), r.VehicleIDs...)
	} else {
		out.VehicleIDs = []int64{}
	}
	if r.ValueNum != nil {
		v := *r.ValueNum
		out.ValueNum = &v
	}
	if r.ValueText != nil {
		v := *r.ValueText
		out.ValueText = &v
	}
	if r.ValueBool != nil {
		v := *r.ValueBool
		out.ValueBool = &v
	}
	if r.ValueMin != nil {
		v := *r.ValueMin
		out.ValueMin = &v
	}
	if r.ValueMax != nil {
		v := *r.ValueMax
		out.ValueMax = &v
	}
	return out
}

// vehicleScopesOverlap reports whether two rules' vehicle
// scopes intersect:
//
//   - AllVehicles vs AllVehicles → always overlap (both apply
//     to every vehicle the user owns).
//   - AllVehicles vs subset → always overlap (the All side
//     covers every vehicle in the subset).
//   - subset vs subset → overlap iff the two subsets share at
//     least one vehicle ID.
//
// Pulled out so the unit tests can pin every case explicitly.
func vehicleScopesOverlap(a, b *models.AlertRule) bool {
	if a.AllVehicles || b.AllVehicles {
		return true
	}
	// Both subsets — check intersection.
	bSet := make(map[int64]struct{}, len(b.VehicleIDs))
	for _, id := range b.VehicleIDs {
		bSet[id] = struct{}{}
	}
	for _, id := range a.VehicleIDs {
		if _, ok := bSet[id]; ok {
			return true
		}
	}
	return false
}

// predicatesByteEqual reports whether two rules have an
// IDENTICAL predicate (same op + every value_* slot).
// nil-pointer-aware. Used to drive the redundant_duplicate
// conflict kind.
//
// Note: signal_name is checked by the detector caller (we only
// reach this when both rules already share signal_name). Kind
// is also checked by the caller — computed_metric vs signal
// rules cannot redundant-duplicate each other.
func predicatesByteEqual(a, b *models.AlertRule) bool {
	if a.Op != b.Op {
		return false
	}
	if !floatPtrEqual(a.ValueNum, b.ValueNum) {
		return false
	}
	if !stringPtrEqual(a.ValueText, b.ValueText) {
		return false
	}
	if !boolPtrEqual(a.ValueBool, b.ValueBool) {
		return false
	}
	if !floatPtrEqual(a.ValueMin, b.ValueMin) {
		return false
	}
	if !floatPtrEqual(a.ValueMax, b.ValueMax) {
		return false
	}
	return true
}

// numericIntervalsOverlap reports whether two rules' numeric
// predicate intervals overlap. Returns (overlap, aSubsumesB,
// bSubsumesA) so the caller can attach the Subsumes metadata.
//
// Only invoked when both rules have a numeric op (one of
// `<`,`<=`,`>`,`>=`,`=`,`!=`,`between`,`outside`) on the same
// signal. For text/bool ops the caller falls through to
// predicatesByteEqual (redundant_duplicate path).
//
// The semantics:
//
//   - `<`/`<=` / `>`/`>=`: half-open interval; overlap if the
//     intervals' projection on the signal axis intersect.
//   - `between`: closed interval [min, max].
//   - `outside`: union of (-∞, min] ∪ [max, +∞).
//   - `=` / `!=`: degenerate point or its complement.
//
// Implementation strategy: project each rule into a
// `numericInterval` struct (see below) and call
// numericIntervalsIntersect. Subsumes is computed by checking
// whether one interval is a (non-strict) superset of the other.
//
// Returns (false, false, false) when either rule has a non-
// numeric op, a missing required value pointer, or any other
// degeneracy that prevents interval comparison — false-positives
// are worse than missed conflicts here per the rubber-duck
// critique.
func numericIntervalsOverlap(a, b *models.AlertRule) (overlap, aSubsumesB, bSubsumesA bool) {
	ia, okA := numericIntervalForRule(a)
	ib, okB := numericIntervalForRule(b)
	if !okA || !okB {
		return false, false, false
	}
	overlap = ia.overlaps(ib)
	if !overlap {
		return false, false, false
	}
	aSubsumesB = ia.subsumes(ib)
	bSubsumesA = ib.subsumes(ia)
	return overlap, aSubsumesB, bSubsumesA
}

// numericInterval represents a 1D numeric interval the detector
// uses for overlap + subsumption checks. The interval is the
// SET of signal values that satisfy the rule's predicate.
//
// Internally we use a list of inclusive-closed segments
// [lo, hi] (with -∞ / +∞ sentinels) so `outside` (which is the
// union of two segments) can be modelled the same as `between`
// (a single segment).
//
// Out-of-band values (NaN, +/-Inf produced by the projection)
// surface as ok=false from numericIntervalForRule so the
// detector skips the comparison.
type numericInterval struct {
	segments []numericSegment
}

type numericSegment struct {
	lo float64 // -math.MaxFloat64 represents -∞
	hi float64 // +math.MaxFloat64 represents +∞
}

// negInf and posInf are the sentinel bounds used by the
// detector. We avoid math.Inf because pgx column reads can
// surface NaN/Inf in odd ways; the sentinels keep the
// comparison logic in finite arithmetic.
const (
	negInf = -1e308
	posInf = 1e308
)

// numericIntervalForRule projects an AlertRule's numeric
// predicate into a numericInterval. Returns ok=false for any
// rule whose op is non-numeric, whose required value slot is
// nil, or whose between/outside bounds are inverted (min > max).
func numericIntervalForRule(r *models.AlertRule) (numericInterval, bool) {
	switch r.Op {
	case "<":
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: negInf, hi: *r.ValueNum - epsilon()}}}, true
	case "<=":
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: negInf, hi: *r.ValueNum}}}, true
	case ">":
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: *r.ValueNum + epsilon(), hi: posInf}}}, true
	case ">=":
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: *r.ValueNum, hi: posInf}}}, true
	case "=":
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: *r.ValueNum, hi: *r.ValueNum}}}, true
	case "!=":
		// Complement of a single point — two segments with a
		// pinhole at the value.
		if r.ValueNum == nil {
			return numericInterval{}, false
		}
		v := *r.ValueNum
		return numericInterval{segments: []numericSegment{
			{lo: negInf, hi: v - epsilon()},
			{lo: v + epsilon(), hi: posInf},
		}}, true
	case "between":
		if r.ValueMin == nil || r.ValueMax == nil {
			return numericInterval{}, false
		}
		if *r.ValueMin > *r.ValueMax {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{{lo: *r.ValueMin, hi: *r.ValueMax}}}, true
	case "outside":
		if r.ValueMin == nil || r.ValueMax == nil {
			return numericInterval{}, false
		}
		if *r.ValueMin > *r.ValueMax {
			return numericInterval{}, false
		}
		return numericInterval{segments: []numericSegment{
			{lo: negInf, hi: *r.ValueMin - epsilon()},
			{lo: *r.ValueMax + epsilon(), hi: posInf},
		}}, true
	default:
		// `changed` and any text/bool op — not a numeric
		// interval.
		return numericInterval{}, false
	}
}

// epsilon is the conservative gap the detector uses to model
// strict inequality in floating-point. Set tiny enough that any
// rule a real user would author falls cleanly outside the
// neighbourhood, but large enough that `<20` and `>=20` don't
// accidentally overlap due to floating-point round-trip noise.
//
// Wrapped in a function (not a const) so a future tuning cycle
// can swap the value without breaking call sites.
func epsilon() float64 { return 1e-9 }

// overlaps reports whether `i` and `j` share at least one
// value. Quadratic in the number of segments per interval
// (max 2 each from the ops above) — trivially fast.
func (i numericInterval) overlaps(j numericInterval) bool {
	for _, s := range i.segments {
		for _, t := range j.segments {
			if segmentsOverlap(s, t) {
				return true
			}
		}
	}
	return false
}

// subsumes reports whether `i` is a (non-strict) superset of
// `j`: every segment of `j` is fully contained in some segment
// of `i`.
func (i numericInterval) subsumes(j numericInterval) bool {
	for _, t := range j.segments {
		contained := false
		for _, s := range i.segments {
			if s.lo <= t.lo && s.hi >= t.hi {
				contained = true
				break
			}
		}
		if !contained {
			return false
		}
	}
	return true
}

// segmentsOverlap returns true iff [s.lo, s.hi] ∩ [t.lo, t.hi]
// is non-empty.
func segmentsOverlap(s, t numericSegment) bool {
	return s.lo <= t.hi && t.lo <= s.hi
}

// floatPtrEqual / stringPtrEqual / boolPtrEqual are nil-safe
// pointer equality helpers for the predicatesByteEqual check.
// Two nil pointers are EQUAL (both signal "field absent");
// nil vs non-nil is NOT equal (one rule sets the field, the
// other doesn't).
func floatPtrEqual(a, b *float64) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func stringPtrEqual(a, b *string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func boolPtrEqual(a, b *bool) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

// DetectRuleConflicts is the pure-functional structural
// conflict detector. Pulled out of the production tool's
// Execute so the unit tests can exercise it without IO.
//
// Algorithm:
//
//  1. Skip disabled rules + rules with kind != "signal" (the
//     computed_metric conflict surface is intentionally out of
//     scope for A3 — those rules don't have a signal_name +
//     ValueNum predicate).
//  2. Group remaining rules by signal_name. Two rules with
//     different signals cannot conflict (their predicates
//     reference different signal axes).
//  3. For each pair within a group, check vehicle-scope
//     overlap (vehicleScopesOverlap). Rules that target
//     disjoint vehicle subsets cannot conflict at runtime.
//  4. For each overlapping-vehicle pair:
//     a. If predicatesByteEqual → emit redundant_duplicate.
//     b. Else if both ops are numeric AND
//        numericIntervalsOverlap → emit overlapping_threshold
//        with the appropriate Subsumes metadata.
//     c. Otherwise no conflict.
//  5. Each conflict carries METADATA flags
//     (severity_mismatch, cooldown_mismatch,
//     trigger_mode_mismatch) reflecting whether the two rules
//     differ on those axes — surfaced so the SPA can render
//     supplementary chips, NOT as standalone conflict kinds
//     (per the rubber-duck critique).
//  6. Sort conflicts by (Kind ASC, RuleAID ASC, RuleBID ASC)
//     so the report is reproducible across calls.
//
// IMPORTANT: this function does NOT mutate the input slice.
// Pointers in the result envelope reference the input rules'
// names but never modify them.
func DetectRuleConflicts(rules []*models.AlertRule) []RuleConflict {
	// Filter to enabled signal-kind rules. Computed-metric
	// rules don't have the signal_name + value_num/min/max
	// predicate this detector understands.
	eligible := make([]*models.AlertRule, 0, len(rules))
	for _, r := range rules {
		if r == nil {
			continue
		}
		if !r.Enabled {
			continue
		}
		if r.Kind != "" && r.Kind != models.AlertRuleKindSignal {
			continue
		}
		if r.SignalName == "" {
			continue
		}
		eligible = append(eligible, r)
	}

	// Sort by ID ASC so the pair iteration produces conflicts
	// in (lower-id, higher-id) order — the conflict pair is
	// stable regardless of the input order.
	sort.SliceStable(eligible, func(i, j int) bool {
		return eligible[i].ID < eligible[j].ID
	})

	conflicts := make([]RuleConflict, 0)
	for i := 0; i < len(eligible); i++ {
		for j := i + 1; j < len(eligible); j++ {
			a := eligible[i]
			b := eligible[j]
			// Different signals → cannot conflict.
			if a.SignalName != b.SignalName {
				continue
			}
			// Disjoint vehicle scope → cannot conflict at
			// runtime.
			if !vehicleScopesOverlap(a, b) {
				continue
			}

			conf, ok := classifyPairConflict(a, b)
			if ok {
				conflicts = append(conflicts, conf)
			}
		}
	}

	// Stable canonical sort.
	sort.SliceStable(conflicts, func(i, j int) bool {
		if conflicts[i].Kind != conflicts[j].Kind {
			return conflicts[i].Kind < conflicts[j].Kind
		}
		if conflicts[i].RuleAID != conflicts[j].RuleAID {
			return conflicts[i].RuleAID < conflicts[j].RuleAID
		}
		return conflicts[i].RuleBID < conflicts[j].RuleBID
	})
	return conflicts
}

// classifyPairConflict applies the per-pair classification
// rules in DetectRuleConflicts. Returns (conflict, true) when
// a structural conflict is detected; (zero, false) when the
// pair is clean.
//
// Caller MUST already have verified:
//
//   - both rules are non-nil and enabled;
//   - both rules share the same signal_name;
//   - vehicle scopes overlap.
//
// The classifier performs no defensive re-checks of those —
// they're load-bearing on the calling loop.
func classifyPairConflict(a, b *models.AlertRule) (RuleConflict, bool) {
	conf := RuleConflict{
		RuleAID:             a.ID,
		RuleBID:             b.ID,
		RuleAName:           a.Name,
		RuleBName:           b.Name,
		SignalName:          a.SignalName,
		SeverityMismatch:    a.Severity != b.Severity,
		CooldownMismatch:    a.CooldownMin != b.CooldownMin,
		TriggerModeMismatch: a.TriggerMode != b.TriggerMode,
	}

	// 1. Byte-identical predicate → redundant_duplicate.
	if predicatesByteEqual(a, b) {
		conf.Kind = ConflictKindRedundantDuplicate
		conf.Subsumes = true // identical predicates trivially subsume each other
		conf.Reason = fmt.Sprintf(
			"rules %d and %d have an identical predicate on signal %s with overlapping vehicle scope",
			a.ID, b.ID, a.SignalName,
		)
		return conf, true
	}

	// 2. Numeric interval overlap → overlapping_threshold.
	overlap, aSubsumesB, bSubsumesA := numericIntervalsOverlap(a, b)
	if overlap {
		conf.Kind = ConflictKindOverlappingThreshold
		conf.Subsumes = aSubsumesB || bSubsumesA
		switch {
		case aSubsumesB:
			conf.Reason = fmt.Sprintf(
				"rule %d (%s %s %s) subsumes rule %d (%s %s %s) on signal %s — the broader rule's predicate covers every value the narrower would match",
				a.ID, a.SignalName, a.Op, formatOperand(a),
				b.ID, b.SignalName, b.Op, formatOperand(b),
				a.SignalName,
			)
		case bSubsumesA:
			conf.Reason = fmt.Sprintf(
				"rule %d (%s %s %s) subsumes rule %d (%s %s %s) on signal %s — the broader rule's predicate covers every value the narrower would match",
				b.ID, b.SignalName, b.Op, formatOperand(b),
				a.ID, a.SignalName, a.Op, formatOperand(a),
				a.SignalName,
			)
		default:
			conf.Reason = fmt.Sprintf(
				"rules %d (%s %s %s) and %d (%s %s %s) have overlapping numeric predicates on signal %s",
				a.ID, a.SignalName, a.Op, formatOperand(a),
				b.ID, b.SignalName, b.Op, formatOperand(b),
				a.SignalName,
			)
		}
		return conf, true
	}

	// No structural conflict.
	return RuleConflict{}, false
}

// formatOperand renders the rule's value operand as a
// human-readable string for the conflict Reason. Used only
// inside Reason — the canonical typed envelope still carries
// the raw value_* pointers for the SPA to render directly.
func formatOperand(r *models.AlertRule) string {
	switch r.Op {
	case "between", "outside":
		if r.ValueMin != nil && r.ValueMax != nil {
			return fmt.Sprintf("[%v, %v]", *r.ValueMin, *r.ValueMax)
		}
	}
	if r.ValueNum != nil {
		return fmt.Sprintf("%v", *r.ValueNum)
	}
	if r.ValueText != nil {
		return fmt.Sprintf("%q", *r.ValueText)
	}
	if r.ValueBool != nil {
		return fmt.Sprintf("%v", *r.ValueBool)
	}
	return "<unset>"
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// CrossRuleConflictDetectionSources bundles the narrow port
// RegisterCrossRuleConflictDetectionTools needs. Mirrors
// [InboxAutoCategorizationSources] /
// [AlertTuningSuggestionsSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AICrossRuleConflictSource); tests substitute
// deterministic fakes.
type CrossRuleConflictDetectionSources struct {
	Source CrossRuleConflictSource
}

// RegisterCrossRuleConflictDetectionTools installs the
// cross-rule-conflict-detection slice's tools on r. Called
// from router.go AFTER RegisterInboxAutoCategorizationTools
// so the alphabetical Names list grows deterministically
// without disturbing earlier registrations.
//
// Panics on duplicate registration (Registry.Register panics)
// — a second call is a wiring bug detected at boot, not at
// first request.
//
// Note: this function registers BOTH new tools
// (`query_alert_rules` + `detect_rule_conflicts`); both are
// NEW for this slice.
func RegisterCrossRuleConflictDetectionTools(r *Registry, s CrossRuleConflictDetectionSources) {
	r.Register(&queryAlertRules{source: s.Source})
	r.Register(&detectRuleConflicts{source: s.Source})
}
