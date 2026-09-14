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
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestEvaluateChecklistAllOK(t *testing.T) {
	now := time.Now().UTC()
	items := EvaluateChecklist(Inputs{
		Soc:      fptr(85),
		Limit:    fptr(90),
		TiresBar: [4]*float64{fptr(2.9), fptr(3.0), fptr(2.95), fptr(3.0)},
	}, now)
	if len(items) != 5 {
		t.Fatalf("items = %d, want 5", len(items))
	}
	for _, it := range items {
		if it.Status != ItemOK {
			t.Fatalf("%s = %q (%s), want ok", it.Key, it.Status, it.Detail)
		}
	}
}

func TestEvaluateChecklistGrades(t *testing.T) {
	now := time.Now().UTC()
	stormAt := now.Add(-2 * time.Hour)
	items := EvaluateChecklist(Inputs{
		Soc:      fptr(70),
		Limit:    fptr(75),
		TiresBar: [4]*float64{fptr(2.9), fptr(2.6), fptr(2.9), fptr(2.9)},
		Storm: &stormguard.Event{
			Level: stormguard.LevelWarning, Reason: "thunder",
			CreatedAt: stormAt,
		},
		Update: &vehiclemodel.SoftwareUpdate{Version: "2026.8", Status: "available"},
	}, now)
	got := map[string]string{}
	for _, it := range items {
		got[it.Key] = it.Status
	}
	want := map[string]string{
		KeyChargeLevel:    ItemAttention,
		KeyChargeLimit:    ItemAction,
		KeyTirePressure:   ItemAction,
		KeyStorm:          ItemAction,
		KeySoftwareUpdate: ItemAttention,
	}
	for k, w := range want {
		if got[k] != w {
			t.Fatalf("%s = %q, want %q", k, got[k], w)
		}
	}
}

func TestEvaluateChecklistUnknowns(t *testing.T) {
	items := EvaluateChecklist(Inputs{}, time.Now().UTC())
	got := map[string]string{}
	for _, it := range items {
		got[it.Key] = it.Status
	}
	// Missing signals degrade; absent storm/update records are fine.
	if got[KeyChargeLevel] != ItemUnknown || got[KeyChargeLimit] != ItemUnknown || got[KeyTirePressure] != ItemUnknown {
		t.Fatalf("signal items = %v, want unknown", got)
	}
	if got[KeyStorm] != ItemOK || got[KeySoftwareUpdate] != ItemOK {
		t.Fatalf("record items = %v, want ok", got)
	}
}

func TestEvaluateChecklistStaleStorm(t *testing.T) {
	now := time.Now().UTC()
	items := EvaluateChecklist(Inputs{
		Storm: &stormguard.Event{
			Level: stormguard.LevelWarning, Reason: "old",
			CreatedAt: now.Add(-24 * time.Hour),
		},
	}, now)
	for _, it := range items {
		if it.Key == KeyStorm && it.Status != ItemOK {
			t.Fatalf("stale storm = %q, want ok", it.Status)
		}
	}
}

type fakeStorm struct {
	events []*stormguard.Event
	err    error
}

func (f *fakeStorm) ListEvents(_ context.Context, _ int64, _ int) ([]*stormguard.Event, error) {
	return f.events, f.err
}

var _ StormEvents = (*fakeStorm)(nil)

type fakeUpdates struct {
	updates []*vehiclemodel.SoftwareUpdate
	err     error
}

func (f *fakeUpdates) GetByVehicle(_ context.Context, _ int64, _ int, _, _ time.Time) ([]*vehiclemodel.SoftwareUpdate, error) {
	return f.updates, f.err
}

var _ UpdateHistory = (*fakeUpdates)(nil)

type fakeRuns struct {
	runs map[int64][]*Run
	err  error
}

func (f *fakeRuns) SaveChecklistRun(_ context.Context, sessionID int64, items []Item) (*Run, error) {
	if f.err != nil {
		return nil, f.err
	}
	run := &Run{ID: int64(len(f.runs[sessionID]) + 1), SessionID: sessionID, RunAt: time.Now().UTC(), Items: items}
	f.runs[sessionID] = append(f.runs[sessionID], run)
	return run, nil
}

