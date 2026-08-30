package teslaenergyhist

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
)

// ---------------------------------------------------------------------------
// Compile-time proof that the production concrete types satisfy the ports.
// A signature drift on the client or a repo fails the build here rather
// than silently at wiring time in router.go.
// ---------------------------------------------------------------------------

var (
	_ energyHistoryClient = (*tesla.Client)(nil)
	_ energyHistoryStore  = (*energydb.TeslaEnergyHistoryRepo)(nil)
	_ backupEventStore    = (*energydb.TeslaEnergyBackupEventRepo)(nil)
	_ wcChargingStore     = (*energydb.TeslaEnergyWCChargingRepo)(nil)
)

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type calCall struct {
	siteID                             int64
	kind, start, end, period, timeZone string
}

type telCall struct {
	siteID                     int64
	kind, start, end, timeZone string
}

// fakeEnergyClient implements energyHistoryClient with pinned responses
// per Tesla endpoint and full call capture for argument assertions.
type fakeEnergyClient struct {
	calBody   []byte
	calStatus int
	calErr    error

	telBody   []byte
	telStatus int
	telErr    error

	calCalls []calCall
	telCalls []telCall
}

func (f *fakeEnergyClient) GetEnergySiteCalendarHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, period, timeZone string) ([]byte, int, error) {
	f.calCalls = append(f.calCalls, calCall{energySiteID, kind, startDate, endDate, period, timeZone})
	return f.calBody, f.calStatus, f.calErr
}

func (f *fakeEnergyClient) GetEnergySiteTelemetryHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, timeZone string) ([]byte, int, error) {
	f.telCalls = append(f.telCalls, telCall{energySiteID, kind, startDate, endDate, timeZone})
	return f.telBody, f.telStatus, f.telErr
}

type energyGetCall struct {
	siteID       int64
	period       string
	since, until time.Time
	limit        int
}

type fakeEnergyRepo struct {
	rows      []*teslamodel.TeslaEnergyHistory
	getErr    error
	upsertErr error

	getCalls    []energyGetCall
	upsertCalls [][]*teslamodel.TeslaEnergyHistory
}

func (f *fakeEnergyRepo) GetByRange(ctx context.Context, siteID int64, period string, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyHistory, error) {
	f.getCalls = append(f.getCalls, energyGetCall{siteID, period, since, until, limit})
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.rows, nil
}

func (f *fakeEnergyRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyHistory) (int, error) {
	f.upsertCalls = append(f.upsertCalls, entries)
	if f.upsertErr != nil {
		return 0, f.upsertErr
	}
	return len(entries), nil
}

type dateGetCall struct {
	siteID       int64
	since, until time.Time
	limit        int
}

type fakeBackupRepo struct {
	rows      []*teslamodel.TeslaEnergyBackupEvent
	getErr    error
	upsertErr error

	getCalls    []dateGetCall
	upsertCalls [][]*teslamodel.TeslaEnergyBackupEvent
}

func (f *fakeBackupRepo) GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyBackupEvent, error) {
	f.getCalls = append(f.getCalls, dateGetCall{siteID, since, until, limit})
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.rows, nil
}

func (f *fakeBackupRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyBackupEvent) (int, error) {
	f.upsertCalls = append(f.upsertCalls, entries)
	if f.upsertErr != nil {
		return 0, f.upsertErr
	}
	return len(entries), nil
}

type fakeWCRepo struct {
	rows      []*teslamodel.TeslaEnergyWCCharging
	getErr    error
	upsertErr error

	getCalls    []dateGetCall
	upsertCalls [][]*teslamodel.TeslaEnergyWCCharging
}

func (f *fakeWCRepo) GetByRange(ctx context.Context, siteID int64, since, until time.Time, limit int) ([]*teslamodel.TeslaEnergyWCCharging, error) {
	f.getCalls = append(f.getCalls, dateGetCall{siteID, since, until, limit})
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.rows, nil
}

func (f *fakeWCRepo) UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaEnergyWCCharging) (int, error) {
	f.upsertCalls = append(f.upsertCalls, entries)
	if f.upsertErr != nil {
		return 0, f.upsertErr
	}
	return len(entries), nil
}

// ---------------------------------------------------------------------------
// Test wiring helpers
// ---------------------------------------------------------------------------

