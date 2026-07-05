package signaltest

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var baseTime = time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)

func TestNewFakeStateReader_Empty(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	if f == nil {
		t.Fatal("NewFakeStateReader returned nil")
	}

	state, err := f.State(context.Background(), 1, baseTime)
	if err != nil {
		t.Fatalf("State on empty fake: unexpected error %v", err)
	}
	if state == nil {
		t.Fatal("State returned nil map; contract requires non-nil")
	}
	if len(state) != 0 {
		t.Fatalf("State on empty fake: want 0 entries, got %d", len(state))
	}

	v, err := f.SignalAt(context.Background(), 1, "VehicleSpeed", baseTime)
	if err != nil {
		t.Fatalf("SignalAt on empty fake: unexpected error %v", err)
	}
	if v != nil {
		t.Fatalf("SignalAt on empty fake: want nil, got %#v", v)
	}

	rows, err := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline on empty fake: unexpected error %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("Timeline on empty fake: want 0 rows, got %d", len(rows))
	}
}

func TestFakeStateReader_ConformsToInterface(t *testing.T) {
	t.Parallel()
	var _ signal.StateReader = NewFakeStateReader()
}

func TestFakeStateReader_StateSnapshot(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetStateMany(1, map[string]signal.SignalValue{
		"VehicleSpeed": 42.0,
		"Gear":         "D",
		"Zero":         0.0,
		"False":        false,
	})

	state, err := f.State(context.Background(), 1, baseTime)
	if err != nil {
		t.Fatalf("State: unexpected error %v", err)
	}
	want := map[string]signal.SignalValue{
		"VehicleSpeed": 42.0,
		"Gear":         "D",
		"Zero":         0.0,
		"False":        false,
	}
	if len(state) != len(want) {
		t.Fatalf("State size = %d, want %d", len(state), len(want))
	}
	for k, wv := range want {
		if !equalSignalValue(state[k], wv) {
			t.Fatalf("State[%q] = %#v, want %#v", k, state[k], wv)
		}
	}
}

func TestFakeStateReader_StateCapturesAtAndIgnoresItForResult(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetState(1, "VehicleSpeed", 42.0)

	// A query far in the past still returns the configured snapshot (the fake
	// does not fold by time), but the `at` argument is captured.
	past := baseTime.Add(-100 * time.Hour)
	state, err := f.State(context.Background(), 1, past)
	if err != nil {
		t.Fatalf("State: unexpected error %v", err)
	}
	if !equalSignalValue(state["VehicleSpeed"], 42.0) {
		t.Fatalf("State ignored snapshot: got %#v", state["VehicleSpeed"])
	}
	if !f.LastStateAt().Equal(past) {
		t.Fatalf("LastStateAt = %v, want %v", f.LastStateAt(), past)
	}
}

func TestFakeStateReader_StateReturnsCallerOwnedCopy(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetState(1, "Speed", 10.0)

	state, _ := f.State(context.Background(), 1, baseTime)
	state["Speed"] = 999.0
	state["Injected"] = "x"

	fresh, _ := f.State(context.Background(), 1, baseTime)
	if !equalSignalValue(fresh["Speed"], 10.0) {
		t.Fatalf("fake storage mutated via returned map: Speed = %#v", fresh["Speed"])
	}
	if _, ok := fresh["Injected"]; ok {
		t.Fatal("fake storage mutated: unexpected Injected key")
	}
}

func TestFakeStateReader_SetStateNilDeletes(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetState(1, "Speed", 10.0)
	f.SetState(1, "Gear", "D")
	f.SetState(1, "Speed", nil)

	if v, _ := f.SignalAt(context.Background(), 1, "Speed", baseTime); v != nil {
		t.Fatalf("after SetState(nil), SignalAt(Speed) = %#v, want nil", v)
	}
	if v, _ := f.SignalAt(context.Background(), 1, "Gear", baseTime); v != "D" {
		t.Fatalf("SignalAt(Gear) = %#v, want \"D\"", v)
	}
}

