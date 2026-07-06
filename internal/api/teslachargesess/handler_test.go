package teslachargesess

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// ---------------------------------------------------------------------------
// Test doubles (ports declared in handler.go). Same-package tests can satisfy
// the unexported teslaChargingSessionClient / teslaChargingSessionStore
// interfaces directly, so no real Tesla HTTP client + OAuth token or pgx pool
// is needed.
// ---------------------------------------------------------------------------

type clientCall struct {
	vin, dateFrom, dateTo string
	limit, offset         int
}

type clientResp struct {
	body   []byte
	status int
	err    error
}

type fakeChargeSessClient struct {
	// resps is consumed positionally, one per GetChargingSessions call. When
	// exhausted a terminal empty page is returned so pagination always halts.
	resps []clientResp
	// always, when non-nil, is returned for every call regardless of index —
	// used to exercise the 5000-offset safety limit without hand-authoring 101
	// canned pages.
	always *clientResp

	calls []clientCall
}

func (f *fakeChargeSessClient) GetChargingSessions(_ context.Context, vin, dateFrom, dateTo string, limit, offset int) ([]byte, int, error) {
	f.calls = append(f.calls, clientCall{vin: vin, dateFrom: dateFrom, dateTo: dateTo, limit: limit, offset: offset})
	if f.always != nil {
		return f.always.body, f.always.status, f.always.err
	}
	idx := len(f.calls) - 1
	if idx < len(f.resps) {
		r := f.resps[idx]
		return r.body, r.status, r.err
	}
	// Terminal empty page: len(data) < limit → the handler stops paginating.
	return []byte(`{"response":{"data":[],"totalResults":0}}`), http.StatusOK, nil
}

type fakeChargeSessStore struct {
	getAllResult []*teslamodel.TeslaChargingSession
	getAllErr    error
	getAllCalls  int
	gotGetAllVIN string
	gotLimit     int
	gotOffset    int

	summaryResult *teslamodel.TeslaChargingSessionSummary
	summaryErr    error
	summaryCalls  int
	gotSummaryVIN string

	upsertErr   error
	upsertCalls int
	gotUpsert   []*teslamodel.TeslaChargingSession
}

func (f *fakeChargeSessStore) GetAll(_ context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingSession, error) {
	f.getAllCalls++
	f.gotGetAllVIN = vin
	f.gotLimit = limit
	f.gotOffset = offset
	return f.getAllResult, f.getAllErr
}

func (f *fakeChargeSessStore) GetSummary(_ context.Context, vin string) (*teslamodel.TeslaChargingSessionSummary, error) {
	f.summaryCalls++
	f.gotSummaryVIN = vin
	return f.summaryResult, f.summaryErr
}

func (f *fakeChargeSessStore) UpsertBatch(_ context.Context, sessions []*teslamodel.TeslaChargingSession) (int, error) {
	f.upsertCalls++
	f.gotUpsert = sessions
	if f.upsertErr != nil {
		return 0, f.upsertErr
	}
	// Mirror the real repo: one row upserted per session.
	return len(sessions), nil
}

// Compile-time assertions the fakes implement the production ports.
var (
	_ teslaChargingSessionClient = (*fakeChargeSessClient)(nil)
	_ teslaChargingSessionStore  = (*fakeChargeSessStore)(nil)
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(tc teslaChargingSessionClient, repo teslaChargingSessionStore) *TeslaChargingSessionHandler {
	return &TeslaChargingSessionHandler{teslaClient: tc, repo: repo}
}

func getReq(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

type listResponse struct {
	Sessions []teslamodel.TeslaChargingSession       `json:"sessions"`
	Summary  *teslamodel.TeslaChargingSessionSummary `json:"summary"`
	Upserted *int                                    `json:"upserted"`
}

func decodeList(t *testing.T, rec *httptest.ResponseRecorder) listResponse {
	t.Helper()
	var lr listResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &lr); err != nil {
		t.Fatalf("decode list response: %v; raw=%q", err, rec.Body.String())
	}
	return lr
}

func decodeErr(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v; raw=%q", err, rec.Body.String())
	}
	return m
}