func newTestHandler(c energyHistoryClient, e energyHistoryStore, b backupEventStore, wc wcChargingStore) *TeslaEnergyHistoryHandler {
	return &TeslaEnergyHistoryHandler{teslaClient: c, energyRepo: e, backupRepo: b, wcRepo: wc}
}

// req builds a request carrying the {siteID} chi param plus an optional
// query string. The path is irrelevant — handlers read only the param and
// the query.
func req(method, siteID, query string) *http.Request {
	target := "/tesla/energy-sites/" + siteID + "/history"
	if query != "" {
		target += "?" + query
	}
	r := httptest.NewRequest(method, target, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("siteID", siteID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func decodeArray(t *testing.T, b []byte) []map[string]any {
	t.Helper()
	var out []map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("body is not a JSON array: %v\nbody=%s", err, b)
	}
	return out
}

type refreshEnvelope struct {
	Entries  []map[string]any `json:"entries"`
	Upserted int              `json:"upserted"`
}

func sampleEnergyRow() *teslamodel.TeslaEnergyHistory {
	v := 1234.5
	return &teslamodel.TeslaEnergyHistory{
		ID: 1, EnergySiteID: 42, Period: "day",
		Timestamp:     time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		SolarEnergyWh: &v, FetchedAt: time.Now().UTC(),
	}
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewTeslaEnergyHistoryHandler_WiresAllDependencies(t *testing.T) {
	t.Parallel()
	c := tesla.NewClient(config.TeslaConfig{})
	h := NewTeslaEnergyHistoryHandler(c, &database.DB{})
	if h == nil {
		t.Fatal("constructor returned nil")
	}
	if h.teslaClient == nil {
		t.Error("teslaClient not wired")
	}
	if h.energyRepo == nil || h.backupRepo == nil || h.wcRepo == nil {
		t.Error("a repo dependency was left nil")
	}
}

// ---------------------------------------------------------------------------
// EnergyHistory (read)
// ---------------------------------------------------------------------------

func TestEnergyHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		siteID      string
		query       string
		repo        *fakeEnergyRepo
		wantStatus  int
		wantRepoHit bool
	}{
		{
			name: "invalid_site_id", siteID: "abc", repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantRepoHit: false,
		},
		{
			name: "zero_site_id_rejected", siteID: "0", repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantRepoHit: false,
		},
		{
			name: "negative_site_id_rejected", siteID: "-3", repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantRepoHit: false,
		},
		{
			name: "invalid_period", siteID: "42", query: "period=hour", repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantRepoHit: false,
		},
		{
			name: "default_period_ok", siteID: "42", repo: &fakeEnergyRepo{rows: []*teslamodel.TeslaEnergyHistory{sampleEnergyRow()}},
			wantStatus: http.StatusOK, wantRepoHit: true,
		},
		{
			name: "explicit_period_ok", siteID: "42", query: "period=week", repo: &fakeEnergyRepo{},
			wantStatus: http.StatusOK, wantRepoHit: true,
		},
		{
			name: "repo_error", siteID: "42", repo: &fakeEnergyRepo{getErr: errors.New("db down")},
			wantStatus: http.StatusInternalServerError, wantRepoHit: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(&fakeEnergyClient{}, tt.repo, &fakeBackupRepo{}, &fakeWCRepo{})
			rec := httptest.NewRecorder()
			h.EnergyHistory(rec, req(http.MethodGet, tt.siteID, tt.query))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.repo.getCalls) > 0; got != tt.wantRepoHit {
				t.Errorf("repo hit = %v, want %v", got, tt.wantRepoHit)
			}
		})
	}
}

