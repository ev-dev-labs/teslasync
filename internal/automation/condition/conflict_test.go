package condition

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ── Helpers ─────────────────────────────────────────────

func ptr[T any](v T) *T { return &v }

func makeAutomation(id int64, name string, vehicleID *int64, triggerType string, triggerConfig, actions string) *models.AutomationFull {
	var triggerMap map[string]any
	_ = json.Unmarshal([]byte(triggerConfig), &triggerMap)

	var triggers []any
	if triggerMap != nil {
		triggers = []any{triggerMap}
	}

	var actionSlice []any
	_ = json.Unmarshal([]byte(actions), &actionSlice)

	return &models.AutomationFull{
		Automation: models.Automation{
			ID:        id,
			Name:      name,
			VehicleID: vehicleID,
			Enabled:   true,
		},
		Steps: []models.AutomationStep{
			{Kind: "trigger_" + triggerType},
		},
		Triggers: triggers,
		Actions:  actionSlice,
	}
}

// ── DetectConflicts Tests ───────────────────────────────

func TestDetectConflicts_NilCandidate(t *testing.T) {
	result := DetectConflicts(context.Background(), nil, []*models.AutomationFull{})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for nil candidate, got %d", len(result))
	}
}

func TestDetectConflicts_EmptyOthers(t *testing.T) {
	candidate := makeAutomation(1, "test", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)

	result := DetectConflicts(context.Background(), candidate, nil)
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for empty others, got %d", len(result))
	}
}

func TestDetectConflicts_NoActionsOnCandidate(t *testing.T) {
	candidate := makeAutomation(1, "test", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[]`)
	other := makeAutomation(2, "other", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for no-action candidate, got %d", len(result))
	}
}

func TestDetectConflicts_SkipsSelf(t *testing.T) {
	auto := makeAutomation(1, "test", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)

	// Same ID in others list — should be skipped.
	other := makeAutomation(1, "test", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), auto, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts when comparing with self, got %d", len(result))
	}
}

func TestDetectConflicts_SkipsDisabledAutomations(t *testing.T) {
	candidate := makeAutomation(1, "lock nightly", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)

	disabled := makeAutomation(2, "unlock nightly", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)
	disabled.Enabled = false

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{disabled})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for disabled other, got %d", len(result))
	}
}

func TestDetectConflicts_SkipsAutoDisabledAutomations(t *testing.T) {
	// AutoDisabled() is now derived from run history (always false until
	// the run-history table lands). This test is a placeholder until then.
	t.Skip("AutoDisabled is now a method derived from run history, not a settable field")
}

// ── Cron Trigger Conflicts ──────────────────────────────

func TestDetectConflicts_CronSameScheduleOppositeActions(t *testing.T) {
	candidate := makeAutomation(1, "lock at 10pm", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock at 10pm", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(result))
	}
	if result[0].AutomationID != 2 {
		t.Fatalf("expected conflict with ID 2, got %d", result[0].AutomationID)
	}
	if result[0].Severity != "warning" {
		t.Fatalf("expected severity 'warning', got %q", result[0].Severity)
	}
}

func TestDetectConflicts_CronDifferentSchedule_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock at 10pm", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock at 6am", nil, "cron",
		`{"cron_expr":"0 6 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for different cron schedules, got %d", len(result))
	}
}

func TestDetectConflicts_CronSameExprDifferentTimezone_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock UTC", nil, "cron",
		`{"cron_expr":"0 22 * * *","timezone":"America/New_York"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock UTC", nil, "cron",
		`{"cron_expr":"0 22 * * *","timezone":"America/Los_Angeles"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for same cron expr different timezone, got %d", len(result))
	}
}

func TestDetectConflicts_CronSameExprSameTimezone(t *testing.T) {
	candidate := makeAutomation(1, "lock", nil, "cron",
		`{"cron_expr":"0 22 * * *","timezone":"America/New_York"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock", nil, "cron",
		`{"cron_expr":"0 22 * * *","timezone":"America/New_York"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(result))
	}
}

func TestDetectConflicts_CronSameActions_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock1", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "lock2", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for same (non-opposite) commands, got %d", len(result))
	}
}