func fptr(f float64) *float64 { return &f }
func iptr(i int) *int         { return &i }

func sampleSummary() *teslamodel.TeslaChargingSessionSummary {
	return &teslamodel.TeslaChargingSessionSummary{
		TotalSessions: 5,
		TotalWh:       fptr(12345),
		TotalCost:     fptr(42.5),
		AvgCostPerKWh: fptr(0.34),
		PeakPowerKW:   fptr(150),
	}
}

func sampleSession(id int64, vin string) *teslamodel.TeslaChargingSession {
	return &teslamodel.TeslaChargingSession{
		SessionID:           id,
		VIN:                 vin,
		SiteLocationName:    "Supercharger X",
		ChargeStartDatetime: time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC),
	}
}

// makeItem builds a minimally-valid Tesla API session item (parseable start).
func makeItem(id int64, vin string) teslaChargingSessionItem {
	return teslaChargingSessionItem{
		SessionID:           id,
		VIN:                 vin,
		ChargeStartDateTime: "2026-03-01T10:00:00Z",
		ChargeStopDateTime:  "2026-03-01T11:00:00Z",
	}
}

// makeItems returns n minimally-valid items with sequential session IDs.
func makeItems(n int, startID int64) []teslaChargingSessionItem {
	items := make([]teslaChargingSessionItem, 0, n)
	for i := 0; i < n; i++ {
		items = append(items, makeItem(startID+int64(i), "5YJ3E1EA0KF000001"))
	}
	return items
}

// sessionsEnvelope marshals items into the Tesla /dx/charging/sessions
// response envelope shape the handler unmarshals.
func sessionsEnvelope(t *testing.T, items []teslaChargingSessionItem, totalResults int) []byte {
	t.Helper()
	var env struct {
		Response struct {
			Data         []teslaChargingSessionItem `json:"data"`
			TotalResults int                        `json:"totalResults"`
		} `json:"response"`
	}
	env.Response.Data = items
	env.Response.TotalResults = totalResults
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal sessions envelope: %v", err)
	}
	return b
}

// ---------------------------------------------------------------------------
// Constructor wiring
// ---------------------------------------------------------------------------

// TestNewTeslaChargingSessionHandler is a wiring smoke test: the constructor
// must populate both ports and never panic, even with nil dependencies (it only
// stores them). Behavioural coverage lives in the List/Refresh tests via the
// unexported ports.
func TestNewTeslaChargingSessionHandler(t *testing.T) {
	h := NewTeslaChargingSessionHandler(nil, &database.DB{})
	if h == nil {
		t.Fatal("constructor returned nil handler")
	}
	if h.repo == nil {
		t.Fatal("repo port not wired")
	}
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestTeslaChargingSessionHandler_List(t *testing.T) {
	tests := []struct {
		name        string
		repo        *fakeChargeSessStore
		wantStatus  int
		wantErr     bool
		wantLen     int
		wantSummary bool
	}{
		{
			name: "success with sessions and summary",
			repo: &fakeChargeSessStore{
				getAllResult:  []*teslamodel.TeslaChargingSession{sampleSession(1, "VINA"), sampleSession(2, "VINA")},
				summaryResult: sampleSummary(),
			},
			wantStatus:  http.StatusOK,
			wantLen:     2,
			wantSummary: true,
		},
		{
			name: "empty result renders json array not null",
			repo: &fakeChargeSessStore{
				getAllResult:  nil,
				summaryResult: &teslamodel.TeslaChargingSessionSummary{TotalSessions: 0},
			},
			wantStatus:  http.StatusOK,
			wantLen:     0,
			wantSummary: true,
		},
		{
			name:       "GetAll error yields 500",
			repo:       &fakeChargeSessStore{getAllErr: errors.New("db down")},
			wantStatus: http.StatusInternalServerError,
			wantErr:    true,
		},
		{
			name: "GetSummary error yields 500",
			repo: &fakeChargeSessStore{
				getAllResult: []*teslamodel.TeslaChargingSession{sampleSession(1, "VINA")},
				summaryErr:   errors.New("summary boom"),
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(&fakeChargeSessClient{}, tc.repo)
			rec := httptest.NewRecorder()
			h.List(rec, getReq("/tesla/charging-sessions"))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}
			if tc.wantErr {
				if got := decodeErr(t, rec); got["error"] == "" {
					t.Fatalf("expected error message in body, got %q", rec.Body.String())
				}
				return
			}
			// sessions must always be a JSON array, never null.
			if !strings.Contains(rec.Body.String(), `"sessions":[`) {
				t.Fatalf("sessions is not a JSON array: %s", rec.Body.String())
			}
			lr := decodeList(t, rec)
			if len(lr.Sessions) != tc.wantLen {
				t.Fatalf("session count = %d, want %d", len(lr.Sessions), tc.wantLen)
			}
			if tc.wantSummary && lr.Summary == nil {
				t.Fatalf("summary missing from response body: %s", rec.Body.String())
			}
			// List never performs a write, so no upserted key.
			if lr.Upserted != nil {
				t.Fatalf("List must not emit an upserted key, got %d", *lr.Upserted)
			}
		})
	}
}

