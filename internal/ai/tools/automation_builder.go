// Phase-50 / 0016 — N2 Natural-language automation builder.
//
// automation_builder.go ships TWO new propose-only tools:
//
//   - `draft_automation_graph`    — accept a typed Automation graph
//                                   shape (one trigger + 0..N
//                                   conditions + 1..N actions) and
//                                   return a normalized + validated
//                                   draft the frontend can render
//                                   for human review.
//   - `validate_automation_graph` — accept a typed Automation graph
//                                   shape and return whether it
//                                   would be accepted by the
//                                   canonical
//                                   POST /api/v1/automations
//                                   handler, with an error message
//                                   on rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate Automation
// graph DTOs but do NOT touch the database. The dispatcher's
// deny-all confirm gate is therefore never triggered — defence in
// depth in case a future edit accidentally adds a write tool. The
// actual mutation flows through the existing typed
// POST /api/v1/automations AutomationHandler.Create handler AFTER
// the user explicitly clicks Save in the AutomationBuilderPage UI.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate validation
//     to AutomationGraphValidator (satisfied by the same
//     decodeAutomationInputDTO function that the canonical
//     AutomationHandler uses), so a draft accepted here is
//     byte-equivalent to a draft accepted by the POST handler.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     interface is intentionally narrow: a single Validate call.
//
//   - "no duplicate write paths" → the toolkit does NOT include a
//     `save_automation` tool. The frontend renders the draft and
//     the user clicks Save, which fires the existing
//     useCreateAutomation* mutation against POST /api/v1/automations.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// AutomationGraphValidator is the narrow validation interface the
// automation builder tools need. In production it is satisfied by
// *api.AIAutomationGraphValidator (a thin wrapper around the
// unexported decodeAutomationInputDTO function in
// internal/api/automation_handler_decode.go), so a draft accepted by
// the tool is byte-equivalent to a draft accepted by the canonical
// POST /api/v1/automations handler. Tests substitute a deterministic
// fake.
//
// The interface MUST stay validation-only — adding a Create or Save
// method here would defeat the propose-only contract that ADR-015
// §I3 + the slice prompt mandate.
type AutomationGraphValidator interface {
	// ValidateAutomationWire reports whether the given automation
	// wire-JSON payload would be accepted by the canonical typed
	// Automation handler. Returns nil on acceptance; an error
	// whose Error() text is suitable for surfacing to the LLM
	// (it'll be relayed back as a tool error reply) on rejection.
	//
	// The payload MUST match the canonical
	// `automationInputWire` shape (name, description, vehicle_id,
	// enabled, triggers, conditions, actions). The canonical
	// handler uses DisallowUnknownFields, so extra keys are
	// rejected.
	ValidateAutomationWire(wireJSON json.RawMessage) error
}

// automationGraphTriggerInput is the typed shape for the (single)
// trigger the LLM proposes. Mirrors the canonical
// `automationTriggerSignalDTO` / `automationTriggerGeofenceDTO` /
// `automationTriggerScheduleDTO` / `automationTriggerEventDTO`
// union: the discriminator is `kind` and the rest of the fields
// describe the kind-specific payload. We accept the union flat
// because the F4 schema generator does not support discriminated
// unions; the canonical decoder does the per-kind dispatch
// downstream.
//
// Field tagging strategy: every field is `omitempty` so a single
// flattened struct can serialise as any of the four trigger shapes
// without leaking irrelevant null keys to the canonical decoder
// (which would reject them via DisallowUnknownFields). The runtime
// `buildWirePayload` helper drops empty/zero pointer fields from the
// per-trigger map before re-encoding.
type automationGraphTriggerInput struct {
	Kind         string   `json:"kind" validate:"required,oneof=trigger_signal trigger_geofence trigger_schedule trigger_event" desc:"Trigger kind: trigger_signal, trigger_geofence, trigger_schedule, or trigger_event."`
	Signal       string   `json:"signal,omitempty" desc:"Canonical signal identifier for trigger_signal (e.g. battery_level)."`
	Op           string   `json:"op,omitempty" desc:"Comparison operator for trigger_signal: =, !=, <, <=, >, >=, changed, crossed_above, crossed_below."`
	ValueText    *string  `json:"value_text,omitempty" desc:"Text operand for trigger_signal."`
	ValueNum     *float64 `json:"value_num,omitempty" desc:"Numeric operand for trigger_signal."`
	ValueBool    *bool    `json:"value_bool,omitempty" desc:"Boolean operand for trigger_signal."`
	PlaceID      int64    `json:"place_id,omitempty" desc:"Geofence place ID for trigger_geofence."`
	Event        string   `json:"event,omitempty" desc:"Geofence event for trigger_geofence: enter, exit, or dwell."`
	DwellMinutes *int     `json:"dwell_minutes,omitempty" desc:"Dwell duration in minutes (only with event=dwell)."`
	CronExpr     string   `json:"cron_expr,omitempty" desc:"Cron expression for trigger_schedule."`
	Timezone     string   `json:"timezone,omitempty" desc:"IANA timezone name for trigger_schedule (defaults to UTC)."`
	EventType    string   `json:"event_type,omitempty" desc:"Event type for trigger_event: drive_start, drive_end, charge_start, charge_end, sleep_start, sleep_end, online, offline, sentry_alert."`
}

