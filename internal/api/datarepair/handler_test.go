package datarepair

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

// testNow is the fixed wall-clock injected into the handler so cutoff and
// duration math are deterministic across every case.
var testNow = time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

var errBoom = errors.New("boom")

// ---- fakes ---------------------------------------------------------------

// fakeChargingRepo is an in-memory chargingRepository. Each method delegates to
// an optional function field (nil => zero-value success) and records the
// arguments it was called with so tests can assert wiring without a database.
type fakeChargingRepo struct {
	getStaleFn func(context.Context, time.Time) ([]*chargingmodel.ChargingSession, error)
	getByIDFn  func(context.Context, int64) (*chargingmodel.ChargingSession, error)
	partialFn  func(context.Context, int64, map[string]interface{}) error
	deleteFn   func(context.Context, int64) error

	staleCalls    int
	staleCutoff   time.Time
	getByIDCalls  int
	getByIDArgs   []int64
	partialCalls  int
	partialID     int64
	partialFields map[string]interface{}
	deleteCalls   int
	deleteID      int64
}

func (f *fakeChargingRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, error) {
	f.staleCalls++
	f.staleCutoff = cutoff
	if f.getStaleFn != nil {
		return f.getStaleFn(ctx, cutoff)
	}
	return nil, nil
}

func (f *fakeChargingRepo) GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error) {
	f.getByIDCalls++
	f.getByIDArgs = append(f.getByIDArgs, id)
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, id)
	}
	return nil, nil
}

func (f *fakeChargingRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	f.partialCalls++
	f.partialID = id
	f.partialFields = fields
	if f.partialFn != nil {
		return f.partialFn(ctx, id, fields)
	}
	return nil
}

func (f *fakeChargingRepo) Delete(ctx context.Context, id int64) error {
	f.deleteCalls++
	f.deleteID = id
	if f.deleteFn != nil {
		return f.deleteFn(ctx, id)
	}
	return nil
}

// fakeDriveRepo mirrors fakeChargingRepo for the driveRepository port.
type fakeDriveRepo struct {
	getStaleFn func(context.Context, time.Time) ([]*drivemodel.Drive, error)
	getByIDFn  func(context.Context, int64) (*drivemodel.Drive, error)
	partialFn  func(context.Context, int64, map[string]interface{}) error
	deleteFn   func(context.Context, int64) error

	staleCalls    int
	staleCutoff   time.Time
	getByIDCalls  int
	getByIDArgs   []int64
	partialCalls  int
	partialID     int64
	partialFields map[string]interface{}
	deleteCalls   int
	deleteID      int64
}

func (f *fakeDriveRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*drivemodel.Drive, error) {
	f.staleCalls++
	f.staleCutoff = cutoff
	if f.getStaleFn != nil {
		return f.getStaleFn(ctx, cutoff)
	}
	return nil, nil
}

func (f *fakeDriveRepo) GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error) {
	f.getByIDCalls++
	f.getByIDArgs = append(f.getByIDArgs, id)
	if f.getByIDFn != nil {
		return f.getByIDFn(ctx, id)
	}
	return nil, nil
}

func (f *fakeDriveRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	f.partialCalls++
	f.partialID = id
	f.partialFields = fields
	if f.partialFn != nil {
		return f.partialFn(ctx, id, fields)
	}
	return nil
}

func (f *fakeDriveRepo) Delete(ctx context.Context, id int64) error {
	f.deleteCalls++
	f.deleteID = id
	if f.deleteFn != nil {
		return f.deleteFn(ctx, id)
	}
	return nil
}

// ---- helpers -------------------------------------------------------------

func newTestHandler(c chargingRepository, d driveRepository) *DataRepairHandler {
	return &DataRepairHandler{
		chargingRepo: c,
		driveRepo:    d,
		clock:        func() time.Time { return testNow },
	}
}

// newRouter mirrors the production mount in internal/api/router.go exactly so
// the {id} URL param resolves the same way it does in the running server.
func newRouter(h *DataRepairHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/data-repair/stale-sessions", h.GetStaleSessions)
	r.Route("/data-repair/charging/{id}", func(r chi.Router) {
		r.Put("/", h.UpdateCharging)
		r.Post("/close", h.CloseCharging)
		r.Delete("/", h.DeleteCharging)
	})
	r.Route("/data-repair/drive/{id}", func(r chi.Router) {
		r.Put("/", h.UpdateDrive)
		r.Post("/close", h.CloseDrive)
		r.Delete("/", h.DeleteDrive)
	})
	return r
}

