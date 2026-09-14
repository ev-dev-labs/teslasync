package journey

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestPaceMS(t *testing.T) {
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	// Odometer wins: 90 km in one hour.
	older := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0, OdometerM: fptr(100000)}
	newer := &Checkpoint{RecordedAt: base.Add(time.Hour), Lat: 39.5, Lng: -104.0, OdometerM: fptr(190000)}
	if pace, ok := PaceMS(older, newer); !ok || pace < 24.99 || pace > 25.01 {
		t.Fatalf("odometer pace = %f %v, want 25", pace, ok)
	}
	// Coordinates when the odometer is absent: 0.01° lat ≈ 1112 m.
	a := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0}
	b := &Checkpoint{RecordedAt: base.Add(100 * time.Second), Lat: 39.71, Lng: -105.0}
	if pace, ok := PaceMS(a, b); !ok || pace < 11 || pace > 11.3 {
		t.Fatalf("coordinate pace = %f %v, want ~11.1", pace, ok)
	}
	same := &Checkpoint{RecordedAt: base, Lat: 39.7, Lng: -105.0, OdometerM: fptr(100000)}
	rollback := &Checkpoint{RecordedAt: base.Add(time.Minute), Lat: 39.7, Lng: -105.0, OdometerM: fptr(99999)}
	jump := &Checkpoint{RecordedAt: base.Add(time.Second), Lat: 30.0, Lng: -90.0}
	for name, tc := range map[string][2]*Checkpoint{
		"nil older":   {nil, newer},
		"nil newer":   {older, nil},
		"zero dt":     {older, &Checkpoint{RecordedAt: base, Lat: 39.5, Lng: -104.0}},
		"negative dt": {newer, older},
		"rollback":    {same, rollback},
		"gps jump":    {a, jump},
	} {
		if pace, ok := PaceMS(tc[0], tc[1]); ok {
			t.Fatalf("%s: pace = %f, want reject", name, pace)
		}
	}
}

func TestArrivalETA(t *testing.T) {
	now := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	eta, moving := ArrivalETA(36000, 20, now)
	if !moving || eta == nil || !eta.Equal(now.Add(30*time.Minute)) {
		t.Fatalf("eta = %v %v, want 10:30 moving", eta, moving)
	}
	if eta, moving := ArrivalETA(36000, 1.5, now); moving || eta != nil {
		t.Fatalf("parked = %v %v, want nil/false", eta, moving)
	}
	if eta, moving := ArrivalETA(0, 20, now); !moving || eta != nil {
		t.Fatalf("arrived = %v %v, want nil/true", eta, moving)
	}
}

func TestChargeAdvice(t *testing.T) {
	verdict, short := ChargeAdvice(fptr(30000), 100_000, fptr(180))
	if verdict != ItemOK || short != nil {
		t.Fatalf("ok = %s %v, want ok/nil", verdict, short)
	}
	verdict, short = ChargeAdvice(fptr(19000), 100_000, fptr(180))
	if verdict != ItemAttention || short == nil {
		t.Fatalf("attention = %s %v", verdict, short)
	}
	// 18000×1.15 − 19000 = 1700.
	if *short < 1699 || *short > 1701 {
		t.Fatalf("shortfall = %f, want 1700", *short)
	}
	verdict, short = ChargeAdvice(fptr(5000), 100_000, fptr(180))
	if verdict != ItemAction || short == nil || *short < 15699 || *short > 15701 {
		t.Fatalf("action = %s %v, want action/15700", verdict, short)
	}
	if verdict, short := ChargeAdvice(nil, 100_000, fptr(180)); verdict != ItemUnknown || short != nil {
		t.Fatalf("unknown = %s %v", verdict, short)
	}
}

func arrivalSetup() (*fakeStore, *fakeTrail) {
	f := newFakeStore()
	s := liveSession()
	s.DestName = "KC"
	f.sessions[1] = s
	tr := &fakeTrail{eff: 180, hasEff: true, points: []*Checkpoint{
		{ID: 1, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC),
			Lat: 39.7392, Lng: -104.9903, OdometerM: fptr(100000)},
		{ID: 2, SessionID: 1, RecordedAt: time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC),
			Lat: 39.5, Lng: -100.0, SocPct: fptr(71), OdometerM: fptr(190000)},
	}}
	return f, tr
}

