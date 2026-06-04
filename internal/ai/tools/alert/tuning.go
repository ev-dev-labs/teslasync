// Alert tuning suggestions expose one propose-only tool:
//
//   - `draft_alert_rule_patch` — accept a rule_id + typed patch
//     fields, read the existing rule via the AlertTuningSource
//     port, replay the recent firing window through the proposed
//     threshold, return a typed envelope { rule_before, proposed,
//     history_summary, status, validation_error } the frontend
//     can render for human review.
//
// The strategy ALSO consumes `validate_alert_rule` from the
// nl-alert-builder toolkit — reused here verbatim;
// no duplicate registration. The dispatcher resolves the tool
// from the same process-wide registry both strategies share.
//
// Both tools are PROPOSE-ONLY: they construct + validate
// AlertRule DTOs but do NOT touch the database. The dispatcher's
// deny-all confirm gate is therefore never reached in practice
// — defence in depth in case a future edit accidentally adds a
// write tool. The actual mutation flows through the existing
// typed PUT /api/v1/alerts/rules/{id} AlertHandler.UpdateAlertRule
// handler AFTER the user explicitly clicks Save in the
// AlertStudioPage UI.
//
// Design constraints:
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and
//     never bypasses existing handlers." → the patch tool's
//     output envelope embeds the FULL merged AlertRule so the
//     LLM can call validate_alert_rule (the existing N1 tool)
//     with byte-equivalent fields. A draft accepted by the AI
//     tool is therefore byte-equivalent to a draft accepted by
//     the canonical handler.
//
//   - "the LLM never writes raw SQL" → the tool delegates to the
//     AlertTuningSource port. The port's contract is
//     intentionally narrow: LoadRule (read-only) +
//     LoadFiringHistory (read-only). No write surface.
//
//   - "no duplicate write paths" → the toolkit does NOT include
//     a `save_alert_rule_patch` tool. The frontend renders the
//     proposed merged rule and the user clicks Save, which fires
//     the existing useSaveAlertRule mutation against PUT /api/v1/
//     alerts/rules/{id}.

package alert

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by draft_alert_rule_patch.
// ---------------------------------------------------------------------------

// AlertRuleFiringHistory mirrors the rolling firing-event summary
// the AlertTuningSource port projects from the notification_logs
// table. All counts are bounded to a recent window (typically
// 7 + 30 days) so the LLM cannot anchor on stale behaviour. The
// `would_have_fired_*` projections are descriptive replays of
// the SAME notification_logs.created_at events through the
// proposed threshold + cooldown — they are NOT a forecast and
// the LLM's narration MUST surface this.
//
// HasEnoughHistory flips false when SampleSize < the port's
// minimum-events threshold; the LLM's system prompt requires
// the narrator to disclose that and refuse to invent a
// projection in that case.
type AlertRuleFiringHistory struct {
	WindowDays                  int     `json:"window_days"`
	MinRequiredEvents           int     `json:"min_required_events"`
	SampleSize                  int     `json:"sample_size"`
	HasEnoughHistory            bool    `json:"has_enough_history"`
	TotalFires7d                int     `json:"total_fires_7d"`
	TotalFires30d               int     `json:"total_fires_30d"`
	AvgFiresPerDay7d            float64 `json:"avg_fires_per_day_7d"`
	AvgFiresPerDay30d           float64 `json:"avg_fires_per_day_30d"`
	WouldHaveFired7dAfterPatch  int     `json:"would_have_fired_7d_after_patch"`
	WouldHaveFired30dAfterPatch int     `json:"would_have_fired_30d_after_patch"`
	// ProjectionMethod names the deterministic replay strategy
	// the adapter used so the narrator can quote it honestly.
	// Today's adapter uses "descriptive replay of notification
	// logs through proposed threshold + cooldown"; future
	// adapters may add "monte-carlo bootstrap" etc.
	ProjectionMethod string `json:"projection_method"`
	// Assumptions enumerates the descriptive caveats the
	// narrator MUST surface (e.g. "ignores cooldown latch
	// across vehicles", "assumes the proposed threshold
	// applies to the same signal stream as the original
	// rule"). Mirrors the TirePressureTrend.Assumptions
	// pattern from the companion alert-analysis tool.
	Assumptions []string `json:"assumptions"`
}

