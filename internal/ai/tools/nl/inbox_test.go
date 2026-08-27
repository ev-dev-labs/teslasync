// Inbox auto-categorization tool tests.
//
// Tool tests for draft_alert_categories + validate_alert_category.
// Both tools are pure functions over their input + (for
// draft_alert_categories) the InboxCategorizationSource port; the
// tests stub the port with a deterministic fake so the tests stay
// hermetic (no api package import, no DB, no notification_logs
// query). The bucketing helper BucketByCategory is exercised
// directly so the production adapter (api.AIInboxCategorizationSource)
// can compose it without re-testing the bucketing semantics.

package nl

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
)

// stubInboxCategorizationSource is a deterministic fake
// implementing InboxCategorizationSource. Records every call
// so a test can assert the tool routes through the port and
// surface the canned shape the test author wants.
type stubInboxCategorizationSource struct {
	counts        []CategoryCount
	totalInWindow int
	minRequired   int
	loadErr       error
	loadFilters   []dbnotif.NotificationLogFilters
}

func (s *stubInboxCategorizationSource) LoadCategoryCounts(_ context.Context, f dbnotif.NotificationLogFilters) ([]CategoryCount, int, int, error) {
	s.loadFilters = append(s.loadFilters, f)
	return s.counts, s.totalInWindow, s.minRequired, s.loadErr
}

// ---------------------------------------------------------------------------
// CategoryForSignal
// ---------------------------------------------------------------------------

// TestCategoryForSignal_KnownSignals pins the deterministic
// substring mapping for every documented signal family. Keep
// the table sorted alphabetically so future additions land in a
// consistent place.
func TestCategoryForSignal_KnownSignals(t *testing.T) {
	t.Parallel()
	cases := []struct {
		signal string
		want   string
	}{
		// battery family
		{"battery_level", "battery"},
		{"battery_level_pct", "battery"},
		{"soc_pct", "battery"},
		{"range_miles_remaining", "battery"},
		{"battery_kwh_remaining", "battery"},
		// charging family
		{"charge_state", "charging"},
		{"charging_amp", "charging"},
		{"supercharger_kw", "charging"},
		{"charging_volt", "charging"},
		// climate family
		{"climate_state", "climate"},
		{"cabin_temp_c", "climate"},
		{"hvac_setpoint", "climate"},
		// tire family
		{"tire_pressure_psi", "tire"},
		{"tpms_warn", "tire"}, // tpms substring matches tire family before "warn" matches maintenance
		{"tyre_pressure_kpa", "tire"},
		// security family
		{"locked", "security"},
		{"sentry_mode_on", "security"},
		{"alarm_triggered", "security"},
		{"intrusion_detected", "security"},
		// connectivity family
		{"vehicle_online", "connectivity"},
		{"wifi_connected", "connectivity"},
		{"lte_signal_strength", "connectivity"},
		// maintenance family
		{"service_due_warning", "maintenance"},
		{"wash_recommended", "maintenance"},
		// noise family
		{"noisy_signal", "noise"},
		{"throttle_position_pct", "noise"},
		// other / fallback
		{"", "other"},
		{"some_unknown_metric", "other"},
		{"computed_metric_42", "other"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.signal+"->"+c.want, func(t *testing.T) {
			t.Parallel()
			if got := CategoryForSignal(c.signal); got != c.want {
				t.Errorf("CategoryForSignal(%q) = %q, want %q", c.signal, got, c.want)
			}
		})
	}
}

// TestCategoryForSignal_TrimsAndLowercases proves the helper
// is whitespace + case insensitive so a slightly different
// signal name still buckets correctly.
func TestCategoryForSignal_TrimsAndLowercases(t *testing.T) {
	t.Parallel()
	if got := CategoryForSignal("  BATTERY_Level  "); got != "battery" {
		t.Errorf("CategoryForSignal whitespace/case = %q, want battery", got)
	}
}

// ---------------------------------------------------------------------------
// BucketByCategory
// ---------------------------------------------------------------------------