func doReq(t *testing.T, h *DataRepairHandler, method, path string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, body)
	newRouter(h).ServeHTTP(rec, req)
	return rec
}

func bodyError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body failed: %v (raw=%q)", err, rec.Body.String())
	}
	return m["error"]
}

func sampleCharging(id int64) *chargingmodel.ChargingSession {
	return &chargingmodel.ChargingSession{
		ID:        id,
		VehicleID: 7,
		StartedAt: time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC),
	}
}

func sampleDrive(id int64, start time.Time) *drivemodel.Drive {
	return &drivemodel.Drive{
		ID:        id,
		VehicleID: 7,
		StartTs:   start,
	}
}

// ---- constructor / clock -------------------------------------------------

func TestNewDataRepairHandler_WiresRepos(t *testing.T) {
	t.Parallel()

	// A nil *database.DB is fine at construction time — NewChargingRepo /
	// NewDriveRepo only touch the pool when a query runs. This exercises the
	// production constructor without a database.
	h := NewDataRepairHandler(nil)
	if h == nil {
		t.Fatal("NewDataRepairHandler returned nil")
	}
	if h.chargingRepo == nil {
		t.Error("chargingRepo is nil")
	}
	if h.driveRepo == nil {
		t.Error("driveRepo is nil")
	}
	if h.clock != nil {
		t.Error("production handler should leave clock nil (wall-clock fallback)")
	}
}

func TestDataRepairHandler_now(t *testing.T) {
	t.Parallel()

	// Injected clock is used verbatim.
	h := newTestHandler(&fakeChargingRepo{}, &fakeDriveRepo{})
	if got := h.now(); !got.Equal(testNow) {
		t.Errorf("now() with injected clock = %s, want %s", got, testNow)
	}

	// Nil clock falls back to wall-clock UTC.
	bare := &DataRepairHandler{}
	before := time.Now().UTC().Add(-time.Second)
	got := bare.now()
	after := time.Now().UTC().Add(time.Second)
	if got.Before(before) || got.After(after) {
		t.Errorf("now() fallback %s not within [%s, %s]", got, before, after)
	}
	if got.Location() != time.UTC {
		t.Errorf("now() fallback location = %s, want UTC", got.Location())
	}
}

// ---- GetStaleSessions ----------------------------------------------------

func TestGetStaleSessions_HappyPath(t *testing.T) {
	t.Parallel()

	charging := &fakeChargingRepo{
		getStaleFn: func(context.Context, time.Time) ([]*chargingmodel.ChargingSession, error) {
			return []*chargingmodel.ChargingSession{sampleCharging(11), sampleCharging(12)}, nil
		},
	}
	drive := &fakeDriveRepo{
		getStaleFn: func(context.Context, time.Time) ([]*drivemodel.Drive, error) {
			return []*drivemodel.Drive{sampleDrive(21, testNow.Add(-48 * time.Hour))}, nil
		},
	}
	h := newTestHandler(charging, drive)

	rec := doReq(t, h, http.MethodGet, "/data-repair/stale-sessions", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var resp StaleSessionsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.StaleCharging) != 2 {
		t.Errorf("stale_charging len = %d, want 2", len(resp.StaleCharging))
	}
	if len(resp.StaleDrives) != 1 {
		t.Errorf("stale_drives len = %d, want 1", len(resp.StaleDrives))
	}
	if len(resp.StaleCharging) == 2 && resp.StaleCharging[0].ID != 11 {
		t.Errorf("first charging id = %d, want 11", resp.StaleCharging[0].ID)
	}

	// The 24h cutoff must be derived from the injected clock.
	wantCutoff := testNow.Add(-24 * time.Hour)
	if !charging.staleCutoff.Equal(wantCutoff) {
		t.Errorf("charging cutoff = %s, want %s", charging.staleCutoff, wantCutoff)
	}
	if !drive.staleCutoff.Equal(wantCutoff) {
		t.Errorf("drive cutoff = %s, want %s", drive.staleCutoff, wantCutoff)
	}
}

