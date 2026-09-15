package daylog

import (
	"testing"
	"time"

	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
)

func dlTime(h, m int) time.Time {
	return time.Date(2026, 9, 14, h, m, 0, 0, time.UTC)
}

func dlWindow() (time.Time, time.Time) {
	return dlTime(7, 0), dlTime(7, 0).Add(24 * time.Hour)
}

func dlBool(b bool) *bool        { return &b }
func dlInt(v int64) *int64       { return &v }
func dlFloat(v float64) *float64 { return &v }
func dlStr(s string) *string     { return &s }

func dlBaseInput() TimelineInput {
	start, end := dlWindow()
	return TimelineInput{VehicleID: 1, WindowStart: start, WindowEnd: end, Layers: []string{}}
}

func eventTypes(events []Event) []string {
	out := make([]string, 0, len(events))
	for _, e := range events {
		out = append(out, e.Type)
	}
	return out
}

func findEvent(events []Event, typ string) *Event {
	for i := range events {
		if events[i].Type == typ {
			return &events[i]
		}
	}
	return nil
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestBuildTimeline_DriveBoundaries(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		drives    []daylogdb.DayDrive
		wantTypes []string
	}{
		{
			name: "start and end inside window",
			drives: []daylogdb.DayDrive{{
				ID: 7, VehicleID: 1, StartedAt: dlTime(10, 0), EndedAt: dlTimePtr(11, 0),
				DurationS: dlInt(3600), DistanceM: dlFloat(25000),
			}},
			wantTypes: []string{"drive_start", "drive_end"},
		},
		{
			name: "started before window only end emits",
			drives: []daylogdb.DayDrive{{
				ID: 8, VehicleID: 1, StartedAt: dlTime(5, 0), EndedAt: dlTimePtr(8, 0),
			}},
			wantTypes: []string{"drive_end"},
		},
		{
			name: "in progress drive emits start only",
			drives: []daylogdb.DayDrive{{
				ID: 9, VehicleID: 1, StartedAt: dlTime(20, 0), EndedAt: nil,
			}},
			wantTypes: []string{"drive_start"},
		},
		{
			name: "open drive from yesterday emits nothing",
			drives: []daylogdb.DayDrive{{
				ID: 10, VehicleID: 1, StartedAt: dlTime(5, 0), EndedAt: nil,
			}},
			wantTypes: []string{},
		},
		{
			name:      "no drives no events",
			drives:    nil,
			wantTypes: []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			in := dlBaseInput()
			in.Drives = tt.drives
			out := BuildTimeline(in)
			if got := eventTypes(out.Events); !equalStrings(got, tt.wantTypes) {
				t.Errorf("types = %v, want %v", got, tt.wantTypes)
			}
			for _, e := range out.Events {
				if e.Layer != LayerDefault {
					t.Errorf("event %s layer = %q, want default", e.Type, e.Layer)
				}
				if e.RefKind == nil || *e.RefKind != "drive" || e.RefID == nil {
					t.Errorf("event %s missing drive ref: %+v", e.Type, e)
				}
				if e.Payload == nil {
					t.Errorf("event %s payload must be non-nil", e.Type)
				}
			}
		})
	}
}

func dlTimePtr(h, m int) *time.Time { t := dlTime(h, m); return &t }

func TestBuildTimeline_FSMSuppression(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.FSM = []daylogdb.DayFSMTransition{
		{ID: 1, Ts: dlTime(8, 0), FromState: dlStr("online"), ToState: "driving"},
		{ID: 2, Ts: dlTime(9, 0), FromState: dlStr("driving"), ToState: "parked"},
		{ID: 3, Ts: dlTime(10, 0), FromState: dlStr("parked"), ToState: "charging"},
		{ID: 4, Ts: dlTime(12, 0), FromState: dlStr("charging"), ToState: "asleep"},
		{ID: 5, Ts: dlTime(13, 0), FromState: dlStr("asleep"), ToState: "wobbling"},
	}
	out := BuildTimeline(in)
	if got, want := eventTypes(out.Events), []string{"parked", "asleep", "state_change"}; !equalStrings(got, want) {
		t.Fatalf("types = %v, want %v", got, want)
	}
	if got := findEvent(out.Events, "parked"); got.Payload["from_state"] != "driving" {
		t.Errorf("parked from_state = %v, want driving", got.Payload["from_state"])
	}
	if got := findEvent(out.Events, "state_change"); got.Payload["to_state"] != "wobbling" {
		t.Errorf("state_change to_state = %v, want wobbling", got.Payload["to_state"])
	}
}

