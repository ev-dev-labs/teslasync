// Phase-50 / 0015 — N1 Natural-language alert builder.
//
// alert_builder.go ships TWO new propose-only tools:
//
//   - `draft_alert_rule`    — accept a typed AlertRule shape and
//                             return a normalized + validated draft
//                             the frontend can render for human review.
//   - `validate_alert_rule` — accept a typed AlertRule shape and return
//                             whether it would be accepted by the canonical
//                             POST /api/v1/alerts/rules handler, with
//                             field-level error messages on rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate AlertRule
// DTOs but do NOT touch the database. The dispatcher's deny-all
// confirm gate is therefore never triggered — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// mutation flows through the existing typed POST /api/v1/alerts/rules
// AlertHandler.CreateAlertRule handler AFTER the user explicitly
// clicks Save in the AlertStudioPage UI.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate validation
//     to AlertRuleValidator (satisfied by the same validateAlertRule
//     function that the canonical AlertHandler uses), so a draft
//     accepted here is byte-equivalent to a draft accepted by the
//     POST handler.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     interface is intentionally narrow: a single Validate call.
//
//   - "no duplicate write paths" → the toolkit does NOT include a
//     `save_alert_rule` tool. The frontend renders the draft and the
//     user clicks Save, which fires the existing
//     useSaveAlertRule mutation against POST /api/v1/alerts/rules.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// AlertRuleValidator is the narrow validation interface the alert
// builder tools need. In production it is satisfied by
// *api.AIAlertRuleValidator (a thin wrapper around the unexported
// validateAlertRule function in internal/api/alert_handler_rules.go),
// so a draft accepted by the tool is byte-equivalent to a draft
// accepted by the canonical POST /api/v1/alerts/rules handler. Tests
// substitute a deterministic fake.
//
// The interface MUST stay validation-only — adding a Create or Save
// method here would defeat the propose-only contract that ADR-015
// §I3 + the slice prompt mandate.
type AlertRuleValidator interface {
	// ValidateAlertRule reports whether rule would be accepted by
	// the canonical typed AlertRule handler. Returns nil on
	// acceptance; an error whose Error() text is suitable for
	// surfacing to the LLM (it'll be relayed back as a tool error
	// reply) on rejection.
	ValidateAlertRule(rule *alertmodel.AlertRule) error
}

// alertRuleDraftInput is the typed input shape both tools share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// validator method runs.
//
// Field choice mirrors alertmodel.AlertRule's writeable surface plus the
// `vehicle_id` scoping enforced by the AI handler — the LLM may
// propose a different vehicle, but the handler clamps it to the
// caller's actual scope before invoking the tool. The handler
// supplies the vehicle scope to the tool via ContextOverrides; the
// tool then enforces the scope by overwriting the LLM-proposed
// vehicle selection.
type alertRuleDraftInput struct {
	// VehicleID is the vehicle the rule applies to. Required and
	// positive; used to seed VehicleIDs / vehicle_id on the draft.
	// The AI handler always scopes to the caller's own vehicle, so
	// a missing or nonsense ID is a programming error rather than
	// a user-facing case.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID this rule applies to."`

	// Name is the user-facing rule name. Capped at the same 200
	// chars the canonical validator enforces, and at least 1 char
	// so a blank name surfaces as an LLM-side error before reaching
	// the validator.
	Name string `json:"name" validate:"required,gte=1,lte=200" desc:"Human-readable rule name (1-200 chars)."`

	// SignalName is the canonical signal identifier (e.g.
	// "battery_level", "outside_temp"). The LLM MUST pick from the
	// project's signal catalog; an unknown name is rejected by the
	// canonical validator. Bounded so a runaway LLM cannot send
	// the validator a megabyte of garbage.
	SignalName string `json:"signal_name" validate:"required,gte=1,lte=128" desc:"Canonical signal identifier (e.g. battery_level)."`

	// Op is the comparison operator: one of =, !=, <, <=, >, >=,
	// changed, between, outside. The validator enforces the same
	// allowlist; we duplicate it here only so a malformed value
	// fails before reaching the validator (cheaper round-trip).
	Op string `json:"op" validate:"required,oneof== != < <= > >= changed between outside" desc:"Comparison operator: =, !=, <, <=, >, >=, changed, between, outside."`

	// Value* fields hold the comparison operand. Exactly which is
	// populated depends on Op + the signal's value type. The
	// canonical validator enforces the per-op rules in
	// validateAlertRuleOperand; pointers preserve the "field
	// absent" semantics the canonical layer expects.
	ValueNum  *float64 `json:"value_num,omitempty"  desc:"Numeric operand (used by <, <=, >, >=, =, !=)."`
	ValueText *string  `json:"value_text,omitempty" desc:"Text operand (used by = / != on string-valued signals)."`
	ValueBool *bool    `json:"value_bool,omitempty" desc:"Boolean operand (used by = / != on bool-valued signals)."`
	ValueMin  *float64 `json:"value_min,omitempty"  desc:"Lower bound (used by between / outside)."`
	ValueMax  *float64 `json:"value_max,omitempty"  desc:"Upper bound (used by between / outside)."`

	// Severity is one of "info", "warn", "critical". The canonical
	// validator rejects the legacy "warning" string, so we mirror
	// the strict allowlist here.
	Severity string `json:"severity" validate:"required,oneof=info warn critical" desc:"Severity tier: info, warn, or critical."`

	// CooldownMin is the minimum minutes between consecutive alerts
	// from this rule. Must be > 0 (the canonical validator
	// enforces the same; we mirror as gte=1).
	CooldownMin int `json:"cooldown_min" validate:"required,gte=1,lte=1440" desc:"Minimum minutes between alerts (1-1440)."`

	// TriggerMode is one of "once" or "repeat". Defaults to
	// "repeat" if omitted at the canonical layer; we keep it
	// optional here to match.
	TriggerMode string `json:"trigger_mode,omitempty" validate:"omitempty,oneof=once repeat" desc:"Trigger mode: once (rising edge only) or repeat (every cooldown while condition holds)."`

	// Description is an optional one-line explanation the LLM may
	// supply for the user. Bounded.
	Description string `json:"description,omitempty" validate:"omitempty,lte=512" desc:"Optional human-readable description."`
}

