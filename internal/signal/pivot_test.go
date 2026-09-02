package signal

import (
	"testing"
	"time"
)

// helper to build a UTC instant with a given offset in seconds from a fixed
// epoch — keeps the test cases visually compact while still letting us
// exercise multi-event timelines.
func ts(offsetSeconds int) time.Time {
	base := time.Date(2026, time.April, 30, 12, 0, 0, 0, time.UTC)
	return base.Add(time.Duration(offsetSeconds) * time.Second)
}

func TestForwardFold_EmptySeedEmptyEvents(t *testing.T) {
	got := forwardFold(nil, nil, []FieldMapping{{Signal: "VehicleSpeed", Field: "speed_mph"}}, ts(0), ts(60))
	if len(got) != 0 {
		t.Fatalf("expected 0 rows, got %d (%+v)", len(got), got)
	}
}

func TestForwardFold_EmptySeedSingleEvent(t *testing.T) {
	mappings := []FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed_mph"},
		{Signal: "BatteryLevel", Field: "battery_pct"},
	}
	events := []rawEvent{
		{Ts: ts(10), Signal: "VehicleSpeed", Value: 65.0},
	}
	got := forwardFold(nil, events, mappings, ts(0), ts(60))
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d (%+v)", len(got), got)
	}
	if !got[0].Timestamp.Equal(ts(10)) {
		t.Errorf("expected timestamp ts(10)=%v, got %v", ts(10), got[0].Timestamp)
	}
	if got[0].Fields["speed_mph"] != 65.0 {
		t.Errorf("expected speed_mph=65, got %v", got[0].Fields["speed_mph"])
	}
	if v, ok := got[0].Fields["battery_pct"]; !ok {
		t.Errorf("expected battery_pct key present even when nil, fields=%v", got[0].Fields)
	} else if v != nil {
		t.Errorf("expected battery_pct=nil (never observed), got %v", v)
	}
}

func TestForwardFold_NonEmptySeedNoEvents(t *testing.T) {
	seed := map[string]SignalValue{"VehicleSpeed": 42.0}
	mappings := []FieldMapping{{Signal: "VehicleSpeed", Field: "speed_mph"}}
	got := forwardFold(seed, nil, mappings, ts(0), ts(60))
	if len(got) != 0 {
		t.Fatalf("expected 0 rows when no events even with seed, got %d (%+v)", len(got), got)
	}
}

func TestForwardFold_MergesSameTimestampEvents(t *testing.T) {
	mappings := []FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed_mph"},
		{Signal: "BatteryLevel", Field: "battery_pct"},
	}
	events := []rawEvent{
		{Ts: ts(10), Signal: "VehicleSpeed", Value: 65.0},
		{Ts: ts(10), Signal: "BatteryLevel", Value: 80.0},
	}
	got := forwardFold(nil, events, mappings, ts(0), ts(60))
	if len(got) != 1 {
		t.Fatalf("expected 1 row (events at same ts merge), got %d (%+v)", len(got), got)
	}
	if got[0].Fields["speed_mph"] != 65.0 {
		t.Errorf("expected speed_mph=65, got %v", got[0].Fields["speed_mph"])
	}
	if got[0].Fields["battery_pct"] != 80.0 {
		t.Errorf("expected battery_pct=80, got %v", got[0].Fields["battery_pct"])
	}
}

func TestForwardFold_CarriesForwardAcrossEvents(t *testing.T) {
	seed := map[string]SignalValue{"VehicleSpeed": 30.0}
	mappings := []FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed_mph"},
		{Signal: "BatteryLevel", Field: "battery_pct"},
	}
	events := []rawEvent{
		{Ts: ts(10), Signal: "BatteryLevel", Value: 80.0},
	}
	got := forwardFold(seed, events, mappings, ts(0), ts(60))
	if len(got) != 1 {
		t.Fatalf("expected 1 row carrying seed forward, got %d (%+v)", len(got), got)
	}
	if got[0].Fields["speed_mph"] != 30.0 {
		t.Errorf("expected seed VehicleSpeed=30 to carry forward, got %v", got[0].Fields["speed_mph"])
	}
	if got[0].Fields["battery_pct"] != 80.0 {
		t.Errorf("expected battery_pct=80 from event, got %v", got[0].Fields["battery_pct"])
	}
}