// TestTeslaChargingSessionHandler_List_PassesVINAndPagination locks in that the
// VIN filter and pagination bounds flow through to the store unchanged. A
// regression here would silently return the wrong vehicle's sessions or ignore
// the page window.
func TestTeslaChargingSessionHandler_List_PassesVINAndPagination(t *testing.T) {
	repo := &fakeChargeSessStore{summaryResult: sampleSummary()}
	h := newHandler(&fakeChargeSessClient{}, repo)

	rec := httptest.NewRecorder()
	h.List(rec, getReq("/tesla/charging-sessions?vin=5YJABC&limit=10&offset=20"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.gotGetAllVIN != "5YJABC" {
		t.Fatalf("GetAll vin = %q, want 5YJABC", repo.gotGetAllVIN)
	}
	if repo.gotLimit != 10 || repo.gotOffset != 20 {
		t.Fatalf("GetAll pagination = (%d,%d), want (10,20)", repo.gotLimit, repo.gotOffset)
	}
	if repo.gotSummaryVIN != "5YJABC" {
		t.Fatalf("GetSummary vin = %q, want 5YJABC", repo.gotSummaryVIN)
	}
}

// ---------------------------------------------------------------------------
// Refresh — error / status branches
// ---------------------------------------------------------------------------

func TestTeslaChargingSessionHandler_Refresh_ErrorBranches(t *testing.T) {
	tests := []struct {
		name       string
		resp       clientResp
		wantStatus int
		wantErrSub string
		wantUpsert bool // whether UpsertBatch should have been reached
	}{
		{
			name:       "tesla transport error yields 502",
			resp:       clientResp{err: errors.New("connection refused")},
			wantStatus: http.StatusBadGateway,
			wantErrSub: "failed to fetch charging sessions from Tesla",
		},
		{
			name:       "tesla 403 yields graceful business-account 403",
			resp:       clientResp{status: http.StatusForbidden, body: []byte(`{"error":"forbidden"}`)},
			wantStatus: http.StatusForbidden,
			wantErrSub: "business account",
		},
		{
			name:       "tesla 500 yields 502 with status detail",
			resp:       clientResp{status: http.StatusInternalServerError, body: []byte(`boom`)},
			wantStatus: http.StatusBadGateway,
			wantErrSub: "Tesla API returned status 500",
		},
		{
			name:       "tesla 200 with invalid json yields 500",
			resp:       clientResp{status: http.StatusOK, body: []byte(`{not json`)},
			wantStatus: http.StatusInternalServerError,
			wantErrSub: "failed to parse Tesla response",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client := &fakeChargeSessClient{resps: []clientResp{tc.resp}}
			repo := &fakeChargeSessStore{}
			h := newHandler(client, repo)

			rec := httptest.NewRecorder()
			h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			body := decodeErr(t, rec)
			if !strings.Contains(body["error"], tc.wantErrSub) {
				t.Fatalf("error = %q, want substring %q", body["error"], tc.wantErrSub)
			}
			if body["code"] == "" {
				t.Fatalf("error response missing machine code: %s", rec.Body.String())
			}
			if !tc.wantUpsert && repo.upsertCalls != 0 {
				t.Fatalf("UpsertBatch called %d times, want 0 (error path must short-circuit)", repo.upsertCalls)
			}
		})
	}
}

// TestTeslaChargingSessionHandler_Refresh_Success covers the happy single-page
// path: fetch → upsert → re-read → JSON with sessions, summary and upserted.
func TestTeslaChargingSessionHandler_Refresh_Success(t *testing.T) {
	page := sessionsEnvelope(t, makeItems(3, 1), 3)
	client := &fakeChargeSessClient{resps: []clientResp{{status: http.StatusOK, body: page}}}
	repo := &fakeChargeSessStore{
		getAllResult:  []*teslamodel.TeslaChargingSession{sampleSession(1, "VINA"), sampleSession(2, "VINA"), sampleSession(3, "VINA")},
		summaryResult: sampleSummary(),
	}
	h := newHandler(client, repo)

	rec := httptest.NewRecorder()
	h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.calls) != 1 {
		t.Fatalf("client called %d times, want 1", len(client.calls))
	}
	if client.calls[0].limit != 50 || client.calls[0].offset != 0 {
		t.Fatalf("first page = (limit %d, offset %d), want (50,0)", client.calls[0].limit, client.calls[0].offset)
	}
	if repo.upsertCalls != 1 {
		t.Fatalf("UpsertBatch calls = %d, want 1", repo.upsertCalls)
	}
	if len(repo.gotUpsert) != 3 {
		t.Fatalf("upserted session count = %d, want 3", len(repo.gotUpsert))
	}
	lr := decodeList(t, rec)
	if len(lr.Sessions) != 3 {
		t.Fatalf("returned session count = %d, want 3", len(lr.Sessions))
	}
	if lr.Summary == nil {
		t.Fatalf("summary missing: %s", rec.Body.String())
	}
	if lr.Upserted == nil || *lr.Upserted != 3 {
		t.Fatalf("upserted = %v, want 3", lr.Upserted)
	}
}

