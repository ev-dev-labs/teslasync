package security

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// strPtr / timePtr keep the table literals below readable — Go has no
// address-of on composite literals for basic types.
func strPtr(s string) *string        { return &s }
func timePtr(t time.Time) *time.Time { return &t }

// fullEvent is a fully-populated SecurityEvent used as the fixture for
// the marshalling / tag / round-trip assertions. Every nullable field is
// set so the "present" shape is exercised; the nil shape is covered
// separately in TestSecurityEvent_NullableFields_SerialiseAsNull.
func fullEvent() SecurityEvent {
	return SecurityEvent{
		ID:        42,
		VehicleID: 7,
		Ts:        time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC),
		EventType: "sentry_mode",
		FromState: strPtr("SentryModeStateOff"),
		ToState:   strPtr("SentryModeStateArmed"),
		Details: map[string]any{
			"trigger": "motion",
			"zone":    "front",
		},
		AcknowledgedAt: timePtr(time.Date(2026, 5, 6, 13, 0, 0, 0, time.UTC)),
		AcknowledgedBy: strPtr("alice@example.com"),
	}
}

// wantColumns is the canonical, ordered list of live `security_events`
// columns after migrations 000183 (recreate) + 000189 (id + ack columns).
// The reflection tests below pin the struct to this exact set so a future
// migration that adds/renames/drops a column fails loudly here instead of
// silently at a pgx scan.
var wantColumns = []string{
	"id",
	"vehicle_id",
	"ts",
	"event_type",
	"from_state",
	"to_state",
	"details",
	"acknowledged_at",
	"acknowledged_by",
}

// staleColumns are the pre-000183 baseline columns that the table no
// longer has. They must NOT reappear as db or json tags — the whole
// point of the drift fix. A regression that copy-pastes the old struct
// back trips this guard. Note `sentry_mode` is a legitimate event_type
// *value* but was a boolean *column* in the old shape, so it is
// forbidden as a tag name here.
var staleColumns = []string{
	"doors_open", "windows_open", "locked",
	"sentry_mode", "user_present", "detail", "source",
}

// TestSecurityEvent_DBTagsMatchLiveSchema asserts, via reflection, that
// the struct's db tags equal the live column set exactly — same members,
// same order, no extras, none missing. This is the schema-drift backstop.
func TestSecurityEvent_DBTagsMatchLiveSchema(t *testing.T) {
	rt := reflect.TypeOf(SecurityEvent{})
	if got, want := rt.NumField(), len(wantColumns); got != want {
		t.Fatalf("SecurityEvent has %d fields, live schema has %d columns %v", got, want, wantColumns)
	}
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		db := f.Tag.Get("db")
		if db == "" {
			t.Errorf("field %s has no db tag", f.Name)
			continue
		}
		if db != wantColumns[i] {
			t.Errorf("field %s db tag = %q, want %q (position %d)", f.Name, db, wantColumns[i], i)
		}
	}
}

// TestSecurityEvent_DBTagEqualsJSONTag pins the models-layer convention
// that each field's db tag and json tag are identical snake_case tokens.
// A mismatch means a pgx scan and the REST envelope disagree on a field
// name — exactly the class of bug this package exists to prevent.
func TestSecurityEvent_DBTagEqualsJSONTag(t *testing.T) {
	rt := reflect.TypeOf(SecurityEvent{})
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		db := f.Tag.Get("db")
		js := f.Tag.Get("json")
		if js == "" {
			t.Errorf("field %s has no json tag", f.Name)
			continue
		}
		// json tag may carry options (,omitempty) — take the name part.
		if name, _, _ := splitTag(js); name != db {
			t.Errorf("field %s: json name %q != db tag %q", f.Name, name, db)
		}
	}
}

// TestSecurityEvent_NoStaleColumns guards against a regression that
// reintroduces the dropped pre-000183 columns as either db or json tags.
func TestSecurityEvent_NoStaleColumns(t *testing.T) {
	rt := reflect.TypeOf(SecurityEvent{})
	stale := map[string]bool{}
	for _, c := range staleColumns {
		stale[c] = true
	}
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		db := f.Tag.Get("db")
		name, _, _ := splitTag(f.Tag.Get("json"))
		if stale[db] {
			t.Errorf("field %s reintroduces dropped column via db tag %q", f.Name, db)
		}
		if stale[name] {
			t.Errorf("field %s reintroduces dropped column via json tag %q", f.Name, name)
		}
	}
}

// TestSecurityEvent_JSONKeys marshals a fully-populated event and asserts
// the emitted object carries every live column as a key — and only those.
func TestSecurityEvent_JSONKeys(t *testing.T) {
	b, err := json.Marshal(fullEvent())
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal into map: %v", err)
	}
	if len(got) != len(wantColumns) {
		t.Errorf("marshalled object has %d keys, want %d: %v", len(got), len(wantColumns), keysOf(got))
	}
	for _, k := range wantColumns {
		if _, ok := got[k]; !ok {
			t.Errorf("marshalled object missing key %q", k)
		}
	}
	for _, stale := range []string{"doors_open", "windows_open", "locked", "user_present", "detail", "source"} {
		if _, ok := got[stale]; ok {
			t.Errorf("marshalled object contains dropped key %q", stale)
		}
	}
}