func TestBuildTimeline_SecurityMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		eventType string
		toState   *string
		wantType  string
		wantState any
	}{
		{"locked true", "locked", dlStr("true"), "locked", nil},
		{"locked false", "locked", dlStr("false"), "unlocked", nil},
		{"locked garbage", "locked", dlStr("maybe"), "lock_unknown", "maybe"},
		{"locked nil", "locked", nil, "lock_unknown", nil},
		{"sentry off", "sentry_mode", dlStr("SentryModeStateOff"), "sentry_off", "SentryModeStateOff"},
		{"sentry unknown token", "sentry_mode", dlStr("SentryModeStateUnknown"), "sentry_off", "SentryModeStateUnknown"},
		{"sentry armed", "sentry_mode", dlStr("SentryModeStateArmed"), "sentry_on", "SentryModeStateArmed"},
		{"sentry idle counts on", "sentry_mode", dlStr("SentryModeStateIdle"), "sentry_on", "SentryModeStateIdle"},
		{"sentry nil", "sentry_mode", nil, "sentry_unknown", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			in := dlBaseInput()
			in.Security = []daylogdb.DaySecurityEvent{{ID: 3, Ts: dlTime(9, 0), EventType: tt.eventType, ToState: tt.toState}}
			out := BuildTimeline(in)
			if len(out.Events) != 1 {
				t.Fatalf("events = %d, want 1", len(out.Events))
			}
			e := out.Events[0]
			if e.Type != tt.wantType {
				t.Errorf("type = %q, want %q", e.Type, tt.wantType)
			}
			if tt.wantState != nil && e.Payload["state"] != tt.wantState {
				t.Errorf("state payload = %v, want %v", e.Payload["state"], tt.wantState)
			}
		})
	}
}

func TestBuildTimeline_ValetIgnored(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.Security = []daylogdb.DaySecurityEvent{{ID: 4, Ts: dlTime(9, 0), EventType: "valet_mode_enabled", ToState: dlStr("true")}}
	if out := BuildTimeline(in); len(out.Events) != 0 {
		t.Errorf("valet events = %d, want 0 (out of v1 scope)", len(out.Events))
	}
}

func dlSignalRow(h, m int, field string, b *bool, i *int64, f *float64, s *string) daylogdb.DaySignalRow {
	return daylogdb.DaySignalRow{Ts: dlTime(h, m), Field: field, BoolValue: b, IntValue: i, FloatValue: f, StrValue: s}
}