// AlertRulePatchProposal is the typed envelope
// draft_alert_rule_patch returns. Every field is grounded in
// either the canonical AlertRuleRepo read or the canonical
// notification_logs read — the adapter does not invent state
// the canonical handlers don't already expose.
//
// RuleBefore is the rule as it currently exists in the DB
// (read-only snapshot). Proposed is RuleBefore with the
// LLM-supplied patch applied. The LLM uses the field-by-field
// diff between the two when narrating the suggestion.
//
// Status is "ok" or "invalid":
//   - "ok"      — Proposed would be accepted by the canonical
//     PUT /api/v1/alerts/rules/{id} validator; the user can
//     review and click Save.
//   - "invalid" — Proposed would be rejected; ValidationError
//     contains a one-line diagnostic suitable for showing in
//     the UI. Even when invalid, Proposed is returned unchanged
//     so the frontend can render the partially-correct
//     suggestion and let the user fix the problem field rather
//     than start over.
type AlertRulePatchProposal struct {
	RuleID          int64                   `json:"rule_id"`
	RuleBefore      *alertmodel.AlertRule   `json:"rule_before"`
	Proposed        *alertmodel.AlertRule   `json:"proposed"`
	History         *AlertRuleFiringHistory `json:"history"`
	Status          string                  `json:"status"`
	ValidationError string                  `json:"validation_error,omitempty"`
	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the
	// canonical validator + the canonical
	// notification_logs reader rather than its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Narrow ports.
// ---------------------------------------------------------------------------

// AlertTuningSource is the narrow port the
// draft_alert_rule_patch tool delegates to. In production it is
// satisfied by *api.AIAlertTuningSource (which composes
// AlertRuleRepo.GetByID + a notification_logs reader behind the
// canonical NotificationRepo); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the ADR-015 §I3 read-only contract.
type AlertTuningSource interface {
	// LoadRule returns the rule's current shape. Returns
	// (nil, nil) when no rule exists — the tool surfaces this
	// as a "rule_not_found" status so the LLM can explain the
	// problem to the user without crashing the dispatcher.
	LoadRule(ctx context.Context, ruleID int64) (*alertmodel.AlertRule, error)

	// LoadFiringHistory returns the rolling firing-event
	// summary for ruleID across the recent windows. The
	// adapter is responsible for replaying the
	// notification_logs through the proposed predicate to
	// compute WouldHaveFired*AfterPatch. Returns a non-nil
	// summary even when SampleSize is small — HasEnoughHistory
	// flips false in that case so the LLM can disclose it.
	LoadFiringHistory(ctx context.Context, ruleID int64, proposed *alertmodel.AlertRule) (*AlertRuleFiringHistory, error)
}

// ---------------------------------------------------------------------------
// Tool: draft_alert_rule_patch.
// ---------------------------------------------------------------------------

// alertRulePatchInput is the typed input shape the dispatcher
// decodes the LLM's tool-call arguments JSON into. Validation
// failures bounce as Tool.Validate errors before any port method
// runs.
//
// Patch fields are all OPTIONAL pointers / omitempty strings —
// only the fields the LLM actually wants to change should be
// populated. The merge step preserves every other field from
// the existing rule.
type alertRulePatchInput struct {
	// RuleID is the rule to tune. Required + positive — the
	// AI handler ALWAYS scopes to the rule_id from the URL
	// path, so a missing or nonsense ID is a programming
	// error (the handler clamps before invoking the tool).
	RuleID int64 `json:"rule_id" validate:"required,gte=1" desc:"Numeric ID of the alert rule to tune."`

	// NewValueNum / NewValueText / NewValueBool / NewValueMin
	// / NewValueMax are the proposed comparison operands.
	// Pointers preserve "field absent" semantics: nil means
	// "leave the existing value untouched"; non-nil means
	// "overwrite with this value".
	NewValueNum  *float64 `json:"new_value_num,omitempty"  desc:"Proposed numeric operand. Omit to leave unchanged."`
	NewValueText *string  `json:"new_value_text,omitempty" desc:"Proposed text operand. Omit to leave unchanged."`
	NewValueBool *bool    `json:"new_value_bool,omitempty" desc:"Proposed boolean operand. Omit to leave unchanged."`
	NewValueMin  *float64 `json:"new_value_min,omitempty"  desc:"Proposed lower bound. Omit to leave unchanged."`
	NewValueMax  *float64 `json:"new_value_max,omitempty"  desc:"Proposed upper bound. Omit to leave unchanged."`

	// NewOp is the proposed operator (=, !=, <, <=, >, >=,
	// changed, between, outside). Empty string ⇒ leave the
	// existing operator unchanged. The validator enforces the
	// same allowlist as the N1 alert-builder.
	NewOp string `json:"new_op,omitempty" validate:"omitempty,oneof== != < <= > >= changed between outside" desc:"Proposed comparison operator. Omit to leave unchanged."`

	// NewSeverity is the proposed severity. Empty string ⇒
	// leave unchanged. The strategy's system prompt forbids
	// loosening severity (e.g. critical -> info); the input
	// schema accepts the value but the system prompt is the
	// load-bearing guard. We could enforce non-loosening here
	// too, but the canonical validator's downstream check
	// would still let info -> info pass — keeping the
	// system-prompt guard as the single source of truth
	// avoids divergence.
	NewSeverity string `json:"new_severity,omitempty" validate:"omitempty,oneof=info warn critical" desc:"Proposed severity tier. Omit to leave unchanged. NEVER loosen (e.g. critical->info)."`

	// NewCooldownMin is the proposed minimum minutes between
	// consecutive alerts. Pointer so 0 is distinguishable
	// from "unspecified" (validator rejects 0; the input
	// schema enforces gte=1).
	NewCooldownMin *int `json:"new_cooldown_min,omitempty" validate:"omitempty,gte=1,lte=1440" desc:"Proposed minimum minutes between alerts (1-1440). Omit to leave unchanged."`

	// NewTriggerMode is the proposed trigger mode (once or
	// repeat). Empty string ⇒ leave unchanged.
	NewTriggerMode string `json:"new_trigger_mode,omitempty" validate:"omitempty,oneof=once repeat" desc:"Proposed trigger mode (once or repeat). Omit to leave unchanged."`

	// Rationale is an optional one-line explanation the LLM
	// may supply for the user. Bounded.
	Rationale string `json:"rationale,omitempty" validate:"omitempty,lte=512" desc:"Optional human-readable rationale for the patch."`
}

// allowedTuningOperatorsHint is the description suffix the tool
// description surfaces to the LLM so it picks canonical
// operators instead of hallucinating them. Sorted to keep the
// description deterministic across boots — the OpenAI / Anthropic
// providers cache prompt hashes per identical-text request.
var allowedTuningOperatorsHint = func() string {
	ops := []string{"=", "!=", "<", "<=", ">", ">=", "changed", "between", "outside"}
	sort.Strings(ops)
	out := ""
	for i, op := range ops {
		if i > 0 {
			out += ", "
		}
		out += op
	}
	return out
}()

// draftAlertRulePatch is the propose-only tool that builds a
// merged AlertRule + firing-history envelope for the
// AlertStudio AI side panel to render. It is the FIRST tool
// the LLM is expected to call (per the strategy's system
// prompt).
//
// Execution is a read: the AlertTuningSource port performs the
// rule + history reads against the canonical repos. There is no
// DB write; no SQL beyond what the port's adapter issues. The
// dispatcher's deny-all confirm gate is bypassed because
// Mutates() returns false.
type draftAlertRulePatch struct {
	source AlertTuningSource
}

// Name implements [Tool].
func (t *draftAlertRulePatch) Name() string { return "draft_alert_rule_patch" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// operator allowlist appended so the model picks from the
// curated set.
func (t *draftAlertRulePatch) Description() string {
	return "Propose a typed AlertRule patch for an existing rule based on its recent firing history. " +
		"PROPOSE-ONLY: the rule is NOT saved; the user reviews the patch in the UI before clicking Save. " +
		"Returns {rule_before, proposed, history, status: ok|invalid|rule_not_found, validation_error, source}. " +
		"Operators: " + allowedTuningOperatorsHint + ". " +
		"Severity: info, warn, critical. Trigger mode: once, repeat. " +
		"Patch fields are optional — omit a field to leave it unchanged on the existing rule. " +
		"NEVER propose loosening severity (e.g. critical->info); tuning is for noise reduction."
}

// InputSchema implements [Tool].
func (t *draftAlertRulePatch) InputSchema() json.RawMessage {
	return tools.CachedSchema(alertRulePatchInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *draftAlertRulePatch) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool reads + composes a DTO but does NOT touch the
// database. The actual save flows through the existing
// PUT /api/v1/alerts/rules/{id} handler AFTER the user clicks
// Save.
func (t *draftAlertRulePatch) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *draftAlertRulePatch) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then runs explicit pointer-aware range checks for the optional
// numeric patch fields. The shared validator's gte/lte rules
// can't reach through *int / *float64 pointers (it falls through
// the numeric switch when v.Kind() is reflect.Ptr), so each
// optional numeric patch field gets a manual range check here.
// Surfaces *ValidationError for symmetry with the framework
// errors so tests / dispatchers can use AsValidationError.
func (t *draftAlertRulePatch) Validate(raw json.RawMessage) (any, error) {
	parsed, err := tools.ValidateStruct[alertRulePatchInput](raw)
	if err != nil {
		return nil, err
	}
	in := parsed.(alertRulePatchInput)
	if in.NewCooldownMin != nil {
		v := *in.NewCooldownMin
		if v < 1 {
			return nil, &tools.ValidationError{Field: "new_cooldown_min", Rule: "gte=1", Msg: "must be ≥ 1"}
		}
		if v > 1440 {
			return nil, &tools.ValidationError{Field: "new_cooldown_min", Rule: "lte=1440", Msg: "must be ≤ 1440"}
		}
	}
	return parsed, nil
}

// Execute implements [Tool]. Loads the existing rule, applies
// the patch, runs the canonical firing-history projection, and
// returns the envelope. Never returns an error from the
// validator path — validation failures are surfaced as
// status="invalid" in the envelope so the LLM's follow-up prose
// can describe the problem rather than the dispatcher relaying
// an error frame. A genuinely missing rule surfaces as
// status="rule_not_found".
//
// A nil source is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests
// that instantiate the tool directly.
func (t *draftAlertRulePatch) Execute(ctx context.Context, in any) (any, error) {
	input := in.(alertRulePatchInput)
	if t.source == nil {
		return nil, errors.New("draft_alert_rule_patch: no AlertTuningSource wired")
	}

	rule, err := t.source.LoadRule(ctx, input.RuleID)
	if err != nil {
		return nil, err
	}
	if rule == nil {
		return &AlertRulePatchProposal{
			RuleID: input.RuleID,
			Status: "rule_not_found",
			Source: "reader: internal/database/alert_repo.go AlertRuleRepo.GetByID",
		}, nil
	}

	// Defensive deep-ish copy of the LLM-proposed merge so the
	// "before" snapshot in the envelope is not mutated by
	// downstream code. We construct Proposed explicitly via
	// applyPatch rather than copying the rule pointer.
	proposed := applyPatch(rule, input)

	history, err := t.source.LoadFiringHistory(ctx, input.RuleID, proposed)
	if err != nil {
		return nil, err
	}

	out := &AlertRulePatchProposal{
		RuleID:     input.RuleID,
		RuleBefore: rule,
		Proposed:   proposed,
		History:    history,
		Status:     "ok",
		Source:     "reader: internal/database/alert_repo.go AlertRuleRepo.GetByID + internal/database/notification_repo.go (firing history)",
	}
	return out, nil
}

// applyPatch produces a NEW *alertmodel.AlertRule with the
// LLM-proposed patch applied on top of the existing rule.
// Fields the patch leaves nil / empty are preserved verbatim
// from the existing rule. Pulled out so the test can exercise
// the merge semantics independently of the IO + dispatcher.
//
// IMPORTANT: this function does NOT mutate `existing`. It
// constructs a fresh struct value and overwrites only the
// patched fields.
func applyPatch(existing *alertmodel.AlertRule, patch alertRulePatchInput) *alertmodel.AlertRule {
	// Shallow-copy first so unrelated metadata (ID, Name,
	// Description, VehicleIDs, AllVehicles, Kind, Enabled,
	// IncludeTitle, msg_template, snoozed_until, escalation_*,
	// etc.) carries through unchanged.
	out := *existing

	// Pointer fields — nil-checks preserve "no patch" semantics.
	// Each pointer is freshly allocated to break the alias with
	// the existing rule's pointer (avoids surprising aliasing
	// when the caller mutates one but expects the other to be
	// stable).
	if patch.NewValueNum != nil {
		v := *patch.NewValueNum
		out.ValueNum = &v
	}
	if patch.NewValueText != nil {
		v := *patch.NewValueText
		out.ValueText = &v
	}
	if patch.NewValueBool != nil {
		v := *patch.NewValueBool
		out.ValueBool = &v
	}
	if patch.NewValueMin != nil {
		v := *patch.NewValueMin
		out.ValueMin = &v
	}
	if patch.NewValueMax != nil {
		v := *patch.NewValueMax
		out.ValueMax = &v
	}
	if patch.NewCooldownMin != nil {
		out.CooldownMin = *patch.NewCooldownMin
	}

	// String fields — non-empty means "patch this field".
	if patch.NewOp != "" {
		out.Op = patch.NewOp
	}
	if patch.NewSeverity != "" {
		out.Severity = patch.NewSeverity
	}
	if patch.NewTriggerMode != "" {
		out.TriggerMode = patch.NewTriggerMode
	}

	return &out
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// AlertTuningSuggestionsSources bundles the narrow port
// RegisterAlertTuningSuggestionsTools needs. Mirrors
// [AlertBuilderSources] / [TirePressureTrendReasoningSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AIAlertTuningSource); tests substitute
// deterministic fakes.
type AlertTuningSuggestionsSources struct {
	Source AlertTuningSource
}

// RegisterAlertTuningSuggestionsTools installs the
// alert-tuning-suggestions tools on r. Called from router.go after
// RegisterAlertBuilderTools so the existing `validate_alert_rule`
// tool is already in the registry, and after the companion
// alert-analysis tool so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
//
// Note: this function ONLY registers the NEW tool
// `draft_alert_rule_patch`. The strategy's other allowed tool
// (`validate_alert_rule`) is registered by RegisterAlertBuilderTools
// and reused here.
// The dispatcher's per-strategy whitelist gates which strategies
// can call which tool.
func RegisterAlertTuningSuggestionsTools(r *tools.Registry, s AlertTuningSuggestionsSources) {
	r.Register(&draftAlertRulePatch{source: s.Source})
}
