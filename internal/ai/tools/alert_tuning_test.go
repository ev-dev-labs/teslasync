// Phase-50 / 0034 — A1 Alert tuning suggestions.
//
// Tool tests for draft_alert_rule_patch. The tool is a pure
// function over the input + AlertTuningSource port; the tests
// stub the port with a deterministic fake so the tests stay
// hermetic (no api package import, no DB, no notification_logs
// query). The other tool the strategy uses
// (`validate_alert_rule`) is exercised by alert_builder_test.go
// and reused here verbatim — we do not re-test its behaviour.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// stubAlertTuningSource is a deterministic fake implementing
// AlertTuningSource. Records every call so a test can assert
// the tool routes through the port (no parallel DB access) and
// surface the canned shape the test author wants.
type stubAlertTuningSource struct {
	rule          *alertmodel.AlertRule
	loadRuleErr   error
	loadRuleCalls []int64

	history             *AlertRuleFiringHistory
	loadHistoryErr      error
	loadHistoryRuleIDs  []int64
	loadHistoryProposed []*alertmodel.AlertRule
}

func (s *stubAlertTuningSource) LoadRule(_ context.Context, ruleID int64) (*alertmodel.AlertRule, error) {
	s.loadRuleCalls = append(s.loadRuleCalls, ruleID)
	return s.rule, s.loadRuleErr
}

func (s *stubAlertTuningSource) LoadFiringHistory(_ context.Context, ruleID int64, proposed *alertmodel.AlertRule) (*AlertRuleFiringHistory, error) {
	s.loadHistoryRuleIDs = append(s.loadHistoryRuleIDs, ruleID)
	s.loadHistoryProposed = append(s.loadHistoryProposed, proposed)
	return s.history, s.loadHistoryErr
}

// helper — ptrFloat64 lives in route_efficiency_test.go
func ptrInt(v int) *int { return &v }

func sampleRule() *alertmodel.AlertRule {
	return &alertmodel.AlertRule{
		ID:           42,
		Name:         "Battery low",
		Enabled:      true,
		AllVehicles:  true,
		VehicleIDs:   []int64{},
		SignalName:   "battery_level",
		Op:           "<",
		ValueNum:     ptrFloat64(20),
		Severity:     "warn",
		CooldownMin:  5,
		TriggerMode:  "repeat",
		Kind:         alertmodel.AlertRuleKindSignal,
		IncludeTitle: true,
	}
}

func sampleHistory() *AlertRuleFiringHistory {
	return &AlertRuleFiringHistory{
		WindowDays:                  30,
		MinRequiredEvents:           5,
		SampleSize:                  23,
		HasEnoughHistory:            true,
		TotalFires7d:                23,
		TotalFires30d:               80,
		AvgFiresPerDay7d:            3.28,
		AvgFiresPerDay30d:           2.66,
		WouldHaveFired7dAfterPatch:  3,
		WouldHaveFired30dAfterPatch: 11,
		ProjectionMethod:            "descriptive replay of notification logs through proposed threshold + cooldown",
		Assumptions: []string{
			"projection treats each notification_logs row as one firing event",
			"cooldown latch is replayed independently per vehicle",
		},
	}
}

