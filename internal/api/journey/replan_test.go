package journey

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/waitoracle"
)

func TestAssessDeviation(t *testing.T) {
	oLat, oLng := 39.7392, -104.9903
	dLat, dLng := 39.0997, -94.5786
	// Points anchored at the origin: the lat/lng midpoint is NOT on
	// the great-circle corridor (sagitta over ~900 km exceeds the
	// drift threshold), so on-track must be measured at the origin.
	at := &Checkpoint{Lat: oLat, Lng: oLng}
	if d := AssessDeviation(&oLat, &oLng, &dLat, &dLng, at); d.Verdict != DeviationOnTrack {
		t.Fatalf("origin = %+v, want on_track", d)
	}
	// ~5.5 km north of the corridor: drifted.
	drift := &Checkpoint{Lat: oLat + 0.05, Lng: oLng}
	d := AssessDeviation(&oLat, &oLng, &dLat, &dLng, drift)
	if d.Verdict != DeviationDrifted || d.DeviationM == nil {
		t.Fatalf("drift = %+v, want drifted", d)
	}
	if *d.DeviationM < 4000 || *d.DeviationM > 7000 {
		t.Fatalf("drift_m = %f, want ~5.5km", *d.DeviationM)
	}
	// ~55 km north: off route.
	off := &Checkpoint{Lat: oLat + 0.5, Lng: oLng}
	if d := AssessDeviation(&oLat, &oLng, &dLat, &dLng, off); d.Verdict != DeviationOffRoute {
		t.Fatalf("off = %+v, want off_route", d)
	}
	if d := AssessDeviation(&oLat, &oLng, &dLat, &dLng, nil); d.Verdict != DeviationUnknown || d.DeviationM != nil {
		t.Fatalf("no fix = %+v, want unknown", d)
	}
	if d := AssessDeviation(nil, &oLng, &dLat, &dLng, at); d.Verdict != DeviationUnknown {
		t.Fatalf("no coords = %+v, want unknown", d)
	}
}

func TestSavedCandidates(t *testing.T) {
	good := `{"kind":"stop_scores","energy_wh":40000,"candidates":[
		{"site":"Kettleman","lat":38.0,"lng":-121.0},
		{"site":"Nowhere","lat":38.0,"lng":-118.0}]}`
	cands, energy, ok := savedCandidates(json.RawMessage(good))
	if !ok || len(cands) != 2 || energy != 40000 || cands[0].Site != "Kettleman" {
		t.Fatalf("good = %+v %f %v", cands, energy, ok)
	}
	replan := `{"kind":"replan","energy_wh":30000,"candidates":[{"site":"A","lat":1,"lng":1}]}`
	if _, _, ok := savedCandidates(json.RawMessage(replan)); !ok {
		t.Fatal("replan kind should rescore")
	}
	bad := []string{
		`{"kind":"departure","energy_wh":40000,"candidates":[{"site":"A","lat":1,"lng":1}]}`,
		`{"kind":"stop_scores","energy_wh":0,"candidates":[{"site":"A","lat":1,"lng":1}]}`,
		`{"kind":"stop_scores","energy_wh":40000,"candidates":[]}`,
		`{"kind":"stop_scores","energy_wh":40000,"candidates":[{"site":"","lat":1,"lng":1}]}`,
		`{"kind":"stop_scores","energy_wh":40000,"candidates":[{"site":"A","lat":91,"lng":1}]}`,
		`{"kind":"stop_scores","energy_wh":40000}`,
		`not json`,
		``,
	}
	for _, raw := range bad {
		if c, e, ok := savedCandidates(json.RawMessage(raw)); ok {
			t.Fatalf("raw %q: = %+v %f, want reject", raw, c, e)
		}
	}
	many := `{"kind":"stop_scores","energy_wh":40000,"candidates":[`
	for i := 0; i < 11; i++ {
		if i > 0 {
			many += ","
		}
		many += `{"site":"S","lat":1,"lng":1}`
	}
	many += `]}`
	if _, _, ok := savedCandidates(json.RawMessage(many)); ok {
		t.Fatal("11 candidates should reject")
	}
}