// TestSecurityEvent_JSONRoundTrip asserts marshalling then unmarshalling
// reproduces every field, including the pointer-nullable fields and the
// JSONB details map.
func TestSecurityEvent_JSONRoundTrip(t *testing.T) {
	orig := fullEvent()
	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var got SecurityEvent
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	if got.ID != orig.ID {
		t.Errorf("ID = %d, want %d", got.ID, orig.ID)
	}
	if got.VehicleID != orig.VehicleID {
		t.Errorf("VehicleID = %d, want %d", got.VehicleID, orig.VehicleID)
	}
	if !got.Ts.Equal(orig.Ts) {
		t.Errorf("Ts = %v, want %v", got.Ts, orig.Ts)
	}
	if got.EventType != orig.EventType {
		t.Errorf("EventType = %q, want %q", got.EventType, orig.EventType)
	}
	assertStrPtrEqual(t, "FromState", got.FromState, orig.FromState)
	assertStrPtrEqual(t, "ToState", got.ToState, orig.ToState)
	assertStrPtrEqual(t, "AcknowledgedBy", got.AcknowledgedBy, orig.AcknowledgedBy)
	if got.AcknowledgedAt == nil || !got.AcknowledgedAt.Equal(*orig.AcknowledgedAt) {
		t.Errorf("AcknowledgedAt = %v, want %v", got.AcknowledgedAt, orig.AcknowledgedAt)
	}
	if !reflect.DeepEqual(got.Details, orig.Details) {
		t.Errorf("Details = %#v, want %#v", got.Details, orig.Details)
	}
}

// TestSecurityEvent_NullableFields_SerialiseAsNull pins that an event
// with every optional field unset emits explicit JSON `null` (no
// omitempty) so the frontend's null-safety derivations work — an absent
// acknowledged_at must be `null`, never an omitted key or epoch zero.
func TestSecurityEvent_NullableFields_SerialiseAsNull(t *testing.T) {
	ev := SecurityEvent{
		ID:        1,
		VehicleID: 2,
		Ts:        time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		EventType: "locked",
		// FromState, ToState, Details, AcknowledgedAt, AcknowledgedBy all nil.
	}
	b, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal into map: %v", err)
	}
	for _, k := range []string{"from_state", "to_state", "details", "acknowledged_at", "acknowledged_by"} {
		raw, ok := got[k]
		if !ok {
			t.Errorf("key %q omitted; nullable columns must serialise as explicit null", k)
			continue
		}
		if string(raw) != "null" {
			t.Errorf("key %q = %s, want null", k, raw)
		}
	}
}

// TestSecurityEvent_UnmarshalAPIShape decodes a realistic guard-endpoint
// payload (the exact shape internal/database/system.GuardEvent emits)
// into SecurityEvent and asserts each field, including a nested details
// object and an unacknowledged (null) pair.
func TestSecurityEvent_UnmarshalAPIShape(t *testing.T) {
	const payload = `{
		"id": 99,
		"vehicle_id": 3,
		"ts": "2026-05-06T12:34:56Z",
		"event_type": "door_open",
		"from_state": null,
		"to_state": "true",
		"details": {"door": "front_left"},
		"acknowledged_at": null,
		"acknowledged_by": null
	}`
	var ev SecurityEvent
	if err := json.Unmarshal([]byte(payload), &ev); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if ev.ID != 99 || ev.VehicleID != 3 {
		t.Errorf("ID/VehicleID = %d/%d, want 99/3", ev.ID, ev.VehicleID)
	}
	if ev.EventType != "door_open" {
		t.Errorf("EventType = %q, want door_open", ev.EventType)
	}
	if ev.FromState != nil {
		t.Errorf("FromState = %v, want nil (first observation)", *ev.FromState)
	}
	if ev.ToState == nil || *ev.ToState != "true" {
		t.Errorf("ToState = %v, want \"true\"", ev.ToState)
	}
	if got, ok := ev.Details["door"]; !ok || got != "front_left" {
		t.Errorf("Details[door] = %v (ok=%v), want front_left", got, ok)
	}
	if ev.Acknowledged() {
		t.Error("Acknowledged() = true for a null acknowledged_at payload")
	}
}

// TestSecurityEvent_Acknowledged is the table-driven cover for the sole
// exported method, including the documented nil-receiver contract.
func TestSecurityEvent_Acknowledged(t *testing.T) {
	ackedAt := time.Date(2026, 5, 6, 13, 0, 0, 0, time.UTC)
	cases := []struct {
		name  string
		event *SecurityEvent
		want  bool
	}{
		{name: "nil_receiver", event: nil, want: false},
		{name: "zero_value", event: &SecurityEvent{}, want: false},
		{
			name:  "acknowledged_at_nil",
			event: &SecurityEvent{AcknowledgedBy: strPtr("alice")}, // by-without-at
			want:  false,
		},
		{
			name:  "acknowledged_at_set",
			event: &SecurityEvent{AcknowledgedAt: &ackedAt},
			want:  true,
		},
		{
			name:  "acknowledged_at_set_zero_time",
			event: &SecurityEvent{AcknowledgedAt: timePtr(time.Time{})},
			want:  true, // presence of the pointer is the contract, not its value
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.event.Acknowledged(); got != tc.want {
				t.Errorf("Acknowledged() = %v, want %v", got, tc.want)
			}
		})
	}
}

// --- small local helpers (no external deps, keep tests self-contained) ---

// splitTag splits a struct tag value like "name,omitempty" into
// (name, opts, hasOpts). Mirrors encoding/json's parsing closely enough
// for tag-name assertions without importing internal packages.
func splitTag(tag string) (name, opts string, hasOpts bool) {
	for i := 0; i < len(tag); i++ {
		if tag[i] == ',' {
			return tag[:i], tag[i+1:], true
		}
	}
	return tag, "", false
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func assertStrPtrEqual(t *testing.T, field string, got, want *string) {
	t.Helper()
	switch {
	case got == nil && want == nil:
		return
	case got == nil || want == nil:
		t.Errorf("%s: got %v, want %v (one is nil)", field, deref(got), deref(want))
	case *got != *want:
		t.Errorf("%s = %q, want %q", field, *got, *want)
	}
}

func deref(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}
