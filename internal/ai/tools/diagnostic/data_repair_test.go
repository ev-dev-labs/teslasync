// Tool tests for draft_data_repair_plan + validate_data_repair_plan.
// Both tools are pure functions over input + scope context +
// DataRepairPlanValidator interface; the tests stub the validator
// with a deterministic fake so the tests stay hermetic (no api
// package import, no DB).

package diagnostic

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// stubDataRepairValidator records every call + can be wired to fail
// for the rejection-path tests.
type stubDataRepairValidator struct {
	failWith error
	calls    []*DataRepairPlan
}

func (s *stubDataRepairValidator) ValidateDataRepairPlan(p *DataRepairPlan) error {
	s.calls = append(s.calls, p)
	return s.failWith
}

// scopedCtx is a one-line builder so tests don't repeat the context
// install boilerplate.
func scopedCtx(charging, drives []int64) context.Context {
	return WithScopedDataRepairIDs(context.Background(), charging, drives)
}

// --- draft_data_repair_plan happy paths ----------------------------

// TestDraftDataRepairPlan_CloseCharging_OK proves a valid LLM
// payload yields status="ok" with the plan exactly mirrored back.
func TestDraftDataRepairPlan_CloseCharging_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDataRepairValidator{}
	tool := &draftDataRepairPlan{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "close"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*dataRepairPlanOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *dataRepairPlanOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.Draft == nil {
		t.Fatal("Draft is nil")
	}
	if env.Draft.TargetKind != "charging" {
		t.Errorf("Draft.TargetKind = %q, want %q", env.Draft.TargetKind, "charging")
	}
	if env.Draft.TargetID != 42 {
		t.Errorf("Draft.TargetID = %d, want 42", env.Draft.TargetID)
	}
	if env.Draft.Action != "close" {
		t.Errorf("Draft.Action = %q, want %q", env.Draft.Action, "close")
	}
	if len(env.Draft.UpdateFields) != 0 {
		t.Errorf("Draft.UpdateFields len = %d, want 0 for action=close", len(env.Draft.UpdateFields))
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestDraftDataRepairPlan_QuarantineDrive_OK proves the quarantine path
// for drives works end-to-end through the scope check.
func TestDraftDataRepairPlan_QuarantineDrive_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDataRepairValidator{}
	tool := &draftDataRepairPlan{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 99,
		"action": "quarantine"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}

	out, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*dataRepairPlanOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.Draft.Action != "quarantine" {
		t.Errorf("Draft.Action = %q, want %q", env.Draft.Action, "quarantine")
	}
}

// TestDraftDataRepairPlan_UpdateCharging_OK proves an update plan
// with allowed keys passes through.
func TestDraftDataRepairPlan_UpdateCharging_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDataRepairValidator{}
	tool := &draftDataRepairPlan{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "update",
		"update_fields": {
			"ended_at": "2026-03-30T04:00:00Z",
			"end_soc_pct": 87
		}
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}

	out, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*dataRepairPlanOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if got := len(env.Draft.UpdateFields); got != 2 {
		t.Errorf("UpdateFields len = %d, want 2", got)
	}
}

// --- scope binding -------------------------------------------------

// TestDraftDataRepairPlan_NoScope_Refuses proves the missing-scope
// path is a HARD error (not a status="invalid"). The dispatcher
// must surface this as a tool error frame so the LLM bails out
// rather than narrating a fabricated proposal.
func TestDraftDataRepairPlan_NoScope_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, err := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "close"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}

	// NO scope installed.
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want missing-scope refusal")
	}
	if !strings.Contains(err.Error(), "no in-scope") {
		t.Errorf("err = %v, want substring 'no in-scope'", err)
	}
}

// TestDraftDataRepairPlan_OutOfScopeCharging_Refuses pins the
// prompt-injection guard: a target_id NOT in the in-scope inventory
// is refused with a hard error mentioning the row.
func TestDraftDataRepairPlan_OutOfScopeCharging_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 777,
		"action": "quarantine"
	}`))

	// Scope contains charging 42 only.
	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want out-of-scope refusal")
	}
	if !strings.Contains(err.Error(), "777") {
		t.Errorf("err = %v, want substring '777'", err)
	}
	if !strings.Contains(err.Error(), "in-scope") {
		t.Errorf("err = %v, want substring 'in-scope'", err)
	}
}

// TestDraftDataRepairPlan_OutOfScopeDrive_Refuses pins the same
// guard for drives.
func TestDraftDataRepairPlan_OutOfScopeDrive_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 555,
		"action": "close"
	}`))

	_, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want out-of-scope refusal")
	}
	if !strings.Contains(err.Error(), "555") {
		t.Errorf("err = %v, want substring '555'", err)
	}
}