func TestGetStaleSessions_NilSlicesSerializeAsArrays(t *testing.T) {
	t.Parallel()

	// Both repos return nil — the handler must coerce to [] so the frontend
	// never has to null-guard the arrays.
	h := newTestHandler(&fakeChargingRepo{}, &fakeDriveRepo{})

	rec := doReq(t, h, http.MethodGet, "/data-repair/stale-sessions", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got := rec.Body.String()
	if !strings.Contains(got, `"stale_charging":[]`) {
		t.Errorf("stale_charging must serialize as [], body=%s", got)
	}
	if !strings.Contains(got, `"stale_drives":[]`) {
		t.Errorf("stale_drives must serialize as [], body=%s", got)
	}
}

func TestGetStaleSessions_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		charging      *fakeChargingRepo
		drive         *fakeDriveRepo
		wantErr       string
		wantDriveCall int
	}{
		{
			name: "charging repo fails short-circuits before drive",
			charging: &fakeChargingRepo{
				getStaleFn: func(context.Context, time.Time) ([]*chargingmodel.ChargingSession, error) {
					return nil, errBoom
				},
			},
			drive:         &fakeDriveRepo{},
			wantErr:       "failed to get stale charging sessions",
			wantDriveCall: 0,
		},
		{
			name:     "drive repo fails after charging ok",
			charging: &fakeChargingRepo{},
			drive: &fakeDriveRepo{
				getStaleFn: func(context.Context, time.Time) ([]*drivemodel.Drive, error) {
					return nil, errBoom
				},
			},
			wantErr:       "failed to get stale drives",
			wantDriveCall: 1,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(tc.charging, tc.drive)
			rec := doReq(t, h, http.MethodGet, "/data-repair/stale-sessions", nil)

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500. body=%s", rec.Code, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if tc.drive.staleCalls != tc.wantDriveCall {
				t.Errorf("drive GetStale calls = %d, want %d", tc.drive.staleCalls, tc.wantDriveCall)
			}
		})
	}
}

// ---- UpdateCharging ------------------------------------------------------