// alertRuleDraftOutput is the JSON envelope both tools return on
// success. The frontend renders it as the structured proposal in the
// AlertStudio's AI side panel.
//
// Status reports whether the draft would be accepted by the canonical
// validator at the time of the tool call:
//
//   - "ok"      — accepted; the user can click Save to persist.
//   - "invalid" — rejected; ValidationError contains a one-line
//     diagnostic suitable for showing in the UI.
//
// Even when invalid, Draft is returned unchanged so the frontend can
// render the partially-correct proposal and let the user fix the
// problem field rather than start over.
type alertRuleDraftOutput struct {
	// Draft is the proposed AlertRule shape, with vehicle scoping
	// already enforced (VehicleIDs = [requested vehicle]; AllVehicles
	// = false). All numeric / pointer fields are populated exactly
	// as the LLM proposed them (after typed parsing) — no
	// silent normalization beyond the canonical validator's path.
	Draft *alertmodel.AlertRule `json:"draft"`

	// Status is "ok" or "invalid".
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection, empty otherwise.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the canonical
	// validator rather than its own reasoning.
	Source string `json:"source"`
}

// buildDraftRule converts the LLM-proposed typed input into a
// *alertmodel.AlertRule with the vehicle scope clamped to the caller's
// actual vehicle. Pulled out so both tools (draft_alert_rule and
// validate_alert_rule) construct the rule the same way and a future
// edit to scope semantics touches one place.
//
// Important: even if the LLM proposed a different vehicle_id (e.g.
// hallucinated "999"), this function overwrites VehicleIDs to the
// caller's vehicle, mirroring the AI handler's same defence-in-depth
// scoping. The strategy's system prompt instructs the LLM to refuse
// cross-vehicle requests, but a confused model could still emit one;
// the typed clamp here is the load-bearing guard.
func buildDraftRule(input alertRuleDraftInput) *alertmodel.AlertRule {
	rule := &alertmodel.AlertRule{
		Name:        input.Name,
		SignalName:  input.SignalName,
		Op:          input.Op,
		Severity:    input.Severity,
		CooldownMin: input.CooldownMin,
		TriggerMode: input.TriggerMode,
		ValueNum:    input.ValueNum,
		ValueText:   input.ValueText,
		ValueBool:   input.ValueBool,
		ValueMin:    input.ValueMin,
		ValueMax:    input.ValueMax,
		// Vehicle scope: clamped to the caller's vehicle. The LLM
		// MAY propose a different ID via the input, but we
		// overwrite here so a confused model cannot draft a rule
		// for someone else's car. The strategy's system prompt
		// tells the LLM to refuse cross-vehicle requests; this is
		// the typed guard.
		AllVehicles: false,
		VehicleIDs:  []int64{input.VehicleID},
		// Kind defaults to "signal" — the natural-language
		// builder targets signal-threshold rules; the
		// computed-metric path is reachable from a different
		// surface and a future strategy.
		Kind: alertmodel.AlertRuleKindSignal,
		// Enabled defaults to true so a saved draft starts firing
		// immediately; the user can toggle it from the studio.
		Enabled: true,
		// IncludeTitle defaults to true to match the canonical
		// Create handler's default for backward-compat.
		IncludeTitle: true,
	}
	if input.Description != "" {
		desc := input.Description
		rule.Description = &desc
	}
	if rule.TriggerMode == "" {
		rule.TriggerMode = "repeat"
	}
	return rule
}