// TestBucketByCategory_HappyPath proves the bucketing helper
// groups rows by the deterministic signal_name -> category map,
// caps SampleRuleIDs at maxSampleRuleIDs, sorts by Count DESC
// then Label ASC, and surfaces unique severities.
func TestBucketByCategory_HappyPath(t *testing.T) {
	t.Parallel()
	id := func(v int64) *int64 { return &v }
	rows := []*notificationmodel.NotificationLog{
		{ID: 1, AlertID: id(10), Severity: "warn"},
		{ID: 2, AlertID: id(11), Severity: "warn"},
		{ID: 3, AlertID: id(12), Severity: "critical"},
		{ID: 4, AlertID: id(20), Severity: "info"},
		{ID: 5, AlertID: id(20), Severity: "info"},
		{ID: 6, AlertID: id(30), Severity: "warn"},
		// unknown rule id buckets into "other"
		{ID: 7, AlertID: id(99), Severity: "info"},
		// nil alert id buckets into "other"
		{ID: 8, AlertID: nil, Severity: "info"},
	}
	signalLookup := map[int64]string{
		10: "battery_level",
		11: "battery_level_pct",
		12: "soc_pct",
		20: "charge_state",
		30: "tire_pressure_psi",
	}
	got := BucketByCategory(rows, signalLookup)
	// Expect 4 categories: battery (3), charging (2), other (2), tire (1).
	// Sort: Count DESC then Label ASC -> battery, charging, other, tire? No: charging=2, other=2 -> ASC label -> charging, other.
	wantLabels := []string{"battery", "charging", "other", "tire"}
	if len(got) != len(wantLabels) {
		t.Fatalf("BucketByCategory len = %d, want %d (got=%v)", len(got), len(wantLabels), got)
	}
	for i, label := range wantLabels {
		if got[i].Label != label {
			t.Errorf("got[%d].Label = %q, want %q", i, got[i].Label, label)
		}
	}
	if got[0].Count != 3 {
		t.Errorf("battery count = %d, want 3", got[0].Count)
	}
	if !reflect.DeepEqual(got[0].SampleRuleIDs, []int64{10, 11, 12}) {
		t.Errorf("battery sample rule ids = %v, want [10 11 12]", got[0].SampleRuleIDs)
	}
	if !reflect.DeepEqual(got[0].SeveritiesSeen, []string{"critical", "warn"}) {
		t.Errorf("battery severities = %v, want [critical warn]", got[0].SeveritiesSeen)
	}
	if got[1].Count != 2 || got[1].Label != "charging" {
		t.Errorf("charging bucket = %+v, want count=2 label=charging", got[1])
	}
	if got[2].Count != 2 || got[2].Label != "other" {
		t.Errorf("other bucket = %+v, want count=2 label=other", got[2])
	}
	if got[3].Count != 1 || got[3].Label != "tire" {
		t.Errorf("tire bucket = %+v, want count=1 label=tire", got[3])
	}
}

// TestBucketByCategory_SampleRuleIDsCap proves SampleRuleIDs is
// capped at maxSampleRuleIDs even when there are more
// distinct rules in a single category.
func TestBucketByCategory_SampleRuleIDsCap(t *testing.T) {
	t.Parallel()
	id := func(v int64) *int64 { return &v }
	rows := make([]*notificationmodel.NotificationLog, 0, 20)
	signalLookup := make(map[int64]string)
	for i := int64(1); i <= 20; i++ {
		rows = append(rows, &notificationmodel.NotificationLog{ID: i, AlertID: id(i), Severity: "warn"})
		signalLookup[i] = "battery_level"
	}
	got := BucketByCategory(rows, signalLookup)
	if len(got) != 1 {
		t.Fatalf("expected 1 bucket, got %d", len(got))
	}
	if got[0].Count != 20 {
		t.Errorf("count = %d, want 20", got[0].Count)
	}
	if len(got[0].SampleRuleIDs) != maxSampleRuleIDs {
		t.Errorf("SampleRuleIDs len = %d, want %d", len(got[0].SampleRuleIDs), maxSampleRuleIDs)
	}
	// First N (sorted ASC) should be 1..maxSampleRuleIDs.
	for i, v := range got[0].SampleRuleIDs {
		if v != int64(i+1) {
			t.Errorf("SampleRuleIDs[%d] = %d, want %d", i, v, i+1)
		}
	}
}

// TestBucketByCategory_EmptyRowsReturnsEmpty proves an empty
// input produces an empty result (zero-count buckets are
// pruned).
func TestBucketByCategory_EmptyRowsReturnsEmpty(t *testing.T) {
	t.Parallel()
	got := BucketByCategory(nil, nil)
	if len(got) != 0 {
		t.Errorf("BucketByCategory(nil, nil) = %v, want empty", got)
	}
}

