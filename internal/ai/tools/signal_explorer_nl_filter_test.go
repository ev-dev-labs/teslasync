// Phase-50 / 0044 — S3 Signal explorer NL filter.
//
// Tool tests for draft_signal_filter + validate_signal_filter.
// Both tools are pure functions over input + scope context +
// SignalFilterValidator interface; the tests stub the validator
// with a deterministic fake so the tests stay hermetic (no api
// package import, no DB).

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// stubSignalFilterValidator records every call + can be wired to
// fail for the rejection-path tests.
type stubSignalFilterValidator struct {
	failWith error
	calls    []*SignalFilter
}

func (s *stubSignalFilterValidator) ValidateSignalFilter(f *SignalFilter) error {
	s.calls = append(s.calls, f)
	return s.failWith
}

// scopedSignalCtx is a one-line builder so tests don't repeat the
// context install boilerplate.
func scopedSignalCtx(vehicleID int64, signals []string) context.Context {
	return WithScopedSignalCatalog(context.Background(), vehicleID, signals)
}

// --- draft_signal_filter happy paths -------------------------------

// TestDraftSignalFilter_HappyPath_OK proves a valid LLM payload
// yields status="ok" with the filter exactly mirrored back.
func TestDraftSignalFilter_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["VehicleSpeed"],
		"range_preset": "today",
		"per_page": 25
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed", "BatteryLevel"}), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*signalFilterOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *signalFilterOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil")
	}
	if env.Draft.VehicleID != 7 {
		t.Errorf("Draft.VehicleID = %d, want 7", env.Draft.VehicleID)
	}
	if len(env.Draft.Signals) != 1 || env.Draft.Signals[0] != "VehicleSpeed" {
		t.Errorf("Draft.Signals = %v, want [VehicleSpeed]", env.Draft.Signals)
	}
	if env.Draft.RangePreset != "today" {
		t.Errorf("Draft.RangePreset = %q, want today", env.Draft.RangePreset)
	}
	if env.Draft.PerPage != 25 {
		t.Errorf("Draft.PerPage = %d, want 25", env.Draft.PerPage)
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestDraftSignalFilter_MultipleSignals_OK proves multi-signal
// proposals pass scope check when every signal is in the catalog.
func TestDraftSignalFilter_MultipleSignals_OK(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["VehicleSpeed", "BatteryLevel", "OutsideTemp"],
		"range_preset": "7d",
		"per_page": 100
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed", "BatteryLevel", "OutsideTemp"}), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*signalFilterOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if len(env.Draft.Signals) != 3 {
		t.Errorf("Signals len = %d, want 3", len(env.Draft.Signals))
	}
}

// --- scope-binding refusals ----------------------------------------

// TestDraftSignalFilter_NoScope_Refuses proves the missing-scope
// case is a hard error, not a silent permit.
func TestDraftSignalFilter_NoScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["VehicleSpeed"],
		"range_preset": "today",
		"per_page": 25
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	// NO scoped ctx — the AI handler always installs one; the
	// dispatcher invoked from any other path must be refused.
	_, execErr := tool.Execute(context.Background(), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (no scope)")
	}
	if !strings.Contains(execErr.Error(), "no in-scope") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "no in-scope")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0 (scope check should refuse before validator)", len(stub.calls))
	}
}

// TestDraftSignalFilter_OutOfScopeVehicle_Refuses proves a payload
// with vehicle_id != bound vehicle is refused (cross-vehicle
// prompt-injection defence).
func TestDraftSignalFilter_OutOfScopeVehicle_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 99,
		"signals": ["VehicleSpeed"],
		"range_preset": "today",
		"per_page": 25
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	// Scope bound to vehicle 7 — payload asks for vehicle 99.
	_, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (cross-vehicle)")
	}
	if !strings.Contains(execErr.Error(), "vehicle_id 99") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "vehicle_id 99")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

// TestDraftSignalFilter_OutOfCatalogSignal_Refuses proves a payload
// with a signal name NOT in the per-vehicle catalog is refused
// (out-of-catalog prompt-injection defence).
func TestDraftSignalFilter_OutOfCatalogSignal_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["VehicleSpeed", "RegenEfficiency"],
		"range_preset": "today",
		"per_page": 25
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	// Catalog has VehicleSpeed but NOT RegenEfficiency.
	_, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed", "BatteryLevel"}), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (out-of-catalog)")
	}
	if !strings.Contains(execErr.Error(), "RegenEfficiency") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "RegenEfficiency")
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