func (f *fakeRuns) LatestChecklistRun(_ context.Context, sessionID int64) (*Run, error) {
	if f.err != nil {
		return nil, f.err
	}
	rs := f.runs[sessionID]
	if len(rs) == 0 {
		return nil, nil
	}
	return rs[len(rs)-1], nil
}

var _ RunStore = (*fakeRuns)(nil)

func TestNewChecklistHandlerPanicsOnNil(t *testing.T) {
	f := newFakeStore()
	r := &fakeRuns{runs: map[int64][]*Run{}}
	l := &fakeLive{}
	s := &fakeStorm{}
	u := &fakeUpdates{}
	cases := map[string]func(){
		"nil store":   func() { NewChecklistHandler(nil, r, l, s, u) },
		"nil runs":    func() { NewChecklistHandler(f, nil, l, s, u) },
		"nil live":    func() { NewChecklistHandler(f, r, nil, s, u) },
		"nil storm":   func() { NewChecklistHandler(f, r, l, nil, u) },
		"nil updates": func() { NewChecklistHandler(f, r, l, s, nil) },
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

func checklistRequest(method, url, id string) *http.Request {
	req := httptest.NewRequest(method, url, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestRefresh(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "north"}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	h := NewChecklistHandler(f, &fakeRuns{runs: map[int64][]*Run{}}, &fakeLive{
		values: map[string]signal.SignalValue{
			"Soc": 85.0, "ChargeLimitSoc": 90.0,
			"TpmsPressureFl": 2.9, "TpmsPressureFr": 3.0,
			"TpmsPressureRl": 2.95, "TpmsPressureRr": 3.0,
		},
	}, &fakeStorm{events: []*stormguard.Event{
		{Level: stormguard.LevelNone, CreatedAt: now},
	}}, &fakeUpdates{})
	rec := httptest.NewRecorder()
	h.Refresh(rec, checklistRequest(http.MethodPost, "/journey/sessions/1/checklist/runs", "1"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Run
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.SessionID != 1 || len(got.Items) != 5 {
		t.Fatalf("run = %+v", got)
	}
	for _, it := range got.Items {
		if it.Status != ItemOK {
			t.Fatalf("%s = %q, want ok", it.Key, it.Status)
		}
	}
}

func TestRefreshErrors(t *testing.T) {
	f := newFakeStore()
	h := NewChecklistHandler(f, &fakeRuns{runs: map[int64][]*Run{}}, &fakeLive{}, &fakeStorm{}, &fakeUpdates{})
	rec := httptest.NewRecorder()
	h.Refresh(rec, checklistRequest(http.MethodPost, "/journey/sessions/9/checklist/runs", "9"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.Refresh(rec, checklistRequest(http.MethodPost, "/journey/sessions/x/checklist/runs", "x"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
}

func TestRefreshLiveDown(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "north"}); err != nil {
		t.Fatal(err)
	}
	h := NewChecklistHandler(f, &fakeRuns{runs: map[int64][]*Run{}}, &fakeLive{err: errors.New("db down")}, &fakeStorm{}, &fakeUpdates{})
	rec := httptest.NewRecorder()
	h.Refresh(rec, checklistRequest(http.MethodPost, "/journey/sessions/1/checklist/runs", "1"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}

func TestLatest(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "north"}); err != nil {
		t.Fatal(err)
	}
	runs := &fakeRuns{runs: map[int64][]*Run{}}
	h := NewChecklistHandler(f, runs, &fakeLive{}, &fakeStorm{}, &fakeUpdates{})
	rec := httptest.NewRecorder()
	h.Latest(rec, checklistRequest(http.MethodGet, "/journey/sessions/1/checklist", "1"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	if _, err := runs.SaveChecklistRun(context.Background(), 1, EvaluateChecklist(Inputs{}, time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	h.Latest(rec, checklistRequest(http.MethodGet, "/journey/sessions/1/checklist", "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, want 200", rec.Code)
	}
	var got Run
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 5 {
		t.Fatalf("items = %d, want 5", len(got.Items))
	}
}
