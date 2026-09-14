package journey

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTrailDistanceM(t *testing.T) {
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	a := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0, OdometerM: fptr(100000)}
	b := &Checkpoint{RecordedAt: base.Add(time.Hour), Lat: 39.5, Lng: -104.0, OdometerM: fptr(190000)}
	// Odometer span wins regardless of input order.
	if d, ok := TrailDistanceM([]*Checkpoint{b, a}); !ok || d != 90000 {
		t.Fatalf("odometer = %f %v, want 90000", d, ok)
	}
	c := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0}
	d := &Checkpoint{RecordedAt: base.Add(100 * time.Second), Lat: 39.71, Lng: -105.0}
	if dist, ok := TrailDistanceM([]*Checkpoint{c, d}); !ok || dist < 1110 || dist > 1114 {
		t.Fatalf("haversine = %f %v, want ~1112", dist, ok)
	}
	if _, ok := TrailDistanceM([]*Checkpoint{c}); ok {
		t.Fatal("single fix should measure nothing")
	}
	if _, ok := TrailDistanceM(nil); ok {
		t.Fatal("nil should measure nothing")
	}
	// Odometer rollback falls back to coordinates, not negative road.
	e := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0, OdometerM: fptr(190000)}
	f := &Checkpoint{RecordedAt: base.Add(100 * time.Second), Lat: 39.71, Lng: -105.0, OdometerM: fptr(100000)}
	if dist, ok := TrailDistanceM([]*Checkpoint{e, f}); !ok || dist < 1110 || dist > 1114 {
		t.Fatalf("rollback = %f %v, want ~1112", dist, ok)
	}
}

func TestTripDurationS(t *testing.T) {
	start := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	end := time.Date(2026, 9, 14, 11, 30, 0, 0, time.UTC)
	if d, ok := TripDurationS(&start, &end, nil); !ok || d != 9000 {
		t.Fatalf("closed = %f %v, want 9000", d, ok)
	}
	fixes := []*Checkpoint{{RecordedAt: start.Add(time.Hour)}}
	if d, ok := TripDurationS(&start, nil, fixes); !ok || d != 3600 {
		t.Fatalf("live = %f %v, want 3600", d, ok)
	}
	if _, ok := TripDurationS(nil, &end, fixes); ok {
		t.Fatal("no start should measure nothing")
	}
	if _, ok := TripDurationS(&start, nil, nil); ok {
		t.Fatal("no end or fix should measure nothing")
	}
	skew := start.Add(-time.Minute)
	if _, ok := TripDurationS(&start, &skew, nil); ok {
		t.Fatal("negative span should measure nothing")
	}
}

func TestDetourRatio(t *testing.T) {
	if r := DetourRatio(90000, 80000); r == nil || *r < 1.12 || *r > 1.13 {
		t.Fatalf("ratio = %v, want 1.13", r)
	}
	if r := DetourRatio(0, 80000); r == nil || *r != 0 {
		t.Fatalf("zero trail = %v, want 0", r)
	}
	if r := DetourRatio(90000, 0); r != nil {
		t.Fatalf("zero straight = %v, want nil", r)
	}
}

func TestCountPlans(t *testing.T) {
	plans := []*PlanVersion{
		{Version: 1, Plan: json.RawMessage(`{"kind":"stop_scores"}`)},
		{Version: 2, Plan: json.RawMessage(`{"kind":"replan"}`)},
		{Version: 3, Plan: json.RawMessage(`{"kind":"replan"}`)},
		{Version: 4, Plan: json.RawMessage(`not json`)},
		nil,
	}
	if total, replans := CountPlans(plans); total != 4 || replans != 2 {
		t.Fatalf("counts = %d/%d, want 4/2", total, replans)
	}
}

func TestRecapChecklist(t *testing.T) {
	if r := RecapChecklist(nil); r != nil {
		t.Fatalf("nil = %+v, want nil", r)
	}
	run := &Run{Items: []Item{
		{Key: "a", Status: ItemOK}, {Key: "b", Status: ItemAttention}, {Key: "c", Status: ItemOK},
	}}
	if r := RecapChecklist(run); r.Ready != 2 || r.Total != 3 {
		t.Fatalf("recap = %+v, want 2/3", r)
	}
}

func reportSession() *Session {
	s := liveSession()
	s.Status = StatusCompleted
	start := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	end := time.Date(2026, 9, 14, 11, 30, 0, 0, time.UTC)
	s.StartedAt, s.EndedAt = &start, &end
	return s
}