// TestDraftSignalFilter_DuplicateSignal_Refuses proves duplicate
// signal names are refused even when both are in the catalog.
func TestDraftSignalFilter_DuplicateSignal_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	// Bypass the validator unique-tag for this test by sending a
	// raw struct directly to Execute (the validator-tag pin is
	// covered by TestDraftSignalFilter_BadInput_RejectedAtValidate).
	in := signalFilterInput{
		VehicleID:   7,
		Signals:     []string{"VehicleSpeed", "VehicleSpeed"},
		RangePreset: "today",
		PerPage:     25,
	}
	_, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (duplicate)")
	}
	if !strings.Contains(execErr.Error(), "duplicate") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "duplicate")
	}
}

// --- shape-check refusals ------------------------------------------

// TestDraftSignalFilter_BadRangePreset_Refuses proves an unsupported
// range preset is refused at scope-check time (defence in depth on
// top of the validator tag).
func TestDraftSignalFilter_BadRangePreset_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	// Bypass the validator oneof tag for this test.
	in := signalFilterInput{
		VehicleID:   7,
		Signals:     []string{"VehicleSpeed"},
		RangePreset: "forever",
		PerPage:     25,
	}
	_, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (bad range_preset)")
	}
	if !strings.Contains(execErr.Error(), "range_preset") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "range_preset")
	}
}

// TestDraftSignalFilter_BadPerPage_Refuses proves an unsupported
// per_page value is refused at scope-check time.
func TestDraftSignalFilter_BadPerPage_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &draftSignalFilter{validator: stub}

	in := signalFilterInput{
		VehicleID:   7,
		Signals:     []string{"VehicleSpeed"},
		RangePreset: "today",
		PerPage:     333,
	}
	_, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if execErr == nil {
		t.Fatal("Execute err = nil, want refusal (bad per_page)")
	}
	if !strings.Contains(execErr.Error(), "per_page") {
		t.Errorf("Execute err = %q, want substring %q", execErr.Error(), "per_page")
	}
}

// --- validator delegation ------------------------------------------

// TestDraftSignalFilter_ValidatorReject_StatusInvalid proves a
// validator rejection surfaces as status="invalid" in the envelope
// (NOT as a returned error) so the LLM can narrate the problem.
func TestDraftSignalFilter_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{failWith: errors.New("validator rejected: out of band reason")}
	tool := &draftSignalFilter{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["VehicleSpeed"],
		"range_preset": "today",
		"per_page": 25
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, execErr := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if execErr != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", execErr)
	}
	env := out.(*signalFilterOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "out of band reason") {
		t.Errorf("ValidationError = %q, want substring %q", env.ValidationError, "out of band reason")
	}
	// Draft must still be returned so the frontend can render the
	// partially-correct proposal.
	if env.Draft == nil {
		t.Error("Draft is nil — must be returned even on validator reject")
	}
}

// TestDraftSignalFilter_NilValidator_Errors proves the constructor's
// nil-guard dependency contract: a tool with no validator wired
// returns an exec error rather than panicking or silently
// producing a draft.
func TestDraftSignalFilter_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftSignalFilter{validator: nil}

	in := signalFilterInput{
		VehicleID:   7,
		Signals:     []string{"VehicleSpeed"},
		RangePreset: "today",
		PerPage:     25,
	}
	_, err := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

// --- validate_signal_filter happy path -----------------------------