func TestBuildTimeline_SignalEdges(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		rows      []daylogdb.DaySignalRow
		wantTypes []string
	}{
		{
			name: "remote start off on off",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "RemoteStartActive", dlBool(false), nil, nil, nil),
				dlSignalRow(9, 0, "RemoteStartActive", dlBool(true), nil, nil, nil),
				dlSignalRow(9, 5, "RemoteStartActive", dlBool(true), nil, nil, nil),
				dlSignalRow(10, 0, "RemoteStartActive", dlBool(false), nil, nil, nil),
			},
			wantTypes: []string{"remote_start_on", "remote_start_off"},
		},
		{
			name: "single observation is baseline not edge",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "RemoteStartActive", dlBool(true), nil, nil, nil),
			},
			wantTypes: []string{},
		},
		{
			name: "steady state emits nothing",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "LightsHazardsActive", dlBool(false), nil, nil, nil),
				dlSignalRow(9, 0, "LightsHazardsActive", dlBool(false), nil, nil, nil),
			},
			wantTypes: []string{},
		},
		{
			name: "hazards and beams",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "LightsHazardsActive", dlBool(false), nil, nil, nil),
				dlSignalRow(8, 1, "LightsHighBeams", dlBool(false), nil, nil, nil),
				dlSignalRow(9, 0, "LightsHazardsActive", dlBool(true), nil, nil, nil),
				dlSignalRow(9, 30, "LightsHighBeams", dlBool(true), nil, nil, nil),
			},
			wantTypes: []string{"hazards_on", "high_beams_on"},
		},
		{
			name: "hvac power fluctuation without off emits one on",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "HvacPower", nil, nil, dlFloat(0), nil),
				dlSignalRow(9, 0, "HvacPower", nil, nil, dlFloat(1500), nil),
				dlSignalRow(9, 30, "HvacPower", nil, nil, dlFloat(1620.5), nil),
				dlSignalRow(10, 0, "HvacPower", nil, nil, dlFloat(0), nil),
			},
			wantTypes: []string{"hvac_on", "hvac_off"},
		},
		{
			name: "turn signal enum edges carry value",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "LightsTurnSignal", nil, dlInt(0), nil, nil),
				dlSignalRow(9, 0, "LightsTurnSignal", nil, dlInt(1), nil, nil),
			},
			wantTypes: []string{"turn_signal"},
		},
		{
			name: "door and window",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "DoorStateDriverFront", dlBool(false), nil, nil, nil),
				dlSignalRow(8, 1, "FdWindow", nil, dlInt(0), nil, nil),
				dlSignalRow(9, 0, "DoorStateDriverFront", dlBool(true), nil, nil, nil),
				dlSignalRow(9, 1, "FdWindow", nil, dlInt(3), nil, nil),
			},
			wantTypes: []string{"door_open", "window"},
		},
		{
			name: "homelink and located",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "HomelinkNearby", dlBool(false), nil, nil, nil),
				dlSignalRow(8, 1, "LocatedAtHome", dlBool(true), nil, nil, nil),
				dlSignalRow(9, 0, "HomelinkNearby", dlBool(true), nil, nil, nil),
				dlSignalRow(9, 1, "LocatedAtHome", dlBool(false), nil, nil, nil),
			},
			wantTypes: []string{"homelink_nearby_on", "left_home"},
		},
		{
			name: "unknown fields emit nothing",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "SomeFutureField", dlBool(false), nil, nil, nil),
				dlSignalRow(9, 0, "SomeFutureField", dlBool(true), nil, nil, nil),
			},
			wantTypes: []string{},
		},
		{
			name: "untyped rows skipped",
			rows: []daylogdb.DaySignalRow{
				{Ts: dlTime(8, 0), Field: "LightsHazardsActive"},
				dlSignalRow(9, 0, "LightsHazardsActive", dlBool(true), nil, nil, nil),
			},
			// First typed row is the baseline; the untyped row is skipped.
			wantTypes: []string{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			in := dlBaseInput()
			in.Signals = tt.rows
			out := BuildTimeline(in)
			if got := eventTypes(out.Events); !equalStrings(got, tt.wantTypes) {
				t.Errorf("types = %v, want %v", got, tt.wantTypes)
			}
		})
	}
}

func TestBuildTimeline_SignalPayloads(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.Signals = []daylogdb.DaySignalRow{
		dlSignalRow(8, 0, "LightsTurnSignal", nil, dlInt(0), nil, nil),
		dlSignalRow(9, 0, "LightsTurnSignal", nil, dlInt(2), nil, nil),
		dlSignalRow(8, 0, "DoorStateDriverFront", dlBool(false), nil, nil, nil),
		dlSignalRow(9, 5, "DoorStateDriverFront", dlBool(true), nil, nil, nil),
		dlSignalRow(8, 0, "HvacPower", nil, nil, dlFloat(0), nil),
		dlSignalRow(9, 10, "HvacPower", nil, nil, dlFloat(2100), nil),
	}
	out := BuildTimeline(in)
	if e := findEvent(out.Events, "turn_signal"); e == nil || e.Payload["value"] != int64(2) {
		t.Errorf("turn_signal payload = %+v, want value=2", e)
	} else if e.Layer != LayerTurnSignals {
		t.Errorf("turn_signal layer = %q", e.Layer)
	}
	if e := findEvent(out.Events, "door_open"); e == nil || e.Payload["door"] != "driver_front" {
		t.Errorf("door_open payload = %+v, want door=driver_front", e)
	} else if e.Layer != LayerDoorsWindow {
		t.Errorf("door_open layer = %q", e.Layer)
	}
	if e := findEvent(out.Events, "hvac_on"); e == nil || e.Payload["power_w"] != 2100.0 {
		t.Errorf("hvac_on payload = %+v, want power_w=2100", e)
	}
}

