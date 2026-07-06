package notification

import (
	"encoding/json"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// fixedTime is a stable, UTC instant so JSON round-trips are deterministic.
// A UTC time.Date carries no monotonic-clock reading and shares the time.UTC
// location pointer, so reflect.DeepEqual survives a marshal→unmarshal cycle.
var fixedTime = time.Date(2026, 7, 5, 12, 30, 0, 0, time.UTC)

func i64(v int64) *int64          { return &v }
func iptr(v int) *int             { return &v }
func sptr(v string) *string       { return &v }
func tptr(v time.Time) *time.Time { return &v }

// topLevelKeys marshals v and returns its top-level JSON object as a raw map,
// so tests can assert exactly which wire keys are present or omitted.
func topLevelKeys(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T) error: %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal %T payload into map: %v (payload=%s)", v, err, b)
	}
	return m
}

func sortedKeys(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// assertKeys checks every key in want is present and every key in absent is
// missing from the marshalled object.
func assertKeys(t *testing.T, m map[string]json.RawMessage, want, absent []string) {
	t.Helper()
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Errorf("missing expected JSON key %q; got keys %v", k, sortedKeys(m))
		}
	}
	for _, k := range absent {
		if _, ok := m[k]; ok {
			t.Errorf("unexpected JSON key %q present (raw=%s); want it omitted", k, m[k])
		}
	}
}

// ---------------------------------------------------------------------------
// NotificationChannel
// ---------------------------------------------------------------------------

func TestNotificationChannel_WireKeys(t *testing.T) {
	c := NotificationChannel{
		ID:        7,
		Name:      "ops-discord",
		Type:      "discord",
		Config:    map[string]string{"webhook_url": "https://example/hook"},
		Enabled:   true,
		CreatedAt: fixedTime,
		UpdatedAt: fixedTime,
	}
	m := topLevelKeys(t, c)
	assertKeys(t,
		m,
		[]string{"id", "name", "type", "config", "enabled", "created_at", "updated_at"},
		// `kind` is a db tag only; it must never leak onto the wire.
		[]string{"kind"},
	)
}

// TestNotificationChannel_TypeTagOverridesDBTag pins the intentional
// divergence between the JSON tag (`type`) and the db tag (`kind`): the wire
// contract exposes `type`, while the column is `kind`. A refactor that
// accidentally unified them would silently break the frontend.
func TestNotificationChannel_TypeTagOverridesDBTag(t *testing.T) {
	c := NotificationChannel{Type: "pushover"}
	m := topLevelKeys(t, c)

	raw, ok := m["type"]
	if !ok {
		t.Fatalf("expected JSON key %q; got %v", "type", sortedKeys(m))
	}
	var got string
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode type value: %v", err)
	}
	if got != "pushover" {
		t.Errorf("type = %q; want %q", got, "pushover")
	}
	if _, leaked := m["kind"]; leaked {
		t.Errorf("db tag `kind` leaked onto the JSON wire; keys=%v", sortedKeys(m))
	}
}