// TestDraftAlertRulePatch_HappyPath_OK proves a valid LLM payload
// yields status="ok", the typed envelope quotes both the original
// and the merged rule, the firing-history summary is forwarded
// verbatim, and the source breadcrumb names the canonical readers.
func TestDraftAlertRulePatch_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubAlertTuningSource{rule: sampleRule(), history: sampleHistory()}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{
		"rule_id":           42,
		"new_value_num":     15,
		"new_cooldown_min":  30,
		"rationale":         "Reduce noise from low-battery alerts"
	}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}

	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*AlertRulePatchProposal)
	if !ok {
		t.Fatalf("Execute returned %T, want *AlertRulePatchProposal", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.RuleID != 42 {
		t.Errorf("RuleID = %d, want 42", env.RuleID)
	}
	if env.RuleBefore == nil || env.RuleBefore.ID != 42 {
		t.Fatalf("RuleBefore = %+v, want sampleRule", env.RuleBefore)
	}
	if env.Proposed == nil {
		t.Fatal("Proposed is nil")
	}
	// Patched fields.
	if env.Proposed.ValueNum == nil || *env.Proposed.ValueNum != 15 {
		t.Errorf("Proposed.ValueNum = %v, want *float64(15)", env.Proposed.ValueNum)
	}
	if env.Proposed.CooldownMin != 30 {
		t.Errorf("Proposed.CooldownMin = %d, want 30", env.Proposed.CooldownMin)
	}
	// Unpatched fields preserved verbatim.
	if env.Proposed.SignalName != "battery_level" {
		t.Errorf("Proposed.SignalName = %q, want %q (preserved)", env.Proposed.SignalName, "battery_level")
	}
	if env.Proposed.Op != "<" {
		t.Errorf("Proposed.Op = %q, want %q (preserved)", env.Proposed.Op, "<")
	}
	if env.Proposed.Severity != "warn" {
		t.Errorf("Proposed.Severity = %q, want %q (preserved)", env.Proposed.Severity, "warn")
	}
	if env.Proposed.TriggerMode != "repeat" {
		t.Errorf("Proposed.TriggerMode = %q, want %q (preserved)", env.Proposed.TriggerMode, "repeat")
	}
	// History envelope passes through verbatim.
	if env.History == nil || env.History.SampleSize != 23 {
		t.Errorf("History = %+v, want sampleHistory", env.History)
	}
	if !env.History.HasEnoughHistory {
		t.Error("History.HasEnoughHistory = false, want true")
	}
	if env.History.WouldHaveFired7dAfterPatch != 3 {
		t.Errorf("History.WouldHaveFired7dAfterPatch = %d, want 3", env.History.WouldHaveFired7dAfterPatch)
	}
	if !strings.Contains(env.Source, "AlertRuleRepo.GetByID") || !strings.Contains(env.Source, "notification_repo") {
		t.Errorf("Source = %q; want canonical reader attribution", env.Source)
	}
	// Port routing.
	if !reflect.DeepEqual(stub.loadRuleCalls, []int64{42}) {
		t.Errorf("LoadRule calls = %v, want [42]", stub.loadRuleCalls)
	}
	if !reflect.DeepEqual(stub.loadHistoryRuleIDs, []int64{42}) {
		t.Errorf("LoadFiringHistory calls = %v, want [42]", stub.loadHistoryRuleIDs)
	}
	// LoadFiringHistory gets the MERGED proposed rule, not the original.
	if len(stub.loadHistoryProposed) != 1 || stub.loadHistoryProposed[0] == nil {
		t.Fatalf("LoadFiringHistory proposed = %v", stub.loadHistoryProposed)
	}
	if stub.loadHistoryProposed[0].ValueNum == nil || *stub.loadHistoryProposed[0].ValueNum != 15 {
		t.Errorf("LoadFiringHistory got original ValueNum=%v; want patched 15", stub.loadHistoryProposed[0].ValueNum)
	}
}

// TestDraftAlertRulePatch_PreservesOriginal proves the merge does
// NOT mutate the original rule the source returned. A future edit
// that aliases the pointer instead of constructing a fresh value
// would break the "show before/after" UI.
func TestDraftAlertRulePatch_PreservesOriginal(t *testing.T) {
	t.Parallel()
	original := sampleRule()
	stub := &stubAlertTuningSource{rule: original, history: sampleHistory()}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{"rule_id":42,"new_value_num":7}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*AlertRulePatchProposal)

	// The pointer in the envelope's RuleBefore IS the original
	// (we don't deep-copy; only Proposed is a fresh value). We
	// still check that the original's ValueNum was NOT mutated
	// to the patched value — applyPatch must construct a new
	// pointer, not in-place edit the existing one.
	if original.ValueNum == nil || *original.ValueNum != 20 {
		t.Errorf("original.ValueNum = %v, want unchanged *float64(20)", original.ValueNum)
	}
	if env.Proposed.ValueNum == nil || *env.Proposed.ValueNum != 7 {
		t.Errorf("Proposed.ValueNum = %v, want *float64(7)", env.Proposed.ValueNum)
	}
	if env.Proposed.ValueNum == original.ValueNum {
		t.Error("Proposed.ValueNum aliases original.ValueNum; want fresh pointer")
	}
}

// TestDraftAlertRulePatch_RuleNotFound surfaces the
// "rule_not_found" status without crashing the dispatcher when the
// caller-supplied ruleID is not in the repo.
func TestDraftAlertRulePatch_RuleNotFound(t *testing.T) {
	t.Parallel()
	stub := &stubAlertTuningSource{rule: nil, history: sampleHistory()}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{"rule_id":99999}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (status surfaced in envelope)", err)
	}
	env := out.(*AlertRulePatchProposal)
	if env.Status != "rule_not_found" {
		t.Errorf("Status = %q, want %q", env.Status, "rule_not_found")
	}
	if env.Proposed != nil {
		t.Errorf("Proposed = %+v, want nil for rule_not_found", env.Proposed)
	}
	if env.RuleBefore != nil {
		t.Errorf("RuleBefore = %+v, want nil for rule_not_found", env.RuleBefore)
	}
	// LoadFiringHistory MUST NOT be called when the rule was
	// not found — there's nothing to project against.
	if len(stub.loadHistoryRuleIDs) != 0 {
		t.Errorf("LoadFiringHistory was called %v; want skipped for rule_not_found", stub.loadHistoryRuleIDs)
	}
}