func TestBuildTimeline_GearEdges(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.Layers = []string{LayerGear}
	in.Gears = []daylogdb.DayGearTick{
		{Ts: dlTime(10, 0), Gear: "P"},
		{Ts: dlTime(10, 1), Gear: "P"},
		{Ts: dlTime(10, 2), Gear: "D"},
		{Ts: dlTime(10, 3), Gear: "D"},
		{Ts: dlTime(11, 0), Gear: "P"},
	}
	out := BuildTimeline(in)
	if got, want := eventTypes(out.Events), []string{"gear", "gear"}; !equalStrings(got, want) {
		t.Fatalf("types = %v, want %v", got, want)
	}
	if out.Events[0].Payload["gear"] != "D" || out.Events[1].Payload["gear"] != "P" {
		t.Errorf("gear payloads = %v %v", out.Events[0].Payload, out.Events[1].Payload)
	}
	if out.Events[0].Layer != LayerGear {
		t.Errorf("gear layer = %q", out.Events[0].Layer)
	}
}

func TestBuildTimeline_SoftwareUpdates(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	installed := dlTime(15, 0)
	in.Software = []daylogdb.DaySoftwareUpdate{
		{ID: 1, VehicleID: 1, Version: "2026.32.1", Status: "available", InstalledAt: &installed, CreatedAt: dlTime(9, 0)},
		{ID: 2, VehicleID: 1, Version: "2026.28.4", Status: "installed", InstalledAt: dlTimePtr(5, 0), CreatedAt: dlTime(4, 0)},
	}
	out := BuildTimeline(in)
	if got, want := eventTypes(out.Events), []string{"sw_update", "sw_update_installed"}; !equalStrings(got, want) {
		t.Fatalf("types = %v, want %v", got, want)
	}
	if e := findEvent(out.Events, "sw_update"); e.Payload["version"] != "2026.32.1" || e.Payload["status"] != "available" {
		t.Errorf("sw_update payload = %v", e.Payload)
	}
}

func TestBuildTimeline_SortAndCap(t *testing.T) {
	t.Parallel()
	t.Run("chronological with id tiebreak", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.Security = []daylogdb.DaySecurityEvent{
			{ID: 9, Ts: dlTime(12, 0), EventType: "locked", ToState: dlStr("true")},
			{ID: 2, Ts: dlTime(12, 0), EventType: "locked", ToState: dlStr("false")},
		}
		in.Drives = []daylogdb.DayDrive{{ID: 1, VehicleID: 1, StartedAt: dlTime(8, 0)}}
		out := BuildTimeline(in)
		if len(out.Events) != 3 {
			t.Fatalf("events = %d, want 3", len(out.Events))
		}
		if out.Events[0].Type != "drive_start" || out.Events[1].ID != "sec:2" || out.Events[2].ID != "sec:9" {
			t.Errorf("order = %v %v %v", out.Events[0].ID, out.Events[1].ID, out.Events[2].ID)
		}
		if out.Truncated {
			t.Errorf("truncated must be false under cap")
		}
	})

	t.Run("output over cap truncates", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		for i := 0; i < 300; i++ {
			start := dlTime(8, 0).Add(time.Duration(i) * time.Second)
			end := start.Add(time.Minute)
			in.Drives = append(in.Drives, daylogdb.DayDrive{ID: int64(i + 1), VehicleID: 1, StartedAt: start, EndedAt: &end})
		}
		out := BuildTimeline(in)
		if len(out.Events) != dayLogEventCap {
			t.Errorf("events = %d, want cap %d", len(out.Events), dayLogEventCap)
		}
		if !out.Truncated {
			t.Errorf("truncated must be true over cap")
		}
	})

	t.Run("input overflow truncates", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.SignalOverflow = true
		if out := BuildTimeline(in); !out.Truncated {
			t.Errorf("truncated must be true on signal overflow")
		}
		in.SignalOverflow = false
		in.GearOverflow = true
		in.Layers = []string{LayerGear}
		if out := BuildTimeline(in); !out.Truncated {
			t.Errorf("truncated must be true on gear overflow")
		}
	})
}