func TestFakeStateReader_SignalAt(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		seed   map[string]signal.SignalValue
		lookup string
		want   signal.SignalValue
	}{
		{"present numeric", map[string]signal.SignalValue{"Speed": 65.0}, "Speed", 65.0},
		{"present zero", map[string]signal.SignalValue{"Soc": 0.0}, "Soc", 0.0},
		{"present string", map[string]signal.SignalValue{"Gear": "P"}, "Gear", "P"},
		{"absent returns nil", map[string]signal.SignalValue{"Speed": 65.0}, "Odometer", nil},
		{"absent on unknown vehicle", nil, "Speed", nil},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := NewFakeStateReader()
			if tc.seed != nil {
				f.SetStateMany(1, tc.seed)
			}
			got, err := f.SignalAt(context.Background(), 1, tc.lookup, baseTime)
			if err != nil {
				t.Fatalf("SignalAt: unexpected error %v", err)
			}
			if !equalSignalValue(got, tc.want) {
				t.Fatalf("SignalAt(%q) = %#v, want %#v", tc.lookup, got, tc.want)
			}
			if !f.LastSignalAt().Equal(baseTime) {
				t.Fatalf("LastSignalAt = %v, want %v", f.LastSignalAt(), baseTime)
			}
		})
	}
}

func TestFakeStateReader_ErrorInjection(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("signal_log query failed")
	f := NewFakeStateReader()
	f.SetState(1, "Speed", 10.0)
	f.SetTimeline(1, []signal.TimelineRow{{Timestamp: baseTime, Fields: map[string]signal.SignalValue{"speed": 10.0}}})
	f.SetError(sentinel)

	if s, err := f.State(context.Background(), 1, baseTime); !errors.Is(err, sentinel) || s != nil {
		t.Fatalf("State on error = (%#v, %v), want (nil, %v)", s, err, sentinel)
	}
	if v, err := f.SignalAt(context.Background(), 1, "Speed", baseTime); !errors.Is(err, sentinel) || v != nil {
		t.Fatalf("SignalAt on error = (%#v, %v), want (nil, %v)", v, err, sentinel)
	}
	if r, err := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{}); !errors.Is(err, sentinel) || r != nil {
		t.Fatalf("Timeline on error = (%#v, %v), want (nil, %v)", r, err, sentinel)
	}
}

func TestFakeStateReader_Reset(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetState(1, "Speed", 10.0)
	f.SetTimeline(1, []signal.TimelineRow{{Timestamp: baseTime}})
	f.SetError(errors.New("boom"))
	_, _ = f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{CollapseBy: []string{"x"}})

	f.Reset()

	// Assert the captured metadata is cleared BEFORE issuing any new call
	// (a new call would re-record it).
	if f.TimelineCalls() != 0 {
		t.Fatalf("after Reset, TimelineCalls = %d, want 0", f.TimelineCalls())
	}
	if f.LastTimelineFields() != nil {
		t.Fatalf("after Reset, LastTimelineFields = %#v, want nil", f.LastTimelineFields())
	}
	if got := f.LastTimelineOptions(); len(got.CollapseBy) != 0 {
		t.Fatalf("after Reset, LastTimelineOptions = %#v, want zero", got)
	}
	if gotFrom, gotTo := f.LastTimelineWindow(); !gotFrom.IsZero() || !gotTo.IsZero() {
		t.Fatalf("after Reset, LastTimelineWindow = (%v, %v), want zero", gotFrom, gotTo)
	}
	if !f.LastStateAt().IsZero() {
		t.Fatalf("after Reset, LastStateAt = %v, want zero", f.LastStateAt())
	}
	if !f.LastSignalAt().IsZero() {
		t.Fatalf("after Reset, LastSignalAt = %v, want zero", f.LastSignalAt())
	}

	// State and timeline data are cleared and the injected error is gone.
	state, err := f.State(context.Background(), 1, baseTime)
	if err != nil {
		t.Fatalf("after Reset, State error = %v, want nil", err)
	}
	if len(state) != 0 {
		t.Fatalf("after Reset, State = %#v, want empty", state)
	}
	rows, err := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if err != nil {
		t.Fatalf("after Reset, Timeline error = %v, want nil", err)
	}
	if len(rows) != 0 {
		t.Fatalf("after Reset, Timeline = %#v, want empty", rows)
	}
}

func timelineRow(offset time.Duration, fields map[string]signal.SignalValue) signal.TimelineRow {
	return signal.TimelineRow{Timestamp: baseTime.Add(offset), Fields: fields}
}

