// Phase-50 / 0044 — S3 Signal explorer NL filter.
//
// signal_explorer_nl_filter.go ships TWO new propose-only tools:
//
//   - `draft_signal_filter`    — accept a typed SignalFilter shape
//                                (vehicle_id, signals, range_preset,
//                                per_page) and return a normalized +
//                                validated draft the frontend can
//                                render for human review in the AI
//                                side panel.
//
//   - `validate_signal_filter` — accept the same typed shape and
//                                return whether it would be accepted
//                                by the canonical SignalExplorerPage
//                                form, with field-level error
//                                messages on rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate a
// SignalFilter DTO but do NOT touch URL state, the database, or
// signal_log. The dispatcher's deny-all confirm gate is therefore
// never triggered — defence in depth in case a future edit
// accidentally adds a write tool. The actual filter application
// flows through the existing typed SignalSelector + RangePicker on
// the SignalExplorerPage AFTER the user explicitly clicks the
// Apply button in the AI side panel; the LLM has no tool that
// writes URL state or fetches history.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI HTTP handler inspects the per-vehicle
// signal catalog (the same catalog the SPA's
// GET /api/v1/signals/{vehicleID}/available endpoint returns) and
// installs the (vehicle_id, signal-name set) snapshot in ctx via
// WithScopedSignalCatalog BEFORE the dispatcher invokes the tool.
// Both tools' Execute REJECT any LLM-supplied signal name that is
// NOT in the snapshot AND any LLM-supplied vehicle_id that does
// not match the request's bound vehicle. This blocks a prompt-
// injection attack where an attacker pastes "show me odometer for
// vehicle 99 instead" into the prompt — even if the LLM tries to
// call the tool with an out-of-scope signal or vehicle, the scope
// check refuses the call before any cross-vehicle proposal can
// reach the SPA.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate the final
//     SignalFilter shape check to the SAME enumeration the
//     SignalExplorerPage renders (range_preset ∈ today / yesterday
//     / 7d / 30d / 90d / all; per_page ∈ 25 / 50 / 100 / 500),
//     exposed via the narrow [SignalFilterValidator] port.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     The interface is intentionally narrow: a single Validate
//     call.
//
//   - "no duplicate write paths" → the toolkit does NOT include a
//     `apply_signal_filter`, `fetch_signal_history`, or any other
//     write / fetch tool. The frontend renders the draft and the
//     user clicks the canonical baseline Explore button on the
//     SignalExplorerPage, which fires the existing typed
//     GET /api/v1/signals/{vehicleID}/{signalName}/history
//     handler.

package nl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Per-request signal-catalog scope binding
// ---------------------------------------------------------------------------

// scopedSignalCatalogScope is the value stored in context. Holding
// the bound vehicle and the signal-name set in a single value lets
// the tool make one O(1) lookup against the scope (instead of two
// context-value reads), and lets missing-scope (no value) be
// distinguished from empty-scope (zero in-catalog signals — a
// degenerate but legal state) at the type level.
type scopedSignalCatalogScope struct {
	vehicleID int64
	signals   map[string]struct{}
}

// scopedSignalCatalogKey is the unexported context-key type used to
// carry the in-scope snapshot through the dispatcher to the tool.
// A per-package unexported type prevents accidental key collisions
// with any other context value in the request lifetime.
type scopedSignalCatalogKey struct{}

// WithScopedSignalCatalog returns ctx with the (vehicleID, signals)
// snapshot installed as the in-scope per-vehicle signal catalog
// for this request. Called by the AI HTTP handler AFTER it loads
// the per-vehicle catalog from the canonical signals API and BEFORE
// the dispatcher.Run loop is started. The dispatcher then
// propagates ctx unchanged through every Tool.Execute call.
//
// signals is defensively copied into a private set so a later
// mutation by the caller cannot retroactively widen or narrow the
// scope a tool already consulted. nil-safe: passing nil for the
// signals slice installs an empty scope (the tool will refuse
// every signal name).
//
// Exported so internal/api can install the scope without depending
// on tool-internal types.
func WithScopedSignalCatalog(ctx context.Context, vehicleID int64, signals []string) context.Context {
	scope := &scopedSignalCatalogScope{
		vehicleID: vehicleID,
		signals:   namesToSet(signals),
	}
	return context.WithValue(ctx, scopedSignalCatalogKey{}, scope)
}