// TestBucketByCategory_NilRowsAreSkipped proves a nil row in
// the slice does not crash the helper.
func TestBucketByCategory_NilRowsAreSkipped(t *testing.T) {
	t.Parallel()
	id := func(v int64) *int64 { return &v }
	rows := []*notificationmodel.NotificationLog{
		nil,
		{ID: 1, AlertID: id(10), Severity: "warn"},
	}
	signalLookup := map[int64]string{10: "battery_level"}
	got := BucketByCategory(rows, signalLookup)
	if len(got) != 1 || got[0].Label != "battery" || got[0].Count != 1 {
		t.Errorf("BucketByCategory with nil row = %v, want [{battery 1 ...}]", got)
	}
}

// ---------------------------------------------------------------------------
// draft_alert_categories
// ---------------------------------------------------------------------------

// TestDraftAlertCategories_HappyPath_OK proves the tool
// composes the right NotificationLogFilters from the input,
// calls the port, and returns a typed envelope with
// HasEnoughHistory=true when the sample size meets the
// minimum.
func TestDraftAlertCategories_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{
		counts: []CategoryCount{
			{Label: "battery", Count: 23, SampleRuleIDs: []int64{10, 11}, SeveritiesSeen: []string{"warn"}},
			{Label: "charging", Count: 12, SampleRuleIDs: []int64{20}, SeveritiesSeen: []string{"info"}},
		},
		totalInWindow: 47,
		minRequired:   10,
	}
	tool := &draftAlertCategories{source: stub}
	vid := int64(1)
	wd := 7
	in := alertCategoriesDraftInput{VehicleID: &vid, WindowDays: &wd}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{VehicleID: 1})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	prop, ok := out.(*CategoryProposal)
	if !ok {
		t.Fatalf("Execute returned %T, want *CategoryProposal", out)
	}
	if prop.Status != "ok" {
		t.Errorf("Status = %q, want ok", prop.Status)
	}
	if prop.WindowDays != 7 {
		t.Errorf("WindowDays = %d, want 7", prop.WindowDays)
	}
	if prop.SampleSize != 47 {
		t.Errorf("SampleSize = %d, want 47", prop.SampleSize)
	}
	if !prop.HasEnoughHistory {
		t.Error("HasEnoughHistory = false, want true")
	}
	if prop.MinRequiredEvents != 10 {
		t.Errorf("MinRequiredEvents = %d, want 10", prop.MinRequiredEvents)
	}
	if len(prop.Categories) != 2 {
		t.Errorf("Categories len = %d, want 2", len(prop.Categories))
	}
	if prop.Method == "" {
		t.Error("Method empty")
	}
	if prop.Source == "" {
		t.Error("Source empty")
	}
	// Filter routing — VehicleIDs should be [1] and Limit 1000.
	if len(stub.loadFilters) != 1 {
		t.Fatalf("expected 1 LoadCategoryCounts call, got %d", len(stub.loadFilters))
	}
	if !reflect.DeepEqual(stub.loadFilters[0].VehicleIDs, []int64{1}) {
		t.Errorf("filters.VehicleIDs = %v, want [1]", stub.loadFilters[0].VehicleIDs)
	}
	if stub.loadFilters[0].Limit != 1000 {
		t.Errorf("filters.Limit = %d, want 1000", stub.loadFilters[0].Limit)
	}
}

// TestDraftAlertCategories_DefaultWindowDays proves an absent
// window_days input falls back to the default 7-day window.
func TestDraftAlertCategories_DefaultWindowDays(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{
		counts:        []CategoryCount{},
		totalInWindow: 0,
	}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{})
	out, err := tool.Execute(ctx, alertCategoriesDraftInput{})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	prop := out.(*CategoryProposal)
	if prop.WindowDays != inboxCategorizationDefaultWindowDays {
		t.Errorf("WindowDays = %d, want %d", prop.WindowDays, inboxCategorizationDefaultWindowDays)
	}
}

// TestDraftAlertCategories_NoData proves an empty window
// surfaces as Status="no_data" and HasEnoughHistory=false.
func TestDraftAlertCategories_NoData(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{
		counts:        nil,
		totalInWindow: 0,
		minRequired:   10,
	}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{})
	out, err := tool.Execute(ctx, alertCategoriesDraftInput{})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	prop := out.(*CategoryProposal)
	if prop.Status != "no_data" {
		t.Errorf("Status = %q, want no_data", prop.Status)
	}
	if prop.HasEnoughHistory {
		t.Error("HasEnoughHistory = true, want false")
	}
}