func TestForwardFold_DropsLeadingAllNilRows(t *testing.T) {
	mappings := []FieldMapping{{Signal: "VehicleSpeed", Field: "speed_mph"}}

	// Scenario A: only events for an unmapped signal Y; no row should escape.
	eventsOnlyY := []rawEvent{
		{Ts: ts(5), Signal: "BatteryLevel", Value: 80.0},
		{Ts: ts(10), Signal: "BatteryLevel", Value: 81.0},
	}
	gotA := forwardFold(nil, eventsOnlyY, mappings, ts(0), ts(60))
	if len(gotA) != 0 {
		t.Fatalf("Phase A: expected 0 rows when no mapped signal ever set, got %d (%+v)", len(gotA), gotA)
	}

	// Scenario B: add a later event for the mapped signal X; exactly one row
	// should appear at the X event's timestamp.
	eventsB := []rawEvent{
		{Ts: ts(5), Signal: "BatteryLevel", Value: 80.0},
		{Ts: ts(10), Signal: "BatteryLevel", Value: 81.0},
		{Ts: ts(20), Signal: "VehicleSpeed", Value: 65.0},
	}
	gotB := forwardFold(nil, eventsB, mappings, ts(0), ts(60))
	if len(gotB) != 1 {
		t.Fatalf("Phase B: expected 1 row once mapped signal arrives, got %d (%+v)", len(gotB), gotB)
	}
	if !gotB[0].Timestamp.Equal(ts(20)) {
		t.Errorf("Phase B: expected timestamp ts(20)=%v, got %v", ts(20), gotB[0].Timestamp)
	}
	if gotB[0].Fields["speed_mph"] != 65.0 {
		t.Errorf("Phase B: expected speed_mph=65, got %v", gotB[0].Fields["speed_mph"])
	}
}

func TestForwardFold_KeepsTrailingAllNilRowsAfterFirstNonNil(t *testing.T) {
	mappings := []FieldMapping{{Signal: "VehicleSpeed", Field: "speed_mph"}}
	events := []rawEvent{
		{Ts: ts(10), Signal: "VehicleSpeed", Value: 65.0},
		// Explicit "no value" emission — projects to nil but is a real
		// datapoint that occurs AFTER a non-nil row, so it must be kept.
		{Ts: ts(20), Signal: "VehicleSpeed", Value: nil},
	}
	got := forwardFold(nil, events, mappings, ts(0), ts(60))
	if len(got) != 2 {
		t.Fatalf("expected 2 rows (leading-nil drop must NOT swallow trailing nils), got %d (%+v)", len(got), got)
	}
	if got[0].Fields["speed_mph"] != 65.0 {
		t.Errorf("expected first row speed_mph=65, got %v", got[0].Fields["speed_mph"])
	}
	if got[1].Fields["speed_mph"] != nil {
		t.Errorf("expected second row speed_mph=nil (explicit nil emission), got %v", got[1].Fields["speed_mph"])
	}
	if !got[1].Timestamp.Equal(ts(20)) {
		t.Errorf("expected second row timestamp ts(20)=%v, got %v", ts(20), got[1].Timestamp)
	}
}