func TestFakeStateReader_TimelineWindow(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(-1*time.Minute, map[string]signal.SignalValue{"speed": 1.0}), // before window
		timelineRow(0, map[string]signal.SignalValue{"speed": 2.0}),              // at from (inclusive)
		timelineRow(1*time.Minute, map[string]signal.SignalValue{"speed": 3.0}),
		timelineRow(2*time.Minute, map[string]signal.SignalValue{"speed": 4.0}), // at to (exclusive)
		timelineRow(3*time.Minute, map[string]signal.SignalValue{"speed": 5.0}), // after window
	})

	from := baseTime
	to := baseTime.Add(2 * time.Minute)
	rows, err := f.Timeline(context.Background(), 1, nil, from, to, signal.TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: unexpected error %v", err)
	}
	// Half-open [from, to): includes t=0 and t=1m, excludes t=-1m, t=2m, t=3m.
	if len(rows) != 2 {
		t.Fatalf("Timeline window size = %d, want 2 (%#v)", len(rows), rows)
	}
	if !equalSignalValue(rows[0].Fields["speed"], 2.0) {
		t.Fatalf("row[0].speed = %#v, want 2.0", rows[0].Fields["speed"])
	}
	if !equalSignalValue(rows[1].Fields["speed"], 3.0) {
		t.Fatalf("row[1].speed = %#v, want 3.0", rows[1].Fields["speed"])
	}
}

func TestFakeStateReader_TimelineOrdersByTimestamp(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	// Deliberately out of order.
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(2*time.Minute, map[string]signal.SignalValue{"speed": 3.0}),
		timelineRow(0, map[string]signal.SignalValue{"speed": 1.0}),
		timelineRow(1*time.Minute, map[string]signal.SignalValue{"speed": 2.0}),
	})

	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if len(rows) != 3 {
		t.Fatalf("want 3 rows, got %d", len(rows))
	}
	for i := 1; i < len(rows); i++ {
		if rows[i].Timestamp.Before(rows[i-1].Timestamp) {
			t.Fatalf("rows not ascending by timestamp: %v then %v", rows[i-1].Timestamp, rows[i].Timestamp)
		}
	}
}

func TestFakeStateReader_TimelineProjectsFields(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"speed": 10.0, "gear": "D", "soc": 80.0}),
	})

	fields := []signal.FieldMapping{{Signal: "VehicleSpeed", Field: "speed"}}
	rows, _ := f.Timeline(context.Background(), 1, fields, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	if len(rows[0].Fields) != 1 {
		t.Fatalf("projected row should keep 1 field, got %d (%#v)", len(rows[0].Fields), rows[0].Fields)
	}
	if !equalSignalValue(rows[0].Fields["speed"], 10.0) {
		t.Fatalf("projected speed = %#v, want 10.0", rows[0].Fields["speed"])
	}
	if _, ok := rows[0].Fields["gear"]; ok {
		t.Fatal("projected row should not contain unrequested field gear")
	}
}

func TestFakeStateReader_TimelineChartModeKeepsDuplicates(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"gear": "D"}),
		timelineRow(1*time.Minute, map[string]signal.SignalValue{"gear": "D"}),
		timelineRow(2*time.Minute, map[string]signal.SignalValue{"gear": "D"}),
	})

	// Empty CollapseBy = chart mode: every emission kept.
	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if len(rows) != 3 {
		t.Fatalf("chart mode should keep all 3 rows, got %d", len(rows))
	}
}

func TestFakeStateReader_TimelineListModeCollapses(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"gear": "D"}),
		timelineRow(1*time.Minute, map[string]signal.SignalValue{"gear": "D"}),
		timelineRow(2*time.Minute, map[string]signal.SignalValue{"gear": "R"}),
		timelineRow(3*time.Minute, map[string]signal.SignalValue{"gear": "R"}),
		timelineRow(4*time.Minute, map[string]signal.SignalValue{"gear": "D"}),
	})

	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{CollapseBy: []string{"gear"}})
	// Runs: D(t0..t1) -> R(t2..t3) -> D(t4). Keep earliest of each run.
	if len(rows) != 3 {
		t.Fatalf("list mode collapse size = %d, want 3 (%#v)", len(rows), rows)
	}
	wantTs := []time.Duration{0, 2 * time.Minute, 4 * time.Minute}
	for i, off := range wantTs {
		if !rows[i].Timestamp.Equal(baseTime.Add(off)) {
			t.Fatalf("row[%d] ts = %v, want %v", i, rows[i].Timestamp, baseTime.Add(off))
		}
	}
	wantGear := []string{"D", "R", "D"}
	for i, g := range wantGear {
		if !equalSignalValue(rows[i].Fields["gear"], g) {
			t.Fatalf("row[%d].gear = %#v, want %q", i, rows[i].Fields["gear"], g)
		}
	}
}

