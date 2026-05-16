// Phase-50 / 0052 — P1 Helix export redaction advisor.
//
// Unit tests for the draft_export_redaction_plan +
// validate_export_redaction_plan tools. Both tools wrap a STATIC
// in-process Go catalog and a pure-Go validator; the unit tests
// stay hermetic by construction (no fakes needed).
//
// The tools also enforce the per-request scope binding the slice
// prompt's security model relies on (defence against
// prompt-injection exfiltration via operator-authored
// description strings). The scope-binding tests pin the
// contract: missing scope ⇒ refuse; mismatched scope ⇒ refuse;
// matched scope ⇒ delegate. A future edit that bypasses any of
// these gates would surface here.

package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Catalog invariants
// ---------------------------------------------------------------------------

// TestSharedExportPIICatalog_AllExportTypesCovered pins the
// catalog↔allow-set parity. exportTypes lists the values the
// validator accepts; sharedExportPIICatalog provides per-type
// recommendations. A drift between the two is a wiring bug —
// the validator would accept an export_type that the catalog
// then refuses, surfacing as a runtime "wiring bug" error.
func TestSharedExportPIICatalog_AllExportTypesCovered(t *testing.T) {
	t.Parallel()
	for _, exportType := range exportTypes {
		entry, ok := sharedExportPIICatalog[exportType]
		if !ok {
			t.Errorf("sharedExportPIICatalog missing entry for export_type=%q", exportType)
			continue
		}
		if entry.ExportType != exportType {
			t.Errorf("sharedExportPIICatalog[%q].ExportType = %q, want %q (key/value mismatch)", exportType, entry.ExportType, exportType)
		}
		if len(entry.Classes) == 0 {
			t.Errorf("sharedExportPIICatalog[%q].Classes is empty", exportType)
		}
	}
	if len(sharedExportPIICatalog) != len(exportTypes) {
		t.Errorf("sharedExportPIICatalog has %d entries; exportTypes has %d (drift)", len(sharedExportPIICatalog), len(exportTypes))
	}
}

// TestSharedExportPIICatalog_ClassesAreSane asserts every
// catalog entry uses well-known modes + priorities. A future
// edit that introduces a typo'd mode ("redcat") or priority
// ("nice_to_have") would refuse the validator and silently
// degrade the recommendation — fail at boot/test time instead.
func TestSharedExportPIICatalog_ClassesAreSane(t *testing.T) {
	t.Parallel()
	for exportType, entry := range sharedExportPIICatalog {
		seen := make(map[string]struct{}, len(entry.Classes))
		for _, c := range entry.Classes {
			if c.Class == "" {
				t.Errorf("export_type=%q: empty class name", exportType)
			}
			if _, dup := seen[c.Class]; dup {
				t.Errorf("export_type=%q: class %q listed more than once in catalog", exportType, c.Class)
			}
			seen[c.Class] = struct{}{}
			if _, ok := redactionModeSet[c.RecommendedMode]; !ok {
				t.Errorf("export_type=%q class=%q: RecommendedMode %q not in allow-set %s", exportType, c.Class, c.RecommendedMode, redactionModesHint)
			}
			if c.Priority != "highly_recommended" && c.Priority != "optional" {
				t.Errorf("export_type=%q class=%q: Priority %q not in {highly_recommended, optional}", exportType, c.Class, c.Priority)
			}
			if c.Rationale == "" {
				t.Errorf("export_type=%q class=%q: empty Rationale", exportType, c.Class)
			}
		}
	}
}

// TestSharedExportRedactionModes_StableExportedAllowSet pins
// the canonical allow-set of redaction modes the advisor may
// recommend. The advisor's system prompt references this set;
// drifting it without updating the prompt would silently degrade
// the recommendation.
func TestSharedExportRedactionModes_StableExportedAllowSet(t *testing.T) {
	t.Parallel()
	modes := SharedExportRedactionModes()
	want := []string{"drop", "hash", "keep_if_consent", "redact"}
	if len(modes) != len(want) {
		t.Fatalf("SharedExportRedactionModes() returned %d modes, want %d (got=%v)", len(modes), len(want), modes)
	}
	for i, m := range want {
		if modes[i] != m {
			t.Errorf("SharedExportRedactionModes()[%d] = %q, want %q", i, modes[i], m)
		}
	}
}