// This test locks in the typed-primitive contract: the codec emits
// already-typed atomic values (float64, float32,
// int32, int64, bool, string, time.Time, ...) and pivot stores them as-is — no
// string parsing, compound flattening, or kind coercion. forwardFold is
// value-type-agnostic; this test flows a heterogeneous mix through the
// algorithm and asserts identity is preserved per primitive kind.
func TestForwardFold_PreservesTypedPrimitives_Phase42(t *testing.T) {
	mappings := []FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed_mph"},          // float64
		{Signal: "BatteryHeaterOn", Field: "battery_heater"},  // bool
		{Signal: "Gear", Field: "gear"},                       // string (enum)
		{Signal: "ChargeAmps", Field: "charge_amps"},          // int32
		{Signal: "RatedRange", Field: "rated_range_km"},       // float32
		{Signal: "GpsHeading", Field: "gps_heading_deg"},      // int64
		{Signal: "ChargingState", Field: "charging_state_at"}, // time.Time
	}
	gpsHeading := int64(180)
	chargeAmps := int32(32)
	chargingStateAt := time.Date(2026, time.April, 30, 11, 59, 0, 0, time.UTC)
	events := []rawEvent{
		{Ts: ts(5), Signal: "VehicleSpeed", Value: 65.0},
		{Ts: ts(5), Signal: "BatteryHeaterOn", Value: true},
		{Ts: ts(5), Signal: "Gear", Value: "D"},
		{Ts: ts(5), Signal: "ChargeAmps", Value: chargeAmps},
		{Ts: ts(5), Signal: "RatedRange", Value: float32(420.5)},
		{Ts: ts(5), Signal: "GpsHeading", Value: gpsHeading},
		{Ts: ts(5), Signal: "ChargingState", Value: chargingStateAt},
	}
	got := forwardFold(nil, events, mappings, ts(0), ts(60))
	if len(got) != 1 {
		t.Fatalf("expected 1 merged row at ts(5), got %d (%+v)", len(got), got)
	}
	row := got[0]
	if v, ok := row.Fields["speed_mph"].(float64); !ok || v != 65.0 {
		t.Errorf("expected speed_mph=float64(65), got %T(%v)", row.Fields["speed_mph"], row.Fields["speed_mph"])
	}
	if v, ok := row.Fields["battery_heater"].(bool); !ok || v != true {
		t.Errorf("expected battery_heater=bool(true), got %T(%v)", row.Fields["battery_heater"], row.Fields["battery_heater"])
	}
	if v, ok := row.Fields["gear"].(string); !ok || v != "D" {
		t.Errorf("expected gear=string(\"D\"), got %T(%v)", row.Fields["gear"], row.Fields["gear"])
	}
	if v, ok := row.Fields["charge_amps"].(int32); !ok || v != 32 {
		t.Errorf("expected charge_amps=int32(32), got %T(%v)", row.Fields["charge_amps"], row.Fields["charge_amps"])
	}
	if v, ok := row.Fields["rated_range_km"].(float32); !ok || v != 420.5 {
		t.Errorf("expected rated_range_km=float32(420.5), got %T(%v)", row.Fields["rated_range_km"], row.Fields["rated_range_km"])
	}
	if v, ok := row.Fields["gps_heading_deg"].(int64); !ok || v != 180 {
		t.Errorf("expected gps_heading_deg=int64(180), got %T(%v)", row.Fields["gps_heading_deg"], row.Fields["gps_heading_deg"])
	}
	if v, ok := row.Fields["charging_state_at"].(time.Time); !ok || !v.Equal(chargingStateAt) {
		t.Errorf("expected charging_state_at=time.Time(%v), got %T(%v)", chargingStateAt, row.Fields["charging_state_at"], row.Fields["charging_state_at"])
	}
}

func TestCollapseTimeline_EmptyCollapseFieldsReturnsUnchanged(t *testing.T) {
	rows := []TimelineRow{
		{Timestamp: ts(10), Fields: map[string]SignalValue{"title": "x"}},
		{Timestamp: ts(20), Fields: map[string]SignalValue{"title": "x"}},
		{Timestamp: ts(30), Fields: map[string]SignalValue{"title": "y"}},
	}
	got := collapseTimeline(rows, nil)
	if len(got) != len(rows) {
		t.Fatalf("expected %d rows unchanged with nil collapseFields, got %d", len(rows), len(got))
	}
	gotEmpty := collapseTimeline(rows, []string{})
	if len(gotEmpty) != len(rows) {
		t.Fatalf("expected %d rows unchanged with empty collapseFields, got %d", len(rows), len(gotEmpty))
	}
}

func TestCollapseTimeline_DropsConsecutiveDuplicates(t *testing.T) {
	rows := []TimelineRow{
		{Timestamp: ts(10), Fields: map[string]SignalValue{"id": "a", "title": "x"}},
		{Timestamp: ts(20), Fields: map[string]SignalValue{"id": "b", "title": "x"}},
		{Timestamp: ts(30), Fields: map[string]SignalValue{"id": "c", "title": "y"}},
	}
	got := collapseTimeline(rows, []string{"title"})
	if len(got) != 2 {
		t.Fatalf("expected 2 rows after collapsing duplicate titles, got %d (%+v)", len(got), got)
	}
	if got[0].Fields["id"] != "a" {
		t.Errorf("expected first kept row id=a (earliest of the run), got %v", got[0].Fields["id"])
	}
	if got[1].Fields["id"] != "c" {
		t.Errorf("expected second kept row id=c, got %v", got[1].Fields["id"])
	}
}