func TestLatestScoredPlanPicksMaxVersion(t *testing.T) {
	// Insertion order (oldest first), as the fake store keeps it: the
	// newest version must still win.
	old := &PlanVersion{ID: 1, SessionID: 1, Version: 1, Plan: json.RawMessage(
		`{"kind":"stop_scores","energy_wh":40000,"candidates":[{"site":"Old","lat":1,"lng":1}]}`)}
	junk := &PlanVersion{ID: 2, SessionID: 1, Version: 2, Plan: json.RawMessage(`{"kind":"departure"}`)}
	fresh := &PlanVersion{ID: 3, SessionID: 1, Version: 3, Plan: json.RawMessage(
		`{"kind":"replan","energy_wh":30000,"candidates":[{"site":"New","lat":2,"lng":2}]}`)}
	cands, energy, ok := latestScoredPlan([]*PlanVersion{old, junk, fresh})
	if !ok || len(cands) != 1 || cands[0].Site != "New" || energy != 30000 {
		t.Fatalf("latest = %+v %f %v, want New/30000", cands, energy, ok)
	}
	if _, _, ok := latestScoredPlan([]*PlanVersion{junk}); ok {
		t.Fatal("junk-only should reject")
	}
	if _, _, ok := latestScoredPlan(nil); ok {
		t.Fatal("nil should reject")
	}
}

func TestParseNextStopReplan(t *testing.T) {
	raw := json.RawMessage(`{"kind":"replan","stops":[{"site":"Flagler SC","wait_s":120}]}`)
	next := ParseNextStop(raw)
	if next == nil || next.Site != "Flagler SC" || next.WaitS == nil || *next.WaitS != 120 {
		t.Fatalf("next = %+v", next)
	}
}

func replanSetup() (*fakeStore, *fakeTrail, *fakeWaits) {
	f := newFakeStore()
	f.sessions[1] = liveSession()
	f.prices["Kettleman"] = 0.30
	f.peaks["Kettleman"] = []float64{150, 151, 149, 150, 152}
	tr := &fakeTrail{points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC), Lat: 39.4, Lng: -99.5},
	}}
	w := &fakeWaits{histories: map[string]waitoracle.SiteHistory{"Kettleman": scoredHistory("Kettleman")}}
	return f, tr, w
}

func scoredPlan(t *testing.T, f *fakeStore, kind string, energy float64) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"kind": kind, "energy_wh": energy,
		"stops": []map[string]any{{"site": "Kettleman", "wait_s": 300}},
		"candidates": []map[string]any{
			{"site": "Kettleman", "lat": 38.0, "lng": -121.0},
			{"site": "Nowhere", "lat": 38.0, "lng": -118.0},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.SavePlan(context.Background(), 1, raw, "v1"); err != nil {
		t.Fatal(err)
	}
}