// Empty result must serialise as [] (never null) so the SPA's safeArray
// consumers don't choke.
func TestEnergyHistory_EmptyReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	h := newTestHandler(&fakeEnergyClient{}, &fakeEnergyRepo{rows: nil}, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.EnergyHistory(rec, req(http.MethodGet, "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %q, want []", rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q", ct)
	}
}

func TestEnergyHistory_SuccessShapeAndArgs(t *testing.T) {
	t.Parallel()
	repo := &fakeEnergyRepo{rows: []*teslamodel.TeslaEnergyHistory{sampleEnergyRow(), sampleEnergyRow()}}
	h := newTestHandler(&fakeEnergyClient{}, repo, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.EnergyHistory(rec, req(http.MethodGet, "42", "period=month&limit=10&since=2026-01-01&until=2026-01-31"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	arr := decodeArray(t, rec.Body.Bytes())
	if len(arr) != 2 {
		t.Fatalf("len(entries) = %d, want 2", len(arr))
	}
	for _, k := range []string{"energy_site_id", "period", "timestamp", "solar_energy_wh"} {
		if _, ok := arr[0][k]; !ok {
			t.Errorf("missing snake_case key %q in %v", k, arr[0])
		}
	}

	if len(repo.getCalls) != 1 {
		t.Fatalf("repo GetByRange calls = %d, want 1", len(repo.getCalls))
	}
	call := repo.getCalls[0]
	if call.siteID != 42 {
		t.Errorf("siteID = %d, want 42", call.siteID)
	}
	if call.period != "month" {
		t.Errorf("period = %q, want month", call.period)
	}
	if call.limit != 10 {
		t.Errorf("limit = %d, want 10", call.limit)
	}
	if !call.since.Equal(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("since = %v, want 2026-01-01", call.since)
	}
	if !call.until.Equal(time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)) {
		t.Errorf("until = %v, want 2026-01-31T23:59:59", call.until)
	}
}

// EnergyHistory with no period must default to "day".
func TestEnergyHistory_DefaultsPeriodToDay(t *testing.T) {
	t.Parallel()
	repo := &fakeEnergyRepo{}
	h := newTestHandler(&fakeEnergyClient{}, repo, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.EnergyHistory(rec, req(http.MethodGet, "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(repo.getCalls) != 1 || repo.getCalls[0].period != "day" {
		t.Fatalf("expected default period=day, got calls=%+v", repo.getCalls)
	}
}

// ---------------------------------------------------------------------------
// BackupHistory (read)
// ---------------------------------------------------------------------------

func TestBackupHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		siteID      string
		repo        *fakeBackupRepo
		wantStatus  int
		wantRepoHit bool
	}{
		{"invalid_site_id", "nope", &fakeBackupRepo{}, http.StatusBadRequest, false},
		{"zero_site_id", "0", &fakeBackupRepo{}, http.StatusBadRequest, false},
		{"success", "42", &fakeBackupRepo{rows: []*teslamodel.TeslaEnergyBackupEvent{{ID: 1, EnergySiteID: 42, DurationSeconds: 60}}}, http.StatusOK, true},
		{"repo_error", "42", &fakeBackupRepo{getErr: errors.New("boom")}, http.StatusInternalServerError, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(&fakeEnergyClient{}, &fakeEnergyRepo{}, tt.repo, &fakeWCRepo{})
			rec := httptest.NewRecorder()
			h.BackupHistory(rec, req(http.MethodGet, tt.siteID, ""))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.repo.getCalls) > 0; got != tt.wantRepoHit {
				t.Errorf("repo hit = %v, want %v", got, tt.wantRepoHit)
			}
		})
	}
}

func TestBackupHistory_EmptyReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	h := newTestHandler(&fakeEnergyClient{}, &fakeEnergyRepo{}, &fakeBackupRepo{rows: nil}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.BackupHistory(rec, req(http.MethodGet, "42", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %q, want []", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// ChargingHistory (read)
// ---------------------------------------------------------------------------

func TestChargingHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		siteID      string
		repo        *fakeWCRepo
		wantStatus  int
		wantRepoHit bool
	}{
		{"invalid_site_id", "x", &fakeWCRepo{}, http.StatusBadRequest, false},
		{"negative_site_id", "-1", &fakeWCRepo{}, http.StatusBadRequest, false},
		{"success", "42", &fakeWCRepo{rows: []*teslamodel.TeslaEnergyWCCharging{{ID: 1, EnergySiteID: 42}}}, http.StatusOK, true},
		{"repo_error", "42", &fakeWCRepo{getErr: errors.New("boom")}, http.StatusInternalServerError, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(&fakeEnergyClient{}, &fakeEnergyRepo{}, &fakeBackupRepo{}, tt.repo)
			rec := httptest.NewRecorder()
			h.ChargingHistory(rec, req(http.MethodGet, tt.siteID, ""))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.repo.getCalls) > 0; got != tt.wantRepoHit {
				t.Errorf("repo hit = %v, want %v", got, tt.wantRepoHit)
			}
		})
	}
}

