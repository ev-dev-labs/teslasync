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
)

type fakeStore struct {
	sessions map[int64]*Session
	plans    map[int64][]*PlanVersion
	nextID   int64
	err      error
}

func newFakeStore() *fakeStore {
	return &fakeStore{sessions: map[int64]*Session{}, plans: map[int64][]*PlanVersion{}, nextID: 1}
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

var _ SessionStore = (*fakeStore)(nil)

func withID(t *testing.T, method, target string, id string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestNewHandlerPanicsOnNil(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	NewHandler(nil)
}

func TestCreate(t *testing.T) {
	h := NewHandler(newFakeStore())
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
	h := NewHandler(newFakeStore())
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
	h := NewHandler(f)
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

func TestListValidation(t *testing.T) {
	h := NewHandler(newFakeStore())
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
	h := NewHandler(f)
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
	h := NewHandler(newFakeStore())
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
	h := NewHandler(f)
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
	h := NewHandler(f)
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
	h := NewHandler(f)
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
	h := NewHandler(newFakeStore())
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
	h := NewHandler(&fakeStore{err: errors.New("db down"), sessions: map[int64]*Session{}, plans: map[int64][]*PlanVersion{}})
	req := httptest.NewRequest(http.MethodGet, "/journey/sessions?vehicle_id=7", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", rec.Code)
	}
}