// ScopedSignalCatalogFromContext returns the in-scope (vehicleID,
// signals) snapshot and true when one is present, or (0, nil,
// false) when no scope is installed. Tools that are scope-bound
// MUST treat the missing-scope case as a hard failure — the AI
// handler ALWAYS installs the scope, so an absent scope means the
// dispatcher was invoked from an unintended path and the call must
// be refused.
//
// Returns the bound vehicle id and a sorted defensive copy of the
// signal names (callers may mutate freely).
//
// Exported for symmetry with WithScopedSignalCatalog and so unit
// tests in other packages can inspect what the AI handler installed.
func ScopedSignalCatalogFromContext(ctx context.Context) (vehicleID int64, signals []string, ok bool) {
	scope, ok := ctx.Value(scopedSignalCatalogKey{}).(*scopedSignalCatalogScope)
	if !ok || scope == nil {
		return 0, nil, false
	}
	return scope.vehicleID, namesSetToSortedSlice(scope.signals), true
}

// namesToSet builds a defensive name-set; a nil input yields an
// empty map (NOT a nil map) so membership lookups stay correct
// without an extra nil-check.
func namesToSet(names []string) map[string]struct{} {
	out := make(map[string]struct{}, len(names))
	for _, n := range names {
		if n == "" {
			continue
		}
		out[n] = struct{}{}
	}
	return out
}

// namesSetToSortedSlice returns the keys of m in ascending order.
// Used only by tests and the diagnostic
// ScopedSignalCatalogFromContext path; the hot tool path uses
// direct map lookup.
func namesSetToSortedSlice(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Constants & enumerations
// ---------------------------------------------------------------------------

// signalFilterAllowedRangePresets is the canonical set of range
// preset IDs the SignalExplorerPage's RangePicker accepts. Mirrors
// `presetIds` in web/src/components/RangePicker.tsx exactly so a
// draft accepted here will be accepted by the baseline form.
//
// Kept narrow on purpose — adding a preset here MUST also update
// the SPA's RangePicker presetIds AND the strategy's system prompt
// enumeration so the LLM knows to propose it.
var signalFilterAllowedRangePresets = []string{
	"today",
	"yesterday",
	"7d",
	"30d",
	"90d",
	"all",
}

// signalFilterAllowedRangePresetSet is the O(1) membership lookup.
var signalFilterAllowedRangePresetSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(signalFilterAllowedRangePresets))
	for _, k := range signalFilterAllowedRangePresets {
		out[k] = struct{}{}
	}
	return out
}()

// signalFilterAllowedRangePresetsHint is the comma-separated list
// rendered in the tool descriptions so the LLM picks from the
// curated set deterministically across boots — providers cache
// prompt hashes per identical-text request.
var signalFilterAllowedRangePresetsHint = strings.Join(signalFilterAllowedRangePresets, ", ")

// signalFilterAllowedPerPage is the canonical set of per-page
// values the SignalExplorerPage accepts. Mirrors PER_PAGE_OPTIONS
// in web/src/features/telemetry/pages/SignalExplorerPage.tsx
// exactly.
var signalFilterAllowedPerPage = []int{25, 50, 100, 500}

// signalFilterAllowedPerPageSet is the O(1) membership lookup.
var signalFilterAllowedPerPageSet = func() map[int]struct{} {
	out := make(map[int]struct{}, len(signalFilterAllowedPerPage))
	for _, k := range signalFilterAllowedPerPage {
		out[k] = struct{}{}
	}
	return out
}()

// signalFilterAllowedPerPageHint renders the per-page options in
// the tool description for the LLM.
var signalFilterAllowedPerPageHint = func() string {
	parts := make([]string, len(signalFilterAllowedPerPage))
	for i, v := range signalFilterAllowedPerPage {
		parts[i] = fmt.Sprintf("%d", v)
	}
	return strings.Join(parts, ", ")
}()