// TestDraftDataRepairPlan_DriveIDInChargingScope_Refuses proves the
// per-kind scope is enforced — a drive ID 42 is NOT a hit just
// because charging 42 is in scope.
func TestDraftDataRepairPlan_DriveIDInChargingScope_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 42,
		"action": "close"
	}`))

	// charging-scope=42, drive-scope=empty.
	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want out-of-scope refusal")
	}
}

// --- shape checks --------------------------------------------------

// TestDraftDataRepairPlan_CloseWithUpdateFields_Refuses proves the
// shape check rejects close+update_fields combinations — the
// canonical close handler ignores the body, so extraneous keys
// would mislead the user.
func TestDraftDataRepairPlan_CloseWithUpdateFields_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "close",
		"update_fields": {"end_soc_pct": 100}
	}`))

	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want shape refusal")
	}
	if !strings.Contains(err.Error(), "must not include update_fields") {
		t.Errorf("err = %v, want shape diagnostic", err)
	}
}

// TestDraftDataRepairPlan_QuarantineWithUpdateFields_Refuses pins the
// same guard for the quarantine action.
func TestDraftDataRepairPlan_QuarantineWithUpdateFields_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 99,
		"action": "quarantine",
		"update_fields": {"distance_m": 100}
	}`))

	_, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want shape refusal")
	}
}

// TestDraftDataRepairPlan_UpdateEmptyFields_Refuses proves an
// update with NO fields is refused — there's nothing to update.
func TestDraftDataRepairPlan_UpdateEmptyFields_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 99,
		"action": "update"
	}`))

	_, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want empty-update refusal")
	}
	if !strings.Contains(err.Error(), "non-empty update_fields") {
		t.Errorf("err = %v, want non-empty diagnostic", err)
	}
}

// TestDraftDataRepairPlan_UpdateUnknownKey_Refuses proves the
// per-kind allowlist is enforced. An update_fields key that is
// NOT in the per-kind allowed set is refused — even if the LLM
// thinks it knows better, the canonical PartialUpdate path would
// silently filter the key out, so refusing here keeps the user
// from seeing a draft that secretly gets dropped on Save.
func TestDraftDataRepairPlan_UpdateUnknownKey_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "update",
		"update_fields": {"hacked_field": "yes"}
	}`))

	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want unknown-key refusal")
	}
	if !strings.Contains(err.Error(), "hacked_field") {
		t.Errorf("err = %v, want unknown-key diagnostic", err)
	}
}

// TestDraftDataRepairPlan_DriveKeyOnChargingTarget_Refuses pins the
// per-kind scope of the allowlist: a drive-only key like
// distance_m on a charging row is refused.
func TestDraftDataRepairPlan_DriveKeyOnChargingTarget_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "update",
		"update_fields": {"distance_m": 100}
	}`))

	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want per-kind allowlist refusal")
	}
	if !strings.Contains(err.Error(), "distance_m") {
		t.Errorf("err = %v, want key-name diagnostic", err)
	}
}

// TestDraftDataRepairPlan_UpdateTooManyFields_Refuses proves the
// max-keys cap fires before validator is called.
func TestDraftDataRepairPlan_UpdateTooManyFields_Refuses(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	// All keys are in the drive allowlist — but 17 of them.
	allKeys := AllowedDataRepairDriveUpdateKeys()
	if len(allKeys) <= dataRepairMaxUpdateFields {
		t.Skipf("drive allowlist size %d <= max %d; cannot exercise cap", len(allKeys), dataRepairMaxUpdateFields)
	}
	fields := map[string]any{}
	for i := 0; i < dataRepairMaxUpdateFields+1 && i < len(allKeys); i++ {
		fields[allKeys[i]] = 1
	}
	body := map[string]any{
		"target_kind":   "drive",
		"target_id":     99,
		"action":        "update",
		"update_fields": fields,
	}
	raw, _ := json.Marshal(body)

	in, _ := tool.Validate(raw)
	_, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err == nil {
		t.Fatal("Execute err = nil, want too-many-fields refusal")
	}
	if !strings.Contains(err.Error(), "max") {
		t.Errorf("err = %v, want max-keys diagnostic", err)
	}
}

// --- validator failure path ---------------------------------------