// automationGraphConditionInput is the typed shape for one condition.
// Same flattened-union strategy as the trigger input; the canonical
// decoder dispatches on `kind`.
type automationGraphConditionInput struct {
	Kind              string   `json:"kind" validate:"required,oneof=condition_signal condition_time_window condition_geofence condition_other_automation" desc:"Condition kind."`
	Signal            string   `json:"signal,omitempty" desc:"Canonical signal identifier for condition_signal."`
	Op                string   `json:"op,omitempty" desc:"Comparison operator for condition_signal: =, !=, <, <=, >, >=, between, in."`
	ValueText         *string  `json:"value_text,omitempty" desc:"Text operand."`
	ValueNum          *float64 `json:"value_num,omitempty" desc:"Numeric operand."`
	ValueBool         *bool    `json:"value_bool,omitempty" desc:"Boolean operand."`
	ValueMin          *float64 `json:"value_min,omitempty" desc:"Lower bound for between."`
	ValueMax          *float64 `json:"value_max,omitempty" desc:"Upper bound for between."`
	StartTime         string   `json:"start_time,omitempty" desc:"Window start HH:MM (condition_time_window)."`
	EndTime           string   `json:"end_time,omitempty" desc:"Window end HH:MM (condition_time_window)."`
	Timezone          string   `json:"timezone,omitempty" desc:"IANA timezone (condition_time_window)."`
	DaysOfWeek        []int    `json:"days_of_week,omitempty" desc:"Days of week 0-6 (condition_time_window)."`
	PlaceID           int64    `json:"place_id,omitempty" desc:"Geofence place ID (condition_geofence)."`
	State             string   `json:"state,omitempty" desc:"Geofence/automation state."`
	OtherAutomationID int64    `json:"other_automation_id,omitempty" desc:"Other automation ID (condition_other_automation)."`
}

// automationGraphActionInput is the typed shape for one action. Same
// flattened-union strategy as the trigger / condition inputs.
type automationGraphActionInput struct {
	Kind               string          `json:"kind" validate:"required,oneof=action_command action_notify action_set_setting action_call_automation" desc:"Action kind."`
	CommandName        string          `json:"command_name,omitempty" desc:"Command name (action_command)."`
	CommandParams      json.RawMessage `json:"command_params,omitempty" desc:"Command parameters JSON (action_command)."`
	ChannelID          int64           `json:"channel_id,omitempty" desc:"Notification channel ID (action_notify)."`
	Template           string          `json:"template,omitempty" desc:"Notification template (action_notify)."`
	SettingKey         string          `json:"setting_key,omitempty" desc:"Setting key (action_set_setting)."`
	ValueText          *string         `json:"value_text,omitempty" desc:"Text value (action_set_setting)."`
	ValueNum           *float64        `json:"value_num,omitempty" desc:"Numeric value (action_set_setting)."`
	ValueBool          *bool           `json:"value_bool,omitempty" desc:"Boolean value (action_set_setting)."`
	TargetAutomationID int64           `json:"target_automation_id,omitempty" desc:"Target automation ID (action_call_automation)."`
}