// ── Vehicle State Trigger Conflicts ─────────────────────

func TestDetectConflicts_VehicleState_SameEvent_OppositeActions(t *testing.T) {
	candidate := makeAutomation(1, "lock on park", nil, "vehicle_state",
		`{"event":"drive_ends"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on park", nil, "vehicle_state",
		`{"event":"drive_ends"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(result))
	}
}

func TestDetectConflicts_VehicleState_DifferentEvent_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock on park", nil, "vehicle_state",
		`{"event":"drive_ends"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on drive", nil, "vehicle_state",
		`{"event":"drive_starts"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for different events, got %d", len(result))
	}
}

func TestDetectConflicts_VehicleState_StateChangeWildcard(t *testing.T) {
	candidate := makeAutomation(1, "lock on any", nil, "vehicle_state",
		`{"event":"state_change"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on sleep", nil, "vehicle_state",
		`{"event":"goes_to_sleep"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict (state_change overlaps any event), got %d", len(result))
	}
}

func TestDetectConflicts_VehicleState_SameEventDifferentFromState_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock on online from asleep", nil, "vehicle_state",
		`{"event":"comes_online","from_state":"asleep"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on online from offline", nil, "vehicle_state",
		`{"event":"comes_online","from_state":"offline"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for mutually exclusive from_state, got %d", len(result))
	}
}

func TestDetectConflicts_VehicleState_SameEventOneFilteredOneNot(t *testing.T) {
	candidate := makeAutomation(1, "lock on sleep", nil, "vehicle_state",
		`{"event":"goes_to_sleep"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on sleep from online", nil, "vehicle_state",
		`{"event":"goes_to_sleep","from_state":"online"}`,
		`[{"command":"unlock"}]`)

	// One has from_state filter, other does not → they can overlap.
	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict (one unfiltered overlaps with filtered), got %d", len(result))
	}
}

// ── Geofence Trigger Conflicts ──────────────────────────

func TestDetectConflicts_Geofence_SameGeofenceSameEvent(t *testing.T) {
	candidate := makeAutomation(1, "lock on enter home", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on enter home", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(result))
	}
}

func TestDetectConflicts_Geofence_SameGeofenceDifferentEvent_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock on enter", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on leave", nil, "geofence",
		`{"geofence_id":5,"event":"leave"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for enter vs leave, got %d", len(result))
	}
}

func TestDetectConflicts_Geofence_BothEventOverlapsEnter(t *testing.T) {
	candidate := makeAutomation(1, "lock on both", nil, "geofence",
		`{"geofence_id":5,"event":"both"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock on enter", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict (both overlaps enter), got %d", len(result))
	}
}

func TestDetectConflicts_Geofence_DifferentGeofence_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock home", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock work", nil, "geofence",
		`{"geofence_id":10,"event":"enter"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for different geofences, got %d", len(result))
	}
}

// ── Vehicle Scope Tests ─────────────────────────────────

func TestDetectConflicts_DifferentVehicles_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "lock car1", ptr(int64(100)), "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock car2", ptr(int64(200)), "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for different vehicles, got %d", len(result))
	}
}

func TestDetectConflicts_GlobalVsSpecific_Conflict(t *testing.T) {
	candidate := makeAutomation(1, "lock all", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock car1", ptr(int64(100)), "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict (global overlaps specific), got %d", len(result))
	}
}

func TestDetectConflicts_SameVehicle_Conflict(t *testing.T) {
	vid := ptr(int64(100))
	candidate := makeAutomation(1, "lock", vid, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "unlock", vid, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict for same vehicle, got %d", len(result))
	}
}

// ── Severity / Conditions Tests ─────────────────────────

func TestDetectConflicts_ConditionsDowngradeSeverity(t *testing.T) {
	candidate := makeAutomation(1, "lock", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	candidate.Conditions = []any{map[string]any{"type": "time_window", "start_time": "22:00", "end_time": "06:00"}}

	other := makeAutomation(2, "unlock", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(result))
	}
	if result[0].Severity != "info" {
		t.Fatalf("expected severity 'info' when conditions present, got %q", result[0].Severity)
	}
}