// TestDraftDataRepairPlan_ValidatorReject_StatusInvalid proves the
// PROPOSE-only contract: a validator rejection is surfaced as
// status="invalid" + the error in the envelope, NOT as a returned
// error. The LLM then narrates the problem to the user.
func TestDraftDataRepairPlan_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubDataRepairValidator{failWith: errors.New("ended_at must be after started_at")}
	tool := &draftDataRepairPlan{validator: stub}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "update",
		"update_fields": {"ended_at": "1999-01-01T00:00:00Z"}
	}`))

	out, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (rejection is in-envelope)", err)
	}
	env := out.(*dataRepairPlanOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want %q", env.Status, "invalid")
	}
	if env.ValidationError == "" {
		t.Error("ValidationError must be non-empty on rejection")
	}
	if env.Draft == nil {
		t.Error("Draft must still be returned on rejection so the UI can render it")
	}
}

// --- nil-validator ------------------------------------------------

// TestDraftDataRepairPlan_NilValidator_Errors pins the
// constructor-bug detection path: a tool instantiated WITHOUT a
// validator (test-only mistake) returns a hard error, never a
// silent nil-pointer panic.
func TestDraftDataRepairPlan_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 42,
		"action": "close"
	}`))

	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want nil-validator error")
	}
	if !strings.Contains(err.Error(), "no DataRepairPlanValidator wired") {
		t.Errorf("err = %v, want nil-validator diagnostic", err)
	}
}

// --- validate_data_repair_plan ------------------------------------

// TestValidateDataRepairPlan_HappyPath_OK proves the validate-only
// tool produces the same envelope shape as the draft tool.
func TestValidateDataRepairPlan_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubDataRepairValidator{}
	tool := &validateDataRepairPlanTool{validator: stub}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "drive",
		"target_id": 99,
		"action": "close"
	}`))

	out, err := tool.Execute(scopedCtx(nil, []int64{99}), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*dataRepairPlanOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q (validation_error=%q)", env.Status, "ok", env.ValidationError)
	}
	if env.Draft == nil || env.Draft.TargetID != 99 {
		t.Errorf("Draft = %+v, want TargetID=99", env.Draft)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

// TestValidateDataRepairPlan_OutOfScope_Refuses proves the
// validate-only tool ALSO enforces the scope binding. Otherwise
// the LLM could call validate first to probe whether a
// cross-vehicle row exists.
func TestValidateDataRepairPlan_OutOfScope_Refuses(t *testing.T) {
	t.Parallel()
	tool := &validateDataRepairPlanTool{validator: &stubDataRepairValidator{}}

	in, _ := tool.Validate(json.RawMessage(`{
		"target_kind": "charging",
		"target_id": 777,
		"action": "quarantine"
	}`))

	_, err := tool.Execute(scopedCtx([]int64{42}, nil), in)
	if err == nil {
		t.Fatal("Execute err = nil, want scope refusal")
	}
}

// --- input validation ---------------------------------------------

// TestDraftDataRepairPlan_BadInput_RejectedAtValidate proves the
// validator tag oneof= is enforced — a malformed action is rejected
// at Validate, not at Execute.
func TestDraftDataRepairPlan_BadInput_RejectedAtValidate(t *testing.T) {
	t.Parallel()
	tool := &draftDataRepairPlan{validator: &stubDataRepairValidator{}}

	cases := []struct {
		name string
		body string
	}{
		{"unknown_kind", `{"target_kind":"vehicle","target_id":1,"action":"close"}`},
		{"unknown_action", `{"target_kind":"charging","target_id":1,"action":"haxxor"}`},
		{"zero_id", `{"target_kind":"charging","target_id":0,"action":"close"}`},
		{"missing_kind", `{"target_id":1,"action":"close"}`},
		{"missing_action", `{"target_kind":"charging","target_id":1}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := tool.Validate(json.RawMessage(tc.body)); err == nil {
				t.Errorf("Validate(%s) err = nil, want validator rejection", tc.body)
			}
		})
	}
}

// --- Tool interface metadata --------------------------------------

// TestDataRepairTools_Mutates_AlwaysFalse pins the propose-only
// contract at the Tool interface level.
func TestDataRepairTools_Mutates_AlwaysFalse(t *testing.T) {
	t.Parallel()
	d := &draftDataRepairPlan{}
	v := &validateDataRepairPlanTool{}
	if d.Mutates() {
		t.Error("draft_data_repair_plan.Mutates() = true, want false (propose-only)")
	}
	if v.Mutates() {
		t.Error("validate_data_repair_plan.Mutates() = true, want false (propose-only)")
	}
}

// TestDataRepairTools_Names pins the tool names so a future rename
// fails here before silently breaking the strategy's allowlist.
func TestDataRepairTools_Names(t *testing.T) {
	t.Parallel()
	d := &draftDataRepairPlan{}
	v := &validateDataRepairPlanTool{}
	if d.Name() != "draft_data_repair_plan" {
		t.Errorf("draft tool Name() = %q, want %q", d.Name(), "draft_data_repair_plan")
	}
	if v.Name() != "validate_data_repair_plan" {
		t.Errorf("validate tool Name() = %q, want %q", v.Name(), "validate_data_repair_plan")
	}
}