// TestValidateSignalFilter_HappyPath_OK proves the validate tool
// produces the same envelope shape as the draft tool (both share
// the same scope check + validator delegation).
func TestValidateSignalFilter_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &validateSignalFilterTool{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"vehicle_id": 7,
		"signals": ["BatteryLevel"],
		"range_preset": "yesterday",
		"per_page": 50
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed", "BatteryLevel"}), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*signalFilterOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok", env.Status)
	}
	if env.Draft.RangePreset != "yesterday" {
		t.Errorf("Draft.RangePreset = %q, want yesterday", env.Draft.RangePreset)
	}
	if env.Draft.PerPage != 50 {
		t.Errorf("Draft.PerPage = %d, want 50", env.Draft.PerPage)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestValidateSignalFilter_OutOfScope_Refuses pins the symmetry: the
// validate tool refuses the same out-of-scope payloads the draft
// tool refuses.
func TestValidateSignalFilter_OutOfScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubSignalFilterValidator{}
	tool := &validateSignalFilterTool{validator: stub}

	in := signalFilterInput{
		VehicleID:   42,
		Signals:     []string{"VehicleSpeed"},
		RangePreset: "today",
		PerPage:     25,
	}
	_, err := tool.Execute(scopedSignalCtx(7, []string{"VehicleSpeed"}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want refusal (cross-vehicle)")
	}
}

// --- bad input rejected at Validate-stage --------------------------

// TestDraftSignalFilter_BadInput_RejectedAtValidate proves the
// per-field validator-tag enforcement happens BEFORE Execute is
// called, so a malformed input never reaches the scope check.
func TestDraftSignalFilter_BadInput_RejectedAtValidate(t *testing.T) {
	t.Parallel()
	tool := &draftSignalFilter{validator: &stubSignalFilterValidator{}}

	cases := []struct {
		name string
		body string
	}{
		{"missing vehicle_id", `{"signals":["VehicleSpeed"],"range_preset":"today","per_page":25}`},
		{"vehicle_id zero", `{"vehicle_id":0,"signals":["VehicleSpeed"],"range_preset":"today","per_page":25}`},
		{"signals empty", `{"vehicle_id":7,"signals":[],"range_preset":"today","per_page":25}`},
		{"signals too many", `{"vehicle_id":7,"signals":["A","B","C","D","E","F"],"range_preset":"today","per_page":25}`},
		{"bad range_preset", `{"vehicle_id":7,"signals":["VehicleSpeed"],"range_preset":"forever","per_page":25}`},
		// NOTE: per_page and signals-duplicate are NOT enforced by
		// the validator-tag layer (the shared validator's `oneof`
		// rule only applies to strings; `unique` is not implemented
		// — see internal/ai/tools/validate.go). They are enforced
		// by checkSignalFilterScopeAndShape at Execute time, so
		// the dedicated tests TestDraftSignalFilter_BadPerPage_Refuses
		// and TestDraftSignalFilter_DuplicateSignal_Refuses pin
		// those rejection paths.
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := tool.Validate(json.RawMessage(tc.body))
			if err == nil {
				t.Fatalf("Validate(%s) err = nil, want non-nil", tc.body)
			}
		})
	}
}

// --- tool metadata -------------------------------------------------

// TestSignalFilterTools_Mutates_AlwaysFalse pins the propose-only
// invariant: neither tool may report Mutates=true. A future edit
// that flips this pin is a violation of ADR-015 §I3.
func TestSignalFilterTools_Mutates_AlwaysFalse(t *testing.T) {
	t.Parallel()
	d := &draftSignalFilter{}
	v := &validateSignalFilterTool{}
	if d.Mutates() {
		t.Error("draft_signal_filter Mutates() = true, want false")
	}
	if v.Mutates() {
		t.Error("validate_signal_filter Mutates() = true, want false")
	}
}

// TestSignalFilterTools_Names pins the canonical tool names. The
// strategy's allowedTools whitelist references these strings.
func TestSignalFilterTools_Names(t *testing.T) {
	t.Parallel()
	d := &draftSignalFilter{}
	v := &validateSignalFilterTool{}
	if d.Name() != "draft_signal_filter" {
		t.Errorf("draft Name() = %q, want draft_signal_filter", d.Name())
	}
	if v.Name() != "validate_signal_filter" {
		t.Errorf("validate Name() = %q, want validate_signal_filter", v.Name())
	}
}

