package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestParkedClosureRequiresAStableObservedGracePeriod(t *testing.T) {
	parkAt := time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)
	now := parkAt.Add(7 * time.Minute)
	liveSample := func() map[string]*signal.Value {
		values := make(map[string]*signal.Value)
		for i, closure := range closurePositions {
			values[closure.field] = &signal.Value{Raw: i == 5, Timestamp: now}
		}
		values["Gear"] = &signal.Value{Raw: "P", Timestamp: now.Add(-time.Minute)}
		values["ServiceMode"] = &signal.Value{Raw: false, Timestamp: now}
		values["DriverSeatOccupied"] = &signal.Value{Raw: false, Timestamp: now}
		return values
	}
	history := func() []signal.TimelineRow {
		rows := make([]signal.TimelineRow, 0, 7)
		for i := 1; i < 7; i++ {
			at := parkAt.Add(time.Duration(i) * time.Minute)
			received := at.Add(time.Second)
			row := signal.TimelineRow{Timestamp: at, ReceivedAt: &received, Fields: make(map[string]signal.SignalValue), ObservedAt: make(map[string]time.Time)}
			for j, closure := range closurePositions {
				row.Fields[closure.field], row.ObservedAt[closure.field] = j == 5, at
			}
			row.Fields["Gear"], row.ObservedAt["Gear"] = "P", at
			for _, name := range closureActivityFields {
				row.Fields[name], row.ObservedAt[name] = false, at
			}
			rows = append(rows, row)
		}
		return rows
	}
	risk, reason := parkedClosureRisk(liveSample(), history(), parkAt, parkAt, now, minClosureGrace)
	if reason != domain.ClosureAtRisk || risk == nil || risk.Position != domain.ClosureRearTrunk ||
		!risk.OpenSince.Equal(parkAt.Add(time.Minute)) || !risk.ActionUntil.Equal(now.Add(time.Minute)) {
		t.Fatalf("want specific observed rear trunk risk and oldest-input expiry: %+v (%s)", risk, reason)
	}
	tests := []struct {
		name   string
		change func(values map[string]*signal.Value, rows []signal.TimelineRow) []signal.TimelineRow
		want   domain.ParkedClosureReason
	}{
		{"closed now", func(v map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			v["DoorStateRearTrunk"].Raw = false
			return r
		}, domain.ClosureClosed},
		{"fresh seat occupancy", func(v map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			v["DriverSeatOccupied"].Raw = true
			return r
		}, domain.ClosureActive},
		{"service mode", func(v map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			v["ServiceMode"].Raw = true
			return r
		}, domain.ClosureActive},
		{"stale actual closure", func(v map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			v["DoorStateRearTrunk"].Timestamp = now.Add(-4 * time.Minute)
			return r
		}, domain.ClosureUnknown},
		{"synthetic closure", func(v map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			v["DoorStateRearTrunk"].TimestampSynthetic = true
			return r
		}, domain.ClosureUnknown},
		{"another closure moved during loading", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			r[4].Fields["DoorStateDriverFront"] = true
			return r
		}, domain.ClosureGrace},
		{"service ended too recently", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			r[3].Fields["ServiceMode"], r[3].ObservedAt["ServiceMode"] = true, r[3].Timestamp
			r[5].Fields["ServiceMode"], r[5].ObservedAt["ServiceMode"] = false, r[5].Timestamp
			return r
		}, domain.ClosureGrace},
		{"out of park during the window", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			r[4].Fields["Gear"], r[4].ObservedAt["Gear"] = "D", r[4].Timestamp
			return r
		}, domain.ClosureUnknown},
		{"interrupted observations", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			return append(r[:2], r[4:]...)
		}, domain.ClosureGrace},
		{"empty seat renewed after a freshness gap", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			delete(r[2].ObservedAt, "DriverSeatOccupied")
			return r
		}, domain.ClosureGrace},
		{"forward filled history is not evidence", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			for i := range r {
				delete(r[i].ObservedAt, "DoorStateRearTrunk")
			}
			return r
		}, domain.ClosureGrace},
		{"a fresh empty seat cannot prove nobody was loading earlier", func(_ map[string]*signal.Value, r []signal.TimelineRow) []signal.TimelineRow {
			for i := range r {
				delete(r[i].ObservedAt, "DriverSeatOccupied")
			}
			return r
		}, domain.ClosureGrace},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := liveSample()
			got, reason := parkedClosureRisk(values, test.change(values, history()), parkAt, parkAt, now, minClosureGrace)
			if got != nil || reason != test.want {
				t.Fatalf("want quiet %s, got %+v (%s)", test.want, got, reason)
			}
		})
	}
	if got, reason := parkedClosureRisk(liveSample(), history(), parkAt, now.Add(-time.Minute), now, minClosureGrace); got != nil || reason != domain.ClosureGrace {
		t.Fatalf("pre-consent observations cannot shorten the grace: %+v (%s)", got, reason)
	}
}