func TestBuildTimeline_Summary(t *testing.T) {
	t.Parallel()
	t.Run("sums skip nils", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.Drives = []daylogdb.DayDrive{
			{ID: 1, VehicleID: 1, StartedAt: dlTime(8, 0), DurationS: dlInt(100), DistanceM: dlFloat(1000), EnergyUsedWh: dlFloat(200)},
			{ID: 2, VehicleID: 1, StartedAt: dlTime(9, 0)},
		}
		in.Charges = []daylogdb.DayCharge{
			{ID: 1, VehicleID: 1, StartedAt: dlTime(12, 0), TotalEnergyAddedWh: dlFloat(5000)},
			{ID: 2, VehicleID: 1, StartedAt: dlTime(14, 0)},
		}
		s := BuildTimeline(in).Summary
		if s.DriveCount != 2 || s.ChargeCount != 2 {
			t.Errorf("counts = %d/%d, want 2/2", s.DriveCount, s.ChargeCount)
		}
		if s.DriveDurationS == nil || *s.DriveDurationS != 100 {
			t.Errorf("duration = %v, want 100", s.DriveDurationS)
		}
		if s.DriveDistanceM == nil || *s.DriveDistanceM != 1000 {
			t.Errorf("distance = %v, want 1000", s.DriveDistanceM)
		}
		if s.EnergyUsedWh == nil || *s.EnergyUsedWh != 200 {
			t.Errorf("used = %v, want 200", s.EnergyUsedWh)
		}
		if s.EnergyAddedWh == nil || *s.EnergyAddedWh != 5000 {
			t.Errorf("added = %v, want 5000", s.EnergyAddedWh)
		}
	})

	t.Run("empty day sums are nil not zero", func(t *testing.T) {
		t.Parallel()
		s := BuildTimeline(dlBaseInput()).Summary
		if s.DriveCount != 0 || s.ChargeCount != 0 {
			t.Errorf("counts = %d/%d, want 0/0", s.DriveCount, s.ChargeCount)
		}
		if s.DriveDurationS != nil || s.DriveDistanceM != nil || s.EnergyAddedWh != nil || s.EnergyUsedWh != nil {
			t.Errorf("sums must be nil on empty day: %+v", s)
		}
	})
}

func TestBuildTimeline_Sources(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.Drives = []daylogdb.DayDrive{{ID: 1, VehicleID: 1, StartedAt: dlTime(8, 0)}}
	out := BuildTimeline(in)
	byName := map[string]Source{}
	for _, s := range out.Sources {
		byName[s.Source] = s
	}
	if byName["drives"].Status != SourceOK || byName["drives"].Count != 1 {
		t.Errorf("drives source = %+v", byName["drives"])
	}
	if byName["charging_sessions"].Status != SourceEmpty {
		t.Errorf("charging source = %+v, want empty", byName["charging_sessions"])
	}
	if _, ok := byName["drive_telemetry"]; ok {
		t.Errorf("drive_telemetry must be absent unless gear requested")
	}
	up, ok := byName["user_presence"]
	if !ok || up.Status != SourceUnavailable || up.Reason == nil {
		t.Errorf("user_presence = %+v, want unavailable with reason", up)
	}

	in.Layers = []string{LayerGear}
	in.Gears = []daylogdb.DayGearTick{{Ts: dlTime(8, 0), Gear: "P"}}
	out = BuildTimeline(in)
	found := false
	for _, s := range out.Sources {
		if s.Source == "drive_telemetry" && s.Status == SourceOK {
			found = true
		}
	}
	if !found {
		t.Errorf("drive_telemetry source missing when gear requested: %+v", out.Sources)
	}
}

func TestSignalFieldsForLayers(t *testing.T) {
	t.Parallel()
	fields := SignalFieldsForLayers(nil)
	if len(fields) != 1 || fields[0] != "RemoteStartActive" {
		t.Errorf("default fields = %v", fields)
	}
	fields = SignalFieldsForLayers([]string{"lights", "lights", "gear", "bogus"})
	// gear contributes no signal fields; bogus contributes none either
	// (validation rejects it at the handler, this is belt-and-braces).
	want := map[string]bool{"RemoteStartActive": true, "LightsHazardsActive": true, "LightsHighBeams": true}
	if len(fields) != len(want) {
		t.Fatalf("fields = %v", fields)
	}
	for _, f := range fields {
		if !want[f] {
			t.Errorf("unexpected field %q in %v", f, fields)
		}
	}
	if !WantsGear([]string{"gear"}) || WantsGear([]string{"lights"}) {
		t.Errorf("WantsGear wrong")
	}
}