// TestTeslaChargingSessionHandler_Refresh_EmptyData verifies that a valid but
// empty Tesla page still upserts (zero rows) and returns 200 with an empty
// array — never a nil panic or a 500.
func TestTeslaChargingSessionHandler_Refresh_EmptyData(t *testing.T) {
	page := sessionsEnvelope(t, nil, 0)
	client := &fakeChargeSessClient{resps: []clientResp{{status: http.StatusOK, body: page}}}
	repo := &fakeChargeSessStore{}
	h := newHandler(client, repo)

	rec := httptest.NewRecorder()
	h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if repo.upsertCalls != 1 || len(repo.gotUpsert) != 0 {
		t.Fatalf("UpsertBatch calls=%d len=%d, want 1 call with 0 sessions", repo.upsertCalls, len(repo.gotUpsert))
	}
	if !strings.Contains(rec.Body.String(), `"sessions":[]`) {
		t.Fatalf("expected empty sessions array, got %s", rec.Body.String())
	}
	lr := decodeList(t, rec)
	if lr.Upserted == nil || *lr.Upserted != 0 {
		t.Fatalf("upserted = %v, want 0", lr.Upserted)
	}
}

// TestTeslaChargingSessionHandler_Refresh_Pagination proves multi-page fetches
// accumulate across pages and stop on the two terminal conditions
// (offset+limit >= totalResults on a full page, and a short final page).
func TestTeslaChargingSessionHandler_Refresh_Pagination(t *testing.T) {
	tests := []struct {
		name       string
		resps      []clientResp
		wantCalls  int
		wantTotal  int
		wantOffset []int // expected offset per call
	}{
		{
			name: "short final page stops the loop",
			resps: []clientResp{
				{status: http.StatusOK}, // page 1 filled below
				{status: http.StatusOK}, // page 2 filled below
			},
			wantCalls:  2,
			wantTotal:  60,
			wantOffset: []int{0, 50},
		},
		{
			name: "totalResults reached on a full page stops the loop",
			resps: []clientResp{
				{status: http.StatusOK},
				{status: http.StatusOK},
			},
			wantCalls:  2,
			wantTotal:  100,
			wantOffset: []int{0, 50},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Build page bodies per scenario.
			if tc.wantTotal == 60 {
				tc.resps[0].body = sessionsEnvelope(t, makeItems(50, 1), 60)
				tc.resps[1].body = sessionsEnvelope(t, makeItems(10, 51), 60)
			} else {
				tc.resps[0].body = sessionsEnvelope(t, makeItems(50, 1), 100)
				tc.resps[1].body = sessionsEnvelope(t, makeItems(50, 51), 100)
			}

			client := &fakeChargeSessClient{resps: tc.resps}
			repo := &fakeChargeSessStore{}
			h := newHandler(client, repo)

			rec := httptest.NewRecorder()
			h.Refresh(rec, getReq("/tesla/charging-sessions/refresh?vin=VINP"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if len(client.calls) != tc.wantCalls {
				t.Fatalf("client calls = %d, want %d", len(client.calls), tc.wantCalls)
			}
			for i, off := range tc.wantOffset {
				if client.calls[i].offset != off {
					t.Fatalf("call[%d] offset = %d, want %d", i, client.calls[i].offset, off)
				}
				if client.calls[i].vin != "VINP" {
					t.Fatalf("call[%d] vin = %q, want VINP", i, client.calls[i].vin)
				}
			}
			if len(repo.gotUpsert) != tc.wantTotal {
				t.Fatalf("upserted total = %d, want %d", len(repo.gotUpsert), tc.wantTotal)
			}
		})
	}
}

// TestTeslaChargingSessionHandler_Refresh_SafetyLimit ensures the 5000-offset
// guard terminates a pathological stream (Tesla always reporting more data)
// rather than looping forever. Exactly 101 pages are fetched (offsets
// 0,50,…,5000) before the guard trips.
func TestTeslaChargingSessionHandler_Refresh_SafetyLimit(t *testing.T) {
	fullPage := sessionsEnvelope(t, makeItems(50, 1), 1<<30) // huge total → never satisfied
	client := &fakeChargeSessClient{always: &clientResp{status: http.StatusOK, body: fullPage}}
	repo := &fakeChargeSessStore{}
	h := newHandler(client, repo)

	rec := httptest.NewRecorder()
	h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.calls) != 101 {
		t.Fatalf("client calls = %d, want 101 (offsets 0..5000 step 50)", len(client.calls))
	}
	if last := client.calls[len(client.calls)-1].offset; last != 5000 {
		t.Fatalf("last fetched offset = %d, want 5000", last)
	}
	if repo.upsertCalls != 1 || len(repo.gotUpsert) != 101*50 {
		t.Fatalf("UpsertBatch calls=%d len=%d, want 1 call with %d sessions", repo.upsertCalls, len(repo.gotUpsert), 101*50)
	}
}