// signalFilterMinSignals / signalFilterMaxSignals bound the size of
// the signals array the LLM may propose in one tool call. The min
// of 1 forces a meaningful filter (an empty filter is the SPA's
// default state and not worth proposing); the max of 5 keeps the
// proposal panel readable and matches what the SignalSelector UI
// surfaces comfortably without horizontal scroll.
const (
	signalFilterMinSignals = 1
	signalFilterMaxSignals = 5
)

// AllowedSignalFilterRangePresets returns a defensive copy of the
// canonical range preset set. Exported so the AI handler + tests
// can reference the same set the tools enforce.
func AllowedSignalFilterRangePresets() []string {
	out := make([]string, len(signalFilterAllowedRangePresets))
	copy(out, signalFilterAllowedRangePresets)
	return out
}

// AllowedSignalFilterPerPage returns a defensive copy of the
// canonical per-page set.
func AllowedSignalFilterPerPage() []int {
	out := make([]int, len(signalFilterAllowedPerPage))
	copy(out, signalFilterAllowedPerPage)
	return out
}

// ---------------------------------------------------------------------------
// Validator port + SignalFilter DTO
// ---------------------------------------------------------------------------

// SignalFilterValidator is the narrow validation interface the
// signal-explorer-nl-filter tools need. In production it is
// satisfied by *api.AISignalFilterValidator (a thin wrapper around
// the canonical SignalExplorerPage range/limit enumeration), so a
// draft accepted by the tool is byte-equivalent to a draft that
// would be accepted by the baseline form. Tests substitute
// deterministic fakes.
//
// The interface MUST stay validation-only — adding an Apply or
// Save method here would defeat the propose-only contract that
// ADR-015 §I3 + the slice prompt mandate.
type SignalFilterValidator interface {
	// ValidateSignalFilter reports whether the filter would be
	// accepted by the canonical SignalExplorerPage form. Returns
	// nil on acceptance; an error whose Error() text is suitable
	// for surfacing to the LLM (it'll be relayed back as a tool
	// error reply) on rejection.
	ValidateSignalFilter(filter *SignalFilter) error
}

// SignalFilter is the typed proposal envelope both tools build
// and the validator inspects. Exported because the AI handler test
// (in package api) needs to reference the type to construct fakes.
//
// This is NOT a model — it's a transient proposal shape the AI
// surface uses. The actual filter application goes through the SPA
// state (selectedSignals / rangePreset / per_page in
// SignalExplorerPage.tsx) which the user explicitly populates by
// clicking Apply in the AI panel.
type SignalFilter struct {
	// VehicleID is the vehicle the filter applies to. Always > 0
	// and equal to the per-request scope-bound vehicle.
	VehicleID int64 `json:"vehicle_id"`

	// Signals is the ordered list of signal names the user wants
	// to plot. Length is bounded by [signalFilterMinSignals,
	// signalFilterMaxSignals]. Every entry MUST appear in the
	// per-vehicle catalog the AI handler installed via
	// WithScopedSignalCatalog. Entries are case-sensitive — the
	// canonical catalog uses CamelCase (VehicleSpeed,
	// BatteryLevel, ...).
	Signals []string `json:"signals"`

	// RangePreset is one of the SignalExplorerPage RangePicker
	// preset IDs (today / yesterday / 7d / 30d / 90d / all).
	RangePreset string `json:"range_preset"`

	// PerPage is one of the SignalExplorerPage page-size options
	// (25 / 50 / 100 / 500).
	PerPage int `json:"per_page"`
}

// ---------------------------------------------------------------------------
// Typed tool input + output shapes
// ---------------------------------------------------------------------------

