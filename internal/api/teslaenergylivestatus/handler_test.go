package teslaenergylivestatus

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

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ── Test doubles ────────────────────────────────────────────────────────────

// fakeLiveStatusRepo is the in-memory liveStatusRepo used to drive the handler
// without a real pgx pool. Each method records its arguments and delegates to
// an optional func field so a table case can inject success / error / nil
// outcomes independently.
type fakeLiveStatusRepo struct {
	getLatestFn  func(ctx context.Context, id int64) (*teslamodel.TeslaEnergyLiveStatus, error)
	getHistoryFn func(ctx context.Context, id int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyLiveStatus, error)
	createFn     func(ctx context.Context, s *teslamodel.TeslaEnergyLiveStatus) error

	getLatestCalls  int
	getHistoryCalls int
	createCalls     int

	lastLatestID     int64
	lastHistoryID    int64
	lastHistorySince time.Time
	lastHistoryUntil time.Time
	lastHistoryLimit int
	lastCreated      *teslamodel.TeslaEnergyLiveStatus
}

func (f *fakeLiveStatusRepo) GetLatest(ctx context.Context, id int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
	f.getLatestCalls++
	f.lastLatestID = id
	if f.getLatestFn == nil {
		return nil, nil
	}
	return f.getLatestFn(ctx, id)
}

func (f *fakeLiveStatusRepo) GetHistory(ctx context.Context, id int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyLiveStatus, error) {
	f.getHistoryCalls++
	f.lastHistoryID = id
	f.lastHistorySince = since
	f.lastHistoryUntil = until
	f.lastHistoryLimit = limit
	if f.getHistoryFn == nil {
		return nil, nil
	}
	return f.getHistoryFn(ctx, id, since, until, limit)
}

func (f *fakeLiveStatusRepo) Create(ctx context.Context, s *teslamodel.TeslaEnergyLiveStatus) error {
	f.createCalls++
	f.lastCreated = s
	if f.createFn == nil {
		return nil
	}
	return f.createFn(ctx, s)
}

var _ liveStatusRepo = (*fakeLiveStatusRepo)(nil)

// fakeLiveStatusFetcher is the in-memory liveStatusFetcher standing in for
// (*tesla.Client).GetEnergySiteLiveStatus. It records the site id and whether
// the handler propagated a bounded context (deadline) into the outbound call.
type fakeLiveStatusFetcher struct {
	fn          func(ctx context.Context, id int64) ([]byte, int, error)
	calls       int
	lastID      int64
	sawDeadline bool
}

func (f *fakeLiveStatusFetcher) GetEnergySiteLiveStatus(ctx context.Context, id int64) ([]byte, int, error) {
	f.calls++
	f.lastID = id
	if _, ok := ctx.Deadline(); ok {
		f.sawDeadline = true
	}
	if f.fn == nil {
		return []byte(`{"response":{}}`), http.StatusOK, nil
	}
	return f.fn(ctx, id)
}

var _ liveStatusFetcher = (*fakeLiveStatusFetcher)(nil)

// ── Helpers ─────────────────────────────────────────────────────────────────

func f64p(v float64) *float64 { return &v }
func strp(v string) *string   { return &v }

// newRequest builds an *http.Request with the chi route context wired so
// apiparams.URLParamInt64(r, "siteID") resolves to siteID. target carries any
// query string under test.
func newRequest(t *testing.T, method, target, siteID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("siteID", siteID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

func decodeObj(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode object: %v; body=%s", err, rec.Body.String())
	}
	return m
}

func decodeArr(t *testing.T, rec *httptest.ResponseRecorder) []any {
	t.Helper()
	var a []any
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatalf("decode array: %v; body=%s", err, rec.Body.String())
	}
	return a
}

func wantContentTypeJSON(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
}

// ── NewHandler ──────────────────────────────────────────────────────────────

// TestNewHandler covers the exported constructor's wiring. The concrete repo
// constructor only stores the *database.DB pointer, so a nil pool is safe here
// (no query is issued) and lets us verify field wiring without a live Postgres.
func TestNewHandler(t *testing.T) {
	h := NewHandler(&tesla.Client{}, &database.DB{})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("repo port not wired")
	}
	if h.teslaClient == nil {
		t.Fatal("teslaClient port not wired")
	}
}

// ── LiveStatus ──────────────────────────────────────────────────────────────

