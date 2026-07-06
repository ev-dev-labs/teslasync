package automation

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Status vocabulary
// ─────────────────────────────────────────────────────────────────────────────

// TestHistoryStatus_Valid pins the known-status set. Valid must accept exactly
// the eight canonical values and reject anything else (empty, typos, casing).
func TestHistoryStatus_Valid(t *testing.T) {
	tests := []struct {
		name   string
		status HistoryStatus
		want   bool
	}{
		{"running", HistoryStatusRunning, true},
		{"success", HistoryStatusSuccess, true},
		{"partial", HistoryStatusPartial, true},
		{"failed", HistoryStatusFailed, true},
		{"skipped", HistoryStatusSkipped, true},
		{"cancelled", HistoryStatusCancelled, true},
		{"test", HistoryStatusTest, true},
		{"undo", HistoryStatusUndo, true},
		{"empty", HistoryStatus(""), false},
		{"unknown", HistoryStatus("bogus"), false},
		{"wrong case", HistoryStatus("Running"), false},
		{"whitespace", HistoryStatus(" running"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.status.Valid(); got != tt.want {
				t.Fatalf("HistoryStatus(%q).Valid() = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

// TestHistoryStatus_IsTerminal pins terminal semantics: "running" is the only
// non-terminal known status; every other known status is terminal; unknown or
// empty values are never terminal (a malformed row must not look "done").
func TestHistoryStatus_IsTerminal(t *testing.T) {
	tests := []struct {
		status HistoryStatus
		want   bool
	}{
		{HistoryStatusRunning, false},
		{HistoryStatusSuccess, true},
		{HistoryStatusPartial, true},
		{HistoryStatusFailed, true},
		{HistoryStatusSkipped, true},
		{HistoryStatusCancelled, true},
		{HistoryStatusTest, true},
		{HistoryStatusUndo, true},
		{HistoryStatus(""), false},
		{HistoryStatus("bogus"), false},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			if got := tt.status.IsTerminal(); got != tt.want {
				t.Fatalf("HistoryStatus(%q).IsTerminal() = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

// TestAllHistoryStatuses_Parity pins parity with the frontend
// AutomationHistoryStatus union (web/src/api/types.ts). If the Go vocabulary and
// the TypeScript union drift apart, this test documents the canonical set so the
// mismatch is caught in code review rather than at runtime.
func TestAllHistoryStatuses_Parity(t *testing.T) {
	// The exact set the frontend union declares.
	frontend := []string{"running", "success", "partial", "failed", "skipped", "cancelled", "test", "undo"}

	all := AllHistoryStatuses()
	if len(all) != len(frontend) {
		t.Fatalf("AllHistoryStatuses() has %d entries, frontend union has %d", len(all), len(frontend))
	}

	got := make(map[string]bool, len(all))
	for _, s := range all {
		if !s.Valid() {
			t.Errorf("AllHistoryStatuses() returned %q which is not Valid()", s)
		}
		if got[string(s)] {
			t.Errorf("AllHistoryStatuses() contains duplicate %q", s)
		}
		got[string(s)] = true
	}
	for _, f := range frontend {
		if !got[f] {
			t.Errorf("frontend status %q missing from AllHistoryStatuses()", f)
		}
	}
}

// TestAllHistoryStatuses_ReturnsFreshSlice ensures callers cannot mutate shared
// package state through the returned slice.
func TestAllHistoryStatuses_ReturnsFreshSlice(t *testing.T) {
	a := AllHistoryStatuses()
	if len(a) == 0 {
		t.Fatal("AllHistoryStatuses() returned empty slice")
	}
	a[0] = HistoryStatus("mutated")
	b := AllHistoryStatuses()
	if b[0] != HistoryStatusRunning {
		t.Fatalf("AllHistoryStatuses() shares backing state: second call returned %q at index 0", b[0])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AutomationHistory predicates
// ─────────────────────────────────────────────────────────────────────────────

// TestAutomationHistory_StatusPredicates covers StatusValue, IsRunning and
// IsTerminal across every status plus the nil receiver contract.
func TestAutomationHistory_StatusPredicates(t *testing.T) {
	tests := []struct {
		name         string
		status       string
		wantRunning  bool
		wantTerminal bool
	}{
		{"running", "running", true, false},
		{"success", "success", false, true},
		{"partial", "partial", false, true},
		{"failed", "failed", false, true},
		{"skipped", "skipped", false, true},
		{"cancelled", "cancelled", false, true},
		{"test", "test", false, true},
		{"undo", "undo", false, true},
		{"unknown", "weird", false, false},
		{"empty", "", false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AutomationHistory{Status: tt.status}
			if got := h.StatusValue(); got != HistoryStatus(tt.status) {
				t.Errorf("StatusValue() = %q, want %q", got, tt.status)
			}
			if got := h.IsRunning(); got != tt.wantRunning {
				t.Errorf("IsRunning() = %v, want %v", got, tt.wantRunning)
			}
			if got := h.IsTerminal(); got != tt.wantTerminal {
				t.Errorf("IsTerminal() = %v, want %v", got, tt.wantTerminal)
			}
		})
	}
}

// TestAutomationHistory_NilReceiver pins the nil-safe contract for every
// predicate; callers routinely receive (nil, nil) from repository lookups.
func TestAutomationHistory_NilReceiver(t *testing.T) {
	var h *AutomationHistory
	if got := h.StatusValue(); got != HistoryStatus("") {
		t.Errorf("nil StatusValue() = %q, want empty", got)
	}
	if h.IsRunning() {
		t.Error("nil IsRunning() = true, want false")
	}
	if h.IsTerminal() {
		t.Error("nil IsTerminal() = true, want false")
	}
	if h.IsComplete() {
		t.Error("nil IsComplete() = true, want false")
	}
	if h.IsFleetWide() {
		t.Error("nil IsFleetWide() = true, want false")
	}
	if got := h.Duration(); got != 0 {
		t.Errorf("nil Duration() = %v, want 0", got)
	}
	if got := h.ActionSuccessRate(); got != 0 {
		t.Errorf("nil ActionSuccessRate() = %v, want 0", got)
	}
}

// TestAutomationHistory_IsComplete distinguishes completion (CompletedAt set)
// from terminal status — a record can be terminal in status yet only "complete"
// once the repository stamps completed_at.
func TestAutomationHistory_IsComplete(t *testing.T) {
	now := time.Now().UTC()
	if (&AutomationHistory{}).IsComplete() {
		t.Error("IsComplete() = true for record with nil CompletedAt")
	}
	if !(&AutomationHistory{CompletedAt: &now}).IsComplete() {
		t.Error("IsComplete() = false for record with CompletedAt set")
	}
}

// TestAutomationHistory_IsFleetWide pins vehicle-scoping semantics: a nil
// VehicleID means the execution is not tied to a specific vehicle.
func TestAutomationHistory_IsFleetWide(t *testing.T) {
	vid := int64(42)
	if !(&AutomationHistory{VehicleID: nil}).IsFleetWide() {
		t.Error("IsFleetWide() = false for nil VehicleID")
	}
	if (&AutomationHistory{VehicleID: &vid}).IsFleetWide() {
		t.Error("IsFleetWide() = true for a specific vehicle")
	}
}

// TestAutomationHistory_Duration covers DurationMs precedence, the
// CompletedAt-TriggeredAt fallback, and the zero/negative guards.
func TestAutomationHistory_Duration(t *testing.T) {
	base := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)
	ms := func(v int) *int { return &v }
	tm := func(t time.Time) *time.Time { return &t }

	tests := []struct {
		name string
		hist AutomationHistory
		want time.Duration
	}{
		{
			name: "duration_ms authoritative",
			hist: AutomationHistory{DurationMs: ms(1500)},
			want: 1500 * time.Millisecond,
		},
		{
			name: "duration_ms wins over completed_at",
			hist: AutomationHistory{DurationMs: ms(2000), TriggeredAt: base, CompletedAt: tm(base.Add(9 * time.Second))},
			want: 2000 * time.Millisecond,
		},
		{
			name: "zero duration_ms",
			hist: AutomationHistory{DurationMs: ms(0)},
			want: 0,
		},
		{
			name: "negative duration_ms guarded",
			hist: AutomationHistory{DurationMs: ms(-42)},
			want: 0,
		},
		{
			name: "fallback to completed_at",
			hist: AutomationHistory{TriggeredAt: base, CompletedAt: tm(base.Add(5 * time.Second))},
			want: 5 * time.Second,
		},
		{
			name: "fallback negative span guarded",
			hist: AutomationHistory{TriggeredAt: base, CompletedAt: tm(base.Add(-3 * time.Second))},
			want: 0,
		},
		{
			name: "no duration data",
			hist: AutomationHistory{TriggeredAt: base},
			want: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.hist.Duration(); got != tt.want {
				t.Fatalf("Duration() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestAutomationHistory_ActionSuccessRate covers the happy path, the
// division-by-zero guard, and the malformed-row clamps at both ends.
func TestAutomationHistory_ActionSuccessRate(t *testing.T) {
	tests := []struct {
		name      string
		total     int
		succeeded int
		want      float64
	}{
		{"half", 4, 2, 0.5},
		{"all", 4, 4, 1.0},
		{"none", 4, 0, 0.0},
		{"zero total guards div-by-zero", 0, 0, 0.0},
		{"negative total guarded", -3, 2, 0.0},
		{"succeeded above total clamps to 1", 4, 5, 1.0},
		{"negative succeeded clamps to 0", 4, -1, 0.0},
		{"single", 1, 1, 1.0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AutomationHistory{ActionsTotal: tt.total, ActionsSucceeded: tt.succeeded}
			if got := h.ActionSuccessRate(); got != tt.want {
				t.Fatalf("ActionSuccessRate(total=%d, ok=%d) = %v, want %v", tt.total, tt.succeeded, got, tt.want)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// AutomationVariable
// ─────────────────────────────────────────────────────────────────────────────

// TestAutomationVariable_IsGlobal pins scope semantics and the nil-safe
// contract: a nil VehicleID is a global (fleet-wide) variable.
func TestAutomationVariable_IsGlobal(t *testing.T) {
	vid := int64(7)
	if !(&AutomationVariable{VehicleID: nil}).IsGlobal() {
		t.Error("IsGlobal() = false for nil VehicleID")
	}
	if (&AutomationVariable{VehicleID: &vid}).IsGlobal() {
		t.Error("IsGlobal() = true for a vehicle-scoped variable")
	}
	var v *AutomationVariable
	if v.IsGlobal() {
		t.Error("nil IsGlobal() = true, want false")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON serialization contract
// ─────────────────────────────────────────────────────────────────────────────

// marshalToMap marshals v and decodes the result into a map of raw JSON values
// so individual keys and their null-ness can be asserted.
func marshalToMap(t *testing.T, v interface{}) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal into map: %v (payload=%s)", err, b)
	}
	return m
}

// TestAutomationHistory_JSONContract_NullableKeysPresent pins the null contract:
// none of the nullable fields carry omitempty, so a fully-empty record must
// still emit every key with an explicit JSON null. The frontend interface types
// them as `T | null`, so a missing key would break the contract.
func TestAutomationHistory_JSONContract_NullableKeysPresent(t *testing.T) {
	m := marshalToMap(t, AutomationHistory{})

	nullableKeys := []string{
		"vehicle_id", "completed_at", "duration_ms", "error", "fsm_state",
		"trigger_snapshot", "conditions_snapshot", "actions_executed",
	}
	for _, k := range nullableKeys {
		raw, ok := m[k]
		if !ok {
			t.Errorf("key %q missing from JSON of zero-value record (omitempty leaked in?)", k)
			continue
		}
		if strings.TrimSpace(string(raw)) != "null" {
			t.Errorf("key %q = %s, want null for zero-value record", k, raw)
		}
	}
}

// TestAutomationHistory_JSONContract_Populated verifies snake_case key names and
// value shapes for a fully-populated record, including json.RawMessage
// passthrough of embedded objects/arrays.
func TestAutomationHistory_JSONContract_Populated(t *testing.T) {
	vid := int64(9)
	dur := 1234
	errMsg := "2/3 actions failed"
	fsm := "driving"
	completed := time.Date(2026, 7, 5, 12, 5, 0, 0, time.UTC)
	triggered := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)
	created := time.Date(2026, 7, 5, 12, 5, 1, 0, time.UTC)

	h := AutomationHistory{
		ID:                 100,
		AutomationID:       42,
		AutomationName:     "Nightly precondition",
		VehicleID:          &vid,
		TriggeredAt:        triggered,
		CompletedAt:        &completed,
		DurationMs:         &dur,
		TriggerType:        "schedule",
		TriggerSnapshot:    json.RawMessage(`{"cron":"0 7 * * *"}`),
		ConditionsMet:      true,
		ConditionsSnapshot: json.RawMessage(`[{"kind":"time_window","met":true}]`),
		ActionsExecuted:    json.RawMessage(`[{"type":"command","ok":true}]`),
		ActionsTotal:       3,
		ActionsSucceeded:   1,
		ActionsFailed:      2,
		Status:             string(HistoryStatusPartial),
		Error:              &errMsg,
		FSMState:           &fsm,
		CreatedAt:          created,
	}

	m := marshalToMap(t, h)

	// Every documented snake_case key must be present.
	wantKeys := []string{
		"id", "automation_id", "automation_name", "vehicle_id", "triggered_at",
		"completed_at", "duration_ms", "trigger_type", "trigger_snapshot",
		"conditions_met", "conditions_snapshot", "actions_executed",
		"actions_total", "actions_succeeded", "actions_failed", "status",
		"error", "fsm_state", "created_at",
	}
	for _, k := range wantKeys {
		if _, ok := m[k]; !ok {
			t.Errorf("populated record JSON missing key %q", k)
		}
	}
	if len(m) != len(wantKeys) {
		t.Errorf("JSON has %d keys, want %d (unexpected extra/missing key)", len(m), len(wantKeys))
	}

	// Spot-check representative scalar values.
	if got := string(m["status"]); got != `"partial"` {
		t.Errorf("status = %s, want \"partial\"", got)
	}
	if got := string(m["vehicle_id"]); got != "9" {
		t.Errorf("vehicle_id = %s, want 9", got)
	}
	if got := string(m["conditions_met"]); got != "true" {
		t.Errorf("conditions_met = %s, want true", got)
	}
	if got := string(m["actions_total"]); got != "3" {
		t.Errorf("actions_total = %s, want 3", got)
	}

	// RawMessage must pass through verbatim (order-insensitive compare via re-decode).
	assertJSONEqual(t, "trigger_snapshot", m["trigger_snapshot"], `{"cron":"0 7 * * *"}`)
	assertJSONEqual(t, "conditions_snapshot", m["conditions_snapshot"], `[{"kind":"time_window","met":true}]`)
}

// TestAutomationHistory_JSONRoundTrip ensures a populated record survives a
// marshal→unmarshal cycle with all fields (including pointers, times and
// RawMessage bodies) preserved.
func TestAutomationHistory_JSONRoundTrip(t *testing.T) {
	vid := int64(9)
	dur := 1234
	errMsg := "boom"
	fsm := "charging"
	triggered := time.Date(2026, 7, 5, 12, 0, 0, 123456789, time.UTC)
	completed := time.Date(2026, 7, 5, 12, 5, 0, 0, time.UTC)
	created := time.Date(2026, 7, 5, 12, 5, 1, 0, time.UTC)

	orig := AutomationHistory{
		ID:                 100,
		AutomationID:       42,
		AutomationName:     "Round trip",
		VehicleID:          &vid,
		TriggeredAt:        triggered,
		CompletedAt:        &completed,
		DurationMs:         &dur,
		TriggerType:        "event",
		TriggerSnapshot:    json.RawMessage(`{"a":1}`),
		ConditionsMet:      true,
		ConditionsSnapshot: json.RawMessage(`{"b":2}`),
		ActionsExecuted:    json.RawMessage(`[]`),
		ActionsTotal:       3,
		ActionsSucceeded:   3,
		ActionsFailed:      0,
		Status:             string(HistoryStatusSuccess),
		Error:              &errMsg,
		FSMState:           &fsm,
		CreatedAt:          created,
	}

	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got AutomationHistory
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.ID != orig.ID || got.AutomationID != orig.AutomationID || got.AutomationName != orig.AutomationName {
		t.Errorf("scalar identity fields differ: got %+v", got)
	}
	if got.VehicleID == nil || *got.VehicleID != *orig.VehicleID {
		t.Errorf("VehicleID = %v, want %d", got.VehicleID, *orig.VehicleID)
	}
	if got.DurationMs == nil || *got.DurationMs != *orig.DurationMs {
		t.Errorf("DurationMs = %v, want %d", got.DurationMs, *orig.DurationMs)
	}
	if got.Error == nil || *got.Error != *orig.Error {
		t.Errorf("Error = %v, want %q", got.Error, *orig.Error)
	}
	if got.FSMState == nil || *got.FSMState != *orig.FSMState {
		t.Errorf("FSMState = %v, want %q", got.FSMState, *orig.FSMState)
	}
	if !got.TriggeredAt.Equal(orig.TriggeredAt) {
		t.Errorf("TriggeredAt = %v, want %v", got.TriggeredAt, orig.TriggeredAt)
	}
	if got.CompletedAt == nil || !got.CompletedAt.Equal(*orig.CompletedAt) {
		t.Errorf("CompletedAt = %v, want %v", got.CompletedAt, orig.CompletedAt)
	}
	if got.ConditionsMet != orig.ConditionsMet {
		t.Errorf("ConditionsMet = %v, want %v", got.ConditionsMet, orig.ConditionsMet)
	}
	if got.ActionsTotal != orig.ActionsTotal || got.ActionsSucceeded != orig.ActionsSucceeded || got.ActionsFailed != orig.ActionsFailed {
		t.Errorf("action counts differ: got total=%d ok=%d fail=%d", got.ActionsTotal, got.ActionsSucceeded, got.ActionsFailed)
	}
	if got.Status != orig.Status {
		t.Errorf("Status = %q, want %q", got.Status, orig.Status)
	}
	assertJSONEqual(t, "TriggerSnapshot", got.TriggerSnapshot, string(orig.TriggerSnapshot))
	assertJSONEqual(t, "ConditionsSnapshot", got.ConditionsSnapshot, string(orig.ConditionsSnapshot))
	assertJSONEqual(t, "ActionsExecuted", got.ActionsExecuted, string(orig.ActionsExecuted))
}

// TestAutomationVariable_JSONContract covers key presence, snake_case naming,
// the null contract for a nil VehicleID, and a populated round-trip.
func TestAutomationVariable_JSONContract(t *testing.T) {
	// Zero value: vehicle_id present and null.
	m := marshalToMap(t, AutomationVariable{})
	wantKeys := []string{"id", "key", "value", "vehicle_id", "updated_at"}
	for _, k := range wantKeys {
		if _, ok := m[k]; !ok {
			t.Errorf("AutomationVariable JSON missing key %q", k)
		}
	}
	if len(m) != len(wantKeys) {
		t.Errorf("AutomationVariable JSON has %d keys, want %d", len(m), len(wantKeys))
	}
	if got := strings.TrimSpace(string(m["vehicle_id"])); got != "null" {
		t.Errorf("vehicle_id = %s, want null for nil VehicleID", got)
	}

	// Populated round-trip.
	vid := int64(3)
	updated := time.Date(2026, 7, 5, 8, 30, 0, 0, time.UTC)
	orig := AutomationVariable{ID: 1, Key: "last_charge_soc", Value: "80", VehicleID: &vid, UpdatedAt: updated}
	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got AutomationVariable
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ID != orig.ID || got.Key != orig.Key || got.Value != orig.Value {
		t.Errorf("scalar fields differ: got %+v", got)
	}
	if got.VehicleID == nil || *got.VehicleID != vid {
		t.Errorf("VehicleID = %v, want %d", got.VehicleID, vid)
	}
	if !got.UpdatedAt.Equal(updated) {
		t.Errorf("UpdatedAt = %v, want %v", got.UpdatedAt, updated)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Struct-tag contract (persistence + transport)
// ─────────────────────────────────────────────────────────────────────────────

// TestAutomationHistory_StructTags asserts every field's json and db tags match
// the repository scan columns (internal/database/automation/history_repo.go) and
// the frontend interface. Being a DTO leaf (ADR-006) this package cannot import
// the repo, so the expected column set is pinned here as the contract.
func TestAutomationHistory_StructTags(t *testing.T) {
	// name -> (json tag, db tag)
	want := map[string][2]string{
		"ID":                 {"id", "id"},
		"AutomationID":       {"automation_id", "automation_id"},
		"AutomationName":     {"automation_name", "automation_name"},
		"VehicleID":          {"vehicle_id", "vehicle_id"},
		"TriggeredAt":        {"triggered_at", "triggered_at"},
		"CompletedAt":        {"completed_at", "completed_at"},
		"DurationMs":         {"duration_ms", "duration_ms"},
		"TriggerType":        {"trigger_type", "trigger_type"},
		"TriggerSnapshot":    {"trigger_snapshot", "trigger_snapshot"},
		"ConditionsMet":      {"conditions_met", "conditions_met"},
		"ConditionsSnapshot": {"conditions_snapshot", "conditions_snapshot"},
		"ActionsExecuted":    {"actions_executed", "actions_executed"},
		"ActionsTotal":       {"actions_total", "actions_total"},
		"ActionsSucceeded":   {"actions_succeeded", "actions_succeeded"},
		"ActionsFailed":      {"actions_failed", "actions_failed"},
		"Status":             {"status", "status"},
		"Error":              {"error", "error"},
		"FSMState":           {"fsm_state", "fsm_state"},
		"CreatedAt":          {"created_at", "created_at"},
	}
	assertStructTags(t, reflect.TypeOf(AutomationHistory{}), want)
}

// TestAutomationVariable_StructTags asserts the variable DTO tags match the
// automation_variables scan columns and the transport contract.
func TestAutomationVariable_StructTags(t *testing.T) {
	want := map[string][2]string{
		"ID":        {"id", "id"},
		"Key":       {"key", "key"},
		"Value":     {"value", "value"},
		"VehicleID": {"vehicle_id", "vehicle_id"},
		"UpdatedAt": {"updated_at", "updated_at"},
	}
	assertStructTags(t, reflect.TypeOf(AutomationVariable{}), want)
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

func assertStructTags(t *testing.T, typ reflect.Type, want map[string][2]string) {
	t.Helper()
	if typ.NumField() != len(want) {
		t.Fatalf("%s has %d fields, expected %d — update the tag contract", typ.Name(), typ.NumField(), len(want))
	}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		exp, ok := want[f.Name]
		if !ok {
			t.Errorf("%s.%s has no expected tag entry", typ.Name(), f.Name)
			continue
		}
		if got := tagName(f.Tag.Get("json")); got != exp[0] {
			t.Errorf("%s.%s json tag = %q, want %q", typ.Name(), f.Name, got, exp[0])
		}
		if got := tagName(f.Tag.Get("db")); got != exp[1] {
			t.Errorf("%s.%s db tag = %q, want %q", typ.Name(), f.Name, got, exp[1])
		}
	}
}

// tagName returns the bare tag name, stripping any options such as ",omitempty".
func tagName(tag string) string {
	if i := strings.IndexByte(tag, ','); i >= 0 {
		return tag[:i]
	}
	return tag
}

// assertJSONEqual compares two JSON payloads for semantic (order-insensitive)
// equality.
func assertJSONEqual(t *testing.T, label string, got json.RawMessage, want string) {
	t.Helper()
	var gv, wv interface{}
	if err := json.Unmarshal(got, &gv); err != nil {
		t.Fatalf("%s: got is not valid JSON: %v (%s)", label, err, got)
	}
	if err := json.Unmarshal([]byte(want), &wv); err != nil {
		t.Fatalf("%s: want is not valid JSON: %v", label, err)
	}
	if !reflect.DeepEqual(gv, wv) {
		t.Errorf("%s JSON mismatch:\n got = %s\nwant = %s", label, got, want)
	}
}