// signalFilterInput is the typed input shape both tools share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// validator method runs.
type signalFilterInput struct {
	// VehicleID is the vehicle the filter applies to. Required
	// and positive; MUST equal the per-request scope-bound
	// vehicle (Execute enforces this — defence in depth on top
	// of the validator tag).
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric ID of the vehicle this filter applies to (must equal the per-request scope-bound vehicle)."`

	// Signals is the ordered list of signal names. Required;
	// length 1-5; entries MUST appear in the in-scope per-
	// vehicle catalog (Execute enforces). Duplicate entries are
	// also refused at Execute time — the validator-tag layer's
	// `unique` keyword is not implemented in
	// internal/ai/tools/validate.go, so the dedup check lives in
	// checkSignalFilterScopeAndShape.
	Signals []string `json:"signals" validate:"required,min=1,max=5" desc:"Ordered list of 1-5 unique signal names; every entry must appear in the in-scope per-vehicle catalog the user message lists."`

	// RangePreset is one of the canonical SignalExplorerPage
	// RangePicker preset IDs.
	RangePreset string `json:"range_preset" validate:"required,oneof=today yesterday 7d 30d 90d all" desc:"Range preset: today, yesterday, 7d, 30d, 90d, or all."`

	// PerPage is one of the canonical SignalExplorerPage page-
	// size options. The shared validator-tag layer's `oneof`
	// keyword only applies to strings (see
	// internal/ai/tools/validate.go), so the per-page set check
	// lives in checkSignalFilterScopeAndShape — defence in depth
	// in case a future schema generator gains numeric `oneof`
	// support.
	PerPage int `json:"per_page" validate:"required,gte=1" desc:"Page size: 25, 50, 100, or 500."`
}