// TestTeslaChargingSessionHandler_Refresh_DefaultDateRange verifies that when
// the caller omits date_from/date_to the handler substitutes a [now-3mo, now]
// window (date-only format) and forwards it to the Tesla client.
func TestTeslaChargingSessionHandler_Refresh_DefaultDateRange(t *testing.T) {
	client := &fakeChargeSessClient{} // default terminal empty page
	repo := &fakeChargeSessStore{}
	h := newHandler(client, repo)

	beforeFrom := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")
	beforeTo := time.Now().UTC().Format("2006-01-02")
	rec := httptest.NewRecorder()
	h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))
	afterFrom := time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")
	afterTo := time.Now().UTC().Format("2006-01-02")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.calls) != 1 {
		t.Fatalf("client calls = %d, want 1", len(client.calls))
	}
	got := client.calls[0]
	if _, err := time.Parse("2006-01-02", got.dateFrom); err != nil {
		t.Fatalf("date_from %q is not YYYY-MM-DD: %v", got.dateFrom, err)
	}
	if got.dateFrom != beforeFrom && got.dateFrom != afterFrom {
		t.Fatalf("date_from = %q, want ~%q (now-3mo)", got.dateFrom, beforeFrom)
	}
	if got.dateTo != beforeTo && got.dateTo != afterTo {
		t.Fatalf("date_to = %q, want ~%q (today)", got.dateTo, beforeTo)
	}
}