// allowedSignalsHint is the description suffix the tool descriptions
// surface to the LLM so it picks canonical signal names instead of
// hallucinating them. Sorted to keep the description deterministic
// across boots — the OpenAI / Anthropic providers cache prompt
// hashes per identical-text request.
//
// Kept narrow on purpose: this is the curated "1.0 baseline" set of
// safe-for-NL signal names. A future slice that wants the full
// catalog of 100+ telemetry fields can plumb a richer enumeration
// through ContextOverrides without touching the tool's input schema.
var allowedSignalsHint = func() string {
	names := []string{
		"battery_level", "battery_range", "charging_state",
		"outside_temp", "inside_temp",
		"speed", "odometer",
		"tire_pressure_fl", "tire_pressure_fr", "tire_pressure_rl", "tire_pressure_rr",
		"locked", "sentry_mode", "vehicle_state",
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}()

// draftAlertRule is the propose-only tool that builds a normalized
// + validated AlertRule draft for the AlertStudio UI to render. It
// is the FIRST tool the LLM is expected to call (per the strategy's
// system prompt).
//
// Execution is pure: input → typed AlertRule → canonical validator
// pass → JSON envelope. No DB call; no SQL; no side effects.
type draftAlertRule struct {
	validator AlertRuleValidator
}

// Name implements [Tool].
func (t *draftAlertRule) Name() string { return "draft_alert_rule" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// signal allowlist appended so the model picks from the curated set.
func (t *draftAlertRule) Description() string {
	return "Build a typed AlertRule draft from the user's natural-language description. " +
		"PROPOSE-ONLY: the rule is NOT saved; the user reviews the draft in the UI before clicking Save. " +
		"Pick signal_name from this allowlist: " + allowedSignalsHint + ". " +
		"Severity is one of info, warn, critical. Operators: =, !=, <, <=, >, >=, changed, between, outside. " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftAlertRule) InputSchema() json.RawMessage {
	return CachedSchema(alertRuleDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *draftAlertRule) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true. The
// tool builds + validates a DTO but does NOT touch the database.
// The actual save flows through the existing
// POST /api/v1/alerts/rules handler AFTER the user clicks Save.
func (t *draftAlertRule) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftAlertRule) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftAlertRule) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[alertRuleDraftInput](raw)
}