// automationGraphDraftInput is the typed input shape both tools
// share. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any validator method runs.
//
// Field choice mirrors the canonical `automationInputWire` plus the
// `vehicle_id` scoping enforced by the AI handler — the LLM may
// propose a different vehicle, but the handler clamps it to the
// caller's actual scope before invoking the tool. The handler
// supplies the vehicle scope to the tool via ContextOverrides; the
// tool then enforces the scope by overwriting the LLM-proposed
// vehicle selection.
type automationGraphDraftInput struct {
	// VehicleID is the vehicle the automation applies to.
	// Required and positive. The AI handler always scopes to the
	// caller's own vehicle, so a missing or nonsense ID is a
	// programming error rather than a user-facing case.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID this automation applies to."`

	// Name is the user-facing automation name. Capped at 200
	// chars (mirrors the canonical automation handler) and at
	// least 1 char so a blank name surfaces as an LLM-side error
	// before reaching the validator.
	Name string `json:"name" validate:"required,gte=1,lte=200" desc:"Human-readable automation name (1-200 chars)."`

	// Description is an optional one-line explanation the LLM may
	// supply. Bounded.
	Description string `json:"description,omitempty" validate:"omitempty,lte=512" desc:"Optional human-readable description."`

	// Trigger is the (single) trigger that fires the automation.
	// Exactly one trigger is supported; multi-trigger automations
	// require a separate strategy.
	Trigger automationGraphTriggerInput `json:"trigger" desc:"The single trigger that fires this automation."`

	// Conditions are 0..N optional gates that must all evaluate
	// true for the actions to run.
	Conditions []automationGraphConditionInput `json:"conditions,omitempty" desc:"Optional list of conditions (all must match)."`

	// Actions are 1..N steps to execute when the trigger fires
	// and conditions pass. At least one action is required by the
	// canonical validator.
	Actions []automationGraphActionInput `json:"actions" validate:"required,min=1" desc:"At least one action is required."`
}