// TestSignalFilterTools_Descriptions_MentionEnumerations pins the
// LLM-visible enumerations: a future edit that drops the range-
// preset / per-page hints from the descriptions silently breaks
// model accuracy on first call.
func TestSignalFilterTools_Descriptions_MentionEnumerations(t *testing.T) {
	t.Parallel()
	d := &draftSignalFilter{}
	v := &validateSignalFilterTool{}

	for _, must := range []string{"today", "yesterday", "7d", "30d", "90d", "all", "25", "500"} {
		if !strings.Contains(d.Description(), must) {
			t.Errorf("draft Description() missing %q", must)
		}
	}
	if !strings.Contains(v.Description(), "validator") {
		t.Errorf("validate Description() missing %q", "validator")
	}
}

// --- scope round-trip helpers --------------------------------------

// TestScopedSignalCatalog_RoundTrip proves the WithScopedSignalCatalog
// + ScopedSignalCatalogFromContext pair installs and reads back the
// same shape.
func TestScopedSignalCatalog_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithScopedSignalCatalog(context.Background(), 7, []string{"VehicleSpeed", "BatteryLevel"})
	vehicleID, signals, ok := ScopedSignalCatalogFromContext(ctx)
	if !ok {
		t.Fatal("ScopedSignalCatalogFromContext ok = false, want true")
	}
	if vehicleID != 7 {
		t.Errorf("vehicleID = %d, want 7", vehicleID)
	}
	if len(signals) != 2 {
		t.Fatalf("signals len = %d, want 2", len(signals))
	}
	// Sorted ascending — defensive copy contract.
	if signals[0] != "BatteryLevel" || signals[1] != "VehicleSpeed" {
		t.Errorf("signals = %v, want [BatteryLevel VehicleSpeed]", signals)
	}
}

// TestScopedSignalCatalog_Empty proves an empty catalog (zero
// signals) is still installable and readable; the tool will refuse
// every signal name in this state, but the scope itself is legal.
func TestScopedSignalCatalog_Empty(t *testing.T) {
	t.Parallel()
	ctx := WithScopedSignalCatalog(context.Background(), 7, nil)
	vehicleID, signals, ok := ScopedSignalCatalogFromContext(ctx)
	if !ok {
		t.Fatal("ok = false, want true (empty scope is still a scope)")
	}
	if vehicleID != 7 {
		t.Errorf("vehicleID = %d, want 7", vehicleID)
	}
	if len(signals) != 0 {
		t.Errorf("signals len = %d, want 0", len(signals))
	}
}

// TestScopedSignalCatalog_Missing proves an unscoped ctx returns
// false (NOT an empty value). Tools rely on this to refuse calls
// from unintended dispatcher paths.
func TestScopedSignalCatalog_Missing(t *testing.T) {
	t.Parallel()
	_, _, ok := ScopedSignalCatalogFromContext(context.Background())
	if ok {
		t.Fatal("ok = true on unscoped ctx, want false")
	}
}

// --- registration --------------------------------------------------

// TestRegisterSignalExplorerNlFilterTools_RegistersBoth proves the
// helper registers BOTH tools on the registry — a regression where
// only one is registered would silently break the strategy's tool
// sequence.
func TestRegisterSignalExplorerNlFilterTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	stub := &stubSignalFilterValidator{}
	RegisterSignalExplorerNlFilterTools(r, SignalExplorerNlFilterSources{Validator: stub})

	if _, ok := r.Get("draft_signal_filter"); !ok {
		t.Error("draft_signal_filter not registered")
	}
	if _, ok := r.Get("validate_signal_filter"); !ok {
		t.Error("validate_signal_filter not registered")
	}
}

// --- defensive copies ----------------------------------------------

// TestAllowedSignalFilterRangePresets_DefensiveCopy proves the
// exported allowlist accessor returns a copy — a caller that
// mutates the slice cannot corrupt the package-level enumeration.
func TestAllowedSignalFilterRangePresets_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedSignalFilterRangePresets()
	first[0] = "MUTATED"
	second := AllowedSignalFilterRangePresets()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedSignalFilterRangePresets() leaked mutation: second[0] = %q", second[0])
	}
}

// TestAllowedSignalFilterPerPage_DefensiveCopy is the per-page
// analogue.
func TestAllowedSignalFilterPerPage_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedSignalFilterPerPage()
	first[0] = 999
	second := AllowedSignalFilterPerPage()
	if second[0] == 999 {
		t.Fatalf("AllowedSignalFilterPerPage() leaked mutation: second[0] = %d", second[0])
	}
}