func TestUpdateCharging_HappyPath(t *testing.T) {
	t.Parallel()

	fake := &fakeChargingRepo{
		getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
			return sampleCharging(id), nil
		},
	}
	h := newTestHandler(fake, &fakeDriveRepo{})

	rec := doReq(t, h, http.MethodPut, "/data-repair/charging/42",
		strings.NewReader(`{"end_soc_pct":95,"cost_currency":"USD"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	var got chargingmodel.ChargingSession
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != 42 {
		t.Errorf("response id = %d, want 42", got.ID)
	}

	// GetByID is called once for the existence check and once for the
	// re-read of the updated row.
	if fake.getByIDCalls != 2 {
		t.Errorf("GetByID calls = %d, want 2", fake.getByIDCalls)
	}
	if fake.partialCalls != 1 {
		t.Fatalf("PartialUpdate calls = %d, want 1", fake.partialCalls)
	}
	if fake.partialID != 42 {
		t.Errorf("PartialUpdate id = %d, want 42", fake.partialID)
	}
	if _, ok := fake.partialFields["end_soc_pct"]; !ok {
		t.Errorf("PartialUpdate fields missing end_soc_pct: %v", fake.partialFields)
	}
	if fake.partialFields["cost_currency"] != "USD" {
		t.Errorf("PartialUpdate cost_currency = %v, want USD", fake.partialFields["cost_currency"])
	}
}

func TestUpdateCharging_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		path         string
		body         io.Reader
		fake         func() *fakeChargingRepo
		wantStatus   int
		wantErr      string
		wantPartial  int
		wantGetByID  int
		skipErrCheck bool
	}{
		{
			name:        "non-numeric id",
			path:        "/data-repair/charging/abc",
			body:        strings.NewReader(`{}`),
			fake:        func() *fakeChargingRepo { return &fakeChargingRepo{} },
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid charging session ID",
			wantPartial: 0,
			wantGetByID: 0,
		},
		{
			name: "get existing fails",
			path: "/data-repair/charging/5",
			body: strings.NewReader(`{}`),
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{getByIDFn: func(context.Context, int64) (*chargingmodel.ChargingSession, error) {
					return nil, errBoom
				}}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get charging session",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name:        "not found",
			path:        "/data-repair/charging/9",
			body:        strings.NewReader(`{}`),
			fake:        func() *fakeChargingRepo { return &fakeChargingRepo{} }, // GetByID => nil,nil
			wantStatus:  http.StatusNotFound,
			wantErr:     "charging session not found",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name: "invalid json body",
			path: "/data-repair/charging/7",
			body: strings.NewReader(`{not valid`),
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
					return sampleCharging(id), nil
				}}
			},
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid JSON body",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name: "partial update fails",
			path: "/data-repair/charging/7",
			body: strings.NewReader(`{"end_soc_pct":50}`),
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{
					getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
						return sampleCharging(id), nil
					},
					partialFn: func(context.Context, int64, map[string]interface{}) error { return errBoom },
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to update charging session",
			wantPartial: 1,
			wantGetByID: 1,
		},
		{
			name: "re-read after update fails",
			path: "/data-repair/charging/7",
			body: strings.NewReader(`{"end_soc_pct":50}`),
			fake: func() *fakeChargingRepo {
				calls := 0
				return &fakeChargingRepo{
					getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
						calls++
						if calls == 1 {
							return sampleCharging(id), nil
						}
						return nil, errBoom
					},
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get updated session",
			wantPartial: 1,
			wantGetByID: 2,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(fake, &fakeDriveRepo{})
			rec := doReq(t, h, http.MethodPut, tc.path, tc.body)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.partialCalls != tc.wantPartial {
				t.Errorf("PartialUpdate calls = %d, want %d", fake.partialCalls, tc.wantPartial)
			}
			if fake.getByIDCalls != tc.wantGetByID {
				t.Errorf("GetByID calls = %d, want %d", fake.getByIDCalls, tc.wantGetByID)
			}
		})
	}
}

// ---- UpdateDrive ---------------------------------------------------------

func TestUpdateDrive_HappyPath(t *testing.T) {
	t.Parallel()

	fake := &fakeDriveRepo{
		getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
			return sampleDrive(id, testNow.Add(-time.Hour)), nil
		},
	}
	h := newTestHandler(&fakeChargingRepo{}, fake)

	rec := doReq(t, h, http.MethodPut, "/data-repair/drive/8",
		strings.NewReader(`{"distance_m":1234.5}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var got drivemodel.Drive
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.ID != 8 {
		t.Errorf("response id = %d, want 8", got.ID)
	}
	if fake.getByIDCalls != 2 {
		t.Errorf("GetByID calls = %d, want 2", fake.getByIDCalls)
	}
	if fake.partialFields["distance_m"] != 1234.5 {
		t.Errorf("PartialUpdate distance_m = %v, want 1234.5", fake.partialFields["distance_m"])
	}
}

func TestUpdateDrive_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		path        string
		body        io.Reader
		fake        func() *fakeDriveRepo
		wantStatus  int
		wantErr     string
		wantPartial int
		wantGetByID int
	}{
		{
			name:        "non-numeric id",
			path:        "/data-repair/drive/xyz",
			body:        strings.NewReader(`{}`),
			fake:        func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid drive ID",
			wantPartial: 0,
			wantGetByID: 0,
		},
		{
			name: "get existing fails",
			path: "/data-repair/drive/5",
			body: strings.NewReader(`{}`),
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{getByIDFn: func(context.Context, int64) (*drivemodel.Drive, error) {
					return nil, errBoom
				}}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get drive",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name:        "not found",
			path:        "/data-repair/drive/9",
			body:        strings.NewReader(`{}`),
			fake:        func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus:  http.StatusNotFound,
			wantErr:     "drive not found",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name: "invalid json body",
			path: "/data-repair/drive/7",
			body: strings.NewReader(`}bad`),
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
					return sampleDrive(id, testNow), nil
				}}
			},
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid JSON body",
			wantPartial: 0,
			wantGetByID: 1,
		},
		{
			name: "partial update fails",
			path: "/data-repair/drive/7",
			body: strings.NewReader(`{"distance_m":10}`),
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{
					getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
						return sampleDrive(id, testNow), nil
					},
					partialFn: func(context.Context, int64, map[string]interface{}) error { return errBoom },
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to update drive",
			wantPartial: 1,
			wantGetByID: 1,
		},
		{
			name: "re-read after update fails",
			path: "/data-repair/drive/7",
			body: strings.NewReader(`{"distance_m":10}`),
			fake: func() *fakeDriveRepo {
				calls := 0
				return &fakeDriveRepo{
					getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
						calls++
						if calls == 1 {
							return sampleDrive(id, testNow), nil
						}
						return nil, errBoom
					},
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get updated drive",
			wantPartial: 1,
			wantGetByID: 2,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(&fakeChargingRepo{}, fake)
			rec := doReq(t, h, http.MethodPut, tc.path, tc.body)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.partialCalls != tc.wantPartial {
				t.Errorf("PartialUpdate calls = %d, want %d", fake.partialCalls, tc.wantPartial)
			}
			if fake.getByIDCalls != tc.wantGetByID {
				t.Errorf("GetByID calls = %d, want %d", fake.getByIDCalls, tc.wantGetByID)
			}
		})
	}
}