// TestDataRepairTools_Descriptions_MentionAllowlist proves the LLM-
// visible Description includes the per-kind allowlist hints (so the
// model picks from the curated set without hallucinating column
// names).
func TestDataRepairTools_Descriptions_MentionAllowlist(t *testing.T) {
	t.Parallel()
	d := &draftDataRepairPlan{}
	desc := d.Description()
	for _, key := range []string{"ended_at", "distance_m", "duration_s"} {
		if !strings.Contains(desc, key) {
			t.Errorf("Description missing key %q for LLM grounding", key)
		}
	}
	for _, must := range []string{"PROPOSE-ONLY", "in-scope"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description missing required substring %q", must)
		}
	}
}

// --- Scope helpers --------------------------------------------------

// TestScopedDataRepairIDs_RoundTrip pins the public helpers'
// contract: install via WithScopedDataRepairIDs, read back via
// ScopedDataRepairIDsFromContext.
func TestScopedDataRepairIDs_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithScopedDataRepairIDs(context.Background(), []int64{42, 7}, []int64{99})
	c, d, ok := ScopedDataRepairIDsFromContext(ctx)
	if !ok {
		t.Fatal("ScopedDataRepairIDsFromContext ok=false, want true")
	}
	// sorted output
	if len(c) != 2 || c[0] != 7 || c[1] != 42 {
		t.Errorf("charging IDs = %v, want [7 42]", c)
	}
	if len(d) != 1 || d[0] != 99 {
		t.Errorf("drive IDs = %v, want [99]", d)
	}

	// Defensive copy: mutating the returned slice does not
	// affect the next read.
	c[0] = 0
	c2, _, _ := ScopedDataRepairIDsFromContext(ctx)
	if c2[0] == 0 {
		t.Error("returned slice is not a defensive copy — mutation leaked back")
	}
}

// TestScopedDataRepairIDs_Empty proves an empty install is
// distinguished from a missing install: ok=true, slices length 0.
func TestScopedDataRepairIDs_Empty(t *testing.T) {
	t.Parallel()
	ctx := WithScopedDataRepairIDs(context.Background(), nil, nil)
	c, d, ok := ScopedDataRepairIDsFromContext(ctx)
	if !ok {
		t.Error("ScopedDataRepairIDsFromContext ok=false, want true on empty install")
	}
	if len(c) != 0 || len(d) != 0 {
		t.Errorf("got (%v, %v), want both empty", c, d)
	}
}

// TestScopedDataRepairIDs_Missing proves no install yields ok=false.
func TestScopedDataRepairIDs_Missing(t *testing.T) {
	t.Parallel()
	c, d, ok := ScopedDataRepairIDsFromContext(context.Background())
	if ok {
		t.Errorf("ok=true on missing install (got c=%v d=%v)", c, d)
	}
}

// TestRegisterDataRepairSuggestionsTools_RegistersBoth proves the
// registration helper installs both tools on the registry.
func TestRegisterDataRepairSuggestionsTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterDataRepairSuggestionsTools(r, DataRepairSuggestionsSources{
		Validator: &stubDataRepairValidator{},
	})
	if _, ok := r.Get("draft_data_repair_plan"); !ok {
		t.Error("registry missing draft_data_repair_plan")
	}
	if _, ok := r.Get("validate_data_repair_plan"); !ok {
		t.Error("registry missing validate_data_repair_plan")
	}
}

// TestAllowedDataRepairChargingUpdateKeys_DefensiveCopy proves the
// public accessor returns a copy.
func TestAllowedDataRepairChargingUpdateKeys_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedDataRepairChargingUpdateKeys()
	if len(first) == 0 {
		t.Fatal("allowlist is empty")
	}
	first[0] = "MUTATED"
	second := AllowedDataRepairChargingUpdateKeys()
	if second[0] == "MUTATED" {
		t.Errorf("AllowedDataRepairChargingUpdateKeys leaked mutation: second[0] = %q", second[0])
	}
}

// TestAllowedDataRepairDriveUpdateKeys_DefensiveCopy proves the
// public accessor returns a copy.
func TestAllowedDataRepairDriveUpdateKeys_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedDataRepairDriveUpdateKeys()
	if len(first) == 0 {
		t.Fatal("allowlist is empty")
	}
	first[0] = "MUTATED"
	second := AllowedDataRepairDriveUpdateKeys()
	if second[0] == "MUTATED" {
		t.Errorf("AllowedDataRepairDriveUpdateKeys leaked mutation: second[0] = %q", second[0])
	}
}