// TestSharedExportTypes_StableExportedAllowSet pins the
// canonical allow-set of export_type values.
func TestSharedExportTypes_StableExportedAllowSet(t *testing.T) {
	t.Parallel()
	types := SharedExportTypes()
	want := []string{"account", "analytics", "backup", "charging", "drives", "trips"}
	if len(types) != len(want) {
		t.Fatalf("SharedExportTypes() returned %d types, want %d (got=%v)", len(types), len(want), types)
	}
	for i, x := range want {
		if types[i] != x {
			t.Errorf("SharedExportTypes()[%d] = %q, want %q", i, types[i], x)
		}
	}
}

// TestSharedExportRedactionReservedSourceTypes_StableForwardCompat
// pins the reserved F7 source-type strings. The slice prompt
// reserves them for a future retrieve tool; a future slice that
// adds the tool MUST use the same strings or the system prompt
// + goldens will drift.
func TestSharedExportRedactionReservedSourceTypes_StableForwardCompat(t *testing.T) {
	t.Parallel()
	got := SharedExportRedactionReservedSourceTypes()
	want := []string{"export_manifest", "redaction_report"}
	if len(got) != len(want) {
		t.Fatalf("SharedExportRedactionReservedSourceTypes() returned %d source types, want %d (got=%v)", len(got), len(want), got)
	}
	for i, s := range want {
		if got[i] != s {
			t.Errorf("SharedExportRedactionReservedSourceTypes()[%d] = %q, want %q", i, got[i], s)
		}
	}
}

// ---------------------------------------------------------------------------
// draft_export_redaction_plan
// ---------------------------------------------------------------------------

func TestDraftExportRedactionPlan_Name(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	if got := tool.Name(); got != "draft_export_redaction_plan" {
		t.Errorf("Name() = %q, want draft_export_redaction_plan", got)
	}
}

func TestDraftExportRedactionPlan_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "catalog-based", "NOT a per-row PII scan", "account, analytics, backup, charging, drives, trips"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestDraftExportRedactionPlan_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	if len(tool.InputSchema()) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() = %v, want nil (free-form output)", tool.OutputSchema())
	}
}

func TestDraftExportRedactionPlan_Validate_RejectsUnknownExportType(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	_, err := tool.Validate(json.RawMessage(`{"export_type": "telemetry"}`))
	if err == nil {
		t.Fatal("Validate(telemetry) returned nil err, want allow-set rejection")
	}
	if !strings.Contains(err.Error(), "telemetry") {
		t.Errorf("Validate err = %v, want mention of unknown value", err)
	}
}

func TestDraftExportRedactionPlan_Validate_AcceptsKnownExportType(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	v, err := tool.Validate(json.RawMessage(`{"export_type": "drives"}`))
	if err != nil {
		t.Fatalf("Validate(drives) err = %v, want nil", err)
	}
	in, ok := v.(draftExportRedactionPlanInput)
	if !ok {
		t.Fatalf("Validate(drives) returned %T, want draftExportRedactionPlanInput", v)
	}
	if in.ExportType != "drives" {
		t.Errorf("Validate(drives).ExportType = %q, want drives", in.ExportType)
	}
}

func TestDraftExportRedactionPlan_Execute_RefusesWithoutScope(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	_, err := tool.Execute(context.Background(), draftExportRedactionPlanInput{ExportType: "drives"})
	if err == nil {
		t.Fatal("Execute(no scope) returned nil err, want scope-binding refusal")
	}
	if !strings.Contains(err.Error(), "in-scope") {
		t.Errorf("Execute(no scope) err = %v, want scope-binding refusal", err)
	}
}

func TestDraftExportRedactionPlan_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "account"})
	_, err := tool.Execute(ctx, draftExportRedactionPlanInput{ExportType: "drives"})
	if err == nil {
		t.Fatal("Execute(mismatched scope) returned nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "does not match in-scope") {
		t.Errorf("Execute(mismatched scope) err = %v, want scope mismatch refusal", err)
	}
}

