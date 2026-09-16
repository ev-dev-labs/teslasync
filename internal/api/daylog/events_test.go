package daylog

import (
	"testing"
	"time"

	daylogdb "github.com/ev-dev-labs/teslasync/internal/database/daylog"
	protomodel "github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
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
	if got := findEvent(out.Events, "parked"); got.Payload["from"] != "driving" || got.Payload["to"] != "parked" {
		t.Errorf("parked from/to = %v/%v, want driving/parked", got.Payload["from"], got.Payload["to"])
	}
	if got := findEvent(out.Events, "state_change"); got.Payload["to"] != "wobbling" {
		t.Errorf("state_change to = %v, want wobbling", got.Payload["to"])
	}
	if got := findEvent(out.Events, "parked"); got.Source != SourceFSM {
		t.Errorf("parked source = %q, want %q", got.Source, SourceFSM)
	}
}

func TestBuildTimeline_SecurityMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		eventType string
		toState   *string
		wantType  string
		wantTo    any
	}{
		{"locked true", "locked", dlStr("true"), "locked", true},
		{"locked false", "locked", dlStr("false"), "unlocked", false},
		{"locked garbage", "locked", dlStr("maybe"), "lock_unknown", "maybe"},
		{"locked nil", "locked", nil, "lock_unknown", nil},
		{"sentry off", "sentry_mode", dlStr("SentryModeStateOff"), "sentry_off", "SentryModeStateOff"},
		{"sentry unknown token", "sentry_mode", dlStr("SentryModeStateUnknown"), "sentry_off", "SentryModeStateUnknown"},
		{"sentry armed", "sentry_mode", dlStr("SentryModeStateArmed"), "sentry_on", "SentryModeStateArmed"},
		{"sentry idle counts on", "sentry_mode", dlStr("SentryModeStateIdle"), "sentry_on", "SentryModeStateIdle"},
		{"sentry nil", "sentry_mode", nil, "sentry_unknown", nil},
		{"valet on", "valet_mode_enabled", dlStr("true"), "valet_on", true},
		{"valet off", "valet_mode_enabled", dlStr("false"), "valet_off", false},
		{"valet nil", "valet_mode_enabled", nil, "valet_unknown", nil},
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
			if e.Payload["to"] != tt.wantTo {
				t.Errorf("to payload = %v, want %v", e.Payload["to"], tt.wantTo)
			}
			if _, hasFrom := e.Payload["from"]; hasFrom {
				t.Errorf("from must be absent with no baseline, got %v", e.Payload["from"])
			}
			if e.Source != SourceSecurity {
				t.Errorf("source = %q, want %q", e.Source, SourceSecurity)
			}
		})
	}
}

