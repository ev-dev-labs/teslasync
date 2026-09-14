package journey

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type fakeTrail struct {
	points []*Checkpoint
	eff    float64
	hasEff bool
	legs   []RouteLeg
	err    error
}

func (f *fakeTrail) AppendCheckpoint(_ context.Context, sessionID int64, in NewCheckpoint) (*Checkpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	cp := &Checkpoint{
		ID: int64(len(f.points) + 1), SessionID: sessionID,
		RecordedAt: in.RecordedAt, Lat: in.Lat, Lng: in.Lng,
		SocPct: in.SocPct, OdometerM: in.OdometerM,
	}
	f.points = append(f.points, cp)
	return cp, nil
}

func (f *fakeTrail) LatestCheckpoint(_ context.Context, _ int64) (*Checkpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	if len(f.points) == 0 {
		return nil, nil
	}
	return f.points[len(f.points)-1], nil
}

func (f *fakeTrail) Trail(_ context.Context, _ int64, limit int) ([]*Checkpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := f.points
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

func (f *fakeTrail) VehicleEfficiency(_ context.Context, _ int64) (float64, bool, error) {
	return f.eff, f.hasEff, f.err
}

func (f *fakeTrail) RouteLegs(_ context.Context, _ int64, _, _ string, _ int) ([]RouteLeg, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.legs, nil
}

var _ TrailStore = (*fakeTrail)(nil)

func liveSession() *Session {
	return &Session{
		ID: 1, VehicleID: 7, Name: "denver run",
		OriginLat: fptr(39.7392), OriginLng: fptr(-104.9903),
		DestLat: fptr(39.0997), DestLng: fptr(-94.5786),
		Status: StatusActive,
	}
}

func liveRequest(method, url, id, body string) *http.Request {
	var rdr *strings.Reader
	if body == "" {
		rdr = strings.NewReader("")
	} else {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, url, rdr)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestComputeProgress(t *testing.T) {
	oLat, oLng := 39.7392, -104.9903
	dLat, dLng := 39.0997, -94.5786
	if p := ComputeProgress(nil, &oLng, &dLat, &dLng, nil); p != nil {
		t.Fatalf("missing origin = %+v, want nil", p)
	}
	p := ComputeProgress(&oLat, &oLng, &dLat, &dLng, nil)
	if p == nil || p.DoneM != 0 || p.LeftM != p.TotalM || p.TotalM <= 0 {
		t.Fatalf("no fix = %+v, want done=0 left=total", p)
	}
	// ~900km Denver→KC; a fix at the destination must nearly zero left.
	at := &Checkpoint{Lat: dLat, Lng: dLng}
	p = ComputeProgress(&oLat, &oLng, &dLat, &dLng, at)
	if p.LeftM > 1000 || p.DoneM <= 0 {
		t.Fatalf("at dest = %+v, want left≈0", p)
	}
	if p.TotalM < 800_000 || p.TotalM > 1_000_000 {
		t.Fatalf("total = %f, want ~900km", p.TotalM)
	}
}

func TestComputeRange(t *testing.T) {
	cases := []struct {
		name string
		have *float64
		eff  *float64
		want string
	}{
		{"ok with buffer", fptr(30000), fptr(180), ItemOK},             // 30kWh vs 18kWh need
		{"attention no buffer", fptr(19000), fptr(180), ItemAttention}, // covers 100km need, not buffer
		{"action short", fptr(5000), fptr(180), ItemAction},
		{"unknown no energy", nil, fptr(180), ItemUnknown},
		{"unknown no eff", fptr(30000), nil, ItemUnknown},
		{"unknown zero eff", fptr(30000), fptr(0), ItemUnknown},
	}
	for _, c := range cases {
		r := ComputeRange(c.have, 100_000, c.eff)
		if r.Verdict != c.want {
			t.Errorf("%s: verdict = %s, want %s", c.name, r.Verdict, c.want)
		}
	}
	r := ComputeRange(fptr(30000), 100_000, fptr(180))
	if r.NeedWh == nil || *r.NeedWh < 17999 || *r.NeedWh > 18001 {
		t.Fatalf("need = %v, want 18000", r.NeedWh)
	}
}

func TestParseNextStop(t *testing.T) {
	raw := json.RawMessage(`{"kind":"stop_scores","stops":[{"site":"Flagler SC","wait_s":300}]}`)
	next := ParseNextStop(raw)
	if next == nil || next.Site != "Flagler SC" || next.WaitS == nil || *next.WaitS != 300 {
		t.Fatalf("next = %+v", next)
	}
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"kind":"departure","stops":[{"site":"x"}]}`),
		json.RawMessage(`{"kind":"stop_scores","stops":[]}`),
		json.RawMessage(`{"kind":"stop_scores","stops":[{"site":""}]}`),
		json.RawMessage(`not json`),
		nil,
	} {
		if next := ParseNextStop(raw); next != nil {
			t.Fatalf("raw %q: next = %+v, want nil", string(raw), next)
		}
	}
}

func TestAppendCheckpoint(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := newFakeStore()
	f.sessions[1] = liveSession()
	tr := &fakeTrail{}
	h := NewLiveHandler(f, tr, &fakeLive{})
	h.now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	h.Append(rec, liveRequest(http.MethodPost, "/journey/sessions/1/checkpoints", "1",
		`{"lat":39.5,"lng":-100.0,"soc_pct":71}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var cp Checkpoint
	if err := json.Unmarshal(rec.Body.Bytes(), &cp); err != nil {
		t.Fatal(err)
	}
	if cp.Lat != 39.5 || cp.SocPct == nil || *cp.SocPct != 71 || !cp.RecordedAt.Equal(now) {
		t.Fatalf("checkpoint = %+v", cp)
	}
}

func TestAppendCheckpointBackfillsLive(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := newFakeStore()
	f.sessions[1] = liveSession()
	tr := &fakeTrail{}
	h := NewLiveHandler(f, tr, &fakeLive{values: map[string]signal.SignalValue{
		"LocationLatitude": 39.5, "LocationLongitude": -100.0, "Soc": 66.0, "Odometer": 12345.0,
	}})
	h.now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	h.Append(rec, liveRequest(http.MethodPost, "/journey/sessions/1/checkpoints", "1", `{}`))
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var cp Checkpoint
	if err := json.Unmarshal(rec.Body.Bytes(), &cp); err != nil {
		t.Fatal(err)
	}
	if cp.Lat != 39.5 || cp.Lng != -100.0 || cp.SocPct == nil || *cp.SocPct != 66 || cp.OdometerM == nil {
		t.Fatalf("backfilled = %+v", cp)
	}
}

func TestAppendCheckpointErrors(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	setup := func() (*fakeStore, *fakeTrail) {
		f := newFakeStore()
		f.sessions[1] = liveSession()
		return f, &fakeTrail{}
	}
	cases := []struct {
		name string
		id   string
		body string
		live *fakeLive
		want int
		mut  func(*fakeStore)
	}{
		{"bad id", "abc", `{"lat":1,"lng":1}`, &fakeLive{}, http.StatusBadRequest, nil},
		{"bad body", "1", `{oops`, &fakeLive{}, http.StatusBadRequest, nil},
		{"future", "1", `{"lat":1,"lng":1,"recorded_at":"2026-09-14T11:00:00Z"}`, &fakeLive{}, http.StatusBadRequest, nil},
		{"bad soc", "1", `{"lat":1,"lng":1,"soc_pct":101}`, &fakeLive{}, http.StatusBadRequest, nil},
		{"bad odo", "1", `{"lat":1,"lng":1,"odometer_m":-5}`, &fakeLive{}, http.StatusBadRequest, nil},
		{"no position", "1", `{}`, &fakeLive{}, http.StatusBadRequest, nil},
		{"missing", "9", `{"lat":1,"lng":1}`, &fakeLive{}, http.StatusNotFound, nil},
		{"planned rejects", "1", `{"lat":1,"lng":1}`, &fakeLive{}, http.StatusConflict, func(f *fakeStore) {
			s := liveSession()
			s.Status = StatusPlanned
			f.sessions[1] = s
		}},
		{"live down", "1", `{}`, &fakeLive{err: errors.New("redis down")}, http.StatusInternalServerError, nil},
	}
	for _, c := range cases {
		f, tr := setup()
		if c.mut != nil {
			c.mut(f)
		}
		h := NewLiveHandler(f, tr, c.live)
		h.now = func() time.Time { return now }
		rec := httptest.NewRecorder()
		h.Append(rec, liveRequest(http.MethodPost, "/journey/sessions/1/checkpoints", c.id, c.body))
		if rec.Code != c.want {
			t.Errorf("%s: code = %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body.String())
		}
	}
}

func TestLiveView(t *testing.T) {
	f := newFakeStore()
	f.sessions[1] = liveSession()
	plan := json.RawMessage(`{"kind":"stop_scores","stops":[{"site":"Flagler SC","wait_s":300}]}`)
	f.plans[1] = []*PlanVersion{{ID: 1, SessionID: 1, Version: 1, Plan: plan}}
	tr := &fakeTrail{eff: 180, hasEff: true, points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC), Lat: 39.7392, Lng: -104.9903},
		{ID: 2, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC), Lat: 39.5, Lng: -100.0, SocPct: fptr(71)},
	}}
	h := NewLiveHandler(f, tr, &fakeLive{values: map[string]signal.SignalValue{"EnergyRemaining": 60.0}})
	rec := httptest.NewRecorder()
	h.View(rec, liveRequest(http.MethodGet, "/journey/sessions/1/live", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var view LiveView
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.Session == nil || view.Session.ID != 1 {
		t.Fatalf("session = %+v", view.Session)
	}
	if view.Latest == nil || view.Latest.ID != 2 || len(view.Trail) != 2 {
		t.Fatalf("trail latest=%+v len=%d", view.Latest, len(view.Trail))
	}
	if view.Progress == nil || view.Progress.DoneM <= 0 || view.Progress.LeftM <= 0 {
		t.Fatalf("progress = %+v", view.Progress)
	}
	if view.Range == nil || view.Range.Verdict == "" {
		t.Fatalf("range = %+v", view.Range)
	}
	if view.Next == nil || view.Next.Site != "Flagler SC" {
		t.Fatalf("next = %+v", view.Next)
	}
	if len(view.Evidence) != 4 {
		t.Fatalf("evidence = %v, want 4 lines", view.Evidence)
	}
}

func TestLiveViewDegraded(t *testing.T) {
	f := newFakeStore()
	s := liveSession()
	s.OriginLat, s.OriginLng, s.DestLat, s.DestLng = nil, nil, nil, nil
	f.sessions[1] = s
	h := NewLiveHandler(f, &fakeTrail{}, &fakeLive{})
	rec := httptest.NewRecorder()
	h.View(rec, liveRequest(http.MethodGet, "/journey/sessions/1/live", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var view LiveView
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if view.Progress != nil || view.Latest != nil || view.Next != nil {
		t.Fatalf("degraded view should omit progress/latest/next: %+v", view)
	}
	if view.Range == nil || view.Range.Verdict != ItemUnknown {
		t.Fatalf("range = %+v, want unknown", view.Range)
	}
	if len(view.Evidence) != 4 {
		t.Fatalf("evidence = %v, want 4 lines", view.Evidence)
	}
}

func TestLiveViewNotFound(t *testing.T) {
	h := NewLiveHandler(newFakeStore(), &fakeTrail{}, &fakeLive{})
	rec := httptest.NewRecorder()
	h.View(rec, liveRequest(http.MethodGet, "/journey/sessions/9/live", "9", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}