func TestDraftExportRedactionPlan_Execute_AcceptsMatchedScope_Drives(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	out, err := tool.Execute(ctx, draftExportRedactionPlanInput{ExportType: "drives"})
	if err != nil {
		t.Fatalf("Execute(drives) err = %v, want nil", err)
	}
	envelope, ok := out.(SharedExportPIICatalogEntry)
	if !ok {
		t.Fatalf("Execute(drives) returned %T, want SharedExportPIICatalogEntry", out)
	}
	if envelope.ExportType != "drives" {
		t.Errorf("envelope.ExportType = %q, want drives", envelope.ExportType)
	}
	if len(envelope.Classes) == 0 {
		t.Error("envelope.Classes is empty for drives")
	}
	// Pin: every drives recommendation MUST include lat_long
	// as highly_recommended (catalog correctness).
	foundLatLong := false
	for _, c := range envelope.Classes {
		if c.Class == "lat_long" {
			foundLatLong = true
			if c.Priority != "highly_recommended" {
				t.Errorf("drives.lat_long.Priority = %q, want highly_recommended", c.Priority)
			}
			break
		}
	}
	if !foundLatLong {
		t.Error("drives recommendation missing lat_long class")
	}
	// Pin: the common assumptions (catalog-based limit
	// disclosures) MUST be appended; the narrator's "catalog-
	// based" disclosure depends on this.
	foundCatalogDisclosure := false
	for _, a := range envelope.Assumptions {
		if strings.Contains(a, "catalog-based") {
			foundCatalogDisclosure = true
			break
		}
	}
	if !foundCatalogDisclosure {
		t.Error("envelope.Assumptions missing catalog-based disclosure")
	}
}

func TestDraftExportRedactionPlan_Execute_AccountCarriesPaymentTokenDrop(t *testing.T) {
	t.Parallel()
	tool := &draftExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "account"})
	out, err := tool.Execute(ctx, draftExportRedactionPlanInput{ExportType: "account"})
	if err != nil {
		t.Fatalf("Execute(account) err = %v, want nil", err)
	}
	envelope := out.(SharedExportPIICatalogEntry)
	foundPaymentDrop := false
	for _, c := range envelope.Classes {
		if c.Class == "payment_token" {
			if c.RecommendedMode != "drop" {
				t.Errorf("account.payment_token.RecommendedMode = %q, want drop (per catalog policy)", c.RecommendedMode)
			}
			foundPaymentDrop = true
			break
		}
	}
	if !foundPaymentDrop {
		t.Error("account recommendation missing payment_token class")
	}
}

// ---------------------------------------------------------------------------
// validate_export_redaction_plan
// ---------------------------------------------------------------------------

func TestValidateExportRedactionPlan_Name(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	if got := tool.Name(); got != "validate_export_redaction_plan" {
		t.Errorf("Name() = %q, want validate_export_redaction_plan", got)
	}
}

func TestValidateExportRedactionPlan_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "errors", "warnings", "narrator MUST REFUSE"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestValidateExportRedactionPlan_Execute_RefusesWithoutScope(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	_, err := tool.Execute(context.Background(), validateExportRedactionPlanInput{
		ExportType: "drives",
		Classes: []validateExportRedactionPlanCandidateClass{
			{Class: "vin", Mode: "hash"},
		},
	})
	if err == nil {
		t.Fatal("Execute(no scope) returned nil err, want scope-binding refusal")
	}
}

func TestValidateExportRedactionPlan_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "account"})
	_, err := tool.Execute(ctx, validateExportRedactionPlanInput{
		ExportType: "drives",
		Classes: []validateExportRedactionPlanCandidateClass{
			{Class: "vin", Mode: "hash"},
		},
	})
	if err == nil {
		t.Fatal("Execute(mismatched scope) returned nil err, want refusal")
	}
}

// drivesCompletePlan returns a complete candidate plan covering
// every highly_recommended class for export_type=drives. Used as
// the baseline for ok=true assertions.
func drivesCompletePlan() validateExportRedactionPlanInput {
	return validateExportRedactionPlanInput{
		ExportType: "drives",
		Classes: []validateExportRedactionPlanCandidateClass{
			{Class: "vin", Mode: "hash"},
			{Class: "lat_long", Mode: "redact"},
			{Class: "address", Mode: "redact"},
			{Class: "place_name", Mode: "redact"},
		},
	}
}