func TestBuildTimeline_SecurityPrevChaining(t *testing.T) {
	t.Parallel()
	t.Run("in-window chain", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.Security = []daylogdb.DaySecurityEvent{
			{ID: 1, Ts: dlTime(8, 0), EventType: "locked", ToState: dlStr("false")},
			{ID: 2, Ts: dlTime(9, 0), EventType: "locked", ToState: dlStr("true")},
		}
		out := BuildTimeline(in)
		if len(out.Events) != 2 {
			t.Fatalf("events = %d, want 2", len(out.Events))
		}
		if _, ok := out.Events[0].Payload["from"]; ok {
			t.Errorf("first event must not invent from")
		}
		if out.Events[1].Payload["from"] != false || out.Events[1].Payload["to"] != true {
			t.Errorf("chained from/to = %v/%v", out.Events[1].Payload["from"], out.Events[1].Payload["to"])
		}
	})

	t.Run("pre-window baseline seeds from", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.PrevSecurity = map[string]*string{"sentry_mode": dlStr("SentryModeStateIdle")}
		in.Security = []daylogdb.DaySecurityEvent{
			{ID: 5, Ts: dlTime(9, 0), EventType: "sentry_mode", ToState: dlStr("SentryModeStateArmed")},
		}
		out := BuildTimeline(in)
		e := out.Events[0]
		if e.Payload["from"] != "SentryModeStateIdle" || e.Payload["to"] != "SentryModeStateArmed" {
			t.Errorf("from/to = %v/%v", e.Payload["from"], e.Payload["to"])
		}
	})

	t.Run("unrecognized type surfaces generic", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.Security = []daylogdb.DaySecurityEvent{
			{ID: 6, Ts: dlTime(9, 0), EventType: "future_alarm", ToState: dlStr("ringing")},
		}
		out := BuildTimeline(in)
		if len(out.Events) != 1 || out.Events[0].Type != "security" {
			t.Fatalf("events = %+v, want one generic security", out.Events)
		}
		e := out.Events[0]
		if e.Payload["event_type"] != "future_alarm" || e.Payload["to"] != "ringing" {
			t.Errorf("payload = %v", e.Payload)
		}
	})
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
			name: "hvac enum off on precondition off",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "HvacPower", nil, dlInt(1), nil, nil),
				dlSignalRow(9, 0, "HvacPower", nil, dlInt(2), nil, nil),
				dlSignalRow(9, 30, "HvacPower", nil, dlInt(3), nil, nil),
				dlSignalRow(10, 0, "HvacPower", nil, dlInt(1), nil, nil),
			},
			wantTypes: []string{"hvac_on", "hvac_on", "hvac_off"},
		},
		{
			name: "turn signal off left off",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "LightsTurnSignal", nil, dlInt(1), nil, nil),
				dlSignalRow(9, 0, "LightsTurnSignal", nil, dlInt(2), nil, nil),
				dlSignalRow(9, 1, "LightsTurnSignal", nil, dlInt(1), nil, nil),
			},
			wantTypes: []string{"turn_signal", "turn_signal"},
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
			name: "unknown fields surface generic signal",
			rows: []daylogdb.DaySignalRow{
				dlSignalRow(8, 0, "SomeFutureField", dlBool(false), nil, nil, nil),
				dlSignalRow(9, 0, "SomeFutureField", dlBool(true), nil, nil, nil),
			},
			wantTypes: []string{"signal"},
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
		dlSignalRow(8, 0, "LightsTurnSignal", nil, dlInt(1), nil, nil),
		dlSignalRow(9, 0, "LightsTurnSignal", nil, dlInt(2), nil, nil),
		dlSignalRow(8, 0, "DoorStateDriverFront", dlBool(false), nil, nil, nil),
		dlSignalRow(9, 5, "DoorStateDriverFront", dlBool(true), nil, nil, nil),
		dlSignalRow(8, 0, "HvacPower", nil, dlInt(1), nil, nil),
		dlSignalRow(9, 10, "HvacPower", nil, dlInt(2), nil, nil),
		dlSignalRow(8, 0, "FdWindow", nil, dlInt(1), nil, nil),
		dlSignalRow(9, 15, "FdWindow", nil, dlInt(3), nil, nil),
	}
	out := BuildTimeline(in)
	e := findEvent(out.Events, "turn_signal")
	if e == nil {
		t.Fatalf("turn_signal missing: %+v", out.Events)
	}
	if e.Payload["component"] != "left" || e.Payload["from"] != "off" || e.Payload["to"] != "left" {
		t.Errorf("turn_signal payload = %v", e.Payload)
	}
	if e.Payload["from_value"] != int64(1) || e.Payload["to_value"] != int64(2) {
		t.Errorf("turn_signal raw values = %v", e.Payload)
	}
	if e.Layer != LayerTurnSignals || e.Source != SourceSignalLog {
		t.Errorf("turn_signal layer/source = %q/%q", e.Layer, e.Source)
	}
	if e := findEvent(out.Events, "door_open"); e == nil || e.Payload["door"] != "driver_front" {
		t.Errorf("door_open payload = %+v, want door=driver_front", e)
	} else {
		if e.Payload["from"] != false || e.Payload["to"] != true {
			t.Errorf("door_open from/to = %v/%v", e.Payload["from"], e.Payload["to"])
		}
		if e.Layer != LayerDoorsWindow {
			t.Errorf("door_open layer = %q", e.Layer)
		}
	}
	if e := findEvent(out.Events, "hvac_on"); e == nil || e.Payload["from"] != "off" || e.Payload["to"] != "on" {
		t.Errorf("hvac_on payload = %+v", e)
	}
	if e := findEvent(out.Events, "window"); e == nil || e.Payload["from"] != "closed" || e.Payload["to"] != "open" {
		t.Errorf("window payload = %+v", e)
	}
}