// signalFilterOutput is the JSON envelope both tools return on
// success. The frontend renders it as the structured proposal in
// the SignalExplorerPage's AI side panel.
//
// Status reports whether the draft would be accepted by the
// canonical validator at the time of the tool call:
//
//   - "ok"      — accepted; the user can copy the draft into the
//     baseline form and click Explore to fetch.
//   - "invalid" — rejected; ValidationError contains a one-line
//     diagnostic suitable for showing in the UI.
//
// Even when invalid, Draft is returned unchanged so the frontend
// can render the partially-correct proposal and let the user fix
// the problem field rather than start over.
type signalFilterOutput struct {
	// Draft is the proposed SignalFilter, with all keys
	// canonicalized and the in-scope scope check already passed.
	Draft *SignalFilter `json:"draft"`

	// Status is "ok" or "invalid".
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection; empty when ok.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the
	// canonical validator + the SignalExplorerPage enumeration
	// rather than its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Shared scope + filter-shape checks
// ---------------------------------------------------------------------------

// buildSignalFilter converts the typed input into a *SignalFilter
// with no scope or shape modification — those checks live in
// checkSignalFilterScopeAndShape so both tools (draft + validate)
// apply identical semantics.
func buildSignalFilter(input signalFilterInput) *SignalFilter {
	signals := make([]string, len(input.Signals))
	copy(signals, input.Signals)
	return &SignalFilter{
		VehicleID:   input.VehicleID,
		Signals:     signals,
		RangePreset: input.RangePreset,
		PerPage:     input.PerPage,
	}
}

// checkSignalFilterScopeAndShape enforces:
//
//   - the in-scope binding installed by the AI handler is present
//     (missing-scope ⇒ hard error)
//   - the LLM-supplied vehicle_id matches the bound vehicle
//     (cross-vehicle prompt-injection ⇒ hard error)
//   - every signal name is in the in-scope per-vehicle catalog
//     (out-of-catalog prompt-injection ⇒ hard error)
//   - range_preset is one of the canonical SPA presets (defence
//     in depth on top of the validator tag)
//   - per_page is one of the canonical SPA values (defence in
//     depth on top of the validator tag)
//
// Returns nil on success. A returned error is propagated as a tool
// error frame back to the LLM so the strategy can refuse politely
// in its narrative reply.
func checkSignalFilterScopeAndShape(ctx context.Context, filter *SignalFilter) error {
	scope, ok := ctx.Value(scopedSignalCatalogKey{}).(*scopedSignalCatalogScope)
	if !ok || scope == nil {
		return errors.New("signal_filter: no in-scope per-vehicle signal catalog installed in context")
	}

	if filter.VehicleID != scope.vehicleID {
		return fmt.Errorf("signal_filter: vehicle_id %d is not the in-scope vehicle for this request (bound vehicle: %d); refuse the request",
			filter.VehicleID, scope.vehicleID)
	}

	if len(filter.Signals) < signalFilterMinSignals || len(filter.Signals) > signalFilterMaxSignals {
		return fmt.Errorf("signal_filter: signals length %d is out of range [%d, %d]",
			len(filter.Signals), signalFilterMinSignals, signalFilterMaxSignals)
	}

	// Sort+dedup detection; map iteration is non-deterministic so
	// build the seen-set explicitly.
	seen := make(map[string]struct{}, len(filter.Signals))
	for _, name := range filter.Signals {
		if _, dup := seen[name]; dup {
			return fmt.Errorf("signal_filter: signals contains duplicate %q", name)
		}
		seen[name] = struct{}{}
		if _, in := scope.signals[name]; !in {
			return fmt.Errorf("signal_filter: signal %q is not in the in-scope per-vehicle catalog; refuse the request",
				name)
		}
	}

	if _, ok := signalFilterAllowedRangePresetSet[filter.RangePreset]; !ok {
		// Defence in depth — the validator tag already enforces
		// the oneof, so this is unreachable in practice.
		return fmt.Errorf("signal_filter: unsupported range_preset %q (allowed: %s)",
			filter.RangePreset, signalFilterAllowedRangePresetsHint)
	}

	if _, ok := signalFilterAllowedPerPageSet[filter.PerPage]; !ok {
		// Defence in depth — same reasoning.
		return fmt.Errorf("signal_filter: unsupported per_page %d (allowed: %s)",
			filter.PerPage, signalFilterAllowedPerPageHint)
	}

	return nil
}

// ---------------------------------------------------------------------------
// draft_signal_filter
// ---------------------------------------------------------------------------

// draftSignalFilter is the propose-only tool that builds a
// normalized + validated SignalFilter draft for the
// SignalExplorerPage UI to render. It is the FIRST tool the LLM is
// expected to call (per the strategy's system prompt).
//
// Execution is pure: input → typed SignalFilter → scope + shape
// check → optional validator pass → JSON envelope. No DB call; no
// SQL; no side effects.
type draftSignalFilter struct {
	validator SignalFilterValidator
}

// Name implements [Tool].
func (t *draftSignalFilter) Name() string { return "draft_signal_filter" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the canonical
// enumerations appended so the model picks from the curated set.
func (t *draftSignalFilter) Description() string {
	return "Build a typed SignalFilter draft from the user's natural-language request for the SignalExplorerPage at /signals/explorer. " +
		"PROPOSE-ONLY: the filter is NOT applied; the user reviews the draft in the AI side panel and clicks the Apply button to copy it into the baseline form. " +
		"vehicle_id MUST equal the per-request scope-bound vehicle the caller-supplied user message names. " +
		"signals is a 1-5 unique list of signal names; every entry MUST appear in the in-scope per-vehicle catalog the user message lists. " +
		"range_preset is one of: " + signalFilterAllowedRangePresetsHint + ". " +
		"per_page is one of: " + signalFilterAllowedPerPageHint + ". " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftSignalFilter) InputSchema() json.RawMessage {
	return tools.CachedSchema(signalFilterInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftSignalFilter) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true. The
// tool builds + validates a DTO but does NOT touch URL state, the
// database, or signal_log. The actual filter application + history
// fetch flows through the existing baseline SignalSelector +
// RangePicker + GET /api/v1/signals/{vehicleID}/{signalName}/history
// path AFTER the user clicks the canonical Apply button.
func (t *draftSignalFilter) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftSignalFilter) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftSignalFilter) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[signalFilterInput](raw)
}