func TestChargingHistory_EmptyReturnsEmptyArray(t *testing.T) {
	t.Parallel()
	h := newTestHandler(&fakeEnergyClient{}, &fakeEnergyRepo{}, &fakeBackupRepo{}, &fakeWCRepo{rows: nil})
	rec := httptest.NewRecorder()
	h.ChargingHistory(rec, req(http.MethodGet, "42", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("body = %q, want []", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// RefreshEnergyHistory
// ---------------------------------------------------------------------------

const validEnergyBody = `{"response":{"time_series":[{"timestamp":"2026-01-01T00:00:00Z","solar_energy_exported":100}]}}`

func TestRefreshEnergyHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		siteID        string
		query         string
		client        *fakeEnergyClient
		repo          *fakeEnergyRepo
		wantStatus    int
		wantClientHit bool
	}{
		{
			name: "invalid_site_id", siteID: "abc",
			client: &fakeEnergyClient{}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantClientHit: false,
		},
		{
			name: "invalid_period", siteID: "42", query: "period=decade",
			client: &fakeEnergyClient{}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadRequest, wantClientHit: false,
		},
		{
			name: "client_error", siteID: "42",
			client: &fakeEnergyClient{calErr: errors.New("network")}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadGateway, wantClientHit: true,
		},
		{
			name: "tesla_non_2xx", siteID: "42",
			client: &fakeEnergyClient{calStatus: 500, calBody: []byte("oops")}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadGateway, wantClientHit: true,
		},
		{
			name: "tesla_404", siteID: "42",
			client: &fakeEnergyClient{calStatus: 404, calBody: []byte("nope")}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusBadGateway, wantClientHit: true,
		},
		{
			name: "parse_error", siteID: "42",
			client: &fakeEnergyClient{calStatus: 200, calBody: []byte("{not json")}, repo: &fakeEnergyRepo{},
			wantStatus: http.StatusInternalServerError, wantClientHit: true,
		},
		{
			name: "upsert_error", siteID: "42",
			client:     &fakeEnergyClient{calStatus: 200, calBody: []byte(validEnergyBody)},
			repo:       &fakeEnergyRepo{upsertErr: errors.New("write failed")},
			wantStatus: http.StatusInternalServerError, wantClientHit: true,
		},
		{
			name: "readback_error", siteID: "42",
			client:     &fakeEnergyClient{calStatus: 200, calBody: []byte(validEnergyBody)},
			repo:       &fakeEnergyRepo{getErr: errors.New("read failed")},
			wantStatus: http.StatusInternalServerError, wantClientHit: true,
		},
		{
			name: "success", siteID: "42",
			client:     &fakeEnergyClient{calStatus: 200, calBody: []byte(validEnergyBody)},
			repo:       &fakeEnergyRepo{rows: []*teslamodel.TeslaEnergyHistory{sampleEnergyRow()}},
			wantStatus: http.StatusOK, wantClientHit: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(tt.client, tt.repo, &fakeBackupRepo{}, &fakeWCRepo{})
			rec := httptest.NewRecorder()
			h.RefreshEnergyHistory(rec, req(http.MethodPost, tt.siteID, tt.query))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.client.calCalls) > 0; got != tt.wantClientHit {
				t.Errorf("client hit = %v, want %v", got, tt.wantClientHit)
			}
		})
	}
}