func TestBuildTimeline_GenericSignalKeepsLayer(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.FieldLayers = map[string]string{"SomeFutureField": LayerLights}
	in.Signals = []daylogdb.DaySignalRow{
		dlSignalRow(8, 0, "SomeFutureField", dlBool(false), nil, nil, nil),
		dlSignalRow(9, 0, "SomeFutureField", dlBool(true), nil, nil, nil),
	}
	out := BuildTimeline(in)
	if len(out.Events) != 1 {
		t.Fatalf("events = %d, want 1", len(out.Events))
	}
	e := out.Events[0]
	if e.Type != "signal" || e.Layer != LayerLights {
		t.Errorf("type/layer = %q/%q", e.Type, e.Layer)
	}
	if e.Payload["field"] != "SomeFutureField" || e.Payload["from"] != false || e.Payload["to"] != true {
		t.Errorf("payload = %v", e.Payload)
	}
}

func TestBuildTimeline_GearEdges(t *testing.T) {
	t.Parallel()
	in := dlBaseInput()
	in.Layers = []string{LayerGear}
	in.Gears = []daylogdb.DayGearTick{
		{Ts: dlTime(10, 0), Gear: "ShiftStateP"},
		{Ts: dlTime(10, 1), Gear: "ShiftStateP"},
		{Ts: dlTime(10, 2), Gear: "ShiftStateD"},
		{Ts: dlTime(10, 3), Gear: "ShiftStateD"},
		{Ts: dlTime(11, 0), Gear: "P"},
	}
	out := BuildTimeline(in)
	if got, want := eventTypes(out.Events), []string{"gear", "gear"}; !equalStrings(got, want) {
		t.Fatalf("types = %v, want %v", got, want)
	}
	first, second := out.Events[0], out.Events[1]
	if first.Payload["from"] != "P" || first.Payload["to"] != "D" {
		t.Errorf("first from/to = %v/%v", first.Payload["from"], first.Payload["to"])
	}
	if first.Payload["to_raw"] != "ShiftStateD" {
		t.Errorf("first to_raw = %v", first.Payload["to_raw"])
	}
	if second.Payload["from"] != "D" || second.Payload["to"] != "P" {
		t.Errorf("second from/to = %v/%v (short form input)", second.Payload["from"], second.Payload["to"])
	}
	if first.Layer != LayerGear || first.Source != SourceGear {
		t.Errorf("gear layer/source = %q/%q", first.Layer, first.Source)
	}
}