func TestLiveStatus(t *testing.T) {
	snapshot := &teslamodel.TeslaEnergyLiveStatus{
		ID:           11,
		EnergySiteID: 7,
		SolarPower:   f64p(1234.5),
		GridStatus:   strp("Active"),
	}

	tests := []struct {
		name           string
		siteID         string
		getLatestFn    func(ctx context.Context, id int64) (*teslamodel.TeslaEnergyLiveStatus, error)
		wantStatus     int
		wantErrMsg     string
		wantLatestCall int
		check          func(t *testing.T, m map[string]any)
	}{
		{
			name:           "invalid site id short-circuits with 400",
			siteID:         "not-a-number",
			wantStatus:     http.StatusBadRequest,
			wantErrMsg:     "invalid site_id",
			wantLatestCall: 0,
		},
		{
			name:   "repo error becomes 500",
			siteID: "7",
			getLatestFn: func(context.Context, int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
				return nil, errors.New("pgx connection lost")
			},
			wantStatus:     http.StatusInternalServerError,
			wantErrMsg:     "failed to query live status",
			wantLatestCall: 1,
		},
		{
			name:   "no rows yet returns 200 with guidance message",
			siteID: "7",
			getLatestFn: func(context.Context, int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
				return nil, nil
			},
			wantStatus:     http.StatusOK,
			wantLatestCall: 1,
			check: func(t *testing.T, m map[string]any) {
				msg, ok := m["message"].(string)
				if !ok || msg == "" {
					t.Fatalf("want non-empty message, got %#v", m)
				}
			},
		},
		{
			name:   "success returns the snapshot with snake_case keys",
			siteID: "7",
			getLatestFn: func(_ context.Context, id int64) (*teslamodel.TeslaEnergyLiveStatus, error) {
				if id != 7 {
					t.Fatalf("GetLatest id = %d, want 7", id)
				}
				return snapshot, nil
			},
			wantStatus:     http.StatusOK,
			wantLatestCall: 1,
			check: func(t *testing.T, m map[string]any) {
				if m["energy_site_id"] != float64(7) {
					t.Fatalf("energy_site_id = %#v, want 7", m["energy_site_id"])
				}
				if m["solar_power"] != float64(1234.5) {
					t.Fatalf("solar_power = %#v, want 1234.5", m["solar_power"])
				}
				if m["grid_status"] != "Active" {
					t.Fatalf("grid_status = %#v, want Active", m["grid_status"])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeLiveStatusRepo{getLatestFn: tt.getLatestFn}
			h := &Handler{repo: repo, teslaClient: &fakeLiveStatusFetcher{}}

			rec := httptest.NewRecorder()
			h.LiveStatus(rec, newRequest(t, http.MethodGet, "/", tt.siteID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			wantContentTypeJSON(t, rec)
			if repo.getLatestCalls != tt.wantLatestCall {
				t.Fatalf("GetLatest calls = %d, want %d", repo.getLatestCalls, tt.wantLatestCall)
			}

			m := decodeObj(t, rec)
			if tt.wantErrMsg != "" && m["error"] != tt.wantErrMsg {
				t.Fatalf("error = %#v, want %q", m["error"], tt.wantErrMsg)
			}
			if tt.check != nil {
				tt.check(t, m)
			}
		})
	}
}

// ── LiveStatusHistory ───────────────────────────────────────────────────────

func TestLiveStatusHistory(t *testing.T) {
	entries := []*teslamodel.TeslaEnergyLiveStatus{
		{ID: 1, EnergySiteID: 5, SolarPower: f64p(100)},
		{ID: 2, EnergySiteID: 5, SolarPower: f64p(200)},
	}

	tests := []struct {
		name            string
		siteID          string
		getHistoryFn    func(ctx context.Context, id int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyLiveStatus, error)
		wantStatus      int
		wantErrMsg      string
		wantHistoryCall int
		wantLen         int
		wantArray       bool
	}{
		{
			name:            "invalid site id short-circuits with 400",
			siteID:          "abc",
			wantStatus:      http.StatusBadRequest,
			wantErrMsg:      "invalid site_id",
			wantHistoryCall: 0,
		},
		{
			name:   "repo error becomes 500",
			siteID: "5",
			getHistoryFn: func(context.Context, int64, time.Time, time.Time, int) ([]*teslamodel.TeslaEnergyLiveStatus, error) {
				return nil, errors.New("query failed")
			},
			wantStatus:      http.StatusInternalServerError,
			wantErrMsg:      "failed to query live status history",
			wantHistoryCall: 1,
		},
		{
			name:   "nil result serialises as an empty array not null",
			siteID: "5",
			getHistoryFn: func(context.Context, int64, time.Time, time.Time, int) ([]*teslamodel.TeslaEnergyLiveStatus, error) {
				return nil, nil
			},
			wantStatus:      http.StatusOK,
			wantHistoryCall: 1,
			wantLen:         0,
			wantArray:       true,
		},
		{
			name:   "success returns the entries in order",
			siteID: "5",
			getHistoryFn: func(context.Context, int64, time.Time, time.Time, int) ([]*teslamodel.TeslaEnergyLiveStatus, error) {
				return entries, nil
			},
			wantStatus:      http.StatusOK,
			wantHistoryCall: 1,
			wantLen:         2,
			wantArray:       true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeLiveStatusRepo{getHistoryFn: tt.getHistoryFn}
			h := &Handler{repo: repo, teslaClient: &fakeLiveStatusFetcher{}}

			rec := httptest.NewRecorder()
			h.LiveStatusHistory(rec, newRequest(t, http.MethodGet, "/", tt.siteID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			wantContentTypeJSON(t, rec)
			if repo.getHistoryCalls != tt.wantHistoryCall {
				t.Fatalf("GetHistory calls = %d, want %d", repo.getHistoryCalls, tt.wantHistoryCall)
			}

			if tt.wantArray {
				got := decodeArr(t, rec)
				if len(got) != tt.wantLen {
					t.Fatalf("array len = %d, want %d; body=%s", len(got), tt.wantLen, rec.Body.String())
				}
				if strings.TrimSpace(rec.Body.String()) == "null" {
					t.Fatalf("body serialised as null, want []")
				}
			} else if tt.wantErrMsg != "" {
				if m := decodeObj(t, rec); m["error"] != tt.wantErrMsg {
					t.Fatalf("error = %#v, want %q", m["error"], tt.wantErrMsg)
				}
			}
		})
	}
}

// TestLiveStatusHistory_LimitPropagation locks the single-source-of-truth limit
// behaviour after removing the confusing double-parse (energyLimit + a second
// fmt.Sscanf(&limit) block that misused the scan-count return). The value the
// handler forwards to repo.GetHistory must be exactly energyLimit's clamp:
// default 500, valid 1..2000 passthrough, everything else 500.
func TestLiveStatusHistory_LimitPropagation(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  int
	}{
		{"absent uses default", "/", 500},
		{"blank uses default", "/?limit=", 500},
		{"valid mid-range passes through", "/?limit=750", 750},
		{"low boundary 1", "/?limit=1", 1},
		{"max boundary 2000", "/?limit=2000", 2000},
		{"just over cap falls to default", "/?limit=2001", 500},
		{"far over cap falls to default", "/?limit=99999", 500},
		{"zero falls to default", "/?limit=0", 500},
		{"negative falls to default", "/?limit=-5", 500},
		{"non-numeric falls to default", "/?limit=abc", 500},
		{"float falls to default", "/?limit=12.5", 500},
		{"overflow falls to default", "/?limit=99999999999999999999", 500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeLiveStatusRepo{}
			h := &Handler{repo: repo, teslaClient: &fakeLiveStatusFetcher{}}

			rec := httptest.NewRecorder()
			h.LiveStatusHistory(rec, newRequest(t, http.MethodGet, tt.query, "5"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if repo.lastHistoryLimit != tt.want {
				t.Fatalf("limit forwarded to repo = %d, want %d", repo.lastHistoryLimit, tt.want)
			}
		})
	}
}

// TestLiveStatusHistory_DateRangePropagation verifies the parsed site id and
// [since, until] window (with until snapped to end-of-day) reach the repo.
func TestLiveStatusHistory_DateRangePropagation(t *testing.T) {
	repo := &fakeLiveStatusRepo{}
	h := &Handler{repo: repo, teslaClient: &fakeLiveStatusFetcher{}}

	rec := httptest.NewRecorder()
	h.LiveStatusHistory(rec, newRequest(t, http.MethodGet, "/?since=2026-01-01&until=2026-01-31&limit=42", "9"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.lastHistoryID != 9 {
		t.Fatalf("site id = %d, want 9", repo.lastHistoryID)
	}
	wantSince := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if !repo.lastHistorySince.Equal(wantSince) {
		t.Fatalf("since = %v, want %v", repo.lastHistorySince, wantSince)
	}
	wantUntil := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC).Add(24*time.Hour - time.Second)
	if !repo.lastHistoryUntil.Equal(wantUntil) {
		t.Fatalf("until = %v, want %v", repo.lastHistoryUntil, wantUntil)
	}
	if repo.lastHistoryLimit != 42 {
		t.Fatalf("limit = %d, want 42", repo.lastHistoryLimit)
	}
}

// ── RefreshLiveStatus ───────────────────────────────────────────────────────

func TestRefreshLiveStatus(t *testing.T) {
	const validBody = `{"response":{"solar_power":1500.25,"grid_status":"Active","timestamp":"2026-07-01T12:00:00Z"}}`

	tests := []struct {
		name       string
		siteID     string
		fetchFn    func(ctx context.Context, id int64) ([]byte, int, error)
		createFn   func(ctx context.Context, s *teslamodel.TeslaEnergyLiveStatus) error
		wantStatus int
		wantErrMsg string
		wantFetch  int
		wantCreate int
		check      func(t *testing.T, m map[string]any, repo *fakeLiveStatusRepo, fetcher *fakeLiveStatusFetcher)
	}{
		{
			name:       "invalid site id short-circuits before calling Tesla",
			siteID:     "xyz",
			wantStatus: http.StatusBadRequest,
			wantErrMsg: "invalid site_id",
			wantFetch:  0,
			wantCreate: 0,
		},
		{
			name:   "tesla transport error becomes 502",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return nil, 0, errors.New("dial tcp: timeout")
			},
			wantStatus: http.StatusBadGateway,
			wantErrMsg: "failed to fetch live status from Tesla",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "tesla 401 becomes 502 with status echoed",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte(`{"error":"token expired"}`), http.StatusUnauthorized, nil
			},
			wantStatus: http.StatusBadGateway,
			wantErrMsg: "Tesla API returned status 401",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "tesla 500 becomes 502",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return nil, http.StatusInternalServerError, nil
			},
			wantStatus: http.StatusBadGateway,
			wantErrMsg: "Tesla API returned status 500",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "3xx is treated as non-2xx and becomes 502",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte(validBody), http.StatusMultipleChoices, nil
			},
			wantStatus: http.StatusBadGateway,
			wantErrMsg: "Tesla API returned status 300",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "malformed envelope becomes 500 and is not persisted",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte("not json at all"), http.StatusOK, nil
			},
			wantStatus: http.StatusInternalServerError,
			wantErrMsg: "failed to parse Tesla response",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "missing response field becomes 500",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte(`{}`), http.StatusOK, nil
			},
			wantStatus: http.StatusInternalServerError,
			wantErrMsg: "failed to parse Tesla response",
			wantFetch:  1,
			wantCreate: 0,
		},
		{
			name:   "persistence failure becomes 500",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte(validBody), http.StatusOK, nil
			},
			createFn: func(context.Context, *teslamodel.TeslaEnergyLiveStatus) error {
				return errors.New("insert failed")
			},
			wantStatus: http.StatusInternalServerError,
			wantErrMsg: "failed to save live status",
			wantFetch:  1,
			wantCreate: 1,
		},
		{
			name:   "success fetches, parses, persists and echoes the entry",
			siteID: "7",
			fetchFn: func(_ context.Context, id int64) ([]byte, int, error) {
				if id != 7 {
					t.Fatalf("fetch id = %d, want 7", id)
				}
				return []byte(validBody), http.StatusOK, nil
			},
			createFn: func(_ context.Context, s *teslamodel.TeslaEnergyLiveStatus) error {
				s.ID = 99
				return nil
			},
			wantStatus: http.StatusOK,
			wantFetch:  1,
			wantCreate: 1,
			check: func(t *testing.T, m map[string]any, repo *fakeLiveStatusRepo, fetcher *fakeLiveStatusFetcher) {
				if m["energy_site_id"] != float64(7) {
					t.Fatalf("energy_site_id = %#v, want 7", m["energy_site_id"])
				}
				if m["solar_power"] != float64(1500.25) {
					t.Fatalf("solar_power = %#v, want 1500.25", m["solar_power"])
				}
				if m["grid_status"] != "Active" {
					t.Fatalf("grid_status = %#v, want Active", m["grid_status"])
				}
				if m["timestamp"] != "2026-07-01T12:00:00Z" {
					t.Fatalf("timestamp = %#v, want 2026-07-01T12:00:00Z", m["timestamp"])
				}
				if m["id"] != float64(99) {
					t.Fatalf("id = %#v, want 99 (set by Create)", m["id"])
				}
				if repo.lastCreated == nil || repo.lastCreated.EnergySiteID != 7 {
					t.Fatalf("persisted entry EnergySiteID = %#v, want 7", repo.lastCreated)
				}
				if !fetcher.sawDeadline {
					t.Fatalf("outbound Tesla call had no context deadline; timeout guard missing")
				}
				if fetcher.lastID != 7 {
					t.Fatalf("fetch lastID = %d, want 7", fetcher.lastID)
				}
			},
		},
		{
			name:   "2xx boundary 299 is treated as success",
			siteID: "7",
			fetchFn: func(context.Context, int64) ([]byte, int, error) {
				return []byte(validBody), 299, nil
			},
			wantStatus: http.StatusOK,
			wantFetch:  1,
			wantCreate: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeLiveStatusRepo{createFn: tt.createFn}
			fetcher := &fakeLiveStatusFetcher{fn: tt.fetchFn}
			h := &Handler{repo: repo, teslaClient: fetcher}

			rec := httptest.NewRecorder()
			h.RefreshLiveStatus(rec, newRequest(t, http.MethodPost, "/", tt.siteID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			wantContentTypeJSON(t, rec)
			if fetcher.calls != tt.wantFetch {
				t.Fatalf("fetch calls = %d, want %d", fetcher.calls, tt.wantFetch)
			}
			if repo.createCalls != tt.wantCreate {
				t.Fatalf("Create calls = %d, want %d", repo.createCalls, tt.wantCreate)
			}

			m := decodeObj(t, rec)
			if tt.wantErrMsg != "" && m["error"] != tt.wantErrMsg {
				t.Fatalf("error = %#v, want %q", m["error"], tt.wantErrMsg)
			}
			if tt.check != nil {
				tt.check(t, m, repo, fetcher)
			}
		})
	}
}