// TestTeslaChargingSessionHandler_Refresh_CustomDateRange verifies explicit
// date_from/date_to query params are forwarded verbatim (no defaulting).
func TestTeslaChargingSessionHandler_Refresh_CustomDateRange(t *testing.T) {
	client := &fakeChargeSessClient{}
	repo := &fakeChargeSessStore{}
	h := newHandler(client, repo)

	rec := httptest.NewRecorder()
	h.Refresh(rec, getReq("/tesla/charging-sessions/refresh?vin=VINC&date_from=2026-01-01&date_to=2026-02-01"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(client.calls) != 1 {
		t.Fatalf("client calls = %d, want 1", len(client.calls))
	}
	got := client.calls[0]
	if got.dateFrom != "2026-01-01" || got.dateTo != "2026-02-01" {
		t.Fatalf("date range = (%q,%q), want (2026-01-01,2026-02-01)", got.dateFrom, got.dateTo)
	}
	if got.vin != "VINC" {
		t.Fatalf("vin = %q, want VINC", got.vin)
	}
}

// TestTeslaChargingSessionHandler_Refresh_PostFetchErrors covers the store
// failures that occur after a successful Tesla fetch: upsert, re-read, and
// summary. Each must surface as a 500 without leaking a partial 200.
func TestTeslaChargingSessionHandler_Refresh_PostFetchErrors(t *testing.T) {
	tests := []struct {
		name       string
		repo       *fakeChargeSessStore
		wantErrSub string
	}{
		{
			name:       "upsert error",
			repo:       &fakeChargeSessStore{upsertErr: errors.New("upsert boom")},
			wantErrSub: "failed to save charging sessions",
		},
		{
			name:       "post-refresh GetAll error",
			repo:       &fakeChargeSessStore{getAllErr: errors.New("getall boom")},
			wantErrSub: "failed to list charging sessions",
		},
		{
			name: "post-refresh GetSummary error",
			repo: &fakeChargeSessStore{
				getAllResult: []*teslamodel.TeslaChargingSession{sampleSession(1, "VINA")},
				summaryErr:   errors.New("summary boom"),
			},
			wantErrSub: "failed to get charging session summary",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			page := sessionsEnvelope(t, makeItems(2, 1), 2)
			client := &fakeChargeSessClient{resps: []clientResp{{status: http.StatusOK, body: page}}}
			h := newHandler(client, tc.repo)

			rec := httptest.NewRecorder()
			h.Refresh(rec, getReq("/tesla/charging-sessions/refresh"))

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
			}
			if got := decodeErr(t, rec)["error"]; !strings.Contains(got, tc.wantErrSub) {
				t.Fatalf("error = %q, want substring %q", got, tc.wantErrSub)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// parseTeslaChargingSessions
// ---------------------------------------------------------------------------

func TestParseTeslaChargingSessions(t *testing.T) {
	t.Run("empty input returns non-nil empty slice", func(t *testing.T) {
		got := parseTeslaChargingSessions(nil)
		if got == nil {
			t.Fatal("got nil slice, want non-nil empty")
		}
		if len(got) != 0 {
			t.Fatalf("len = %d, want 0", len(got))
		}
	})

	t.Run("fully populated item maps every field", func(t *testing.T) {
		item := teslaChargingSessionItem{
			SessionID:           99,
			VIN:                 "5YJ3E1EA0KF999999",
			ChargerID:           "charger-1",
			SiteLocationName:    "Downtown SC",
			ChargeStartDateTime: "2026-03-01T10:00:00Z",
			ChargeStopDateTime:  "2026-03-01T11:30:00Z",
			EnergyAddedKWh:      fptr(42.5),
			PeakPowerKW:         fptr(150),
			MaxChargeRateKW:     fptr(250),
			ChargeDurationS:     iptr(5400),
			ChargerType:         "DC",
			Cost: &teslaChargingSessionCost{
				CurrencyCode:  "USD",
				TotalCost:     18.75,
				PerKWhRate:    0.44,
				IdleFee:       2.0,
				CongestionFee: 1.5,
			},
			Location: &teslaChargingSessionLoc{Latitude: 37.42, Longitude: -122.08},
		}

		got := parseTeslaChargingSessions([]teslaChargingSessionItem{item})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		s := got[0]
		if s.SessionID != 99 || s.VIN != "5YJ3E1EA0KF999999" || s.SiteLocationName != "Downtown SC" {
			t.Fatalf("scalar fields wrong: %+v", s)
		}
		wantStart := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
		if !s.ChargeStartDatetime.Equal(wantStart) {
			t.Fatalf("start = %v, want %v", s.ChargeStartDatetime, wantStart)
		}
		if s.ChargeStopDatetime == nil || !s.ChargeStopDatetime.Equal(time.Date(2026, 3, 1, 11, 30, 0, 0, time.UTC)) {
			t.Fatalf("stop = %v, want 2026-03-01T11:30:00Z", s.ChargeStopDatetime)
		}
		if s.ChargerID == nil || *s.ChargerID != "charger-1" {
			t.Fatalf("charger_id = %v, want charger-1", s.ChargerID)
		}
		if s.ChargerType == nil || *s.ChargerType != "DC" {
			t.Fatalf("charger_type = %v, want DC", s.ChargerType)
		}
		if s.EnergyAddedKWh == nil || *s.EnergyAddedKWh != 42.5 {
			t.Fatalf("energy = %v, want 42.5", s.EnergyAddedKWh)
		}
		if s.PeakPowerKW == nil || *s.PeakPowerKW != 150 {
			t.Fatalf("peak = %v, want 150", s.PeakPowerKW)
		}
		if s.MaxChargeRateKW == nil || *s.MaxChargeRateKW != 250 {
			t.Fatalf("max rate = %v, want 250", s.MaxChargeRateKW)
		}
		if s.ChargeDurationS == nil || *s.ChargeDurationS != 5400 {
			t.Fatalf("duration = %v, want 5400", s.ChargeDurationS)
		}
		if s.CurrencyCode == nil || *s.CurrencyCode != "USD" {
			t.Fatalf("currency = %v, want USD", s.CurrencyCode)
		}
		if s.TotalCost == nil || *s.TotalCost != 18.75 {
			t.Fatalf("total cost = %v, want 18.75", s.TotalCost)
		}
		if s.PerKWhRate == nil || *s.PerKWhRate != 0.44 {
			t.Fatalf("per kwh = %v, want 0.44", s.PerKWhRate)
		}
		if s.IdleFee == nil || *s.IdleFee != 2.0 {
			t.Fatalf("idle fee = %v, want 2.0", s.IdleFee)
		}
		if s.CongestionFee == nil || *s.CongestionFee != 1.5 {
			t.Fatalf("congestion fee = %v, want 1.5", s.CongestionFee)
		}
		if s.Latitude == nil || *s.Latitude != 37.42 {
			t.Fatalf("lat = %v, want 37.42", s.Latitude)
		}
		if s.Longitude == nil || *s.Longitude != -122.08 {
			t.Fatalf("lon = %v, want -122.08", s.Longitude)
		}
	})

	t.Run("optional fields stay nil when absent", func(t *testing.T) {
		item := teslaChargingSessionItem{
			SessionID:           7,
			VIN:                 "VINX",
			ChargeStartDateTime: "2026-03-01T10:00:00Z",
			// empty ChargerID / ChargerType / ChargeStopDateTime, nil Cost + Location
		}
		got := parseTeslaChargingSessions([]teslaChargingSessionItem{item})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		s := got[0]
		if s.ChargerID != nil {
			t.Fatalf("charger_id = %v, want nil", *s.ChargerID)
		}
		if s.ChargerType != nil {
			t.Fatalf("charger_type = %v, want nil", *s.ChargerType)
		}
		if s.ChargeStopDatetime != nil {
			t.Fatalf("stop = %v, want nil", s.ChargeStopDatetime)
		}
		if s.CurrencyCode != nil || s.TotalCost != nil || s.PerKWhRate != nil || s.IdleFee != nil || s.CongestionFee != nil {
			t.Fatalf("cost pointers should be nil: %+v", s)
		}
		if s.Latitude != nil || s.Longitude != nil {
			t.Fatalf("location pointers should be nil: lat=%v lon=%v", s.Latitude, s.Longitude)
		}
	})

	t.Run("unparseable stop keeps item with nil stop", func(t *testing.T) {
		item := teslaChargingSessionItem{
			SessionID:           8,
			VIN:                 "VINX",
			ChargeStartDateTime: "2026-03-01T10:00:00Z",
			ChargeStopDateTime:  "not-a-timestamp",
		}
		got := parseTeslaChargingSessions([]teslaChargingSessionItem{item})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1 (item kept despite bad stop)", len(got))
		}
		if got[0].ChargeStopDatetime != nil {
			t.Fatalf("stop = %v, want nil on parse failure", got[0].ChargeStopDatetime)
		}
	})

	t.Run("unparseable start drops the item", func(t *testing.T) {
		items := []teslaChargingSessionItem{
			{SessionID: 1, VIN: "VINX", ChargeStartDateTime: "garbage"},
			{SessionID: 2, VIN: "VINX", ChargeStartDateTime: ""},
			makeItem(3, "VINX"), // the only valid one
		}
		got := parseTeslaChargingSessions(items)
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1 (only the parseable item survives)", len(got))
		}
		if got[0].SessionID != 3 {
			t.Fatalf("kept session = %d, want 3", got[0].SessionID)
		}
	})

	t.Run("distinct items do not alias pointers", func(t *testing.T) {
		items := []teslaChargingSessionItem{
			{SessionID: 1, VIN: "VINA", ChargerID: "cid-1", ChargeStartDateTime: "2026-03-01T10:00:00Z", Cost: &teslaChargingSessionCost{CurrencyCode: "USD"}},
			{SessionID: 2, VIN: "VINB", ChargerID: "cid-2", ChargeStartDateTime: "2026-03-02T10:00:00Z", Cost: &teslaChargingSessionCost{CurrencyCode: "EUR"}},
		}
		got := parseTeslaChargingSessions(items)
		if len(got) != 2 {
			t.Fatalf("len = %d, want 2", len(got))
		}
		if *got[0].ChargerID != "cid-1" || *got[1].ChargerID != "cid-2" {
			t.Fatalf("charger ids aliased: %q, %q", *got[0].ChargerID, *got[1].ChargerID)
		}
		if *got[0].CurrencyCode != "USD" || *got[1].CurrencyCode != "EUR" {
			t.Fatalf("currency codes aliased: %q, %q", *got[0].CurrencyCode, *got[1].CurrencyCode)
		}
	})
}