func TestAssess(t *testing.T) {
	f, tr, w := replanSetup()
	h := NewReplanHandler(f, tr, f, w)
	rec := httptest.NewRecorder()
	h.Assess(rec, liveRequest(http.MethodGet, "/journey/sessions/1/replan", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Assessment
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != 1 || got.Deviation == nil || got.Deviation.DeviationM == nil {
		t.Fatalf("assessment = %+v", got)
	}
	if len(got.Evidence) != 2 {
		t.Fatalf("evidence = %v, want 2 lines", got.Evidence)
	}
	if got.Latest == nil || got.Latest.ID != 1 {
		t.Fatalf("latest = %+v", got.Latest)
	}
}

func TestAssessDegraded(t *testing.T) {
	f, _, w := replanSetup()
	h := NewReplanHandler(f, &fakeTrail{}, f, w)
	rec := httptest.NewRecorder()
	h.Assess(rec, liveRequest(http.MethodGet, "/journey/sessions/1/replan", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Assessment
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Deviation.Verdict != DeviationUnknown || got.Latest != nil {
		t.Fatalf("degraded = %+v", got)
	}
	if len(got.Evidence) != 1 {
		t.Fatalf("evidence = %v, want 1 line", got.Evidence)
	}
}

func TestAssessNotFound(t *testing.T) {
	f, tr, w := replanSetup()
	h := NewReplanHandler(f, tr, f, w)
	rec := httptest.NewRecorder()
	h.Assess(rec, liveRequest(http.MethodGet, "/journey/sessions/9/replan", "9", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

func TestRescore(t *testing.T) {
	f, tr, w := replanSetup()
	scoredPlan(t, f, "stop_scores", 40000)
	h := NewReplanHandler(f, tr, f, w)
	h.now = func() time.Time { return time.Date(2026, 9, 14, 10, 5, 0, 0, time.UTC) }
	rec := httptest.NewRecorder()
	h.Rescore(rec, liveRequest(http.MethodPost, "/journey/sessions/1/replan", "1", `{}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got scoreResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Winner != "Kettleman" || len(got.Stops) != 2 || got.EnergyWh != 40000 {
		t.Fatalf("rescore = %+v", got)
	}
	if got.PlanVersion != 2 {
		t.Fatalf("plan_version = %d, want 2", got.PlanVersion)
	}
	plans, err := f.ListPlans(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 2 {
		t.Fatalf("plans = %d, want 2", len(plans))
	}
	var saved struct {
		Kind       string  `json:"kind"`
		EnergyWh   float64 `json:"energy_wh"`
		Candidates []struct {
			Site string `json:"site"`
		} `json:"candidates"`
		From struct {
			Lat float64 `json:"lat"`
		} `json:"from"`
	}
	if err := json.Unmarshal(plans[1].Plan, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Kind != "replan" || len(saved.Candidates) != 2 || saved.From.Lat != 39.4 {
		t.Fatalf("saved = %+v", saved)
	}
	// The replan stays rescorable: chain a second rescore off it.
	rec2 := httptest.NewRecorder()
	h.Rescore(rec2, liveRequest(http.MethodPost, "/journey/sessions/1/replan", "1", `{"energy_wh":30000}`))
	if rec2.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec2.Code, rec2.Body.String())
	}
	var got2 scoreResponse
	if err := json.Unmarshal(rec2.Body.Bytes(), &got2); err != nil {
		t.Fatal(err)
	}
	if got2.EnergyWh != 30000 || got2.PlanVersion != 3 {
		t.Fatalf("override = %+v, want 30000/v3", got2)
	}
}

func TestRescoreErrors(t *testing.T) {
	setup := func() (*fakeStore, *fakeTrail, *fakeWaits) { return replanSetup() }
	cases := []struct {
		name string
		id   string
		body string
		want int
		seed bool
		mut  func(*testing.T, *fakeStore, *fakeTrail)
	}{
		{"bad id", "abc", `{}`, http.StatusBadRequest, true, nil},
		{"bad body", "1", `{oops`, http.StatusBadRequest, true, nil},
		{"bad energy", "1", `{"energy_wh":-5}`, http.StatusBadRequest, true, nil},
		{"missing", "9", `{}`, http.StatusNotFound, true, nil},
		{"planned rejects", "1", `{}`, http.StatusConflict, true, func(_ *testing.T, f *fakeStore, _ *fakeTrail) {
			s := liveSession()
			s.Status = StatusPlanned
			f.sessions[1] = s
		}},
		{"no dest coords", "1", `{}`, http.StatusBadRequest, true, func(_ *testing.T, f *fakeStore, _ *fakeTrail) {
			s := liveSession()
			s.DestLat, s.DestLng = nil, nil
			f.sessions[1] = s
		}},
		{"no fix", "1", `{}`, http.StatusBadRequest, false, func(t *testing.T, f *fakeStore, tr *fakeTrail) {
			t.Helper()
			tr.points = nil
			scoredPlan(t, f, "stop_scores", 40000)
		}},
		{"no scored plan", "1", `{}`, http.StatusBadRequest, false, nil},
		{"waits down", "1", `{}`, http.StatusInternalServerError, true, nil},
	}
	for _, c := range cases {
		f, tr, w := setup()
		if c.seed {
			scoredPlan(t, f, "stop_scores", 40000)
		}
		if c.mut != nil {
			c.mut(t, f, tr)
		}
		if c.name == "waits down" {
			w.err = errors.New("db down")
		}
		h := NewReplanHandler(f, tr, f, w)
		rec := httptest.NewRecorder()
		h.Rescore(rec, liveRequest(http.MethodPost, "/journey/sessions/1/replan", c.id, c.body))
		if rec.Code != c.want {
			t.Errorf("%s: code = %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body.String())
		}
	}
}