// ── Multiple Command Pairs ──────────────────────────────

func TestDetectConflicts_MultipleOppositeCommandPairs(t *testing.T) {
	candidate := makeAutomation(1, "arm", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"},{"command":"sentry_on"},{"command":"climate_off"}]`)
	other := makeAutomation(2, "disarm", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"},{"command":"sentry_off"},{"command":"climate_on"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 1 {
		t.Fatalf("expected 1 conflict (single entry per automation), got %d", len(result))
	}
	// The reason should mention all conflicting pairs.
	r := result[0].Reason
	if !containsAll(r, "lock", "unlock") {
		t.Fatalf("expected reason to mention lock/unlock conflict, got %q", r)
	}
}

func TestDetectConflicts_MultipleOtherAutomations(t *testing.T) {
	candidate := makeAutomation(1, "lock", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other1 := makeAutomation(2, "unlock1", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)
	other2 := makeAutomation(3, "unlock2", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other1, other2})
	if len(result) != 2 {
		t.Fatalf("expected 2 conflicts, got %d", len(result))
	}
}

// ── Different Trigger Types ─────────────────────────────

func TestDetectConflicts_DifferentTriggerTypes_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "cron lock", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "geofence unlock", nil, "geofence",
		`{"geofence_id":5,"event":"enter"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for different trigger types, got %d", len(result))
	}
}

// ── Edge Cases ──────────────────────────────────────────

func TestDetectConflicts_MalformedJSON_NoConflict(t *testing.T) {
	candidate := makeAutomation(1, "broken", nil, "cron",
		`{bad json}`,
		`[{"command":"lock"}]`)
	other := makeAutomation(2, "other", nil, "cron",
		`{bad json}`,
		`[{"command":"unlock"}]`)

	// Malformed trigger config → trigger summary will be empty → no cron expr match.
	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts for malformed JSON, got %d", len(result))
	}
}

func TestDetectConflicts_NoCommandActions(t *testing.T) {
	candidate := makeAutomation(1, "notify", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"type":"notification","channel":"discord"}]`)
	other := makeAutomation(2, "unlock", nil, "cron",
		`{"cron_expr":"0 22 * * *"}`,
		`[{"command":"unlock"}]`)

	result := DetectConflicts(context.Background(), candidate, []*models.AutomationFull{other})
	if len(result) != 0 {
		t.Fatalf("expected 0 conflicts when candidate has no command actions, got %d", len(result))
	}
}

// ── Internal Helper Tests ───────────────────────────────