func TestGearShortForm(t *testing.T) {
	t.Parallel()
	tests := []struct {
		stored string
		want   string
		wantOK bool
	}{
		{"ShiftStateP", "P", true},
		{"ShiftStateR", "R", true},
		{"ShiftStateN", "N", true},
		{"ShiftStateD", "D", true},
		{"P", "P", true},
		{"D", "D", true},
		{"ShiftStateUnknown", "unknown", true},
		{"ShiftStateInvalid", "invalid", true},
		{"ShiftStateSNA", "sna", true},
		{"ShiftStateTeleport", "ShiftStateTeleport", false},
		{"", "", false},
	}
	for _, tt := range tests {
		if got, ok := gearShortForm(tt.stored); got != tt.want || ok != tt.wantOK {
			t.Errorf("gearShortForm(%q) = (%q, %v), want (%q, %v)", tt.stored, got, ok, tt.want, tt.wantOK)
		}
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
	t.Run("chronological stable keeps source order on ties", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		in.Security = []daylogdb.DaySecurityEvent{
			{ID: 2, Ts: dlTime(12, 0), EventType: "locked", ToState: dlStr("false")},
			{ID: 9, Ts: dlTime(12, 0), EventType: "locked", ToState: dlStr("true")},
		}
		in.Drives = []daylogdb.DayDrive{{ID: 1, VehicleID: 1, StartedAt: dlTime(8, 0)}}
		out := BuildTimeline(in)
		if len(out.Events) != 3 {
			t.Fatalf("events = %d, want 3", len(out.Events))
		}
		if out.Events[0].Type != "drive_start" || out.Events[1].ID != "sec:2" || out.Events[2].ID != "sec:9" {
			t.Errorf("order = %v %v %v", out.Events[0].ID, out.Events[1].ID, out.Events[2].ID)
		}
		if out.Total != 3 {
			t.Errorf("total = %d, want 3", out.Total)
		}
		if out.Truncated {
			t.Errorf("truncated must be false without overflow")
		}
	})

	t.Run("paging slices without loss", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		for i := 0; i < 10; i++ {
			start := dlTime(8, 0).Add(time.Duration(i) * time.Hour)
			end := start.Add(time.Minute)
			in.Drives = append(in.Drives, daylogdb.DayDrive{ID: int64(i + 1), VehicleID: 1, StartedAt: start, EndedAt: &end})
		}
		in.Limit, in.Offset = 5, 5
		out := BuildTimeline(in)
		if out.Total != 20 {
			t.Errorf("total = %d, want 20", out.Total)
		}
		if len(out.Events) != 5 {
			t.Errorf("page = %d, want 5", len(out.Events))
		}
		if out.Truncated {
			t.Errorf("paging must not set truncated")
		}
		// Offset past the end yields an empty page, not an error.
		in.Offset = 99
		if out := BuildTimeline(in); len(out.Events) != 0 || out.Total != 20 {
			t.Errorf("oob page = %d/%d", len(out.Events), out.Total)
		}
	})

	t.Run("default limit applies", func(t *testing.T) {
		t.Parallel()
		in := dlBaseInput()
		for i := 0; i < 300; i++ {
			start := dlTime(8, 0).Add(time.Duration(i) * time.Second)
			end := start.Add(time.Minute)
			in.Drives = append(in.Drives, daylogdb.DayDrive{ID: int64(i + 1), VehicleID: 1, StartedAt: start, EndedAt: &end})
		}
		out := BuildTimeline(in)
		if len(out.Events) != dayLogDefaultLimit || out.Total != 600 {
			t.Errorf("page/total = %d/%d, want 500/600", len(out.Events), out.Total)
		}
		if out.Truncated {
			t.Errorf("paging must not set truncated")
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

// TestEnumDisplayParity pins the read-side display maps against the
// generated enum String() output. If the proto renumbers a variant,
// this test fails loudly instead of letting the timeline mislabel.
// Importing generated bindings in a TEST to assert known-good output
// shape is the sanctioned exception to the codec rule.
func TestEnumDisplayParity(t *testing.T) {
	t.Parallel()
	turnCases := map[int64]string{
		0: "TurnSignalStateUnknown",
		1: "TurnSignalStateOff",
		2: "TurnSignalStateLeft",
		3: "TurnSignalStateRight",
		4: "TurnSignalStateBoth",
	}
	for n, wantStr := range turnCases {
		if got := protomodel.TurnSignalState(n).String(); got != wantStr {
			t.Errorf("TurnSignalState(%d).String() = %q, want %q (proto drift?)", n, got, wantStr)
		}
		if _, ok := turnSignalShort[n]; !ok {
			t.Errorf("turnSignalShort missing %d (%s)", n, wantStr)
		}
	}
	if len(turnSignalShort) != len(turnCases) {
		t.Errorf("turnSignalShort has %d entries, want %d", len(turnSignalShort), len(turnCases))
	}
	windowCases := map[int64]string{
		0: "WindowStateUnknown",
		1: "WindowStateClosed",
		2: "WindowStatePartiallyOpen",
		3: "WindowStateOpened",
	}
	for n, wantStr := range windowCases {
		if got := protomodel.WindowState(n).String(); got != wantStr {
			t.Errorf("WindowState(%d).String() = %q, want %q (proto drift?)", n, got, wantStr)
		}
		if _, ok := windowShort[n]; !ok {
			t.Errorf("windowShort missing %d (%s)", n, wantStr)
		}
	}
	hvacCases := map[int64]string{
		0: "HvacPowerStateUnknown",
		1: "HvacPowerStateOff",
		2: "HvacPowerStateOn",
		3: "HvacPowerStatePrecondition",
		4: "HvacPowerStateOverheatProtect",
	}
	for n, wantStr := range hvacCases {
		if got := protomodel.HvacPowerState(n).String(); got != wantStr {
			t.Errorf("HvacPowerState(%d).String() = %q, want %q (proto drift?)", n, got, wantStr)
		}
		if _, ok := hvacShort[n]; !ok {
			t.Errorf("hvacShort missing %d (%s)", n, wantStr)
		}
	}
}

func TestFieldLayersForLayers(t *testing.T) {
	t.Parallel()
	m := FieldLayersForLayers([]string{"lights"})
	if m["RemoteStartActive"] != LayerDefault {
		t.Errorf("default field layer = %q", m["RemoteStartActive"])
	}
	if m["LightsHazardsActive"] != LayerLights || m["LightsHighBeams"] != LayerLights {
		t.Errorf("lights fields = %v", m)
	}
	if _, ok := m["HvacPower"]; ok {
		t.Errorf("unrequested field must be absent: %v", m)
	}
	full := FieldLayersForLayers(AllLayers)
	for _, l := range AllLayers {
		for _, f := range layerSignalFields[l] {
			if full[f] != l {
				t.Errorf("field %q layer = %q, want %q", f, full[f], l)
			}
		}
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