func TestRefreshEnergyHistory_SuccessEnvelopeAndClientArgs(t *testing.T) {
	t.Parallel()
	client := &fakeEnergyClient{calStatus: 200, calBody: []byte(validEnergyBody)}
	repo := &fakeEnergyRepo{rows: []*teslamodel.TeslaEnergyHistory{sampleEnergyRow(), sampleEnergyRow()}}
	h := newTestHandler(client, repo, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.RefreshEnergyHistory(rec, req(http.MethodPost, "42",
		"period=week&start_date=2026-01-01&end_date=2026-02-01&time_zone=America/Los_Angeles"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var env refreshEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v\nbody=%s", err, rec.Body.String())
	}
	// The parsed body carried exactly one point → upserted must be 1.
	if env.Upserted != 1 {
		t.Errorf("upserted = %d, want 1", env.Upserted)
	}
	if len(env.Entries) != 2 {
		t.Errorf("entries len = %d, want 2 (read-back rows)", len(env.Entries))
	}

	if len(client.calCalls) != 1 {
		t.Fatalf("calendar calls = %d, want 1", len(client.calCalls))
	}
	c := client.calCalls[0]
	if c.siteID != 42 || c.kind != "energy" || c.period != "week" ||
		c.start != "2026-01-01" || c.end != "2026-02-01" || c.timeZone != "America/Los_Angeles" {
		t.Errorf("calendar call args = %+v", c)
	}
	// One upsert with the single parsed entry.
	if len(repo.upsertCalls) != 1 || len(repo.upsertCalls[0]) != 1 {
		t.Errorf("upsert calls = %+v, want one batch of one entry", repo.upsertCalls)
	}
}

// A refresh whose read-back window returns no rows must still 200 with an
// empty (never null) entries array and the true upserted count. This is the
// documented quirk that the Tesla fetch uses start_date/end_date while the
// read-back uses since/until — data refreshed outside the default 30-day
// read window is persisted (upserted>0) yet absent from entries.
func TestRefreshEnergyHistory_SuccessWithEmptyReadBack(t *testing.T) {
	t.Parallel()
	client := &fakeEnergyClient{calStatus: 200, calBody: []byte(validEnergyBody)}
	repo := &fakeEnergyRepo{rows: nil} // read-back finds nothing in the since/until window
	h := newTestHandler(client, repo, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.RefreshEnergyHistory(rec, req(http.MethodPost, "42", "start_date=2020-01-01&end_date=2020-02-01"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var env refreshEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Upserted != 1 {
		t.Errorf("upserted = %d, want 1 (data was persisted even if outside read window)", env.Upserted)
	}
	if env.Entries == nil {
		t.Errorf("entries = null, want [] — empty read-back must not serialise as null")
	}
	if len(env.Entries) != 0 {
		t.Errorf("entries len = %d, want 0", len(env.Entries))
	}
}

// ---------------------------------------------------------------------------
// RefreshBackupHistory
// ---------------------------------------------------------------------------

const validBackupBody = `{"response":{"time_series":[{"timestamp":"2026-01-01T00:00:00Z","duration":120}]}}`

func TestRefreshBackupHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		siteID        string
		query         string
		client        *fakeEnergyClient
		repo          *fakeBackupRepo
		wantStatus    int
		wantClientHit bool
	}{
		{"invalid_site_id", "abc", "", &fakeEnergyClient{}, &fakeBackupRepo{}, http.StatusBadRequest, false},
		{"invalid_period", "42", "period=fortnight", &fakeEnergyClient{}, &fakeBackupRepo{}, http.StatusBadRequest, false},
		{"client_error", "42", "", &fakeEnergyClient{calErr: errors.New("net")}, &fakeBackupRepo{}, http.StatusBadGateway, true},
		{"tesla_non_2xx", "42", "", &fakeEnergyClient{calStatus: 503, calBody: []byte("down")}, &fakeBackupRepo{}, http.StatusBadGateway, true},
		{"parse_error", "42", "", &fakeEnergyClient{calStatus: 200, calBody: []byte("garbage")}, &fakeBackupRepo{}, http.StatusInternalServerError, true},
		{"upsert_error", "42", "", &fakeEnergyClient{calStatus: 200, calBody: []byte(validBackupBody)}, &fakeBackupRepo{upsertErr: errors.New("w")}, http.StatusInternalServerError, true},
		{"readback_error", "42", "", &fakeEnergyClient{calStatus: 200, calBody: []byte(validBackupBody)}, &fakeBackupRepo{getErr: errors.New("r")}, http.StatusInternalServerError, true},
		{"success", "42", "", &fakeEnergyClient{calStatus: 200, calBody: []byte(validBackupBody)}, &fakeBackupRepo{}, http.StatusOK, true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(tt.client, &fakeEnergyRepo{}, tt.repo, &fakeWCRepo{})
			rec := httptest.NewRecorder()
			h.RefreshBackupHistory(rec, req(http.MethodPost, tt.siteID, tt.query))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.client.calCalls) > 0; got != tt.wantClientHit {
				t.Errorf("client hit = %v, want %v", got, tt.wantClientHit)
			}
		})
	}
}

func TestRefreshBackupHistory_UsesBackupKind(t *testing.T) {
	t.Parallel()
	client := &fakeEnergyClient{calStatus: 200, calBody: []byte(validBackupBody)}
	h := newTestHandler(client, &fakeEnergyRepo{}, &fakeBackupRepo{}, &fakeWCRepo{})
	rec := httptest.NewRecorder()
	h.RefreshBackupHistory(rec, req(http.MethodPost, "42", "start_date=2026-01-01&end_date=2026-02-01"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(client.calCalls) != 1 || client.calCalls[0].kind != "backup" {
		t.Fatalf("expected a single calendar call with kind=backup, got %+v", client.calCalls)
	}
	if len(client.telCalls) != 0 {
		t.Errorf("backup refresh must not touch the telemetry endpoint")
	}
}

// ---------------------------------------------------------------------------
// RefreshChargingHistory
// ---------------------------------------------------------------------------

const validWCBody = `{"response":{"data":[{"timestamp":"2026-01-01T00:00:00Z","din":"1-2-F","energy_wh":42}]}}`

func TestRefreshChargingHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		siteID        string
		query         string
		client        *fakeEnergyClient
		repo          *fakeWCRepo
		wantStatus    int
		wantClientHit bool
	}{
		{"invalid_site_id", "abc", "", &fakeEnergyClient{}, &fakeWCRepo{}, http.StatusBadRequest, false},
		{"client_error", "42", "", &fakeEnergyClient{telErr: errors.New("net")}, &fakeWCRepo{}, http.StatusBadGateway, true},
		{"tesla_non_2xx", "42", "", &fakeEnergyClient{telStatus: 502, telBody: []byte("bad")}, &fakeWCRepo{}, http.StatusBadGateway, true},
		{"parse_error", "42", "", &fakeEnergyClient{telStatus: 200, telBody: []byte("{oops")}, &fakeWCRepo{}, http.StatusInternalServerError, true},
		{"upsert_error", "42", "", &fakeEnergyClient{telStatus: 200, telBody: []byte(validWCBody)}, &fakeWCRepo{upsertErr: errors.New("w")}, http.StatusInternalServerError, true},
		{"readback_error", "42", "", &fakeEnergyClient{telStatus: 200, telBody: []byte(validWCBody)}, &fakeWCRepo{getErr: errors.New("r")}, http.StatusInternalServerError, true},
		{"success", "42", "", &fakeEnergyClient{telStatus: 200, telBody: []byte(validWCBody)}, &fakeWCRepo{}, http.StatusOK, true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := newTestHandler(tt.client, &fakeEnergyRepo{}, &fakeBackupRepo{}, tt.repo)
			rec := httptest.NewRecorder()
			h.RefreshChargingHistory(rec, req(http.MethodPost, tt.siteID, tt.query))
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if got := len(tt.client.telCalls) > 0; got != tt.wantClientHit {
				t.Errorf("client hit = %v, want %v", got, tt.wantClientHit)
			}
		})
	}
}