// TestDraftAlertCategories_HasEnoughHistoryFalse proves that
// when sample_size < min_required, the flag flips false even
// though Status remains "ok".
func TestDraftAlertCategories_HasEnoughHistoryFalse(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{
		counts: []CategoryCount{
			{Label: "battery", Count: 3, SampleRuleIDs: []int64{10}},
		},
		totalInWindow: 3,
		minRequired:   10,
	}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{})
	out, err := tool.Execute(ctx, alertCategoriesDraftInput{})
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	prop := out.(*CategoryProposal)
	if prop.Status != "ok" {
		t.Errorf("Status = %q, want ok", prop.Status)
	}
	if prop.HasEnoughHistory {
		t.Error("HasEnoughHistory = true, want false")
	}
}

// TestDraftAlertCategories_LoadError proves a port error
// propagates verbatim to the dispatcher (no swallow).
func TestDraftAlertCategories_LoadError(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{loadErr: errors.New("db down")}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{})
	_, err := tool.Execute(ctx, alertCategoriesDraftInput{})
	if err == nil || !strings.Contains(err.Error(), "db down") {
		t.Fatalf("Execute err = %v, want wrapping db down", err)
	}
}

// TestDraftAlertCategories_NilSourceErrorsAtExecute proves
// the tool surfaces a clear wiring error when the source port
// is nil (defence in depth — the registrar panics at boot).
func TestDraftAlertCategories_NilSourceErrorsAtExecute(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: nil}
	_, err := tool.Execute(context.Background(), alertCategoriesDraftInput{})
	if err == nil || !strings.Contains(err.Error(), "no InboxCategorizationSource wired") {
		t.Fatalf("Execute err = %v, want wiring error", err)
	}
}

// TestDraftAlertCategories_MissingScopeRefused proves Execute
// hard-fails when no scope has been installed on ctx (AI-06 /
// SEC-11: the AI handler is the only sanctioned caller and ALWAYS
// installs a scope; an absent scope means the dispatcher was
// invoked from an unintended path, so the tool must refuse rather
// than silently defaulting to "all vehicles").
func TestDraftAlertCategories_MissingScopeRefused(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{counts: []CategoryCount{{Label: "battery", Count: 5}}, totalInWindow: 5}
	tool := &draftAlertCategories{source: stub}
	_, err := tool.Execute(context.Background(), alertCategoriesDraftInput{})
	if err == nil || !strings.Contains(err.Error(), "no in-scope inbox window installed") {
		t.Fatalf("Execute err = %v, want missing-scope refusal", err)
	}
	if len(stub.loadFilters) != 0 {
		t.Fatalf("LoadCategoryCounts was called %d times, want 0 (refused before touching the source)", len(stub.loadFilters))
	}
}

// TestDraftAlertCategories_RejectsCrossVehicleToolCall is the
// negative cross-vehicle-leakage test (AI-06 / SEC-11): the AI
// handler installs vehicle_id=7 as the in-scope window (mirroring
// what a real request for vehicle 7's inbox would install), but
// the LLM's tool call asks for vehicle_id=99 — e.g. because a
// prompt-injection payload embedded in a notification title told
// it to "categorize vehicle 99 instead". Execute MUST refuse the
// call and MUST NOT touch the source, so vehicle 99's notification
// data can never be read into vehicle 7's response.
func TestDraftAlertCategories_RejectsCrossVehicleToolCall(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{
		counts:        []CategoryCount{{Label: "battery", Count: 99, SampleRuleIDs: []int64{1}}},
		totalInWindow: 99,
	}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{VehicleID: 7})
	otherVehicleID := int64(99)
	_, err := tool.Execute(ctx, alertCategoriesDraftInput{VehicleID: &otherVehicleID})
	if err == nil {
		t.Fatal("Execute err = nil, want cross-vehicle scope refusal")
	}
	if !strings.Contains(err.Error(), "requested vehicle_id 99 does not match in-scope vehicle_id 7") {
		t.Fatalf("Execute err = %v, want explicit vehicle_id mismatch message", err)
	}
	if len(stub.loadFilters) != 0 {
		t.Fatalf("LoadCategoryCounts was called %d times, want 0 (refused before touching the source — vehicle 99's data must never load into vehicle 7's response)", len(stub.loadFilters))
	}
}