func TestCard(t *testing.T) {
	f := newFakeStore()
	f.sessions[1] = reportSession()
	tr := &fakeTrail{points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC),
			Lat: 39.7392, Lng: -104.9903, OdometerM: fptr(100000)},
		{ID: 2, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 11, 30, 0, 0, time.UTC),
			Lat: 39.0997, Lng: -94.5786, OdometerM: fptr(1000000)},
	}}
	f.plans[1] = []*PlanVersion{
		{ID: 1, SessionID: 1, Version: 1, Plan: json.RawMessage(`{"kind":"stop_scores"}`)},
		{ID: 2, SessionID: 1, Version: 2, Plan: json.RawMessage(`{"kind":"replan"}`)},
	}
	runs := &fakeRuns{runs: map[int64][]*Run{1: {{
		ID: 1, SessionID: 1, RunAt: time.Date(2026, 9, 14, 8, 50, 0, 0, time.UTC),
		Items: []Item{{Key: "a", Status: ItemOK}, {Key: "b", Status: ItemOK}, {Key: "c", Status: ItemAction}},
	}}}}
	h := NewReportHandler(f, tr, runs)
	rec := httptest.NewRecorder()
	h.Card(rec, liveRequest(http.MethodGet, "/journey/sessions/1/report", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Report
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != 1 || got.Status != StatusCompleted {
		t.Fatalf("report = %+v", got)
	}
	if got.DurationS == nil || *got.DurationS != 9000 {
		t.Fatalf("duration = %v, want 9000", got.DurationS)
	}
	if got.DistanceM == nil || *got.DistanceM != 900000 {
		t.Fatalf("distance = %v, want 900000", got.DistanceM)
	}
	if got.Fixes != 2 || got.Plans != 2 || got.Replans != 1 {
		t.Fatalf("counts = %d/%d/%d, want 2/2/1", got.Fixes, got.Plans, got.Replans)
	}
	if got.Detour == nil || *got.Detour < 0.9 || *got.Detour > 1.2 {
		t.Fatalf("detour = %v, want ~1.0", got.Detour)
	}
	if got.Checklist == nil || got.Checklist.Ready != 2 || got.Checklist.Total != 3 {
		t.Fatalf("checklist = %+v, want 2/3", got.Checklist)
	}
	if len(got.Evidence) != 5 {
		t.Fatalf("evidence = %v, want 5 lines", got.Evidence)
	}
}

func TestCardRouteFactor(t *testing.T) {
	f := newFakeStore()
	s := reportSession()
	s.OriginName, s.DestName = "Denver", "KC"
	f.sessions[1] = s
	tr := &fakeTrail{points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC),
			Lat: 39.7392, Lng: -104.9903, OdometerM: fptr(100000)},
		{ID: 2, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 11, 30, 0, 0, time.UTC),
			Lat: 39.0997, Lng: -94.5786, OdometerM: fptr(1000000)},
	}, legs: []RouteLeg{
		{DistanceM: 990000, StraightM: 900000},
		{DistanceM: 900000, StraightM: 900000},
		{DistanceM: 945000, StraightM: 900000},
	}}
	h := NewReportHandler(f, tr, &fakeRuns{runs: map[int64][]*Run{}})
	rec := httptest.NewRecorder()
	h.Card(rec, liveRequest(http.MethodGet, "/journey/sessions/1/report", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Report
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.RouteFactor == nil || *got.RouteFactor < 1.049 || *got.RouteFactor > 1.051 {
		t.Fatalf("factor = %v, want 1.05", got.RouteFactor)
	}
	if got.RouteTrips != 3 {
		t.Fatalf("trips = %d, want 3", got.RouteTrips)
	}
	// duration, distance, detour, route, replans, checklist.
	if len(got.Evidence) != 6 {
		t.Fatalf("evidence = %v, want 6 lines", got.Evidence)
	}
}

func TestCardLive(t *testing.T) {
	f := newFakeStore()
	s := liveSession()
	start := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	s.StartedAt = &start
	f.sessions[1] = s
	tr := &fakeTrail{points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: start, Lat: 39.7392, Lng: -104.9903},
	}}
	h := NewReportHandler(f, tr, &fakeRuns{runs: map[int64][]*Run{}})
	rec := httptest.NewRecorder()
	h.Card(rec, liveRequest(http.MethodGet, "/journey/sessions/1/report", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Report
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.DurationS == nil || *got.DurationS != 0 {
		t.Fatalf("duration = %v, want 0", got.DurationS)
	}
	if got.DistanceM != nil || got.Detour != nil || got.Checklist != nil {
		t.Fatalf("live card should omit distance/detour/checklist: %+v", got)
	}
	if len(got.Evidence) != 5 {
		t.Fatalf("evidence = %v, want 5 lines", got.Evidence)
	}
}

func TestCardNotFound(t *testing.T) {
	h := NewReportHandler(newFakeStore(), &fakeTrail{}, &fakeRuns{runs: map[int64][]*Run{}})
	rec := httptest.NewRecorder()
	h.Card(rec, liveRequest(http.MethodGet, "/journey/sessions/9/report", "9", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}