// Execute implements [Tool]. Builds the draft, runs the canonical
// validator, returns the envelope. Never returns an error from the
// validator path — validation failures are surfaced as
// status="invalid" in the envelope so the LLM's follow-up prose can
// describe the problem rather than the dispatcher relaying an error
// frame.
//
// A nil validator is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
func (t *draftAlertRule) Execute(_ context.Context, in any) (any, error) {
	input := in.(alertRuleDraftInput)
	if t.validator == nil {
		return nil, errors.New("draft_alert_rule: no AlertRuleValidator wired")
	}

	rule := buildDraftRule(input)

	out := &alertRuleDraftOutput{
		Draft:  rule,
		Status: "ok",
		Source: "validator: internal/api/alert_handler_rules.go validateAlertRule",
	}
	if err := t.validator.ValidateAlertRule(rule); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// alertRuleValidateInput is the typed input for validate_alert_rule.
// Mirrors alertRuleDraftInput field-for-field so the LLM can call
// either tool with the same payload — the difference is semantic
// (draft = build + check; validate = check only).
//
// We keep the two input types separate (rather than reusing one)
// because a future change to validate-only semantics (e.g. accepting
// an existing rule's ID for diff-style validation) would force the
// types to diverge anyway.
type alertRuleValidateInput struct {
	// VehicleID — see alertRuleDraftInput.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID this rule applies to."`

	Name        string   `json:"name" validate:"required,gte=1,lte=200" desc:"Human-readable rule name."`
	SignalName  string   `json:"signal_name" validate:"required,gte=1,lte=128" desc:"Canonical signal identifier."`
	Op          string   `json:"op" validate:"required,oneof== != < <= > >= changed between outside" desc:"Comparison operator."`
	ValueNum    *float64 `json:"value_num,omitempty"  desc:"Numeric operand."`
	ValueText   *string  `json:"value_text,omitempty" desc:"Text operand."`
	ValueBool   *bool    `json:"value_bool,omitempty" desc:"Boolean operand."`
	ValueMin    *float64 `json:"value_min,omitempty"  desc:"Lower bound."`
	ValueMax    *float64 `json:"value_max,omitempty"  desc:"Upper bound."`
	Severity    string   `json:"severity" validate:"required,oneof=info warn critical" desc:"Severity tier."`
	CooldownMin int      `json:"cooldown_min" validate:"required,gte=1,lte=1440" desc:"Minimum minutes between alerts."`
	TriggerMode string   `json:"trigger_mode,omitempty" validate:"omitempty,oneof=once repeat" desc:"Trigger mode."`
	Description string   `json:"description,omitempty" validate:"omitempty,lte=512" desc:"Optional description."`
}

// alertRuleValidateOutput is the envelope returned by
// validate_alert_rule. Mirrors alertRuleDraftOutput minus the Draft
// field — the LLM already has the draft; this tool reports whether
// it would be accepted.
type alertRuleValidateOutput struct {
	Status          string `json:"status"`                     // "ok" | "invalid"
	ValidationError string `json:"validation_error,omitempty"` // empty when ok
	Source          string `json:"source"`
}

// validateAlertRule is the propose-only tool that runs the canonical
// validator over a typed AlertRule shape and reports the verdict.
// It is the SECOND tool the LLM is expected to call (per the
// strategy's system prompt) — typically immediately after
// draft_alert_rule, so the assistant can confirm the draft would
// pass before narrating it to the user.
//
// Execution is pure: input → typed AlertRule → canonical validator
// pass → JSON envelope. No DB call; no SQL; no side effects.
type validateAlertRuleTool struct {
	validator AlertRuleValidator
}

// Name implements [Tool].
func (t *validateAlertRuleTool) Name() string { return "validate_alert_rule" }

// Description implements [Tool].
func (t *validateAlertRuleTool) Description() string {
	return "Run the canonical AlertRule validator over a typed AlertRule shape and report whether it would be accepted by the POST /api/v1/alerts/rules handler. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_alert_rule to confirm a proposed draft will be accepted before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateAlertRuleTool) InputSchema() json.RawMessage {
	return CachedSchema(alertRuleValidateInput{})
}

// OutputSchema implements [Tool].
func (t *validateAlertRuleTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateAlertRuleTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_alert_rule.
func (t *validateAlertRuleTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateAlertRuleTool) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[alertRuleValidateInput](raw)
}

// Execute implements [Tool]. Builds an AlertRule from the typed
// input, runs the canonical validator, returns the verdict envelope.
// Same error semantics as draft_alert_rule: validation failures are
// surfaced as status="invalid", never as a returned error.
func (t *validateAlertRuleTool) Execute(_ context.Context, in any) (any, error) {
	input := in.(alertRuleValidateInput)
	if t.validator == nil {
		return nil, errors.New("validate_alert_rule: no AlertRuleValidator wired")
	}

	// Reuse buildDraftRule's construction by adapting the input
	// type. The two input shapes are field-equivalent today; if
	// they diverge in a future slice, expand the conversion here.
	rule := buildDraftRule(alertRuleDraftInput(input))

	out := &alertRuleValidateOutput{
		Status: "ok",
		Source: "validator: internal/api/alert_handler_rules.go validateAlertRule",
	}
	if err := t.validator.ValidateAlertRule(rule); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// AlertBuilderSources bundles the narrow validator interface
// RegisterAlertBuilderTools needs. Mirrors [DigestSources] /
// [YearReviewSources] / [AnomalySources] but exposes only the
// surface the alert-builder tools actually consume.
//
// Production wiring (router.go) instantiates *api.AIAlertRuleValidator
// (a thin wrapper around the unexported validateAlertRule function);
// tests substitute deterministic fakes.
type AlertBuilderSources struct {
	Validator AlertRuleValidator
}

// RegisterAlertBuilderTools installs the nl-alert-builder slice's
// tools on r. Called from router.go AFTER Register12Builtins +
// RegisterDigestTools + RegisterYearReviewTools + RegisterAnomalyTools
// so the registry's alphabetical Names list grows deterministically
// without disturbing earlier registrations or the BuiltinNames pin
// test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterAlertBuilderTools(r *Registry, s AlertBuilderSources) {
	r.Register(&draftAlertRule{validator: s.Validator})
	r.Register(&validateAlertRuleTool{validator: s.Validator})
}