// TestDraftAlertCategories_RejectsFleetScopeEscape proves the
// inverse cross-entity leak: the handler scoped the request to
// vehicle_id=0 (all vehicles are OUT of scope for a single-vehicle
// call is not the case here — rather, the caller's actual request
// carried NO vehicle_id, but the LLM tool call supplies one). A
// hallucinated/injected vehicle_id must be refused even when the
// installed scope is the "all vehicles" sentinel, because the
// in-scope window the handler installed is the source of truth,
// not whatever the model decides to send.
func TestDraftAlertCategories_RejectsFleetScopeEscape(t *testing.T) {
	t.Parallel()
	stub := &stubInboxCategorizationSource{counts: []CategoryCount{{Label: "battery", Count: 5}}, totalInWindow: 5}
	tool := &draftAlertCategories{source: stub}
	ctx := WithScopedInboxCategorizationWindow(context.Background(), ScopedInboxCategorizationWindow{VehicleID: 0})
	someVehicleID := int64(3)
	_, err := tool.Execute(ctx, alertCategoriesDraftInput{VehicleID: &someVehicleID})
	if err == nil || !strings.Contains(err.Error(), "requested vehicle_id 3 does not match in-scope vehicle_id 0") {
		t.Fatalf("Execute err = %v, want vehicle_id mismatch refusal", err)
	}
	if len(stub.loadFilters) != 0 {
		t.Fatalf("LoadCategoryCounts was called %d times, want 0", len(stub.loadFilters))
	}
}

// TestDraftAlertCategories_RejectsBadVehicleID proves the
// validator rejects a vehicle_id < 1.
func TestDraftAlertCategories_RejectsBadVehicleID(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: &stubInboxCategorizationSource{}}
	_, err := tool.Validate(json.RawMessage(`{"vehicle_id": 0}`))
	if err == nil {
		t.Fatal("Validate err = nil, want validation failure")
	}
}

// TestDraftAlertCategories_RejectsBadWindow proves the
// validator rejects a window_days outside [1, 90].
func TestDraftAlertCategories_RejectsBadWindow(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: &stubInboxCategorizationSource{}}
	_, err := tool.Validate(json.RawMessage(`{"window_days": 0}`))
	if err == nil {
		t.Fatal("Validate(window_days=0) err = nil, want failure")
	}
	_, err = tool.Validate(json.RawMessage(`{"window_days": 365}`))
	if err == nil {
		t.Fatal("Validate(window_days=365) err = nil, want failure")
	}
}

// TestDraftAlertCategories_RejectsBadSeverity proves the
// validator rejects an unknown severity.
func TestDraftAlertCategories_RejectsBadSeverity(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: &stubInboxCategorizationSource{}}
	_, err := tool.Validate(json.RawMessage(`{"severities": ["bogus"]}`))
	if err == nil {
		t.Fatal("Validate err = nil, want validation failure")
	}
}

// TestDraftAlertCategories_AllowsAllOptionalsOmitted proves
// that an entirely empty input is valid (the entire-inbox
// default).
func TestDraftAlertCategories_AllowsAllOptionalsOmitted(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: &stubInboxCategorizationSource{}}
	if _, err := tool.Validate(json.RawMessage(`{}`)); err != nil {
		t.Fatalf("Validate({}) err = %v, want nil", err)
	}
}

// TestDraftAlertCategories_ContractMetadata pins the
// load-bearing contract surface (Name, Mutates, Description,
// schema validity).
func TestDraftAlertCategories_ContractMetadata(t *testing.T) {
	t.Parallel()
	tool := &draftAlertCategories{source: &stubInboxCategorizationSource{}}
	if tool.Name() != "draft_alert_categories" {
		t.Errorf("Name = %q, want draft_alert_categories", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates = true, want false (PROPOSE-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope = %q, want empty", tool.RequiredScope())
	}
	if d := tool.Description(); d == "" || !strings.Contains(d, "PROPOSE-ONLY") {
		t.Errorf("Description missing PROPOSE-ONLY marker; got=%q", d)
	}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema empty")
	}
	var doc map[string]any
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("InputSchema not valid JSON: %v", err)
	}
}

// ---------------------------------------------------------------------------
// validate_alert_category
// ---------------------------------------------------------------------------