// TestDraftAlertRulePatch_LoadRuleError propagates a port-level
// error to the dispatcher (which surfaces it as an AI tool error
// frame for the LLM).
func TestDraftAlertRulePatch_LoadRuleError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("simulated DB outage")
	stub := &stubAlertTuningSource{loadRuleErr: wantErr}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{"rule_id":42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if !errors.Is(err, wantErr) {
		t.Fatalf("Execute err = %v, want %v", err, wantErr)
	}
}

// TestDraftAlertRulePatch_LoadHistoryError propagates a port-level
// error from the history reader.
func TestDraftAlertRulePatch_LoadHistoryError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("simulated history outage")
	stub := &stubAlertTuningSource{rule: sampleRule(), loadHistoryErr: wantErr}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{"rule_id":42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if !errors.Is(err, wantErr) {
		t.Fatalf("Execute err = %v, want %v", err, wantErr)
	}
}

// TestDraftAlertRulePatch_NilSourcePanicsAtExecute proves a wiring
// gap surfaces as a tool error (never as a nil dereference panic
// reaching the dispatcher's stream writer).
func TestDraftAlertRulePatch_NilSourceErrorsAtExecute(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: nil}
	in, err := tool.Validate(json.RawMessage(`{"rule_id":42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil; want explicit no-source-wired error")
	}
	if !strings.Contains(err.Error(), "no AlertTuningSource wired") {
		t.Errorf("Execute err = %v; want 'no AlertTuningSource wired'", err)
	}
}

// TestDraftAlertRulePatch_RejectsMissingRuleID proves the
// schema-level validate guard short-circuits before the port is
// touched. This is defence-in-depth — the AI handler clamps
// ruleID from the URL path, so a missing rule_id is a wiring bug.
func TestDraftAlertRulePatch_RejectsMissingRuleID(t *testing.T) {
	t.Parallel()
	stub := &stubAlertTuningSource{}
	tool := &draftAlertRulePatch{source: stub}
	_, err := tool.Validate(json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("Validate err = nil, want required-field error")
	}
	ve, ok := AsValidationError(err)
	if !ok {
		t.Fatalf("Validate err is not *ValidationError: %T %v", err, err)
	}
	if ve.Field != "rule_id" || ve.Rule != "required" {
		t.Errorf("Validate err = %+v; want field=rule_id rule=required", ve)
	}
	if len(stub.loadRuleCalls) != 0 {
		t.Errorf("LoadRule was called %v; want short-circuit on Validate failure", stub.loadRuleCalls)
	}
}

// TestDraftAlertRulePatch_RejectsZeroRuleID proves the gte=1 rule
// fires on a zero or negative ruleID.
func TestDraftAlertRulePatch_RejectsZeroRuleID(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: &stubAlertTuningSource{}}
	_, err := tool.Validate(json.RawMessage(`{"rule_id":0}`))
	if err == nil {
		t.Fatal("Validate err = nil, want required-field error on rule_id=0")
	}
	// rule_id=0 is the zero value — `required` triggers first.
	ve, ok := AsValidationError(err)
	if !ok {
		t.Fatalf("Validate err is not *ValidationError: %T %v", err, err)
	}
	if ve.Field != "rule_id" {
		t.Errorf("Validate err field = %q; want rule_id", ve.Field)
	}
}

// TestDraftAlertRulePatch_RejectsBadOperator proves the oneof
// validate tag fires on an invalid operator string.
func TestDraftAlertRulePatch_RejectsBadOperator(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: &stubAlertTuningSource{}}
	_, err := tool.Validate(json.RawMessage(`{"rule_id":42,"new_op":"~="}`))
	if err == nil {
		t.Fatal("Validate err = nil, want oneof violation")
	}
	ve, ok := AsValidationError(err)
	if !ok {
		t.Fatalf("Validate err is not *ValidationError: %T %v", err, err)
	}
	if ve.Field != "new_op" {
		t.Errorf("Validate err field = %q; want new_op", ve.Field)
	}
}

// TestDraftAlertRulePatch_RejectsBadSeverity proves loosening
// severity is rejected at the schema level when set to a
// non-canonical value. (The "do not loosen severity" guard is in
// the system prompt; the schema-level guard here just rejects
// non-canonical values.)
func TestDraftAlertRulePatch_RejectsBadSeverity(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: &stubAlertTuningSource{}}
	_, err := tool.Validate(json.RawMessage(`{"rule_id":42,"new_severity":"warning"}`))
	if err == nil {
		t.Fatal("Validate err = nil, want oneof violation on legacy 'warning'")
	}
	ve, ok := AsValidationError(err)
	if !ok {
		t.Fatalf("Validate err is not *ValidationError: %T %v", err, err)
	}
	if ve.Field != "new_severity" {
		t.Errorf("Validate err field = %q; want new_severity", ve.Field)
	}
}

// TestDraftAlertRulePatch_RejectsCooldownOutOfRange proves the
// gte=1,lte=1440 guard fires on a too-short or too-long cooldown.
func TestDraftAlertRulePatch_RejectsCooldownOutOfRange(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: &stubAlertTuningSource{}}
	for _, body := range []string{
		`{"rule_id":42,"new_cooldown_min":0}`,    // gte=1
		`{"rule_id":42,"new_cooldown_min":2000}`, // lte=1440
	} {
		_, err := tool.Validate(json.RawMessage(body))
		if err == nil {
			t.Errorf("Validate(%s) err = nil, want range violation", body)
			continue
		}
		ve, ok := AsValidationError(err)
		if !ok {
			t.Errorf("Validate(%s) err is not *ValidationError: %T", body, err)
			continue
		}
		if ve.Field != "new_cooldown_min" {
			t.Errorf("Validate(%s) field = %q, want new_cooldown_min", body, ve.Field)
		}
	}
}

// TestDraftAlertRulePatch_AllowsOmittedPatchFields proves a
// rule_id-only payload is accepted (zero-patch case — the LLM is
// just asking for the typed envelope before deciding what to
// tune).
func TestDraftAlertRulePatch_AllowsOmittedPatchFields(t *testing.T) {
	t.Parallel()
	stub := &stubAlertTuningSource{rule: sampleRule(), history: sampleHistory()}
	tool := &draftAlertRulePatch{source: stub}

	in, err := tool.Validate(json.RawMessage(`{"rule_id":42}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*AlertRulePatchProposal)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.Proposed.ValueNum == nil || *env.Proposed.ValueNum != 20 {
		t.Errorf("Proposed.ValueNum = %v, want preserved *float64(20)", env.Proposed.ValueNum)
	}
}