func TestVehicleScopeOverlaps(t *testing.T) {
	tests := []struct {
		name string
		a, b *int64
		want bool
	}{
		{"both nil (global)", nil, nil, true},
		{"a nil b specific", nil, ptr(int64(1)), true},
		{"a specific b nil", ptr(int64(1)), nil, true},
		{"same vehicle", ptr(int64(1)), ptr(int64(1)), true},
		{"different vehicles", ptr(int64(1)), ptr(int64(2)), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vehicleScopeOverlaps(tt.a, tt.b)
			if got != tt.want {
				t.Fatalf("vehicleScopeOverlaps(%v, %v) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestFindOppositeCommands(t *testing.T) {
	tests := []struct {
		name  string
		ours  []string
		theirs []string
		want  int
	}{
		{"lock vs unlock", []string{"lock"}, []string{"unlock"}, 1},
		{"lock vs lock", []string{"lock"}, []string{"lock"}, 0},
		{"no opposites", []string{"wake"}, []string{"lock"}, 0},
		{"multiple pairs", []string{"lock", "sentry_on"}, []string{"unlock", "sentry_off"}, 2},
		{"deduplicated", []string{"lock", "lock"}, []string{"unlock"}, 1},
		{"empty ours", []string{}, []string{"unlock"}, 0},
		{"empty theirs", []string{"lock"}, []string{}, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := findOppositeCommands(tt.ours, tt.theirs)
			if len(got) != tt.want {
				t.Fatalf("findOppositeCommands(%v, %v) = %d pairs, want %d", tt.ours, tt.theirs, len(got), tt.want)
			}
		})
	}
}

func TestParseActions(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want int
	}{
		{"valid single", `[{"command":"lock"}]`, 1},
		{"valid multiple", `[{"command":"lock"},{"command":"sentry_on"}]`, 2},
		{"empty array", `[]`, 0},
		{"empty string", ``, 0},
		{"malformed", `[{bad}`, 0},
		{"mixed types", `[{"command":"lock"},{"type":"notify"}]`, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseActions(json.RawMessage(tt.raw))
			if len(got) != tt.want {
				t.Fatalf("parseActions(%q) = %d entries, want %d", tt.raw, len(got), tt.want)
			}
		})
	}
}

func TestParseTriggerSummary_Cron(t *testing.T) {
	ts := parseTriggerSummary("cron", json.RawMessage(`{"cron_expr":"0 22 * * *","timezone":"UTC"}`))
	if ts.cronExpr != "0 22 * * *" {
		t.Fatalf("expected cron_expr '0 22 * * *', got %q", ts.cronExpr)
	}
	if ts.timezone != "UTC" {
		t.Fatalf("expected timezone 'UTC', got %q", ts.timezone)
	}
}

func TestParseTriggerSummary_VehicleState(t *testing.T) {
	ts := parseTriggerSummary("vehicle_state", json.RawMessage(`{"event":"drive_ends","from_state":"active"}`))
	if ts.event != "drive_ends" {
		t.Fatalf("expected event 'drive_ends', got %q", ts.event)
	}
	if ts.fromState == nil || *ts.fromState != "active" {
		t.Fatalf("expected from_state 'active', got %v", ts.fromState)
	}
}

func TestParseTriggerSummary_GeofenceBoth(t *testing.T) {
	ts := parseTriggerSummary("geofence", json.RawMessage(`{"geofence_id":5,"event":"both"}`))
	if ts.geofenceID != 5 {
		t.Fatalf("expected geofence_id 5, got %d", ts.geofenceID)
	}
	if len(ts.events) != 2 {
		t.Fatalf("expected 2 events for 'both', got %d", len(ts.events))
	}
}

func TestVehicleStateEventsOverlap(t *testing.T) {
	tests := []struct {
		name string
		a, b triggerSummary
		want bool
	}{
		{
			"same event no filters",
			triggerSummary{event: "drive_ends"},
			triggerSummary{event: "drive_ends"},
			true,
		},
		{
			"different events",
			triggerSummary{event: "drive_ends"},
			triggerSummary{event: "drive_starts"},
			false,
		},
		{
			"state_change overlaps any",
			triggerSummary{event: "state_change"},
			triggerSummary{event: "drive_ends"},
			true,
		},
		{
			"same event different from_state",
			triggerSummary{event: "comes_online", fromState: ptr("asleep")},
			triggerSummary{event: "comes_online", fromState: ptr("offline")},
			false,
		},
		{
			"same event one has from_state",
			triggerSummary{event: "comes_online", fromState: ptr("asleep")},
			triggerSummary{event: "comes_online"},
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vehicleStateEventsOverlap(tt.a, tt.b)
			if got != tt.want {
				t.Fatalf("vehicleStateEventsOverlap(%q/%q) = %v, want %v",
					tt.a.event, tt.b.event, got, tt.want)
			}
		})
	}
}

func TestGeofenceEventsOverlap(t *testing.T) {
	tests := []struct {
		name string
		a, b []string
		want bool
	}{
		{"enter vs enter", []string{"enter"}, []string{"enter"}, true},
		{"enter vs leave", []string{"enter"}, []string{"leave"}, false},
		{"both vs enter", []string{"enter", "leave"}, []string{"enter"}, true},
		{"both vs both", []string{"enter", "leave"}, []string{"enter", "leave"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := geofenceEventsOverlap(tt.a, tt.b)
			if got != tt.want {
				t.Fatalf("geofenceEventsOverlap(%v, %v) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

// containsAll checks that s contains all substrings.
func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !contains(s, sub) {
			return false
		}
	}
	return true
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
