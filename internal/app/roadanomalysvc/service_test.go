package roadanomalysvc

import (
	"context"
	"errors"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var origin = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func row(ms int, g float64) signal.TimelineRow {
	ts := origin.Add(time.Duration(ms) * time.Millisecond)
	return signal.TimelineRow{
		Timestamp: ts,
		Fields: map[string]signal.SignalValue{
			"longitudinal": g * standardGravityMps2, "lateral": .02 * standardGravityMps2, "speed": 15.0,
			"latitude": 37.1, "longitude": -122.1, "brake": false,
		},
		ObservedAt: map[string]time.Time{
			"longitudinal": ts, "lateral": ts, "speed": ts,
			"latitude": ts, "longitude": ts,
		},
	}
}

func TestDetect(t *testing.T) {
	base := []signal.TimelineRow{row(0, .01), row(180, .72), row(370, .02)}
	tests := []struct {
		name           string
		mutate         func([]signal.TimelineRow) []signal.TimelineRow
		wantStatus     Status
		wantCandidates int
	}{
		{"impact", nil, "candidates", 1},
		{"unordered", func(r []signal.TimelineRow) []signal.TimelineRow { return []signal.TimelineRow{r[2], r[0], r[1]} }, "candidates", 1},
		{"braking", func(r []signal.TimelineRow) []signal.TimelineRow { r[1].Fields["brake"] = true; return r }, "insufficient_data", 0},
		{"turn", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["lateral"] = .28 * standardGravityMps2
			return r
		}, "insufficient_data", 0},
		{"small SI acceleration", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["longitudinal"] = .72 // m/s², not 0.72 g
			return r
		}, "no_candidates", 0},
		{"float32 SI acceleration", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["longitudinal"] = float32(.72 * standardGravityMps2)
			return r
		}, "candidates", 1},
		{"missing brake context", func(r []signal.TimelineRow) []signal.TimelineRow {
			delete(r[1].Fields, "brake")
			return r
		}, "insufficient_data", 0},
		{"zero pedal context", func(r []signal.TimelineRow) []signal.TimelineRow {
			delete(r[1].Fields, "brake")
			r[1].Fields["brake_position"] = 0.0
			return r
		}, "candidates", 1},
		{"sustained maneuver", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[0].Fields["longitudinal"] = -.4 * standardGravityMps2
			return r
		}, "no_candidates", 0},
		{"stale gps", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].ObservedAt["latitude"] = r[1].Timestamp.Add(-2 * time.Second)
			return r
		}, "insufficient_data", 0},
		{"missing gps provenance", func(r []signal.TimelineRow) []signal.TimelineRow {
			delete(r[1].ObservedAt, "longitude")
			return r
		}, "insufficient_data", 0},
		{"sparse emissions", func(r []signal.TimelineRow) []signal.TimelineRow {
			delete(r[1].ObservedAt, "longitudinal")
			return r
		}, "insufficient_data", 0},
		{"slow sampling", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[2].Timestamp = origin.Add(1200 * time.Millisecond)
			r[2].ObservedAt["longitudinal"] = r[2].Timestamp
			return r
		}, "insufficient_data", 0},
		{"duplicate timestamp", func(r []signal.TimelineRow) []signal.TimelineRow {
			return append(r, r[1])
		}, "insufficient_data", 0},
		{"below threshold", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["longitudinal"] = .449 * standardGravityMps2
			return r
		}, "no_candidates", 0},
		{"at threshold", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["longitudinal"] = .45 * standardGravityMps2
			return r
		}, "candidates", 1},
		{"too slow", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["speed"] = 4.99
			return r
		}, "insufficient_data", 0},
		{"speed change braking", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[0].Fields["speed"] = 18.0
			return r
		}, "no_candidates", 0},
		{"forward filled spike", func(r []signal.TimelineRow) []signal.TimelineRow {
			r[1].Fields["longitudinal"] = .72 * standardGravityMps2
			delete(r[1].ObservedAt, "longitudinal")
			return r
		}, "insufficient_data", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rows := []signal.TimelineRow{row(0, .01), row(180, .72), row(370, .02)}
			if tc.mutate != nil {
				rows = tc.mutate(rows)
			}
			got := Detect(rows)
			if got.Status != tc.wantStatus || len(got.Candidates) != tc.wantCandidates {
				t.Fatalf("status=%s candidates=%v assessed=%d", got.Status, got.Candidates, got.AssessableWindows)
			}
			if len(got.Candidates) > 0 {
				c := got.Candidates[0]
				if c.Timestamp != base[1].Timestamp || c.Classification != "possible_road_anomaly" ||
					c.JerkGPerS <= 0 || c.SampleIntervalMs != 180 {
					t.Fatalf("candidate: %+v", c)
				}
			}
		})
	}
}

