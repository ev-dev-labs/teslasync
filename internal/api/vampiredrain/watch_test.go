package vampiredrain

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

func fptr(f float64) *float64 { return &f }

func watchEvent(start time.Time, perDay float64, temp *float64) drivedb.VampireDrainEvent {
	return drivedb.VampireDrainEvent{
		StartedAt:       start,
		EndedAt:         start.Add(10 * time.Hour),
		DurationHours:   10,
		DrainPctPerDay:  perDay,
		AmbientTempCAvg: temp,
	}
}

func TestEvaluateWatchOK(t *testing.T) {
	now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	events := []drivedb.VampireDrainEvent{
		watchEvent(now.Add(-24*time.Hour), 0.8, fptr(12)),
		watchEvent(now.Add(-48*time.Hour), 0.6, fptr(14)),
	}
	rep := EvaluateWatch(events, fptr(0.7), 3.0, now)
	if rep.Status != WatchStatusOK {
		t.Fatalf("status = %s, want ok", rep.Status)
	}
	if rep.BreachStreak != 0 || rep.BreachesLast7Days != 0 {
		t.Fatalf("unexpected breaches: %+v", rep)
	}
}

func TestEvaluateWatchAlertOnStreak(t *testing.T) {
	now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	events := []drivedb.VampireDrainEvent{
		watchEvent(now.Add(-24*time.Hour), 3.4, fptr(10)),
		watchEvent(now.Add(-48*time.Hour), 3.1, fptr(11)),
		watchEvent(now.Add(-72*time.Hour), 3.8, fptr(9)),
		watchEvent(now.Add(-96*time.Hour), 0.5, fptr(12)),
	}
	rep := EvaluateWatch(events, fptr(2.7), 3.0, now)
	if rep.Status != WatchStatusAlert {
		t.Fatalf("status = %s, want alert", rep.Status)
	}
	if rep.BreachStreak != 3 {
		t.Fatalf("streak = %d, want 3", rep.BreachStreak)
	}
	if rep.Worst == nil || rep.Worst.DrainPctPerDay != 3.8 {
		t.Fatalf("worst = %+v, want 3.8/day", rep.Worst)
	}
	if rep.Recommendation == "" {
		t.Fatal("expected a recommendation")
	}
}

func TestEvaluateWatchColdNote(t *testing.T) {
	now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	events := []drivedb.VampireDrainEvent{
		watchEvent(now.Add(-24*time.Hour), 4.0, fptr(-2)),
		watchEvent(now.Add(-48*time.Hour), 3.6, fptr(0)),
		watchEvent(now.Add(-72*time.Hour), 1.0, fptr(15)),
		watchEvent(now.Add(-96*time.Hour), 0.8, fptr(16)),
	}
	rep := EvaluateWatch(events, fptr(2.3), 3.0, now)
	if rep.ColdNote == "" {
		t.Fatal("expected a cold-weather note")
	}
}

func TestEvaluateWatchEmpty(t *testing.T) {
	rep := EvaluateWatch(nil, nil, 3.0, time.Now().UTC())
	if rep.Status != WatchStatusOK || rep.Recommendation == "" {
		t.Fatalf("unexpected empty report: %+v", rep)
	}
}

func TestWatchRejectsBadThreshold(t *testing.T) {
	h := newVampireDrainHandlerForTest(&fakeVampireDrainRepo{}, time.Now().UTC())
	req := httptest.NewRequest(http.MethodGet, "/watch?vehicle_id=1&threshold_pct_per_day=99", nil)
	rec := httptest.NewRecorder()
	h.Watch(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestWatchServesReport(t *testing.T) {
	now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	h := newVampireDrainHandlerForTest(&fakeVampireDrainRepo{
		exists: map[int64]bool{5: true},
		events: []drivedb.VampireDrainEvent{watchEvent(now.Add(-24*time.Hour), 2.5, nil)},
		stats:  drivedb.VampireDrainStats{AvgDrainPctPerDay: fptr(2.5)},
	}, now)
	req := httptest.NewRequest(http.MethodGet, "/watch?vehicle_id=5", nil)
	rec := httptest.NewRecorder()
	h.Watch(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var rep WatchReport
	if err := json.NewDecoder(rec.Body).Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep.Status != WatchStatusWatch || rep.EventsEvaluated != 1 {
		t.Fatalf("unexpected report: %+v", rep)
	}
}