func TestValidateExportRedactionPlan_Execute_OKForCompletePlan(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	out, err := tool.Execute(ctx, drivesCompletePlan())
	if err != nil {
		t.Fatalf("Execute(complete plan) err = %v, want nil", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if !res.OK {
		t.Errorf("complete plan: OK = false, errors=%v", res.Errors)
	}
	if len(res.Errors) != 0 {
		t.Errorf("complete plan: errors = %v, want empty", res.Errors)
	}
	// Optional classes (vehicle_name, precise_timestamp) are
	// NOT covered → expect warnings.
	if len(res.Warnings) == 0 {
		t.Error("complete plan: warnings = empty, want optional-class warnings")
	}
}

func TestValidateExportRedactionPlan_Execute_RejectsMissingHighlyRecommended(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	plan := drivesCompletePlan()
	// Drop lat_long → highly_recommended class missing.
	plan.Classes = []validateExportRedactionPlanCandidateClass{
		plan.Classes[0], plan.Classes[2], plan.Classes[3],
	}
	out, err := tool.Execute(ctx, plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (missing class is a soft validator failure, not a tool error)", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if res.OK {
		t.Error("plan missing highly_recommended class: OK = true, want false")
	}
	foundLatLongErr := false
	for _, e := range res.Errors {
		if strings.Contains(e, "lat_long") && strings.Contains(e, "highly_recommended") {
			foundLatLongErr = true
			break
		}
	}
	if !foundLatLongErr {
		t.Errorf("plan missing lat_long: errors = %v, want lat_long highly_recommended error", res.Errors)
	}
}

func TestValidateExportRedactionPlan_Execute_RejectsUnknownClass(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	plan := drivesCompletePlan()
	plan.Classes = append(plan.Classes, validateExportRedactionPlanCandidateClass{Class: "fingerprint_dna", Mode: "redact"})
	out, err := tool.Execute(ctx, plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if res.OK {
		t.Error("plan with unknown class: OK = true, want false")
	}
	foundUnknownErr := false
	for _, e := range res.Errors {
		if strings.Contains(e, "fingerprint_dna") && strings.Contains(e, "not in the catalog") {
			foundUnknownErr = true
			break
		}
	}
	if !foundUnknownErr {
		t.Errorf("plan with unknown class: errors = %v, want unknown-class error", res.Errors)
	}
}

func TestValidateExportRedactionPlan_Execute_RejectsUnknownMode(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	plan := drivesCompletePlan()
	plan.Classes[0].Mode = "obfuscate" // not in {drop, hash, keep_if_consent, redact}
	out, err := tool.Execute(ctx, plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if res.OK {
		t.Error("plan with unknown mode: OK = true, want false")
	}
	foundUnknownMode := false
	for _, e := range res.Errors {
		if strings.Contains(e, "obfuscate") && strings.Contains(e, "unknown redaction mode") {
			foundUnknownMode = true
			break
		}
	}
	if !foundUnknownMode {
		t.Errorf("plan with unknown mode: errors = %v, want unknown-mode error", res.Errors)
	}
}

func TestValidateExportRedactionPlan_Execute_RejectsDuplicateClass(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	plan := drivesCompletePlan()
	plan.Classes = append(plan.Classes, validateExportRedactionPlanCandidateClass{Class: "vin", Mode: "redact"})
	out, err := tool.Execute(ctx, plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if res.OK {
		t.Error("plan with duplicate class: OK = true, want false")
	}
	foundDup := false
	for _, e := range res.Errors {
		if strings.Contains(e, `"vin"`) && strings.Contains(e, "more than once") {
			foundDup = true
			break
		}
	}
	if !foundDup {
		t.Errorf("plan with duplicate class: errors = %v, want duplicate error", res.Errors)
	}
}

func TestValidateExportRedactionPlan_Execute_WarnsOnRecommendedModeDisagreement(t *testing.T) {
	t.Parallel()
	tool := &validateExportRedactionPlan{}
	ctx := WithScopedSharedExportRedactionWindow(context.Background(), ScopedSharedExportRedactionWindow{ExportType: "drives"})
	plan := drivesCompletePlan()
	// vin recommended_mode is hash; user picks redact instead
	// → warning, not error.
	plan.Classes[0].Mode = "redact"
	out, err := tool.Execute(ctx, plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateExportRedactionPlanResult)
	if !res.OK {
		t.Errorf("plan with mode disagreement: OK = false, want true (disagreement is a warning, not an error). errors=%v", res.Errors)
	}
	foundDisagreementWarning := false
	for _, w := range res.Warnings {
		if strings.Contains(w, `"vin"`) && strings.Contains(w, "redact") && strings.Contains(w, "hash") {
			foundDisagreementWarning = true
			break
		}
	}
	if !foundDisagreementWarning {
		t.Errorf("plan with mode disagreement: warnings = %v, want vin redact/hash disagreement warning", res.Warnings)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterPiiRedactionSharedExportsTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterPiiRedactionSharedExportsTools(r)
	for _, name := range []string{"draft_export_redaction_plan", "validate_export_redaction_plan"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing tool %q after RegisterPiiRedactionSharedExportsTools", name)
		}
	}
}