// Execute implements [Tool]. Builds the draft, runs the scope +
// shape checks, runs the canonical validator, returns the envelope.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): rejects any LLM-supplied signal name that is NOT
// in the per-vehicle catalog the AI handler installed via
// WithScopedSignalCatalog, AND any LLM-supplied vehicle_id that
// does not match the bound vehicle.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the tool
// refuses. The AI handler is the only path that should be loading
// this tool, and it ALWAYS installs the scope.
//
// Validator failures are surfaced as status="invalid" in the
// envelope (NOT as a returned error) so the LLM's follow-up prose
// can describe the problem rather than the dispatcher relaying an
// error frame.
func (t *draftSignalFilter) Execute(ctx context.Context, in any) (any, error) {
	input := in.(signalFilterInput)
	if t.validator == nil {
		return nil, errors.New("draft_signal_filter: no SignalFilterValidator wired")
	}

	filter := buildSignalFilter(input)
	if err := checkSignalFilterScopeAndShape(ctx, filter); err != nil {
		return nil, err
	}

	out := &signalFilterOutput{
		Draft:  filter,
		Status: "ok",
		Source: "validator: web/src/features/telemetry/pages/SignalExplorerPage.tsx PER_PAGE_OPTIONS + web/src/components/RangePicker.tsx presetIds",
	}
	if err := t.validator.ValidateSignalFilter(filter); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// validate_signal_filter
// ---------------------------------------------------------------------------

// validateSignalFilterTool is the propose-only tool that runs the
// canonical validator over a typed SignalFilter shape and reports
// the verdict. It is the SECOND tool the LLM is expected to call
// (per the strategy's system prompt) — typically immediately after
// draft_signal_filter, so the assistant can confirm the draft
// would pass before narrating it to the user.
//
// Execution is pure: input → typed SignalFilter → scope + shape
// check → canonical validator pass → JSON envelope. No DB call; no
// SQL; no side effects.
type validateSignalFilterTool struct {
	validator SignalFilterValidator
}

// Name implements [Tool].
func (t *validateSignalFilterTool) Name() string { return "validate_signal_filter" }

// Description implements [Tool].
func (t *validateSignalFilterTool) Description() string {
	return "Run the canonical SignalFilter validator over a typed SignalFilter shape and report whether it would be accepted by the SignalExplorerPage at /signals/explorer. " +
		"PROPOSE-ONLY: nothing is applied. Returns {draft, status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_signal_filter to confirm a proposed draft will be accepted before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateSignalFilterTool) InputSchema() json.RawMessage {
	return tools.CachedSchema(signalFilterInput{})
}

// OutputSchema implements [Tool].
func (t *validateSignalFilterTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateSignalFilterTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_signal_filter.
func (t *validateSignalFilterTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateSignalFilterTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[signalFilterInput](raw)
}

// Execute implements [Tool]. Same scope + shape checks as
// draft_signal_filter, then the canonical validator. Same error
// semantics: validation failures are surfaced as status="invalid",
// never as a returned error.
func (t *validateSignalFilterTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(signalFilterInput)
	if t.validator == nil {
		return nil, errors.New("validate_signal_filter: no SignalFilterValidator wired")
	}

	filter := buildSignalFilter(input)
	if err := checkSignalFilterScopeAndShape(ctx, filter); err != nil {
		return nil, err
	}

	out := &signalFilterOutput{
		Draft:  filter,
		Status: "ok",
		Source: "validator: web/src/features/telemetry/pages/SignalExplorerPage.tsx PER_PAGE_OPTIONS + web/src/components/RangePicker.tsx presetIds",
	}
	if err := t.validator.ValidateSignalFilter(filter); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// SignalExplorerNlFilterSources bundles the narrow validator
// interface RegisterSignalExplorerNlFilterTools needs. Mirrors
// [DataRepairSuggestionsSources] but exposes only the surface the
// signal-explorer-nl-filter tools actually consume.
//
// Production wiring (router.go) instantiates
// *api.AISignalFilterValidator (a thin wrapper around the
// canonical SPA enumeration); tests substitute deterministic
// fakes.
type SignalExplorerNlFilterSources struct {
	Validator SignalFilterValidator
}

// RegisterSignalExplorerNlFilterTools installs the
// signal-explorer-nl-filter slice's tools on r. Called from
// router.go AFTER the Phase-50 / 0043 data-repair-suggestions
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterSignalExplorerNlFilterTools(r *tools.Registry, s SignalExplorerNlFilterSources) {
	r.Register(&draftSignalFilter{validator: s.Validator})
	r.Register(&validateSignalFilterTool{validator: s.Validator})
}