// ── parseLiveStatusResponse ─────────────────────────────────────────────────

func TestParseLiveStatusResponse_FullMapping(t *testing.T) {
	body := []byte(`{"response":{
		"solar_power":1000.5,
		"battery_power":-250.5,
		"load_power":800,
		"grid_power":50.25,
		"grid_services_power":0,
		"energy_left":13500,
		"total_pack_energy":14000,
		"percentage_charged":96.4,
		"grid_status":"Active",
		"backup_capable":true,
		"storm_mode_active":false,
		"timestamp":"2026-07-01T12:00:00Z"
	}}`)

	got, err := parseLiveStatusResponse(body, 42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.EnergySiteID != 42 {
		t.Fatalf("EnergySiteID = %d, want 42", got.EnergySiteID)
	}

	floatFields := []struct {
		name string
		got  *float64
		want float64
	}{
		{"SolarPower", got.SolarPower, 1000.5},
		{"BatteryPower", got.BatteryPower, -250.5},
		{"LoadPower", got.LoadPower, 800},
		{"GridPower", got.GridPower, 50.25},
		{"GridServicesPower", got.GridServicesPower, 0},
		{"EnergyLeft", got.EnergyLeft, 13500},
		{"TotalPackEnergy", got.TotalPackEnergy, 14000},
		{"PercentageCharged", got.PercentageCharged, 96.4},
	}
	for _, f := range floatFields {
		if f.got == nil {
			t.Fatalf("%s = nil, want %v", f.name, f.want)
		}
		if *f.got != f.want {
			t.Fatalf("%s = %v, want %v", f.name, *f.got, f.want)
		}
	}
	if got.GridStatus == nil || *got.GridStatus != "Active" {
		t.Fatalf("GridStatus = %v, want Active", got.GridStatus)
	}
	if got.BackupCapable == nil || *got.BackupCapable != true {
		t.Fatalf("BackupCapable = %v, want true", got.BackupCapable)
	}
	if got.StormModeActive == nil || *got.StormModeActive != false {
		t.Fatalf("StormModeActive = %v, want false", got.StormModeActive)
	}
	wantTS := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	if !got.Timestamp.Equal(wantTS) {
		t.Fatalf("Timestamp = %v, want %v", got.Timestamp, wantTS)
	}
}

func TestParseLiveStatusResponse(t *testing.T) {
	fixedTS := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)

	tests := []struct {
		name    string
		body    string
		wantErr bool
		// wantTS non-nil means assert exact; nil + !wantErr means "≈ now".
		wantTS   *time.Time
		checkVal func(t *testing.T, got *teslamodel.TeslaEnergyLiveStatus)
	}{
		{
			name: "partial payload leaves absent fields nil",
			body: `{"response":{"solar_power":500}}`,
			checkVal: func(t *testing.T, got *teslamodel.TeslaEnergyLiveStatus) {
				if got.SolarPower == nil || *got.SolarPower != 500 {
					t.Fatalf("SolarPower = %v, want 500", got.SolarPower)
				}
				if got.BatteryPower != nil {
					t.Fatalf("BatteryPower = %v, want nil", *got.BatteryPower)
				}
				if got.GridStatus != nil {
					t.Fatalf("GridStatus = %v, want nil", *got.GridStatus)
				}
			},
		},
		{
			name: "empty response object yields all-nil metrics",
			body: `{"response":{}}`,
			checkVal: func(t *testing.T, got *teslamodel.TeslaEnergyLiveStatus) {
				if got.SolarPower != nil || got.BackupCapable != nil {
					t.Fatalf("want all-nil metrics, got %+v", got)
				}
			},
		},
		{
			name: "json null response is tolerated",
			body: `{"response":null}`,
			checkVal: func(t *testing.T, got *teslamodel.TeslaEnergyLiveStatus) {
				if got.SolarPower != nil {
					t.Fatalf("SolarPower = %v, want nil", *got.SolarPower)
				}
			},
		},
		{
			name:   "valid RFC3339 timestamp is preserved",
			body:   `{"response":{"timestamp":"2026-03-04T05:06:07Z"}}`,
			wantTS: &fixedTS,
		},
		{
			name: "unparseable timestamp falls back to now",
			body: `{"response":{"timestamp":"yesterday afternoon"}}`,
		},
		{
			name: "empty timestamp falls back to now",
			body: `{"response":{"solar_power":1}}`,
		},
		{
			name:    "missing response field is an error",
			body:    `{}`,
			wantErr: true,
		},
		{
			name:    "invalid envelope json is an error",
			body:    `this is not json`,
			wantErr: true,
		},
		{
			name:    "response of wrong json type is an error",
			body:    `{"response":123}`,
			wantErr: true,
		},
		{
			name:    "field of wrong type is an error",
			body:    `{"response":{"solar_power":"high"}}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := time.Now().UTC()
			got, err := parseLiveStatusResponse([]byte(tt.body), 7)
			after := time.Now().UTC()

			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (result=%+v)", got)
				}
				if got != nil {
					t.Fatalf("expected nil result on error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.EnergySiteID != 7 {
				t.Fatalf("EnergySiteID = %d, want 7", got.EnergySiteID)
			}
			switch {
			case tt.wantTS != nil:
				if !got.Timestamp.Equal(*tt.wantTS) {
					t.Fatalf("Timestamp = %v, want %v", got.Timestamp, *tt.wantTS)
				}
			default:
				if got.Timestamp.Before(before) || got.Timestamp.After(after) {
					t.Fatalf("Timestamp = %v, want within [%v, %v] (≈ now)", got.Timestamp, before, after)
				}
			}
			if tt.checkVal != nil {
				tt.checkVal(t, got)
			}
		})
	}
}

// ── energyDateRange ─────────────────────────────────────────────────────────

func TestEnergyDateRange(t *testing.T) {
	tests := []struct {
		name  string
		query string
		check func(t *testing.T, since, until, before, after time.Time)
	}{
		{
			name:  "defaults span roughly the last month",
			query: "/",
			check: func(t *testing.T, since, until, before, after time.Time) {
				if until.Before(before) || until.After(after) {
					t.Fatalf("until = %v, want ≈ now within [%v,%v]", until, before, after)
				}
				lo, hi := before.AddDate(0, -1, 0), after.AddDate(0, -1, 0)
				if since.Before(lo) || since.After(hi) {
					t.Fatalf("since = %v, want ≈ now-1month within [%v,%v]", since, lo, hi)
				}
			},
		},
		{
			name:  "explicit since is parsed as UTC midnight",
			query: "/?since=2026-01-01",
			check: func(t *testing.T, since, until, before, after time.Time) {
				want := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
				if !since.Equal(want) {
					t.Fatalf("since = %v, want %v", since, want)
				}
				if until.Before(before) || until.After(after) {
					t.Fatalf("until = %v, want ≈ now", until)
				}
			},
		},
		{
			name:  "explicit until is snapped to end of day",
			query: "/?until=2026-01-31",
			check: func(t *testing.T, since, until, before, after time.Time) {
				want := time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC).Add(24*time.Hour - time.Second)
				if !until.Equal(want) {
					t.Fatalf("until = %v, want %v", until, want)
				}
			},
		},
		{
			name:  "both explicit dates are honoured",
			query: "/?since=2025-12-01&until=2025-12-31",
			check: func(t *testing.T, since, until, _, _ time.Time) {
				wantSince := time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC)
				wantUntil := time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC).Add(24*time.Hour - time.Second)
				if !since.Equal(wantSince) {
					t.Fatalf("since = %v, want %v", since, wantSince)
				}
				if !until.Equal(wantUntil) {
					t.Fatalf("until = %v, want %v", until, wantUntil)
				}
			},
		},
		{
			name:  "garbage since is ignored (default applies)",
			query: "/?since=not-a-date",
			check: func(t *testing.T, since, _, before, after time.Time) {
				lo, hi := before.AddDate(0, -1, 0), after.AddDate(0, -1, 0)
				if since.Before(lo) || since.After(hi) {
					t.Fatalf("since = %v, want default ≈ now-1month", since)
				}
			},
		},
		{
			name:  "rfc3339 since is rejected by the date-only parser",
			query: "/?since=2026-01-01T00:00:00Z",
			check: func(t *testing.T, since, _, before, after time.Time) {
				lo, hi := before.AddDate(0, -1, 0), after.AddDate(0, -1, 0)
				if since.Before(lo) || since.After(hi) {
					t.Fatalf("since = %v, want default (RFC3339 not accepted)", since)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.query, nil)
			before := time.Now().UTC()
			since, until := energyDateRange(req)
			after := time.Now().UTC()
			tt.check(t, since, until, before, after)
		})
	}
}

// ── energyLimit ─────────────────────────────────────────────────────────────

func TestEnergyLimit(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  int
	}{
		{"absent", "/", 500},
		{"blank", "/?limit=", 500},
		{"one", "/?limit=1", 1},
		{"typical", "/?limit=500", 500},
		{"mid", "/?limit=750", 750},
		{"below-old-cap", "/?limit=1000", 1000},
		{"new max boundary 2000", "/?limit=2000", 2000},
		{"just over cap", "/?limit=2001", 500},
		{"far over cap", "/?limit=5000", 500},
		{"zero", "/?limit=0", 500},
		{"negative", "/?limit=-1", 500},
		{"non-numeric", "/?limit=abc", 500},
		{"float", "/?limit=3.14", 500},
		{"overflow", "/?limit=99999999999999999999", 500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.query, nil)
			if got := energyLimit(req); got != tt.want {
				t.Fatalf("energyLimit(%q) = %d, want %d", tt.query, got, tt.want)
			}
		})
	}
}

// ── truncateBody ────────────────────────────────────────────────────────────

func TestTruncateBody(t *testing.T) {
	tests := []struct {
		name    string
		in      []byte
		wantLen int
		wantEq  string
	}{
		{"nil", nil, 0, ""},
		{"empty", []byte(""), 0, ""},
		{"short", []byte("hello"), 5, "hello"},
		{"exactly 500 kept whole", []byte(strings.Repeat("a", 500)), 500, ""},
		{"501 truncated to 500", []byte(strings.Repeat("b", 501)), 500, ""},
		{"1000 truncated to 500", []byte(strings.Repeat("c", 1000)), 500, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncateBody(tt.in)
			if len(got) != tt.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tt.wantLen)
			}
			if tt.wantEq != "" && got != tt.wantEq {
				t.Fatalf("got = %q, want %q", got, tt.wantEq)
			}
		})
	}
}