// ---- CloseCharging -------------------------------------------------------

func TestCloseCharging_HappyPath(t *testing.T) {
	t.Parallel()

	fake := &fakeChargingRepo{
		getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
			return sampleCharging(id), nil
		},
	}
	h := newTestHandler(fake, &fakeDriveRepo{})

	rec := doReq(t, h, http.MethodPost, "/data-repair/charging/3/close", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out["status"] != "closed" {
		t.Errorf("status field = %q, want closed", out["status"])
	}
	if fake.partialCalls != 1 {
		t.Fatalf("PartialUpdate calls = %d, want 1", fake.partialCalls)
	}
	if fake.partialID != 3 {
		t.Errorf("PartialUpdate id = %d, want 3", fake.partialID)
	}
	wantEnded := testNow.Format(time.RFC3339)
	if fake.partialFields["ended_at"] != wantEnded {
		t.Errorf("ended_at = %v, want %s", fake.partialFields["ended_at"], wantEnded)
	}
	// The charging table has no stored duration; the patch must not write one.
	if _, ok := fake.partialFields["duration_s"]; ok {
		t.Errorf("close charging must not set duration_s: %v", fake.partialFields)
	}
}

func TestCloseCharging_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		path        string
		fake        func() *fakeChargingRepo
		wantStatus  int
		wantErr     string
		wantPartial int
	}{
		{
			name:        "non-numeric id",
			path:        "/data-repair/charging/nope/close",
			fake:        func() *fakeChargingRepo { return &fakeChargingRepo{} },
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid charging session ID",
			wantPartial: 0,
		},
		{
			name: "get session fails",
			path: "/data-repair/charging/5/close",
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{getByIDFn: func(context.Context, int64) (*chargingmodel.ChargingSession, error) {
					return nil, errBoom
				}}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get charging session",
			wantPartial: 0,
		},
		{
			name:        "not found",
			path:        "/data-repair/charging/9/close",
			fake:        func() *fakeChargingRepo { return &fakeChargingRepo{} },
			wantStatus:  http.StatusNotFound,
			wantErr:     "charging session not found",
			wantPartial: 0,
		},
		{
			name: "partial update fails",
			path: "/data-repair/charging/9/close",
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{
					getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
						return sampleCharging(id), nil
					},
					partialFn: func(context.Context, int64, map[string]interface{}) error { return errBoom },
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to close charging session",
			wantPartial: 1,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(fake, &fakeDriveRepo{})
			rec := doReq(t, h, http.MethodPost, tc.path, nil)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.partialCalls != tc.wantPartial {
				t.Errorf("PartialUpdate calls = %d, want %d", fake.partialCalls, tc.wantPartial)
			}
		})
	}
}

// ---- CloseDrive ----------------------------------------------------------