func TestNotificationChannel_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		in   NotificationChannel
	}{
		{"full", NotificationChannel{
			ID: 1, Name: "email", Type: "email",
			Config:    map[string]string{"to": "a@b.c", "from": "x@y.z"},
			Enabled:   true,
			CreatedAt: fixedTime, UpdatedAt: fixedTime,
		}},
		{"nil-config", NotificationChannel{
			ID: 2, Name: "slack", Type: "slack",
			CreatedAt: fixedTime, UpdatedAt: fixedTime,
		}},
		{"empty-config", NotificationChannel{
			ID: 3, Name: "ntfy", Type: "ntfy", Config: map[string]string{},
			CreatedAt: fixedTime, UpdatedAt: fixedTime,
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b, err := json.Marshal(tc.in)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var out NotificationChannel
			if err := json.Unmarshal(b, &out); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(tc.in, out) {
				t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", tc.in, out)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// NotificationLog
// ---------------------------------------------------------------------------

var notificationLogRequiredKeys = []string{
	"id", "channel_id", "title", "message", "status", "created_at",
}

var notificationLogOptionalKeys = []string{
	"alert_id", "severity", "error", "scheduled_at", "latency_ms",
	"sent_at", "read_at", "archived_at",
	"acknowledged_at", "acknowledged_by", "acknowledgement_note",
}

func fullNotificationLog() NotificationLog {
	return NotificationLog{
		ID:                  10,
		ChannelID:           2,
		AlertID:             i64(99),
		Title:               "Low battery",
		Message:             "SoC 12%",
		Status:              "sent",
		Severity:            "warning",
		Error:               "transient upstream 500",
		ScheduledAt:         tptr(fixedTime),
		LatencyMs:           iptr(340),
		CreatedAt:           fixedTime,
		SentAt:              tptr(fixedTime),
		ReadAt:              tptr(fixedTime),
		ArchivedAt:          tptr(fixedTime),
		AcknowledgedAt:      tptr(fixedTime),
		AcknowledgedBy:      sptr("alice"),
		AcknowledgementNote: sptr("looking into it"),
	}
}

func TestNotificationLog_WireKeys(t *testing.T) {
	tests := []struct {
		name        string
		in          NotificationLog
		wantPresent []string
		wantAbsent  []string
	}{
		{
			name:        "all-optional-populated",
			in:          fullNotificationLog(),
			wantPresent: append(append([]string{}, notificationLogRequiredKeys...), notificationLogOptionalKeys...),
			wantAbsent:  nil,
		},
		{
			name: "no-optional-populated",
			in: NotificationLog{
				ID: 11, ChannelID: 3, Title: "t", Message: "m",
				Status: "pending", CreatedAt: fixedTime,
			},
			wantPresent: notificationLogRequiredKeys,
			wantAbsent:  notificationLogOptionalKeys,
		},
		{
			name: "error-string-omitempty",
			in: NotificationLog{
				ID: 12, ChannelID: 3, Title: "t", Message: "m",
				Status: "failed", Error: "boom", CreatedAt: fixedTime,
			},
			wantPresent: append(append([]string{}, notificationLogRequiredKeys...), "error"),
			wantAbsent:  []string{"severity", "alert_id", "latency_ms", "sent_at"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := topLevelKeys(t, tc.in)
			assertKeys(t, m, tc.wantPresent, tc.wantAbsent)
		})
	}
}

// TestNotificationLog_OmitEmptyPerField isolates each optional field: when it
// alone is set, its key must appear; every other optional key must stay
// omitted. This catches an accidentally-dropped `,omitempty` on any one tag.
func TestNotificationLog_OmitEmptyPerField(t *testing.T) {
	base := func() NotificationLog {
		return NotificationLog{
			ID: 1, ChannelID: 1, Title: "t", Message: "m",
			Status: "pending", CreatedAt: fixedTime,
		}
	}
	tests := []struct {
		name string
		key  string
		set  func(*NotificationLog)
	}{
		{"alert_id", "alert_id", func(l *NotificationLog) { l.AlertID = i64(1) }},
		{"severity", "severity", func(l *NotificationLog) { l.Severity = "critical" }},
		{"error", "error", func(l *NotificationLog) { l.Error = "x" }},
		{"scheduled_at", "scheduled_at", func(l *NotificationLog) { l.ScheduledAt = tptr(fixedTime) }},
		{"latency_ms", "latency_ms", func(l *NotificationLog) { l.LatencyMs = iptr(1) }},
		{"sent_at", "sent_at", func(l *NotificationLog) { l.SentAt = tptr(fixedTime) }},
		{"read_at", "read_at", func(l *NotificationLog) { l.ReadAt = tptr(fixedTime) }},
		{"archived_at", "archived_at", func(l *NotificationLog) { l.ArchivedAt = tptr(fixedTime) }},
		{"acknowledged_at", "acknowledged_at", func(l *NotificationLog) { l.AcknowledgedAt = tptr(fixedTime) }},
		{"acknowledged_by", "acknowledged_by", func(l *NotificationLog) { l.AcknowledgedBy = sptr("bob") }},
		{"acknowledgement_note", "acknowledgement_note", func(l *NotificationLog) { l.AcknowledgementNote = sptr("n") }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := base()
			tc.set(&l)
			m := topLevelKeys(t, l)
			if _, ok := m[tc.key]; !ok {
				t.Errorf("key %q should be present when set; keys=%v", tc.key, sortedKeys(m))
			}
			for _, other := range notificationLogOptionalKeys {
				if other == tc.key {
					continue
				}
				if _, ok := m[other]; ok {
					t.Errorf("key %q should be omitted when only %q is set; keys=%v", other, tc.key, sortedKeys(m))
				}
			}
		})
	}
}

// TestNotificationLog_DecodeAPIShape pins that the snake_case wire names the
// API emits decode back into the correct Go fields — a defence against a
// json-tag typo silently dropping data the frontend sent or the DB stored.
func TestNotificationLog_DecodeAPIShape(t *testing.T) {
	payload := `{
	  "id": 5,
	  "channel_id": 8,
	  "alert_id": 42,
	  "title": "Door open",
	  "message": "front left",
	  "status": "sent",
	  "severity": "info",
	  "latency_ms": 275,
	  "created_at": "2026-07-05T12:30:00Z",
	  "acknowledged_by": "carol",
	  "acknowledgement_note": "on it"
	}`
	var l NotificationLog
	if err := json.Unmarshal([]byte(payload), &l); err != nil {
		t.Fatalf("unmarshal API payload: %v", err)
	}
	if l.ID != 5 || l.ChannelID != 8 {
		t.Errorf("id/channel_id decoded wrong: id=%d channel_id=%d", l.ID, l.ChannelID)
	}
	if l.AlertID == nil || *l.AlertID != 42 {
		t.Errorf("alert_id = %v; want 42", l.AlertID)
	}
	if l.LatencyMs == nil || *l.LatencyMs != 275 {
		t.Errorf("latency_ms = %v; want 275", l.LatencyMs)
	}
	if l.Severity != "info" || l.Status != "sent" {
		t.Errorf("severity/status decoded wrong: severity=%q status=%q", l.Severity, l.Status)
	}
	if l.AcknowledgedBy == nil || *l.AcknowledgedBy != "carol" {
		t.Errorf("acknowledged_by = %v; want carol", l.AcknowledgedBy)
	}
	if l.AcknowledgementNote == nil || *l.AcknowledgementNote != "on it" {
		t.Errorf("acknowledgement_note = %v; want 'on it'", l.AcknowledgementNote)
	}
	if !l.CreatedAt.Equal(fixedTime) {
		t.Errorf("created_at = %v; want %v", l.CreatedAt, fixedTime)
	}
}

func TestNotificationLog_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		in   NotificationLog
	}{
		{"full", fullNotificationLog()},
		{"minimal", NotificationLog{
			ID: 1, ChannelID: 1, Title: "t", Message: "m",
			Status: "pending", CreatedAt: fixedTime,
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b, err := json.Marshal(tc.in)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var out NotificationLog
			if err := json.Unmarshal(b, &out); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if !reflect.DeepEqual(tc.in, out) {
				t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", tc.in, out)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// NotificationSchedule
// ---------------------------------------------------------------------------

func TestNotificationSchedule_WireKeys(t *testing.T) {
	required := []string{"id", "channel_id", "title", "message", "enabled", "created_at", "updated_at"}
	optional := []string{"cron_expr", "scheduled_at", "last_run_at", "next_run_at"}

	tests := []struct {
		name        string
		in          NotificationSchedule
		wantPresent []string
		wantAbsent  []string
	}{
		{
			name: "recurring-cron",
			in: NotificationSchedule{
				ID: 1, ChannelID: 2, Title: "daily", Message: "report",
				CronExpr: sptr("0 8 * * *"), NextRunAt: tptr(fixedTime),
				LastRunAt: tptr(fixedTime), Enabled: true,
				CreatedAt: fixedTime, UpdatedAt: fixedTime,
			},
			wantPresent: append(append([]string{}, required...), "cron_expr", "next_run_at", "last_run_at"),
			wantAbsent:  []string{"scheduled_at"},
		},
		{
			name: "one-shot",
			in: NotificationSchedule{
				ID: 2, ChannelID: 2, Title: "once", Message: "ping",
				ScheduledAt: tptr(fixedTime), Enabled: true,
				CreatedAt: fixedTime, UpdatedAt: fixedTime,
			},
			wantPresent: append(append([]string{}, required...), "scheduled_at"),
			wantAbsent:  []string{"cron_expr", "last_run_at", "next_run_at"},
		},
		{
			name: "never-run",
			in: NotificationSchedule{
				ID: 3, ChannelID: 2, Title: "t", Message: "m",
				CreatedAt: fixedTime, UpdatedAt: fixedTime,
			},
			wantPresent: required,
			wantAbsent:  optional,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m := topLevelKeys(t, tc.in)
			assertKeys(t, m, tc.wantPresent, tc.wantAbsent)
		})
	}
}

func TestNotificationSchedule_RoundTrip(t *testing.T) {
	in := NotificationSchedule{
		ID: 1, ChannelID: 2, Title: "daily", Message: "report",
		CronExpr: sptr("0 8 * * *"), ScheduledAt: nil,
		LastRunAt: tptr(fixedTime), NextRunAt: tptr(fixedTime),
		Enabled: true, CreatedAt: fixedTime, UpdatedAt: fixedTime,
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out NotificationSchedule
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", in, out)
	}
}

// ---------------------------------------------------------------------------
// NotificationPreference
// ---------------------------------------------------------------------------

func TestNotificationPreference_WireKeysAndRoundTrip(t *testing.T) {
	in := NotificationPreference{
		ID: 1, ChannelID: 2, EventType: "charge_complete",
		Enabled: true, CreatedAt: fixedTime,
	}
	m := topLevelKeys(t, in)
	assertKeys(t, m,
		[]string{"id", "channel_id", "event_type", "enabled", "created_at"},
		nil,
	)

	b, _ := json.Marshal(in)
	var out NotificationPreference
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", in, out)
	}
}

// ---------------------------------------------------------------------------
// NotificationMetric
// ---------------------------------------------------------------------------

func TestNotificationMetric_WireKeysAndRoundTrip(t *testing.T) {
	in := NotificationMetric{
		ID: 1, ChannelID: 2, Date: fixedTime,
		TotalSent: 40, TotalFailed: 2, AvgLatencyMs: 310,
	}
	m := topLevelKeys(t, in)
	assertKeys(t, m,
		[]string{"id", "channel_id", "date", "total_sent", "total_failed", "avg_latency_ms"},
		nil,
	)

	b, _ := json.Marshal(in)
	var out NotificationMetric
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", in, out)
	}
}

// ---------------------------------------------------------------------------
// NotificationLogGroup — the VehicleIDs never-null contract
// ---------------------------------------------------------------------------

// rawVehicleIDs marshals v and returns the raw `vehicle_ids` fragment.
func rawVehicleIDs(t *testing.T, v any) string {
	t.Helper()
	m := topLevelKeys(t, v)
	raw, ok := m["vehicle_ids"]
	if !ok {
		t.Fatalf("vehicle_ids key missing; keys=%v", sortedKeys(m))
	}
	return strings.TrimSpace(string(raw))
}

// TestNotificationLogGroup_VehicleIDsNeverNull is the core hardening test: no
// matter how the group is constructed, `vehicle_ids` must serialise to a JSON
// array and never to `null`. The doc comment promises this invariant but the
// raw struct could not keep it until MarshalJSON was added.
func TestNotificationLogGroup_VehicleIDsNeverNull(t *testing.T) {
	tests := []struct {
		name string
		in   NotificationLogGroup
		want string
	}{
		{"nil-slice", NotificationLogGroup{Count: 1, UnreadCount: 0}, "[]"},
		{"explicit-empty", NotificationLogGroup{VehicleIDs: []int64{}}, "[]"},
		{"single", NotificationLogGroup{VehicleIDs: []int64{7}}, "[7]"},
		{"multi", NotificationLogGroup{VehicleIDs: []int64{1, 2, 3}}, "[1,2,3]"},
		{"zero-value", NotificationLogGroup{}, "[]"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := rawVehicleIDs(t, tc.in)
			if got == "null" {
				t.Fatalf("vehicle_ids serialised as null; the never-null contract is broken")
			}
			if got != tc.want {
				t.Errorf("vehicle_ids = %s; want %s", got, tc.want)
			}
		})
	}
}

// TestNotificationLogGroup_VehicleIDsNeverNull_PointerAndSlice verifies the
// invariant holds through the exact shapes the repository returns: a pointer
// value and a []*NotificationLogGroup slice element.
func TestNotificationLogGroup_VehicleIDsNeverNull_PointerAndSlice(t *testing.T) {
	if got := rawVehicleIDs(t, &NotificationLogGroup{Count: 1}); got != "[]" {
		t.Errorf("*NotificationLogGroup vehicle_ids = %s; want []", got)
	}

	groups := []*NotificationLogGroup{{Count: 1}, {VehicleIDs: []int64{9}}}
	b, err := json.Marshal(groups)
	if err != nil {
		t.Fatalf("marshal slice: %v", err)
	}
	if strings.Contains(string(b), `"vehicle_ids":null`) {
		t.Errorf("slice element serialised vehicle_ids as null: %s", b)
	}
	if !strings.Contains(string(b), `"vehicle_ids":[]`) {
		t.Errorf("nil-slice element should serialise vehicle_ids as []: %s", b)
	}
	if !strings.Contains(string(b), `"vehicle_ids":[9]`) {
		t.Errorf("populated element should serialise vehicle_ids as [9]: %s", b)
	}
}

// TestNotificationLogGroup_DoesNotMutateInput guards against the MarshalJSON
// normalisation leaking back into the caller's struct (it operates on a copy).
func TestNotificationLogGroup_DoesNotMutateInput(t *testing.T) {
	g := NotificationLogGroup{Count: 1}
	if _, err := json.Marshal(g); err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if g.VehicleIDs != nil {
		t.Errorf("MarshalJSON mutated the caller's VehicleIDs to %v; want nil", g.VehicleIDs)
	}
}

func TestNotificationLogGroup_GroupKeyOmitEmpty(t *testing.T) {
	tests := []struct {
		name       string
		groupKey   *string
		wantKeySet bool
	}{
		{"singleton-nil-key", nil, false},
		{"grouped-key-set", sptr("abc123"), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := NotificationLogGroup{
				GroupKey:   tc.groupKey,
				Latest:     &NotificationLog{ID: 1, Status: "sent", CreatedAt: fixedTime},
				Count:      3,
				VehicleIDs: []int64{1},
			}
			m := topLevelKeys(t, g)
			_, present := m["group_key"]
			if present != tc.wantKeySet {
				t.Errorf("group_key present = %v; want %v (keys=%v)", present, tc.wantKeySet, sortedKeys(m))
			}
			// These are always part of the group shape.
			assertKeys(t, m, []string{"latest", "count", "unread_count", "vehicle_ids"}, nil)
		})
	}
}

func TestNotificationLogGroup_RoundTrip(t *testing.T) {
	in := NotificationLogGroup{
		GroupKey: sptr("deadbeef"),
		Latest: &NotificationLog{
			ID: 4, ChannelID: 1, Title: "t", Message: "m",
			Status: "sent", Severity: "warning", CreatedAt: fixedTime,
		},
		Count:       5,
		UnreadCount: 2,
		VehicleIDs:  []int64{1, 2},
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out NotificationLogGroup
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(in, out) {
		t.Errorf("round-trip mismatch:\n in  = %+v\n out = %+v", in, out)
	}
}

// TestNotificationLogGroup_RoundTrip_NilVehicleIDsNormalises documents that a
// group built with a nil slice comes back as an empty (non-nil) slice — the
// intended, contract-satisfying consequence of MarshalJSON.
func TestNotificationLogGroup_RoundTrip_NilVehicleIDsNormalises(t *testing.T) {
	in := NotificationLogGroup{
		Latest: &NotificationLog{ID: 1, Status: "sent", CreatedAt: fixedTime},
		Count:  1,
	}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out NotificationLogGroup
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.VehicleIDs == nil {
		t.Fatal("expected non-nil VehicleIDs after round-trip")
	}
	if len(out.VehicleIDs) != 0 {
		t.Errorf("VehicleIDs = %v; want empty slice", out.VehicleIDs)
	}
}
