package smartreadinesssvc

import (
	"slices"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestParkedUnlockNeedsRepeatedUnlockedObservationsAtChosenPlace(t *testing.T) {
	park := time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)
	now := park.Add(7 * time.Minute)
	withinPlace := func(lat, lon float64) bool { return 47.1 < lat && lat < 47.2 && -122.3 < lon && lon < -122.2 }
	values := func() map[string]*signal.Value {
		return map[string]*signal.Value{
			"Gear": {Raw: "P", Timestamp: now}, "Locked": {Raw: false, Timestamp: now},
			"LocationLatitude": {Raw: 47.15, Timestamp: now}, "LocationLongitude": {Raw: -122.25, Timestamp: now},
		}
	}
	history := func() []signal.TimelineRow {
		var rows []signal.TimelineRow
		for i := 1; i < 7; i++ {
			at := park.Add(time.Duration(i) * time.Minute)
			received := at.Add(time.Second)
			row := signal.TimelineRow{Timestamp: at, ReceivedAt: &received, Fields: make(signal.State), ObservedAt: make(map[string]time.Time)}
			for field, value := range values() {
				row.Fields[field], row.ObservedAt[field] = value.Raw, at
			}
			rows = append(rows, row)
		}
		return rows
	}
	risk, reason := parkedUnlockRisk(values(), history(), park, park, now, withinPlace)
	if risk == nil || reason != domain.UnlockAtRisk || !risk.UnlockedSince.Equal(park.Add(time.Minute)) {
		t.Fatalf("want five observed minutes unlocked in the selected place, got %+v (%s)", risk, reason)
	}
	rows := history()
	at := rows[2].Timestamp.Add(30 * time.Second)
	receipt := at.Add(time.Second)
	location := signal.TimelineRow{
		Timestamp: at, ReceivedAt: &receipt,
		Fields:     signal.State{"LocationLatitude": 47.15, "LocationLongitude": -122.24},
		ObservedAt: map[string]time.Time{"LocationLatitude": at, "LocationLongitude": at},
	}
	rows = slices.Insert(rows, 3, location)
	risk, reason = parkedUnlockRisk(values(), rows, park, park, now, withinPlace)
	if risk == nil || reason != domain.UnlockAtRisk || !risk.UnlockedSince.Equal(park.Add(time.Minute)) {
		t.Errorf("a compatible standalone location cannot reset the observed grace: %+v (%s)", risk, reason)
	}
	location.Fields["LocationLongitude"] = -122.5
	risk, reason = parkedUnlockRisk(values(), rows, park, park, now, withinPlace)
	if risk != nil || reason != domain.UnlockGrace {
		t.Errorf("a standalone report outside the monitored place must break continuity: %+v (%s)", risk, reason)
	}
	for _, tc := range []struct {
		name   string
		change func(map[string]*signal.Value, []signal.TimelineRow)
		want   domain.ParkedUnlockReason
	}{
		{"locked now", func(v map[string]*signal.Value, _ []signal.TimelineRow) {
			v["Locked"].Raw = true
		}, domain.UnlockLocked},
		{"other parking location", func(v map[string]*signal.Value, _ []signal.TimelineRow) {
			v["LocationLongitude"].Raw = -122.5
		}, domain.UnlockOutsidePlace},
		{"stale lock status", func(v map[string]*signal.Value, _ []signal.TimelineRow) {
			v["Locked"].Timestamp = now.Add(-3 * time.Minute)
		}, domain.UnlockUnknown},
		{"relocked briefly", func(_ map[string]*signal.Value, r []signal.TimelineRow) {
			r[2].Fields["Locked"] = true
		}, domain.UnlockGrace},
		{"left chosen place", func(_ map[string]*signal.Value, r []signal.TimelineRow) {
			r[2].Fields["LocationLongitude"] = -122.5
		}, domain.UnlockGrace},
		{"forward-filled coordinates", func(_ map[string]*signal.Value, r []signal.TimelineRow) {
			delete(r[3].ObservedAt, "LocationLongitude")
		}, domain.UnlockGrace},
	} {
		t.Run(tc.name, func(t *testing.T) {
			live, rows := values(), history()
			tc.change(live, rows)
			risk, reason := parkedUnlockRisk(live, rows, park, park, now, withinPlace)
			if risk != nil || reason != tc.want {
				t.Fatalf("want silence (%s), got %+v (%s)", tc.want, risk, reason)
			}
		})
	}
}