func TestPrep(t *testing.T) {
	f, tr := arrivalSetup()
	h := NewArrivalHandler(f, tr, &fakeLive{values: map[string]signal.SignalValue{"EnergyRemaining": 60.0}})
	now := time.Date(2026, 9, 14, 10, 5, 0, 0, time.UTC)
	h.now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/1/arrival", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Arrival
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != 1 || got.DestName != "KC" {
		t.Fatalf("arrival = %+v", got)
	}
	if got.LeftM == nil || *got.LeftM <= 0 {
		t.Fatalf("left = %v", got.LeftM)
	}
	if got.PaceMS == nil || *got.PaceMS < 24.99 || *got.PaceMS > 25.01 {
		t.Fatalf("pace = %v, want 25", got.PaceMS)
	}
	if !got.Moving || got.EtaAt == nil {
		t.Fatalf("moving = %v eta = %v", got.Moving, got.EtaAt)
	}
	wantETA := now.Add(time.Duration(*got.LeftM / 25 * float64(time.Second)))
	if got.EtaAt.Sub(wantETA) > time.Minute || wantETA.Sub(*got.EtaAt) > time.Minute {
		t.Fatalf("eta = %v, want ~%v", got.EtaAt, wantETA)
	}
	// 60 kWh against ~500 km at 180 Wh/km: action with a shortfall.
	if got.Verdict != ItemAction || got.ShortfallWh == nil || *got.ShortfallWh <= 0 {
		t.Fatalf("advice = %s %v, want action/shortfall", got.Verdict, got.ShortfallWh)
	}
	if len(got.Evidence) != 3 {
		t.Fatalf("evidence = %v, want 3 lines", got.Evidence)
	}
}

func TestPrepRouteFactor(t *testing.T) {
	f, tr := arrivalSetup()
	s := f.sessions[1]
	s.OriginName, s.DestName = "Denver", "KC"
	tr.legs = []RouteLeg{
		{DistanceM: 990000, StraightM: 900000},
		{DistanceM: 900000, StraightM: 900000},
	}
	h := NewArrivalHandler(f, tr, &fakeLive{values: map[string]signal.SignalValue{"EnergyRemaining": 200.0}})
	now := time.Date(2026, 9, 14, 10, 5, 0, 0, time.UTC)
	h.now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/1/arrival", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Arrival
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.RouteFactor == nil || *got.RouteFactor < 1.049 || *got.RouteFactor > 1.051 {
		t.Fatalf("factor = %v, want 1.05", got.RouteFactor)
	}
	if got.RouteTrips != 2 {
		t.Fatalf("trips = %d, want 2", got.RouteTrips)
	}
	// ETA runs on the adjusted remainder: left×1.05 at 25 m/s.
	wantETA := now.Add(time.Duration(*got.LeftM * 1.05 / 25 * float64(time.Second)))
	if got.EtaAt.Sub(wantETA) > time.Minute || wantETA.Sub(*got.EtaAt) > time.Minute {
		t.Fatalf("eta = %v, want ~%v", got.EtaAt, wantETA)
	}
	if len(got.Evidence) != 4 {
		t.Fatalf("evidence = %v, want 4 lines", got.Evidence)
	}
}

func TestPrepParked(t *testing.T) {
	f, tr := arrivalSetup()
	tr.points[1].OdometerM = fptr(100000) // same odometer: pace 0.
	h := NewArrivalHandler(f, tr, &fakeLive{})
	rec := httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/1/arrival", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Arrival
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Moving || got.EtaAt != nil {
		t.Fatalf("parked = moving:%v eta:%v", got.Moving, got.EtaAt)
	}
	if got.PaceMS == nil || *got.PaceMS != 0 {
		t.Fatalf("pace = %v, want 0", got.PaceMS)
	}
	if got.Verdict != ItemUnknown {
		t.Fatalf("verdict = %s, want unknown", got.Verdict)
	}
}

func TestPrepDegraded(t *testing.T) {
	f := newFakeStore()
	f.sessions[1] = liveSession()
	h := NewArrivalHandler(f, &fakeTrail{}, &fakeLive{})
	rec := httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/1/arrival", "1", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got Arrival
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	// No fix: left falls back to the whole leg, pace is absent.
	if got.LeftM == nil || *got.LeftM <= 0 {
		t.Fatalf("left = %v, want full leg", got.LeftM)
	}
	if got.PaceMS != nil || got.Moving || got.EtaAt != nil {
		t.Fatalf("pace = %v moving = %v eta = %v", got.PaceMS, got.Moving, got.EtaAt)
	}
	if len(got.Evidence) != 3 {
		t.Fatalf("evidence = %v, want 3 lines", got.Evidence)
	}
}

func TestPrepErrors(t *testing.T) {
	f, tr := arrivalSetup()
	h := NewArrivalHandler(f, tr, &fakeLive{})
	rec := httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/9/arrival", "9", ""))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.Prep(rec, liveRequest(http.MethodGet, "/journey/sessions/abc/arrival", "abc", ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
}
