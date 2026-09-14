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

	"github.com/ev-dev-labs/teslasync/internal/api/waitoracle"
)

type fakeStore struct {
	sessions map[int64]*Session
	plans    map[int64][]*PlanVersion
	peaks    map[string][]float64
	prices   map[string]float64
	nextID   int64
	err      error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		sessions: map[int64]*Session{},
		plans:    map[int64][]*PlanVersion{},
		peaks:    map[string][]float64{},
		prices:   map[string]float64{},
		nextID:   1,
	}
}

func (f *fakeStore) Create(_ context.Context, in NewSession) (*Session, error) {
	if f.err != nil {
		return nil, f.err
	}
	s := &Session{
		ID: f.nextID, VehicleID: in.VehicleID, Name: in.Name,
		OriginName: in.OriginName, OriginLat: in.OriginLat, OriginLng: in.OriginLng,
		DestName: in.DestName, DestLat: in.DestLat, DestLng: in.DestLng,
		Status: StatusPlanned, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	f.sessions[s.ID] = s
	f.nextID++
	return s, nil
}

func (f *fakeStore) Get(_ context.Context, id int64) (*Session, error) {
	return f.sessions[id], f.err
}

func (f *fakeStore) List(_ context.Context, vehicleID int64, status string, _ int) ([]*Session, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := []*Session{}
	for _, s := range f.sessions {
		if s.VehicleID != vehicleID {
			continue
		}
		if status != "" && s.Status != status {
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

func (f *fakeStore) ActiveForVehicle(_ context.Context, vehicleID int64) (*Session, error) {
	if f.err != nil {
		return nil, f.err
	}
	for _, s := range f.sessions {
		if s.VehicleID == vehicleID && s.Status == StatusActive {
			return s, nil
		}
	}
	return nil, nil
}

func (f *fakeStore) SetStatus(_ context.Context, id int64, from, to string) (*Session, error) {
	if f.err != nil {
		return nil, f.err
	}
	s, ok := f.sessions[id]
	if !ok || s.Status != from {
		return nil, ErrConflict
	}
	if err := Transition(from, to); err != nil {
		return nil, err
	}
	s.Status = to
	s.UpdatedAt = time.Now()
	return s, nil
}

func (f *fakeStore) SavePlan(_ context.Context, sessionID int64, plan json.RawMessage, note string) (*PlanVersion, error) {
	if f.err != nil {
		return nil, f.err
	}
	s, ok := f.sessions[sessionID]
	if !ok {
		return nil, ErrNoSession
	}
	s.PlanVersion++
	pv := &PlanVersion{
		ID: int64(len(f.plans[sessionID]) + 1), SessionID: sessionID,
		Version: s.PlanVersion, Plan: plan, Note: note, CreatedAt: time.Now(),
	}
	f.plans[sessionID] = append(f.plans[sessionID], pv)
	return pv, nil
}

func (f *fakeStore) ListPlans(_ context.Context, sessionID int64) ([]*PlanVersion, error) {
	return f.plans[sessionID], f.err
}

func (f *fakeStore) SitePeaks(_ context.Context, site string) ([]float64, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.peaks[site], nil
}

func (f *fakeStore) SitePrice(_ context.Context, site string) (float64, int, bool, error) {
	if f.err != nil {
		return 0, 0, false, f.err
	}
	p, ok := f.prices[site]
	if !ok {
		return 0, 0, false, nil
	}
	return p, 12, true, nil
}

var _ SessionStore = (*fakeStore)(nil)
var _ SignalStore = (*fakeStore)(nil)

type fakeWaits struct {
	histories map[string]waitoracle.SiteHistory
	err       error
}

func (f *fakeWaits) History(_ context.Context, site string) (waitoracle.SiteHistory, error) {
	if f.err != nil {
		return waitoracle.SiteHistory{}, f.err
	}
	h, ok := f.histories[site]
	if !ok {
		return waitoracle.SiteHistory{}, waitoracle.ErrNoHistory
	}
	return h, nil
}

var _ WaitStore = (*fakeWaits)(nil)

func testHandler(f *fakeStore) *Handler {
	return NewHandler(f, f, &fakeWaits{histories: map[string]waitoracle.SiteHistory{}})
}

func withID(t *testing.T, method, target string, id string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	f := newFakeStore()
	w := &fakeWaits{}
	cases := map[string]func(){
		"nil store":   func() { NewHandler(nil, f, w) },
		"nil signals": func() { NewHandler(f, nil, w) },
		"nil waits":   func() { NewHandler(f, f, nil) },
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

func TestCreate(t *testing.T) {
	h := testHandler(newFakeStore())
	body := `{"vehicle_id":7,"name":"Tahoe ski trip","origin_name":"Home","dest_name":"Tahoe","dest_lat":39.1,"dest_lng":-120.0}`
	req := httptest.NewRequest(http.MethodPost, "/journey/sessions", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Create(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got Session
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusPlanned || got.Name != "Tahoe ski trip" || got.DestLat == nil {
		t.Fatalf("session = %+v", got)
	}
}

func TestCreateValidation(t *testing.T) {
	h := testHandler(newFakeStore())
	cases := map[string]string{
		"bad json":        `{oops`,
		"missing vehicle": `{"vehicle_id":0,"name":"x"}`,
		"empty name":      `{"vehicle_id":1,"name":""}`,
		"long name":       `{"vehicle_id":1,"name":"` + strings.Repeat("n", 201) + `"}`,
		"bad lat":         `{"vehicle_id":1,"name":"x","dest_lat":99}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/journey/sessions", strings.NewReader(body))
			rec := httptest.NewRecorder()
			h.Create(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400", rec.Code)
			}
		})
	}
}

func TestListFiltersByVehicleAndStatus(t *testing.T) {
	f := newFakeStore()
	h := testHandler(f)
	ctx := context.Background()
	if _, err := f.Create(ctx, NewSession{VehicleID: 7, Name: "a"}); err != nil {
		t.Fatal(err)
	}
	b, err := f.Create(ctx, NewSession{VehicleID: 7, Name: "b"})
	if err != nil {
		t.Fatal(err)
	}
	b.Status = StatusActive
	if _, err := f.Create(ctx, NewSession{VehicleID: 9, Name: "other"}); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/journey/sessions?vehicle_id=7&status=active", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got []*Session
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "b" {
		t.Fatalf("list = %+v", got)
	}
}

func TestClampListLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want int
	}{
		{0, 20},
		{-5, 20},
		{1, 1},
		{20, 20},
		{100, 100},
		{101, 100},
		{10_000, 100},
	}
	for _, tc := range cases {
		if got := clampListLimit(tc.in); got != tc.want {
			t.Fatalf("clampListLimit(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestListValidation(t *testing.T) {
	h := testHandler(newFakeStore())
	for _, url := range []string{
		"/journey/sessions",
		"/journey/sessions?vehicle_id=0",
		"/journey/sessions?vehicle_id=7&status=bogus",
	} {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		h.List(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: code = %d, want 400", url, rec.Code)
		}
	}
}

func TestGetIncludesPlansAndNext(t *testing.T) {
	f := newFakeStore()
	h := testHandler(f)
	ctx := context.Background()
	s, err := f.Create(ctx, NewSession{VehicleID: 7, Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.SavePlan(ctx, s.ID, json.RawMessage(`{"stops":[]}`), "v1"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.Get(rec, withID(t, http.MethodGet, "/journey/sessions/1", "1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
	var got getResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Plans) != 1 || got.Plans[0].Version != 1 {
		t.Fatalf("plans = %+v", got.Plans)
	}
	if len(got.Next) != 2 { // active, aborted
		t.Fatalf("next = %v", got.Next)
	}
}

func TestGetNotFound(t *testing.T) {
	h := testHandler(newFakeStore())
	rec := httptest.NewRecorder()
	h.Get(rec, withID(t, http.MethodGet, "/journey/sessions/9", "9"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.Get(rec, withID(t, http.MethodGet, "/journey/sessions/x", "x"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
}

func TestStartRejectsSecondActive(t *testing.T) {
	f := newFakeStore()
	h := testHandler(f)
	ctx := context.Background()
	a, err := f.Create(ctx, NewSession{VehicleID: 7, Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	a.Status = StatusActive
	b, err := f.Create(ctx, NewSession{VehicleID: 7, Name: "b"})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.Start(rec, withID(t, http.MethodPost, "/journey/sessions/2/start", "2"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
	_ = b
}

func TestLifecycleTransitions(t *testing.T) {
	f := newFakeStore()
	h := testHandler(f)
	s, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	steps := []struct {
		name string
		fn   func(http.ResponseWriter, *http.Request)
		want string
	}{
		{"start", h.Start, StatusActive},
		{"pause", h.Pause, StatusPaused},
		{"resume", h.Resume, StatusActive},
		{"complete", h.Complete, StatusCompleted},
	}
	for _, step := range steps {
		t.Run(step.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			step.fn(rec, withID(t, http.MethodPost, "/journey/sessions/1/x", "1"))
			if rec.Code != http.StatusOK {
				t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
			}
			if s.Status != step.want {
				t.Fatalf("status = %q, want %q", s.Status, step.want)
			}
		})
	}
	// Terminal: abort after complete must conflict.
	rec := httptest.NewRecorder()
	h.Abort(rec, withID(t, http.MethodPost, "/journey/sessions/1/abort", "1"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("code = %d, want 409", rec.Code)
	}
}

func TestSavePlan(t *testing.T) {
	f := newFakeStore()
	h := testHandler(f)
	s, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"plan":{"stops":[{"site":"Kettleman"}]},"note":"initial"}`
	req := httptest.NewRequest(http.MethodPost, "/journey/sessions/1/plans", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "1")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.SavePlan(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got PlanVersion
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Version != 1 || s.PlanVersion != 1 {
		t.Fatalf("version = %d, session pointer = %d", got.Version, s.PlanVersion)
	}
}

func TestSavePlanErrors(t *testing.T) {
	h := testHandler(newFakeStore())
	// Missing session.
	body := `{"plan":{},"note":"x"}`
	req := httptest.NewRequest(http.MethodPost, "/journey/sessions/9/plans", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "9")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.SavePlan(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
	// Invalid JSON plan.
	bad := `{"plan":{oops},"note":"x"}`
	req2 := httptest.NewRequest(http.MethodPost, "/journey/sessions/1/plans", strings.NewReader(bad))
	rctx2 := chi.NewRouteContext()
	rctx2.URLParams.Add("id", "1")
	req2 = req2.WithContext(context.WithValue(req2.Context(), chi.RouteCtxKey, rctx2))
	rec2 := httptest.NewRecorder()
	h.SavePlan(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec2.Code)
	}
}

func TestStoreErrorSurfaces500(t *testing.T) {
	h := testHandler(&fakeStore{err: errors.New("db down"), sessions: map[int64]*Session{}, plans: map[int64][]*PlanVersion{}})
	req := httptest.NewRequest(http.MethodGet, "/journey/sessions?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}

func fptr(v float64) *float64 { return &v }

func scoredHistory(site string) waitoracle.SiteHistory {
	base := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	spans := make([]waitoracle.Session, 0, 20)
	for i := 0; i < 20; i++ {
		s := base.Add(time.Duration(i) * time.Hour)
		spans = append(spans, waitoracle.Session{Start: s, Stop: s.Add(30 * time.Minute)})
	}
	return waitoracle.SiteHistory{
		Site: site, Sessions: 100, Weeks: 10,
		Buckets: []waitoracle.Bucket{{Weekday: 5, Hour: 18, Starts: 60}},
		Spans:   spans,
	}
}

func scoreHTTPRequest(t *testing.T, id, body string) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/journey/sessions/"+id+"/score-stops", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return httptest.NewRecorder(), req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestScoreStops(t *testing.T) {
	f := newFakeStore()
	s, err := f.Create(context.Background(), NewSession{
		VehicleID: 7, Name: "north",
		OriginLat: fptr(37.0), OriginLng: fptr(-122.0),
		DestLat: fptr(39.0), DestLng: fptr(-120.0),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.prices["Kettleman"] = 0.30
	f.peaks["Kettleman"] = []float64{150, 151, 149, 150, 152}
	w := &fakeWaits{histories: map[string]waitoracle.SiteHistory{
		"Kettleman": scoredHistory("Kettleman"),
	}}
	h := NewHandler(f, f, w)
	body := `{"energy_wh": 40000, "candidates": [
		{"site": "Kettleman", "lat": 38.0, "lng": -121.0, "arrive_at": "2026-09-11T18:00:00Z"},
		{"site": "Nowhere", "lat": 38.0, "lng": -118.0, "arrive_at": "2026-09-11T18:00:00Z"}
	]}`
	rec, req := scoreHTTPRequest(t, "1", body)
	h.ScoreStops(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code = %d, body = %s", rec.Code, rec.Body.String())
	}
	var got scoreResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Winner != "Kettleman" {
		t.Fatalf("winner = %q, want Kettleman", got.Winner)
	}
	if len(got.Stops) != 2 || got.Stops[0].Score < got.Stops[1].Score {
		t.Fatalf("stops not ranked: %+v", got.Stops)
	}
	if got.Stops[0].WaitS == nil || got.Stops[0].PerKWh == nil || got.Stops[0].Health == nil {
		t.Fatalf("winner missing signals: %+v", got.Stops[0])
	}
	if got.Stops[1].WaitS != nil || got.Stops[1].PerKWh != nil {
		t.Fatalf("thin site should degrade: %+v", got.Stops[1])
	}
	if got.PlanVersion != 1 || s.PlanVersion != 1 || len(f.plans[s.ID]) != 1 {
		t.Fatalf("plan not persisted: %+v", got)
	}
	if f.plans[s.ID][0].Note != "stop scores (2 candidates)" {
		t.Fatalf("note = %q", f.plans[s.ID][0].Note)
	}
}

func TestScoreStopsValidation(t *testing.T) {
	h := testHandler(newFakeStore())
	cand := `{"site": "K", "lat": 38.0, "lng": -121.0, "arrive_at": "2026-09-11T18:00:00Z"}`
	many := `{"energy_wh": 1000, "candidates": [` + strings.Repeat(cand+",", 10) + cand + `]}`
	cases := map[string]string{
		"bad json":      `{oops`,
		"no candidates": `{"energy_wh": 1000, "candidates": []}`,
		"too many":      many,
		"no energy":     `{"energy_wh": 0, "candidates": [` + cand + `]}`,
		"huge energy":   `{"energy_wh": 999999, "candidates": [` + cand + `]}`,
		"empty site":    `{"energy_wh": 1000, "candidates": [{"site": "", "lat": 0, "lng": 0, "arrive_at": "2026-09-11T18:00:00Z"}]}`,
		"bad lat":       `{"energy_wh": 1000, "candidates": [{"site": "K", "lat": 99, "lng": 0, "arrive_at": "2026-09-11T18:00:00Z"}]}`,
		"bad arrival":   `{"energy_wh": 1000, "candidates": [{"site": "K", "lat": 0, "lng": 0, "arrive_at": "soon"}]}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec, req := scoreHTTPRequest(t, "1", body)
			h.ScoreStops(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("code = %d, want 400", rec.Code)
			}
		})
	}
}

func TestScoreStopsNeedsCoords(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{VehicleID: 7, Name: "vague"}); err != nil {
		t.Fatal(err)
	}
	h := testHandler(f)
	body := `{"energy_wh": 1000, "candidates": [
		{"site": "K", "lat": 38.0, "lng": -121.0, "arrive_at": "2026-09-11T18:00:00Z"}
	]}`
	rec, req := scoreHTTPRequest(t, "1", body)
	h.ScoreStops(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", rec.Code)
	}
}

func TestScoreStopsNotFound(t *testing.T) {
	h := testHandler(newFakeStore())
	body := `{"energy_wh": 1000, "candidates": [
		{"site": "K", "lat": 38.0, "lng": -121.0, "arrive_at": "2026-09-11T18:00:00Z"}
	]}`
	rec, req := scoreHTTPRequest(t, "9", body)
	h.ScoreStops(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code = %d, want 404", rec.Code)
	}
}

func TestScoreStopsSignalsError(t *testing.T) {
	f := newFakeStore()
	if _, err := f.Create(context.Background(), NewSession{
		VehicleID: 7, Name: "north",
		OriginLat: fptr(37.0), OriginLng: fptr(-122.0),
		DestLat: fptr(39.0), DestLng: fptr(-120.0),
	}); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(f, f, &fakeWaits{err: errors.New("db down")})
	body := `{"energy_wh": 1000, "candidates": [
		{"site": "K", "lat": 38.0, "lng": -121.0, "arrive_at": "2026-09-11T18:00:00Z"}
	]}`
	rec, req := scoreHTTPRequest(t, "1", body)
	h.ScoreStops(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}
