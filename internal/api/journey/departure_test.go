package journey

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/api/stormguard"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func departForecast(base time.Time) *stormguard.Forecast {
	times := make([]time.Time, 0, 6)
	codes := []int{1, 95, 1, 80, 1, 1}
	gusts := []float64{8, 9, 30, 9, 18, 8}
	for i := range codes {
		times = append(times, base.Add(time.Duration(i)*time.Hour))
	}
	return &stormguard.Forecast{Times: times, Weather: codes, WindGustMS: gusts}
}

func TestRankDepartureSlots(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	slots, rec := RankDepartureSlots(departForecast(base), base, base.Add(6*time.Hour))
	if len(slots) != 6 {
		t.Fatalf("slots = %d, want 6", len(slots))
	}
	// Sorted by score desc, then time: calm hours first.
	if slots[0].Score != 100 || !slots[0].DepartAt.Equal(base) {
		t.Fatalf("first = %+v, want calm 10:00", slots[0])
	}
	if rec == nil || !rec.Equal(base) {
		t.Fatalf("recommended = %v, want 10:00", rec)
	}
	levels := map[string]int{}
	for _, s := range slots {
		levels[s.Level]++
	}
	if levels[stormguard.LevelWarning] != 2 || levels[stormguard.LevelWatch] != 2 || levels[stormguard.LevelNone] != 2 {
		t.Fatalf("levels = %v", levels)
	}
}

func TestRankDepartureSlotsSkipsUncovered(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	slots, rec := RankDepartureSlots(departForecast(base), base.Add(24*time.Hour), base.Add(30*time.Hour))
	if len(slots) != 0 || rec != nil {
		t.Fatalf("uncovered = %+v %v, want empty", slots, rec)
	}
	if slots, rec := RankDepartureSlots(nil, base, base.Add(6*time.Hour)); len(slots) != 0 || rec != nil {
		t.Fatalf("nil forecast = %+v %v, want empty", slots, rec)
	}
}

func TestRankDepartureSlotsAllWarn(t *testing.T) {
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	f := &stormguard.Forecast{
		Times:      []time.Time{base, base.Add(time.Hour)},
		Weather:    []int{95, 99},
		WindGustMS: []float64{9, 9},
	}
	slots, rec := RankDepartureSlots(f, base, base.Add(2*time.Hour))
	if len(slots) != 2 || rec != nil {
		t.Fatalf("all-warn = %+v %v, want slots without recommendation", slots, rec)
	}
}

type fakeMeteo struct {
	forecast *stormguard.Forecast
	err      error
}

func (f *fakeMeteo) Fetch(_ context.Context, _, _ float64) (*stormguard.Forecast, error) {
	return f.forecast, f.err
}

var _ Meteo = (*fakeMeteo)(nil)

type fakeLive struct {
	values map[string]signal.SignalValue
	err    error
}

func (f *fakeLive) LiveSignal(_ context.Context, _ int64, name string) (signal.SignalValue, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.values[name], nil
}

var _ LiveSignals = (*fakeLive)(nil)

func adviseRequest(url, id string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, url, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestNewDepartureHandlerPanicsOnNil(t *testing.T) {
	f := newFakeStore()
	m := &fakeMeteo{}
	l := &fakeLive{}
	cases := map[string]func(){
		"nil store": func() { NewDepartureHandler(nil, m, l) },
		"nil meteo": func() { NewDepartureHandler(f, nil, l) },
		"nil live":  func() { NewDepartureHandler(f, m, nil) },
	}
	for name, fn := range cases {
		func() {
			defer func() {
				if recover() == nil {
					t.Fatalf("%s: expected panic", name)
				}
			}()
			fn()
		}()
	}
}

func TestAdvise(t *testing.T) {
	f := newFakeStore()
	now := time.Date(2026, 9, 14, 9, 30, 0, 0, time.UTC)
	s, err := f.Create(context.Background(), NewSession{
		VehicleID: 7, Name: "north",
		OriginLat: fptr(37.0), OriginLng: fptr(-122.0),
		DestLat: fptr(39.0), DestLng: fptr(-120.0),
	})
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	h := NewDepartureHandler(f, &fakeMeteo{forecast: departForecast(base)}, &fakeLive{
		values: map[string]signal.SignalValue{"Soc": 82.0, "ChargeLimitSoc": 90.0},
	})
	h.now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	h.Advise(rec, adviseRequest("/journey/sessions/1/departure", "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got DepartureAdvice
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != s.ID || len(got.Slots) != 6 {
		t.Fatalf("advice = %+v", got)
	}
	if got.RecommendedAt == nil || !got.RecommendedAt.Equal(base) {
		t.Fatalf("recommended = %v, want 10:00", got.RecommendedAt)
	}
	if got.Charge == nil || got.Charge.SocPct == nil || *got.Charge.SocPct != 82 {
		t.Fatalf("charge = %+v", got.Charge)
	}
	if len(got.Evidence) == 0 {
		t.Fatal("evidence is empty")
	}
}

func TestAdviseErrors(t *testing.T) {
	f := newFakeStore()
	h := NewDepartureHandler(f, &fakeMeteo{}, &fakeLive{})
	h.now = func() time.Time { return time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC) }
	cases := []struct {
		name string
		url  string
		id   string
		code int
	}{
		{"bad id", "/journey/sessions/x/departure", "x", http.StatusBadRequest},
		{"bad from", "/journey/sessions/1/departure?from=soon", "1", http.StatusBadRequest},
		{"bad to", "/journey/sessions/1/departure?to=later", "1", http.StatusBadRequest},
		{"missing session", "/journey/sessions/9/departure", "9", http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.Advise(rec, adviseRequest(c.url, c.id))
			if rec.Code != c.code {
				t.Fatalf("code = %d, want %d", rec.Code, c.code)
			}
		})
	}
}

func TestAdviseNeedsOrigin(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "vague"}); err != nil {
		t.Fatal(err)
	}
	h := NewDepartureHandler(f, &fakeMeteo{}, &fakeLive{})
	rec := httptest.NewRecorder()
	h.Advise(rec, adviseRequest("/journey/sessions/1/departure", "1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
}

func TestAdviseMeteoDown(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{
		VehicleID: 7, Name: "north",
		OriginLat: fptr(37.0), OriginLng: fptr(-122.0),
		DestLat: fptr(39.0), DestLng: fptr(-120.0),
	}); err != nil {
		t.Fatal(err)
	}
	h := NewDepartureHandler(f, &fakeMeteo{err: errors.New("meteo down")}, &fakeLive{})
	rec := httptest.NewRecorder()
	h.Advise(rec, adviseRequest("/journey/sessions/1/departure", "1"))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("code = %d, want 502", rec.Code)
	}
}