type testDrives struct{ drive *drivemodel.Drive }

func (d testDrives) GetByID(_ context.Context, id int64) (*drivemodel.Drive, error) {
	if d.drive == nil || d.drive.ID != id {
		return nil, nil
	}
	return d.drive, nil
}

type testTimeline struct {
	rows     []signal.TimelineRow
	opts     signal.TimelineOptions
	vehicle  int64
	from, to time.Time
	err      error
}

func (t *testTimeline) Timeline(_ context.Context, vehicle int64, _ []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	t.opts, t.vehicle, t.from, t.to = opts, vehicle, from, to
	return t.rows, t.err
}
func (*testTimeline) State(context.Context, int64, time.Time) (signal.State, error) {
	return nil, errors.New("unexpected State")
}
func (*testTimeline) SignalAt(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
	return nil, errors.New("unexpected SignalAt")
}

func TestAnalyzeBounds(t *testing.T) {
	end := origin.Add(time.Minute)
	reader := &testTimeline{rows: []signal.TimelineRow{row(0, .01), row(180, .72), row(370, .02)}}
	d := &drivemodel.Drive{ID: 7, VehicleID: 9, StartTs: origin, EndTs: &end}
	svc := New(testDrives{d}, reader)
	got, err := svc.Analyze(context.Background(), 7)
	if err != nil || got.DriveID != 7 || got.VehicleID != 9 || reader.vehicle != 9 ||
		reader.from != origin.Add(-time.Nanosecond) || reader.to != end || reader.opts.MaxRows != maxRows+1 || reader.opts.MaxEvents != maxEvents {
		t.Fatalf("result=%+v err=%v reader=%+v", got, err, reader)
	}
	reader.vehicle = 0
	_, err = svc.Analyze(context.Background(), 8)
	if !errors.Is(err, ErrNotFound) || reader.vehicle != 0 {
		t.Fatalf("different drive must not read vehicle signals: err=%v vehicle=%d", err, reader.vehicle)
	}
	largeEnd := origin.Add(MaxWindow + time.Second)
	_, err = New(testDrives{&drivemodel.Drive{ID: 7, StartTs: origin, EndTs: &largeEnd, VehicleID: 9}}, reader).Analyze(context.Background(), 7)
	if !errors.Is(err, ErrWindowTooLarge) {
		t.Fatalf("large window error = %v", err)
	}
	reader.rows = make([]signal.TimelineRow, maxRows+1)
	got, err = svc.Analyze(context.Background(), 7)
	if err != nil || got.Status != "insufficient_data" || len(got.Candidates) != 0 ||
		len(got.Reasons) != 1 || got.Reasons[0] != "timeline_row_limit_exceeded" {
		t.Fatalf("truncation result=%+v err=%v", got, err)
	}
	reader.err = signal.ErrTimelineEventLimit
	got, err = svc.Analyze(context.Background(), 7)
	if err != nil || got.Status != "insufficient_data" || len(got.Candidates) != 0 ||
		len(got.Reasons) != 1 || got.Reasons[0] != "timeline_event_limit_exceeded" {
		t.Fatalf("raw event cap result=%+v err=%v", got, err)
	}
}