func TestFakeStateReader_TimelineMultiFieldCollapse(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"gear": "D", "brake": false}),
		timelineRow(1*time.Minute, map[string]signal.SignalValue{"gear": "D", "brake": true}), // brake changed
		timelineRow(2*time.Minute, map[string]signal.SignalValue{"gear": "D", "brake": true}), // unchanged
	})

	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{CollapseBy: []string{"gear", "brake"}})
	if len(rows) != 2 {
		t.Fatalf("multi-field collapse size = %d, want 2 (%#v)", len(rows), rows)
	}
}

func TestFakeStateReader_TimelineCapturesCallMetadata(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	fields := []signal.FieldMapping{{Signal: "VehicleSpeed", Field: "speed"}}
	opts := signal.TimelineOptions{CollapseBy: []string{"speed"}}
	from := baseTime
	to := baseTime.Add(30 * time.Minute)

	_, _ = f.Timeline(context.Background(), 1, fields, from, to, opts)
	_, _ = f.Timeline(context.Background(), 1, fields, from, to, opts)

	if f.TimelineCalls() != 2 {
		t.Fatalf("TimelineCalls = %d, want 2", f.TimelineCalls())
	}
	gotFields := f.LastTimelineFields()
	if len(gotFields) != 1 || gotFields[0].Field != "speed" {
		t.Fatalf("LastTimelineFields = %#v, want [{VehicleSpeed speed}]", gotFields)
	}
	if got := f.LastTimelineOptions(); len(got.CollapseBy) != 1 || got.CollapseBy[0] != "speed" {
		t.Fatalf("LastTimelineOptions = %#v", got)
	}
	gotFrom, gotTo := f.LastTimelineWindow()
	if !gotFrom.Equal(from) || !gotTo.Equal(to) {
		t.Fatalf("LastTimelineWindow = (%v, %v), want (%v, %v)", gotFrom, gotTo, from, to)
	}
}

func TestFakeStateReader_TimelineReturnsCallerOwnedCopies(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	f.SetTimeline(1, []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"speed": 10.0}),
	})

	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	rows[0].Fields["speed"] = 999.0
	rows[0].Fields["injected"] = "x"

	fresh, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if !equalSignalValue(fresh[0].Fields["speed"], 10.0) {
		t.Fatalf("stored row mutated via returned copy: speed = %#v", fresh[0].Fields["speed"])
	}
	if _, ok := fresh[0].Fields["injected"]; ok {
		t.Fatal("stored row mutated: unexpected injected key")
	}
}

func TestFakeStateReader_SetTimelineDefensiveCopy(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	input := []signal.TimelineRow{
		timelineRow(0, map[string]signal.SignalValue{"speed": 10.0}),
	}
	f.SetTimeline(1, input)

	// Mutating the argument after SetTimeline must not affect the fake.
	input[0].Fields["speed"] = 999.0

	rows, _ := f.Timeline(context.Background(), 1, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
	if !equalSignalValue(rows[0].Fields["speed"], 10.0) {
		t.Fatalf("SetTimeline did not copy input: speed = %#v", rows[0].Fields["speed"])
	}
}

func TestFakeStateReader_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	f := NewFakeStateReader()
	const workers = 16
	const iterations = 200

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func(id int) {
			defer wg.Done()
			vehicleID := int64(id%4 + 1)
			for i := 0; i < iterations; i++ {
				f.SetState(vehicleID, "Speed", float64(i))
				f.SetStateMany(vehicleID, map[string]signal.SignalValue{"Gear": "D"})
				f.SetTimeline(vehicleID, []signal.TimelineRow{timelineRow(0, map[string]signal.SignalValue{"gear": "D"})})
				_, _ = f.State(context.Background(), vehicleID, baseTime)
				_, _ = f.SignalAt(context.Background(), vehicleID, "Speed", baseTime)
				_, _ = f.Timeline(context.Background(), vehicleID, nil, baseTime, baseTime.Add(time.Hour), signal.TimelineOptions{})
			}
		}(w)
	}
	wg.Wait()

	for vehicleID := int64(1); vehicleID <= 4; vehicleID++ {
		state, err := f.State(context.Background(), vehicleID, baseTime)
		if err != nil {
			t.Fatalf("State(%d): %v", vehicleID, err)
		}
		if _, ok := state["Gear"]; !ok {
			t.Fatalf("vehicle %d missing Gear after concurrent writes", vehicleID)
		}
	}
}