// TestDraftAlertRulePatch_HasEnoughHistoryFalse proves the
// envelope surfaces the small-sample flag verbatim. The LLM's
// system prompt then asks the narrator to disclose this case
// rather than invent a baseline rate.
func TestDraftAlertRulePatch_HasEnoughHistoryFalse(t *testing.T) {
	t.Parallel()
	stub := &stubAlertTuningSource{
		rule: sampleRule(),
		history: &AlertRuleFiringHistory{
			WindowDays:        30,
			MinRequiredEvents: 5,
			SampleSize:        2,
			HasEnoughHistory:  false,
			Assumptions:       []string{"insufficient firing events to project a rate"},
		},
	}
	tool := &draftAlertRulePatch{source: stub}
	in, _ := tool.Validate(json.RawMessage(`{"rule_id":42,"new_value_num":15}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(*AlertRulePatchProposal)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want %q", env.Status, "ok")
	}
	if env.History.HasEnoughHistory {
		t.Error("History.HasEnoughHistory = true, want false")
	}
	if env.History.SampleSize != 2 {
		t.Errorf("History.SampleSize = %d, want 2", env.History.SampleSize)
	}
}

// TestDraftAlertRulePatch_ContractMetadata pins the descriptive
// metadata fields (Name, Description, Mutates, RequiredScope) so
// a future edit that flips Mutates() to true (which would route
// the tool through the deny-all confirm gate by accident) fails
// here first.
func TestDraftAlertRulePatch_ContractMetadata(t *testing.T) {
	t.Parallel()
	tool := &draftAlertRulePatch{source: &stubAlertTuningSource{}}
	if tool.Name() != "draft_alert_rule_patch" {
		t.Errorf("Name = %q, want %q", tool.Name(), "draft_alert_rule_patch")
	}
	if tool.Mutates() {
		t.Error("Mutates() = true, want false (PROPOSE-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope = %q, want empty", tool.RequiredScope())
	}
	if d := tool.Description(); d == "" || !strings.Contains(d, "PROPOSE-ONLY") {
		t.Errorf("Description missing PROPOSE-ONLY marker; got=%q", d)
	}
	// Schema is non-empty + JSON-valid.
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema empty")
	}
	var doc map[string]any
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("InputSchema not valid JSON: %v", err)
	}
}

// TestRegisterAlertTuningSuggestionsTools proves the registrar
// installs draft_alert_rule_patch on the registry. We do NOT
// assert the registration of validate_alert_rule — that's
// installed by RegisterAlertBuilderTools (the N1 slice) and
// the dispatcher resolves it from the same shared registry.
func TestRegisterAlertTuningSuggestionsTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterAlertTuningSuggestionsTools(r, AlertTuningSuggestionsSources{
		Source: &stubAlertTuningSource{},
	})
	got, ok := r.Get("draft_alert_rule_patch")
	if !ok {
		t.Fatalf("Get(draft_alert_rule_patch) not found")
	}
	if got.Name() != "draft_alert_rule_patch" {
		t.Errorf("Get returned %q", got.Name())
	}
}