// TestCloseDrive_SetsEndedAtAndDuration pins the bug fix: the close patch MUST
// key the end timestamp as "ended_at" (the SI-canonical drives column in
// DrivePartialAllowed), not "end_ts". Writing "end_ts" is silently dropped by
// BuildPartialUpdate, leaving ended_at NULL so the drive stays "stale" forever.
func TestCloseDrive_SetsEndedAtAndDuration(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-2 * time.Hour)
	fake := &fakeDriveRepo{
		getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
			return sampleDrive(id, start), nil
		},
	}
	h := newTestHandler(&fakeChargingRepo{}, fake)

	rec := doReq(t, h, http.MethodPost, "/data-repair/drive/17/close", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out["status"] != "closed" {
		t.Errorf("status field = %q, want closed", out["status"])
	}
	if fake.partialCalls != 1 {
		t.Fatalf("PartialUpdate calls = %d, want 1", fake.partialCalls)
	}
	if fake.partialID != 17 {
		t.Errorf("PartialUpdate id = %d, want 17", fake.partialID)
	}

	// The regression guard: the wrong key must NOT be present ...
	if _, wrong := fake.partialFields["end_ts"]; wrong {
		t.Errorf("close drive must not write end_ts (dropped by DrivePartialAllowed): %v", fake.partialFields)
	}
	// ... and the correct SI column must be present with the clock timestamp.
	wantEnded := testNow.Format(time.RFC3339)
	if fake.partialFields["ended_at"] != wantEnded {
		t.Errorf("ended_at = %v, want %s", fake.partialFields["ended_at"], wantEnded)
	}
	if got, ok := fake.partialFields["duration_s"].(int64); !ok || got != 7200 {
		t.Errorf("duration_s = %v (%T), want int64 7200", fake.partialFields["duration_s"], fake.partialFields["duration_s"])
	}
}

func TestCloseDrive_DurationRounding(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		offset time.Duration // start = testNow - offset
		want   int64
	}{
		{"zero duration", 0, 0},
		{"exact seconds", 90 * time.Second, 90},
		{"round down below half", 10*time.Second + 400*time.Millisecond, 10},
		{"round up at half", 10*time.Second + 500*time.Millisecond, 11},
		{"round up above half", 10*time.Second + 600*time.Millisecond, 11},
		{"two hours", 2 * time.Hour, 7200},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := &fakeDriveRepo{
				getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
					return sampleDrive(id, testNow.Add(-tc.offset)), nil
				},
			}
			h := newTestHandler(&fakeChargingRepo{}, fake)

			rec := doReq(t, h, http.MethodPost, "/data-repair/drive/1/close", nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			got, ok := fake.partialFields["duration_s"].(int64)
			if !ok {
				t.Fatalf("duration_s type = %T, want int64", fake.partialFields["duration_s"])
			}
			if got != tc.want {
				t.Errorf("duration_s = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestCloseDrive_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		path        string
		fake        func() *fakeDriveRepo
		wantStatus  int
		wantErr     string
		wantPartial int
	}{
		{
			name:        "non-numeric id",
			path:        "/data-repair/drive/nope/close",
			fake:        func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus:  http.StatusBadRequest,
			wantErr:     "invalid drive ID",
			wantPartial: 0,
		},
		{
			name: "get drive fails",
			path: "/data-repair/drive/5/close",
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{getByIDFn: func(context.Context, int64) (*drivemodel.Drive, error) {
					return nil, errBoom
				}}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to get drive",
			wantPartial: 0,
		},
		{
			name:        "not found",
			path:        "/data-repair/drive/9/close",
			fake:        func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus:  http.StatusNotFound,
			wantErr:     "drive not found",
			wantPartial: 0,
		},
		{
			name: "partial update fails",
			path: "/data-repair/drive/9/close",
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{
					getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
						return sampleDrive(id, testNow.Add(-time.Hour)), nil
					},
					partialFn: func(context.Context, int64, map[string]interface{}) error { return errBoom },
				}
			},
			wantStatus:  http.StatusInternalServerError,
			wantErr:     "failed to close drive",
			wantPartial: 1,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(&fakeChargingRepo{}, fake)
			rec := doReq(t, h, http.MethodPost, tc.path, nil)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.partialCalls != tc.wantPartial {
				t.Errorf("PartialUpdate calls = %d, want %d", fake.partialCalls, tc.wantPartial)
			}
		})
	}
}

// ---- DeleteCharging ------------------------------------------------------

func TestDeleteCharging_HappyPath(t *testing.T) {
	t.Parallel()

	fake := &fakeChargingRepo{
		getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
			return sampleCharging(id), nil
		},
	}
	h := newTestHandler(fake, &fakeDriveRepo{})

	rec := doReq(t, h, http.MethodDelete, "/data-repair/charging/55", nil)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204. body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 response must have empty body, got %q", rec.Body.String())
	}
	if fake.deleteCalls != 1 {
		t.Fatalf("Delete calls = %d, want 1", fake.deleteCalls)
	}
	if fake.deleteID != 55 {
		t.Errorf("Delete id = %d, want 55", fake.deleteID)
	}
}