// TestValidateAlertCategory_AcceptsKnownLabel proves a single
// known label returns OK=true with no invalid_labels.
func TestValidateAlertCategory_AcceptsKnownLabel(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	parsed, err := tool.Validate(json.RawMessage(`{"label": "battery"}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), parsed)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	resp := out.(*alertCategoryValidateOutput)
	if !resp.OK {
		t.Errorf("OK = false, want true; invalid=%v", resp.InvalidLabels)
	}
	if len(resp.InvalidLabels) != 0 {
		t.Errorf("InvalidLabels = %v, want empty", resp.InvalidLabels)
	}
	if !reflect.DeepEqual(resp.AllowedTaxonomy, InboxCategoryLabels) {
		t.Errorf("AllowedTaxonomy = %v, want InboxCategoryLabels", resp.AllowedTaxonomy)
	}
}

// TestValidateAlertCategory_RejectsUnknownLabel proves an
// unknown single label returns OK=false and surfaces the
// rejected label.
func TestValidateAlertCategory_RejectsUnknownLabel(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	parsed, err := tool.Validate(json.RawMessage(`{"label": "made_up_category"}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, _ := tool.Execute(context.Background(), parsed)
	resp := out.(*alertCategoryValidateOutput)
	if resp.OK {
		t.Error("OK = true, want false")
	}
	if !reflect.DeepEqual(resp.InvalidLabels, []string{"made_up_category"}) {
		t.Errorf("InvalidLabels = %v, want [made_up_category]", resp.InvalidLabels)
	}
}

// TestValidateAlertCategory_BatchMixed proves a mixed batch
// surfaces only the invalid labels in InvalidLabels and flips
// OK to false.
func TestValidateAlertCategory_BatchMixed(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	parsed, err := tool.Validate(json.RawMessage(`{"labels": ["battery", "made_up", "charging", "also_bogus"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, _ := tool.Execute(context.Background(), parsed)
	resp := out.(*alertCategoryValidateOutput)
	if resp.OK {
		t.Error("OK = true, want false")
	}
	if !reflect.DeepEqual(resp.InvalidLabels, []string{"made_up", "also_bogus"}) {
		t.Errorf("InvalidLabels = %v, want [made_up also_bogus]", resp.InvalidLabels)
	}
}

// TestValidateAlertCategory_RejectsBothEmpty proves that
// passing neither label nor labels surfaces a validation error
// (the dispatcher surfaces it back to the LLM as a tool
// validation error).
func TestValidateAlertCategory_RejectsBothEmpty(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	_, err := tool.Validate(json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("Validate({}) err = nil, want failure")
	}
}

// TestValidateAlertCategory_AcceptsCaseAndWhitespace proves
// the label is normalised so the LLM doesn't have to be
// pixel-perfect about case.
func TestValidateAlertCategory_AcceptsCaseAndWhitespace(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	parsed, _ := tool.Validate(json.RawMessage(`{"label": "  Battery "}`))
	out, _ := tool.Execute(context.Background(), parsed)
	resp := out.(*alertCategoryValidateOutput)
	if !resp.OK {
		t.Errorf("OK = false, want true; invalid=%v", resp.InvalidLabels)
	}
}

// TestValidateAlertCategory_ContractMetadata pins the
// load-bearing contract surface.
func TestValidateAlertCategory_ContractMetadata(t *testing.T) {
	t.Parallel()
	tool := &validateAlertCategory{}
	if tool.Name() != "validate_alert_category" {
		t.Errorf("Name = %q, want validate_alert_category", tool.Name())
	}
	if tool.Mutates() {
		t.Error("Mutates = true, want false (PROPOSE-only)")
	}
	if d := tool.Description(); d == "" || !strings.Contains(d, "PROPOSE-ONLY") {
		t.Errorf("Description missing PROPOSE-ONLY marker; got=%q", d)
	}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema empty")
	}
	var doc map[string]any
	if err := json.Unmarshal(schema, &doc); err != nil {
		t.Fatalf("InputSchema not valid JSON: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TestRegisterInboxAutoCategorizationTools proves the
// registrar installs both NEW tools on the registry.
func TestRegisterInboxAutoCategorizationTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterInboxAutoCategorizationTools(r, InboxAutoCategorizationSources{
		Source: &stubInboxCategorizationSource{},
	})
	for _, name := range []string{"draft_alert_categories", "validate_alert_category"} {
		got, ok := r.Get(name)
		if !ok {
			t.Errorf("Get(%q) not found", name)
			continue
		}
		if got.Name() != name {
			t.Errorf("Get(%q).Name() = %q", name, got.Name())
		}
	}
}