func TestRefreshChargingHistory_UsesTelemetryChargeKindAndIgnoresPeriod(t *testing.T) {
	t.Parallel()
	client := &fakeEnergyClient{telStatus: 200, telBody: []byte(validWCBody)}
	repo := &fakeWCRepo{}
	h := newTestHandler(client, &fakeEnergyRepo{}, &fakeBackupRepo{}, repo)
	rec := httptest.NewRecorder()
	// A bogus period must NOT 400 here — charging refresh has no period concept.
	h.RefreshChargingHistory(rec, req(http.MethodPost, "42", "period=bogus&start_date=2026-01-01&end_date=2026-02-01&time_zone=UTC"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(client.telCalls) != 1 {
		t.Fatalf("telemetry calls = %d, want 1", len(client.telCalls))
	}
	c := client.telCalls[0]
	if c.siteID != 42 || c.kind != "charge" || c.start != "2026-01-01" || c.end != "2026-02-01" || c.timeZone != "UTC" {
		t.Errorf("telemetry call args = %+v", c)
	}
	if len(client.calCalls) != 0 {
		t.Errorf("charging refresh must not touch the calendar endpoint")
	}
	var env refreshEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Upserted != 1 {
		t.Errorf("upserted = %d, want 1", env.Upserted)
	}
}