func TestDeleteCharging_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		path       string
		fake       func() *fakeChargingRepo
		wantStatus int
		wantErr    string
		wantDelete int
	}{
		{
			name:       "non-numeric id",
			path:       "/data-repair/charging/abc",
			fake:       func() *fakeChargingRepo { return &fakeChargingRepo{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid charging session ID",
			wantDelete: 0,
		},
		{
			name: "get session fails",
			path: "/data-repair/charging/5",
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{getByIDFn: func(context.Context, int64) (*chargingmodel.ChargingSession, error) {
					return nil, errBoom
				}}
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to get charging session",
			wantDelete: 0,
		},
		{
			name:       "not found",
			path:       "/data-repair/charging/9",
			fake:       func() *fakeChargingRepo { return &fakeChargingRepo{} },
			wantStatus: http.StatusNotFound,
			wantErr:    "charging session not found",
			wantDelete: 0,
		},
		{
			name: "delete fails",
			path: "/data-repair/charging/9",
			fake: func() *fakeChargingRepo {
				return &fakeChargingRepo{
					getByIDFn: func(_ context.Context, id int64) (*chargingmodel.ChargingSession, error) {
						return sampleCharging(id), nil
					},
					deleteFn: func(context.Context, int64) error { return errBoom },
				}
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to delete charging session",
			wantDelete: 1,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(fake, &fakeDriveRepo{})
			rec := doReq(t, h, http.MethodDelete, tc.path, nil)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.deleteCalls != tc.wantDelete {
				t.Errorf("Delete calls = %d, want %d", fake.deleteCalls, tc.wantDelete)
			}
		})
	}
}

// ---- DeleteDrive ---------------------------------------------------------

func TestDeleteDrive_HappyPath(t *testing.T) {
	t.Parallel()

	fake := &fakeDriveRepo{
		getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
			return sampleDrive(id, testNow), nil
		},
	}
	h := newTestHandler(&fakeChargingRepo{}, fake)

	rec := doReq(t, h, http.MethodDelete, "/data-repair/drive/71", nil)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204. body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("204 response must have empty body, got %q", rec.Body.String())
	}
	if fake.deleteCalls != 1 || fake.deleteID != 71 {
		t.Errorf("Delete calls=%d id=%d, want 1/71", fake.deleteCalls, fake.deleteID)
	}
}

func TestDeleteDrive_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		path       string
		fake       func() *fakeDriveRepo
		wantStatus int
		wantErr    string
		wantDelete int
	}{
		{
			name:       "non-numeric id",
			path:       "/data-repair/drive/abc",
			fake:       func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid drive ID",
			wantDelete: 0,
		},
		{
			name: "get drive fails",
			path: "/data-repair/drive/5",
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{getByIDFn: func(context.Context, int64) (*drivemodel.Drive, error) {
					return nil, errBoom
				}}
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to get drive",
			wantDelete: 0,
		},
		{
			name:       "not found",
			path:       "/data-repair/drive/9",
			fake:       func() *fakeDriveRepo { return &fakeDriveRepo{} },
			wantStatus: http.StatusNotFound,
			wantErr:    "drive not found",
			wantDelete: 0,
		},
		{
			name: "delete fails",
			path: "/data-repair/drive/9",
			fake: func() *fakeDriveRepo {
				return &fakeDriveRepo{
					getByIDFn: func(_ context.Context, id int64) (*drivemodel.Drive, error) {
						return sampleDrive(id, testNow), nil
					},
					deleteFn: func(context.Context, int64) error { return errBoom },
				}
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to delete drive",
			wantDelete: 1,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fake := tc.fake()
			h := newTestHandler(&fakeChargingRepo{}, fake)
			rec := doReq(t, h, http.MethodDelete, tc.path, nil)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if got := bodyError(t, rec); got != tc.wantErr {
				t.Errorf("error = %q, want %q", got, tc.wantErr)
			}
			if fake.deleteCalls != tc.wantDelete {
				t.Errorf("Delete calls = %d, want %d", fake.deleteCalls, tc.wantDelete)
			}
		})
	}
}