func TestCollapseTimeline_TreatsNilEqualToNil(t *testing.T) {
	rows := []TimelineRow{
		{Timestamp: ts(10), Fields: map[string]SignalValue{"shift_state": nil}},
		{Timestamp: ts(20), Fields: map[string]SignalValue{"shift_state": nil}},
		{Timestamp: ts(30), Fields: map[string]SignalValue{"shift_state": "D"}},
		{Timestamp: ts(40), Fields: map[string]SignalValue{"shift_state": nil}},
	}
	got := collapseTimeline(rows, []string{"shift_state"})
	if len(got) != 3 {
		t.Fatalf("expected 3 rows (nil,nil collapse; D distinct; nil distinct from D), got %d (%+v)", len(got), got)
	}
	if got[0].Fields["shift_state"] != nil {
		t.Errorf("expected first kept row shift_state=nil, got %v", got[0].Fields["shift_state"])
	}
	if got[1].Fields["shift_state"] != "D" {
		t.Errorf("expected second kept row shift_state=D, got %v", got[1].Fields["shift_state"])
	}
	if got[2].Fields["shift_state"] != nil {
		t.Errorf("expected third kept row shift_state=nil (distinct from D, kept), got %v", got[2].Fields["shift_state"])
	}
}

func TestCollapseTimeline_KeepsFirstAlways(t *testing.T) {
	rows := []TimelineRow{
		{Timestamp: ts(10), Fields: map[string]SignalValue{"title": nil}},
		{Timestamp: ts(20), Fields: map[string]SignalValue{"title": nil}},
	}
	got := collapseTimeline(rows, []string{"title"})
	if len(got) != 1 {
		t.Fatalf("expected 1 row (first always kept; second collapses as nil==nil), got %d (%+v)", len(got), got)
	}
	if !got[0].Timestamp.Equal(ts(10)) {
		t.Errorf("expected the FIRST row to be kept (ts(10)=%v), got %v", ts(10), got[0].Timestamp)
	}

	// Single all-nil row is also kept.
	single := []TimelineRow{
		{Timestamp: ts(50), Fields: map[string]SignalValue{"title": nil}},
	}
	gotSingle := collapseTimeline(single, []string{"title"})
	if len(gotSingle) != 1 {
		t.Fatalf("expected 1 row (single all-nil row kept), got %d", len(gotSingle))
	}
}

func TestTimelineFolder_MatchesFoldThenCollapse(t *testing.T) {
	seed := map[string]SignalValue{"Gear": "D", "VehicleSpeed": 10.0}
	mappings := []FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "VehicleSpeed", Field: "speed"},
	}
	events := []rawEvent{
		{Ts: ts(1), Signal: "VehicleSpeed", Value: 11.0},
		{Ts: ts(2), Signal: "VehicleSpeed", Value: 12.0},
		{Ts: ts(3), Signal: "Gear", Value: "P"},
		{Ts: ts(4), Signal: "VehicleSpeed", Value: 0.0},
	}
	want := collapseTimeline(forwardFold(seed, events, mappings, ts(0), ts(60)), []string{"gear"})
	folder := newTimelineFolder(seed, mappings, []string{"gear"}, 0)
	for _, ev := range events {
		if !folder.Add(ev) {
			t.Fatal("folder rejected events under unlimited MaxRows")
		}
	}
	got := folder.Finish()
	if len(got) != 2 {
		t.Fatalf("collapsed rows = %d, want 2 (Drive then Park); got %+v", len(got), got)
	}
	if len(want) != len(got) {
		t.Fatalf("fold+collapse rows = %d, stream rows = %d", len(want), len(got))
	}
	if got[0].Fields["gear"] != "D" || got[1].Fields["gear"] != "P" {
		t.Fatalf("gear sequence = %+v", got)
	}
}

func TestTimelineFolder_MaxRowsStopsAfterCollapse(t *testing.T) {
	mappings := []FieldMapping{{Signal: "Gear", Field: "gear"}}
	folder := newTimelineFolder(nil, mappings, []string{"gear"}, 1)
	if !folder.Add(rawEvent{Ts: ts(1), Signal: "Gear", Value: "D"}) {
		t.Fatal("first gear change must be kept")
	}
	if !folder.Add(rawEvent{Ts: ts(2), Signal: "Gear", Value: "P"}) {
		t.Fatal("second event is applied before the cap is checked on flush")
	}
	got := folder.Finish()
	if !folder.truncated || len(got) != 1 || got[0].Fields["gear"] != "D" {
		t.Fatalf("truncated=%v rows=%+v", folder.truncated, got)
	}
}