// automationGraphDraftOutput is the JSON envelope both tools return
// on success. The frontend renders it as the structured proposal in
// the AutomationBuilder's AI side panel.
//
// Status reports whether the draft would be accepted by the
// canonical validator at the time of the tool call:
//
//   - "ok"      — accepted; the user can click Save to persist.
//   - "invalid" — rejected; ValidationError contains a one-line
//     diagnostic suitable for showing in the UI.
//
// Even when invalid, Draft is returned unchanged so the frontend can
// render the partially-correct proposal and let the user fix the
// problem field rather than start over.
type automationGraphDraftOutput struct {
	// Draft is the canonical wire-shaped Automation payload (the
	// same JSON the POST /api/v1/automations handler accepts),
	// with vehicle scoping already enforced. The frontend can
	// pipe it directly into the AutomationBuilderPage form
	// without any additional transformation.
	Draft json.RawMessage `json:"draft"`

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

// automationGraphValidateOutput is the envelope returned by
// validate_automation_graph. Mirrors automationGraphDraftOutput
// minus the Draft field — the LLM already has the draft; this tool
// reports whether it would be accepted.
type automationGraphValidateOutput struct {
	Status          string `json:"status"`                     // "ok" | "invalid"
	ValidationError string `json:"validation_error,omitempty"` // empty when ok
	Source          string `json:"source"`
}

// allowedTriggerKindsHint is the description suffix surfaced to the
// LLM so it picks canonical trigger discriminator values instead of
// hallucinating them. Sorted to keep the description deterministic
// across boots.
var allowedTriggerKindsHint = func() string {
	names := []string{
		"trigger_signal", "trigger_geofence", "trigger_schedule", "trigger_event",
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}()

// allowedConditionKindsHint mirrors allowedTriggerKindsHint for the
// condition discriminator values.
var allowedConditionKindsHint = func() string {
	names := []string{
		"condition_signal", "condition_time_window", "condition_geofence", "condition_other_automation",
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}()

// allowedActionKindsHint mirrors allowedTriggerKindsHint for the
// action discriminator values.
var allowedActionKindsHint = func() string {
	names := []string{
		"action_command", "action_notify", "action_set_setting", "action_call_automation",
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}()

// buildWirePayload converts the LLM-proposed typed input into the
// canonical `automationInputWire` JSON shape with the vehicle scope
// clamped to the caller's actual vehicle. Pulled out so both tools
// (draft_automation_graph and validate_automation_graph) construct
// the wire payload the same way and a future edit to scope semantics
// touches one place.
//
// Important: even if the LLM proposed a different vehicle_id (e.g.
// hallucinated "999"), this function overwrites VehicleID to the
// caller's vehicle, mirroring the AI handler's same defence-in-depth
// scoping. The strategy's system prompt instructs the LLM to refuse
// cross-vehicle requests, but a confused model could still emit one;
// the typed clamp here is the load-bearing guard.
//
// Returns the JSON-encoded wire payload ready to feed straight into
// the canonical decoder. Returns an error only if the encoder
// itself fails (which it cannot for these well-typed structs).
func buildWirePayload(input automationGraphDraftInput) (json.RawMessage, error) {
	// Build per-step maps so we can omit empty/zero fields the
	// canonical decoder would reject via DisallowUnknownFields.
	triggerMap := triggerToMap(input.Trigger)
	conditionMaps := make([]map[string]any, 0, len(input.Conditions))
	for _, c := range input.Conditions {
		conditionMaps = append(conditionMaps, conditionToMap(c))
	}
	actionMaps := make([]map[string]any, 0, len(input.Actions))
	for _, a := range input.Actions {
		actionMaps = append(actionMaps, actionToMap(a))
	}

	enabled := true
	wire := map[string]any{
		"name":        input.Name,
		"description": input.Description,
		// Vehicle scope: clamped to the caller's vehicle. The LLM
		// MAY propose a different ID via the input, but we
		// overwrite here so a confused model cannot draft an
		// automation for someone else's car. The strategy's
		// system prompt tells the LLM to refuse cross-vehicle
		// requests; this is the typed guard.
		"vehicle_id": input.VehicleID,
		// Enabled defaults to true so a saved draft starts
		// running immediately; the user can toggle it from the
		// builder.
		"enabled":    &enabled,
		"triggers":   []map[string]any{triggerMap},
		"conditions": conditionMaps,
		"actions":    actionMaps,
	}
	raw, err := json.Marshal(wire)
	if err != nil {
		return nil, fmt.Errorf("encode automation wire payload: %w", err)
	}
	return raw, nil
}

// triggerToMap converts a flattened typed trigger into the
// kind-specific map the canonical decoder expects. Only the fields
// relevant to the kind are emitted so DisallowUnknownFields is
// satisfied.
func triggerToMap(t automationGraphTriggerInput) map[string]any {
	m := map[string]any{"kind": t.Kind}
	switch t.Kind {
	case "trigger_signal":
		setNonEmpty(m, "signal", t.Signal)
		setNonEmpty(m, "op", t.Op)
		setPtr(m, "value_text", t.ValueText)
		setPtr(m, "value_num", t.ValueNum)
		setPtr(m, "value_bool", t.ValueBool)
	case "trigger_geofence":
		if t.PlaceID != 0 {
			m["place_id"] = t.PlaceID
		}
		setNonEmpty(m, "event", t.Event)
		setPtr(m, "dwell_minutes", t.DwellMinutes)
	case "trigger_schedule":
		setNonEmpty(m, "cron_expr", t.CronExpr)
		setNonEmpty(m, "timezone", t.Timezone)
	case "trigger_event":
		setNonEmpty(m, "event_type", t.EventType)
	}
	return m
}

// conditionToMap mirrors triggerToMap for conditions.
func conditionToMap(c automationGraphConditionInput) map[string]any {
	m := map[string]any{"kind": c.Kind}
	switch c.Kind {
	case "condition_signal":
		setNonEmpty(m, "signal", c.Signal)
		setNonEmpty(m, "op", c.Op)
		setPtr(m, "value_text", c.ValueText)
		setPtr(m, "value_num", c.ValueNum)
		setPtr(m, "value_bool", c.ValueBool)
		setPtr(m, "value_min", c.ValueMin)
		setPtr(m, "value_max", c.ValueMax)
	case "condition_time_window":
		setNonEmpty(m, "start_time", c.StartTime)
		setNonEmpty(m, "end_time", c.EndTime)
		setNonEmpty(m, "timezone", c.Timezone)
		if len(c.DaysOfWeek) > 0 {
			m["days_of_week"] = c.DaysOfWeek
		}
	case "condition_geofence":
		if c.PlaceID != 0 {
			m["place_id"] = c.PlaceID
		}
		setNonEmpty(m, "state", c.State)
	case "condition_other_automation":
		if c.OtherAutomationID != 0 {
			m["other_automation_id"] = c.OtherAutomationID
		}
		setNonEmpty(m, "state", c.State)
	}
	return m
}

// actionToMap mirrors triggerToMap for actions.
func actionToMap(a automationGraphActionInput) map[string]any {
	m := map[string]any{"kind": a.Kind}
	switch a.Kind {
	case "action_command":
		setNonEmpty(m, "command_name", a.CommandName)
		if len(a.CommandParams) > 0 {
			m["command_params"] = a.CommandParams
		}
	case "action_notify":
		if a.ChannelID != 0 {
			m["channel_id"] = a.ChannelID
		}
		setNonEmpty(m, "template", a.Template)
	case "action_set_setting":
		setNonEmpty(m, "setting_key", a.SettingKey)
		setPtr(m, "value_text", a.ValueText)
		setPtr(m, "value_num", a.ValueNum)
		setPtr(m, "value_bool", a.ValueBool)
	case "action_call_automation":
		if a.TargetAutomationID != 0 {
			m["target_automation_id"] = a.TargetAutomationID
		}
	}
	return m
}

// setNonEmpty assigns m[key]=val only when val is non-empty. Keeps
// the encoded payload free of stray "":"" entries the canonical
// decoder would reject.
func setNonEmpty(m map[string]any, key, val string) {
	if val != "" {
		m[key] = val
	}
}

// setPtr assigns m[key]=val only when ptr is non-nil. Same rationale
// as setNonEmpty.
func setPtr[T any](m map[string]any, key string, ptr *T) {
	if ptr != nil {
		m[key] = *ptr
	}
}

// draftAutomationGraph is the propose-only tool that builds a
// normalized + validated Automation graph draft for the
// AutomationBuilder UI to render. It is the FIRST tool the LLM is
// expected to call (per the strategy's system prompt).
//
// Execution is pure: input → typed wire payload → canonical
// validator pass → JSON envelope. No DB call; no SQL; no side
// effects.
type draftAutomationGraph struct {
	validator AutomationGraphValidator
}

// Name implements [Tool].
func (t *draftAutomationGraph) Name() string { return "draft_automation_graph" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// kind allowlists appended so the model picks from the curated
// sets.
func (t *draftAutomationGraph) Description() string {
	return "Build a typed Automation graph draft (one trigger plus optional conditions plus one or more actions) from the user's natural-language description. " +
		"PROPOSE-ONLY: the automation is NOT saved; the user reviews the draft in the UI before clicking Save. " +
		"Trigger kinds: " + allowedTriggerKindsHint + ". " +
		"Condition kinds: " + allowedConditionKindsHint + ". " +
		"Action kinds: " + allowedActionKindsHint + ". " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftAutomationGraph) InputSchema() json.RawMessage {
	return CachedSchema(automationGraphDraftInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *draftAutomationGraph) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true. The
// tool builds + validates a wire payload but does NOT touch the
// database. The actual save flows through the existing
// POST /api/v1/automations handler AFTER the user clicks Save.
func (t *draftAutomationGraph) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftAutomationGraph) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftAutomationGraph) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[automationGraphDraftInput](raw)
}

// Execute implements [Tool]. Builds the wire payload, runs the
// canonical validator, returns the envelope. Never returns an error
// from the validator path — validation failures are surfaced as
// status="invalid" in the envelope so the LLM's follow-up prose can
// describe the problem rather than the dispatcher relaying an error
// frame.
//
// A nil validator is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
func (t *draftAutomationGraph) Execute(_ context.Context, in any) (any, error) {
	input := in.(automationGraphDraftInput)
	if t.validator == nil {
		return nil, errors.New("draft_automation_graph: no AutomationGraphValidator wired")
	}

	wire, err := buildWirePayload(input)
	if err != nil {
		return nil, fmt.Errorf("draft_automation_graph: build wire payload: %w", err)
	}

	out := &automationGraphDraftOutput{
		Draft:  wire,
		Status: "ok",
		Source: "validator: internal/api/automation_handler_decode.go decodeAutomationInputDTO",
	}
	if err := t.validator.ValidateAutomationWire(wire); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// validateAutomationGraphTool is the propose-only tool that runs the
// canonical validator over a typed Automation graph shape and
// reports the verdict. It is the SECOND tool the LLM is expected to
// call (per the strategy's system prompt) — typically immediately
// after draft_automation_graph, so the assistant can confirm the
// draft would pass before narrating it to the user.
//
// Execution is pure: input → typed wire payload → canonical
// validator pass → JSON envelope. No DB call; no SQL; no side
// effects.
type validateAutomationGraphTool struct {
	validator AutomationGraphValidator
}

// Name implements [Tool].
func (t *validateAutomationGraphTool) Name() string { return "validate_automation_graph" }

// Description implements [Tool].
func (t *validateAutomationGraphTool) Description() string {
	return "Run the canonical Automation validator over a typed Automation graph shape and report whether it would be accepted by the POST /api/v1/automations handler. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_automation_graph to confirm a proposed draft will be accepted before narrating it to the user."
}

// InputSchema implements [Tool]. Reuses the draft input schema —
// validate-only consumes the same typed shape as draft.
func (t *validateAutomationGraphTool) InputSchema() json.RawMessage {
	return CachedSchema(automationGraphDraftInput{})
}

// OutputSchema implements [Tool].
func (t *validateAutomationGraphTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *validateAutomationGraphTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_automation_graph.
func (t *validateAutomationGraphTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateAutomationGraphTool) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[automationGraphDraftInput](raw)
}

// Execute implements [Tool]. Builds the wire payload, runs the
// canonical validator, returns the verdict envelope. Same error
// semantics as draft_automation_graph: validation failures are
// surfaced as status="invalid", never as a returned error.
func (t *validateAutomationGraphTool) Execute(_ context.Context, in any) (any, error) {
	input := in.(automationGraphDraftInput)
	if t.validator == nil {
		return nil, errors.New("validate_automation_graph: no AutomationGraphValidator wired")
	}

	wire, err := buildWirePayload(input)
	if err != nil {
		return nil, fmt.Errorf("validate_automation_graph: build wire payload: %w", err)
	}

	out := &automationGraphValidateOutput{
		Status: "ok",
		Source: "validator: internal/api/automation_handler_decode.go decodeAutomationInputDTO",
	}
	if err := t.validator.ValidateAutomationWire(wire); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// AutomationBuilderSources bundles the narrow validator interface
// RegisterAutomationBuilderTools needs. Mirrors [DigestSources] /
// [YearReviewSources] / [AnomalySources] / [AlertBuilderSources] but
// exposes only the surface the automation-builder tools actually
// consume.
//
// Production wiring (router.go) instantiates
// *api.AIAutomationGraphValidator (a thin wrapper around the
// unexported decodeAutomationInputDTO function); tests substitute
// deterministic fakes.
type AutomationBuilderSources struct {
	Validator AutomationGraphValidator
}

// RegisterAutomationBuilderTools installs the
// nl-automation-builder slice's tools on r. Called from router.go
// AFTER RegisterAlertBuilderTools so the registry's alphabetical
// Names list grows deterministically without disturbing earlier
// registrations or the BuiltinNames pin test.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterAutomationBuilderTools(r *Registry, s AutomationBuilderSources) {
	r.Register(&draftAutomationGraph{validator: s.Validator})
	r.Register(&validateAutomationGraphTool{validator: s.Validator})
}
