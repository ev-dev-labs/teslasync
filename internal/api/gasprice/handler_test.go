package gasprice

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/worker"
)

// ---------------------------------------------------------------------------
// Test doubles — follow the established database.DBTX / pgx.Rows / pgx.Row fake
// pattern used across the repo (see internal/api/apikey/handler_test.go and
// internal/database/drive/repo_backfill_test.go). No live DB, network, price
// provider, or polling loop is used.
// ---------------------------------------------------------------------------

// fakePoller satisfies gasPoller. It records every call so tests can pin the
// exact worker interactions each handler drives. Poll optionally blocks on a
// release channel so the Poll test can inspect the detached context's liveness
// *after* cancelling the originating request context — proving the fire-and-
// forget poll is decoupled from the request lifecycle.
type fakePoller struct {
	mu sync.Mutex

	status      worker.GasPriceStatus
	resumeCalls int
	stopCalls   int
	intervals   []string

	pollCalls      int
	pollCtx        context.Context
	pollErrOnEntry error
	pollErrOnExit  error
	blockPoll      bool
	entered        chan struct{}
	release        chan struct{}
	done           chan struct{}
}

func newFakePoller() *fakePoller {
	return &fakePoller{
		entered: make(chan struct{}),
		release: make(chan struct{}),
		done:    make(chan struct{}),
	}
}

func (f *fakePoller) Status() worker.GasPriceStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status
}

func (f *fakePoller) Poll(ctx context.Context) {
	f.mu.Lock()
	f.pollCalls++
	f.pollCtx = ctx
	f.pollErrOnEntry = ctx.Err()
	block := f.blockPoll
	f.mu.Unlock()

	close(f.entered)
	if block {
		<-f.release
	}

	f.mu.Lock()
	f.pollErrOnExit = ctx.Err()
	f.mu.Unlock()
	close(f.done)
}

func (f *fakePoller) Resume() {
	f.mu.Lock()
	f.resumeCalls++
	f.mu.Unlock()
}

func (f *fakePoller) Stop() {
	f.mu.Lock()
	f.stopCalls++
	f.mu.Unlock()
}

func (f *fakePoller) SetPollInterval(interval string) {
	f.mu.Lock()
	f.intervals = append(f.intervals, interval)
	f.mu.Unlock()
}

func (f *fakePoller) snapshot() (resume, stop int, intervals []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := append([]string(nil), f.intervals...)
	return f.resumeCalls, f.stopCalls, cp
}

var _ gasPoller = (*fakePoller)(nil)

// execCall records a single Exec invocation for assertion.
type execCall struct {
	sql  string
	args []any
}

// fakeQuerier satisfies database.DBTX. Query/Exec record their calls and can be
// steered to fail so the handler's error branches are exercised deterministically.
type fakeQuerier struct {
	mu sync.Mutex

	queryErr  error
	queryRows pgx.Rows
	queryArgs []any

	execErr   error
	execTag   pgconn.CommandTag
	execCalls []execCall
}

func (f *fakeQuerier) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	f.mu.Lock()
	f.queryArgs = append([]any(nil), args...)
	f.mu.Unlock()
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	if f.queryRows != nil {
		return f.queryRows, nil
	}
	return newFakeRows(nil), nil
}

func (f *fakeQuerier) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeRow{}
}

func (f *fakeQuerier) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.mu.Lock()
	f.execCalls = append(f.execCalls, execCall{sql: sql, args: append([]any(nil), args...)})
	f.mu.Unlock()
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return f.execTag, nil
}

func (f *fakeQuerier) execSnapshot() []execCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]execCall(nil), f.execCalls...)
}

func (f *fakeQuerier) queryArgSnapshot() []any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]any(nil), f.queryArgs...)
}

var _ database.DBTX = (*fakeQuerier)(nil)

// fakeRow satisfies pgx.Row for the unused QueryRow path on the DBTX contract.
type fakeRow struct{}

func (fakeRow) Scan(_ ...any) error { return nil }

var _ pgx.Row = fakeRow{}

// fakeRows satisfies pgx.Rows for the History SELECT path. data holds one []any
// per row in column order; scanErrAt forces Scan to fail for one row and iterErr
// is surfaced by Err() to exercise the post-iteration error branch.
type fakeRows struct {
	data      [][]any
	cursor    int
	closed    bool
	iterErr   error
	scanErrAt int
}

func newFakeRows(data [][]any) *fakeRows {
	return &fakeRows{data: data, cursor: -1, scanErrAt: -1}
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }

func (r *fakeRows) Next() bool {
	r.cursor++
	return r.cursor < len(r.data)
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.cursor < 0 || r.cursor >= len(r.data) {
		return errors.New("fakeRows.Scan: cursor out of range")
	}
	if r.cursor == r.scanErrAt {
		return errors.New("fakeRows: forced scan error")
	}
	return scanInto(dest, r.data[r.cursor])
}

func (r *fakeRows) Values() ([]any, error) { return nil, nil }
func (r *fakeRows) RawValues() [][]byte    { return nil }
func (r *fakeRows) Conn() *pgx.Conn        { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// scanInto copies src column values into the pointer destinations History hands
// to rows.Scan, mimicking pgx's assignment semantics for the exact types the
// query returns (int64, float64, string, time.Time, *time.Time).
func scanInto(dest, src []any) error {
	if len(dest) != len(src) {
		return errors.New("scanInto: dest/src length mismatch")
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return errors.New("scanInto: dest is not a non-nil pointer")
		}
		target := dv.Elem()
		if src[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		sv := reflect.ValueOf(src[i])
		if !sv.Type().AssignableTo(target.Type()) {
			return errors.New("scanInto: type not assignable")
		}
		target.Set(sv)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Shared assertion helpers
// ---------------------------------------------------------------------------

const jsonContentType = "application/json; charset=utf-8"

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, want, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != jsonContentType {
		t.Errorf("Content-Type = %q, want %q", ct, jsonContentType)
	}
}

func decodeMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return m
}

func assertErrorBody(t *testing.T, rec *httptest.ResponseRecorder, wantCode string) {
	t.Helper()
	m := decodeMap(t, rec)
	if _, ok := m["error"].(string); !ok || m["error"].(string) == "" {
		t.Errorf("expected non-empty error field, got %v", m["error"])
	}
	if code, _ := m["code"].(string); code != wantCode {
		t.Errorf("code = %q, want %q", code, wantCode)
	}
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

func TestHandler_Status(t *testing.T) {
	lastPoll := time.Date(2026, 3, 1, 12, 30, 0, 0, time.UTC)
	tests := []struct {
		name string
		in   worker.GasPriceStatus
	}{
		{
			name: "running with price",
			in: worker.GasPriceStatus{
				Enabled:           true,
				PollInterval:      "7d",
				LastPollTime:      lastPoll,
				CurrentPrice:      3.59,
				CurrentPriceKWhEq: 0.5028,
			},
		},
		{
			name: "stopped zero-value",
			in:   worker.GasPriceStatus{Enabled: false, PollInterval: "daily"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			poller := newFakePoller()
			poller.status = tc.in
			h := newHandler(&fakeQuerier{}, poller)

			rec := httptest.NewRecorder()
			h.Status(rec, httptest.NewRequest(http.MethodGet, "/gas-price/status", nil))

			assertStatus(t, rec, http.StatusOK)

			var got worker.GasPriceStatus
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.Enabled != tc.in.Enabled {
				t.Errorf("enabled = %v, want %v", got.Enabled, tc.in.Enabled)
			}
			if got.PollInterval != tc.in.PollInterval {
				t.Errorf("poll_interval = %q, want %q", got.PollInterval, tc.in.PollInterval)
			}
			if got.CurrentPrice != tc.in.CurrentPrice {
				t.Errorf("current_price = %v, want %v", got.CurrentPrice, tc.in.CurrentPrice)
			}
			if got.CurrentPriceKWhEq != tc.in.CurrentPriceKWhEq {
				t.Errorf("current_price_kwh_eq = %v, want %v", got.CurrentPriceKWhEq, tc.in.CurrentPriceKWhEq)
			}
			if !got.LastPollTime.Equal(tc.in.LastPollTime) {
				t.Errorf("last_poll_time = %v, want %v", got.LastPollTime, tc.in.LastPollTime)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Poll — verifies fire-and-forget behaviour AND the context-detachment bug fix.
// ---------------------------------------------------------------------------

func TestHandler_Poll(t *testing.T) {
	poller := newFakePoller()
	poller.blockPoll = true // hold Poll open so we can cancel the request first
	h := newHandler(nil, poller)

	parentCtx, cancelParent := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/gas-price/poll", nil).WithContext(parentCtx)
	rec := httptest.NewRecorder()

	h.Poll(rec, req)

	// The handler must respond immediately without waiting on the poll.
	assertStatus(t, rec, http.StatusOK)
	if got := decodeMap(t, rec)["status"]; got != "poll_triggered" {
		t.Errorf("status = %v, want poll_triggered", got)
	}

	// Wait for the background poll to start (it captured its context).
	select {
	case <-poller.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("worker.Poll was not invoked")
	}

	// Emulate net/http tearing down the request context after ServeHTTP returns.
	cancelParent()

	poller.mu.Lock()
	pollCtx := poller.pollCtx
	entryErr := poller.pollErrOnEntry
	poller.mu.Unlock()

	if entryErr != nil {
		t.Errorf("poll context should be live on entry, got err=%v", entryErr)
	}
	if _, ok := pollCtx.Deadline(); !ok {
		t.Error("background poll context should carry a timeout deadline (pollTimeout)")
	}

	// Release Poll so it reads ctx.Err() AFTER the request context was cancelled.
	close(poller.release)
	select {
	case <-poller.done:
	case <-time.After(2 * time.Second):
		t.Fatal("worker.Poll did not complete")
	}

	poller.mu.Lock()
	exitErr := poller.pollErrOnExit
	calls := poller.pollCalls
	poller.mu.Unlock()

	if exitErr != nil {
		t.Errorf("detached poll context must survive request cancellation, got err=%v", exitErr)
	}
	if calls != 1 {
		t.Errorf("Poll call count = %d, want 1", calls)
	}
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

func TestHandler_Toggle(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		execErr     error
		wantStatus  int
		wantCode    string
		wantEnabled bool
		wantResume  int
		wantStop    int
		wantExec    bool
	}{
		{
			name:        "enable resumes worker and persists",
			body:        `{"enabled":true}`,
			wantStatus:  http.StatusOK,
			wantEnabled: true,
			wantResume:  1,
			wantStop:    0,
			wantExec:    true,
		},
		{
			name:       "disable stops worker and persists",
			body:       `{"enabled":false}`,
			wantStatus: http.StatusOK,
			wantStop:   1,
			wantExec:   true,
		},
		{
			name:        "persist failure still succeeds (best-effort)",
			body:        `{"enabled":true}`,
			execErr:     errors.New("db down"),
			wantStatus:  http.StatusOK,
			wantEnabled: true,
			wantResume:  1,
			wantExec:    true,
		},
		{
			name:       "malformed json rejected",
			body:       `{"enabled":`,
			wantStatus: http.StatusBadRequest,
			wantCode:   "BAD_REQUEST",
		},
		{
			name:       "empty body rejected",
			body:       ``,
			wantStatus: http.StatusBadRequest,
			wantCode:   "BAD_REQUEST",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			poller := newFakePoller()
			q := &fakeQuerier{execErr: tc.execErr}
			h := newHandler(q, poller)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/gas-price/toggle", strings.NewReader(tc.body))
			h.Toggle(rec, req)

			assertStatus(t, rec, tc.wantStatus)

			resume, stop, _ := poller.snapshot()
			execs := q.execSnapshot()

			if tc.wantStatus != http.StatusOK {
				assertErrorBody(t, rec, tc.wantCode)
				if resume != 0 || stop != 0 {
					t.Errorf("worker must not be toggled on bad input (resume=%d stop=%d)", resume, stop)
				}
				if len(execs) != 0 {
					t.Errorf("no persistence expected on bad input, got %d execs", len(execs))
				}
				return
			}

			if got := decodeMap(t, rec)["enabled"]; got != tc.wantEnabled {
				t.Errorf("enabled = %v, want %v", got, tc.wantEnabled)
			}
			if resume != tc.wantResume {
				t.Errorf("resume calls = %d, want %d", resume, tc.wantResume)
			}
			if stop != tc.wantStop {
				t.Errorf("stop calls = %d, want %d", stop, tc.wantStop)
			}
			if tc.wantExec {
				if len(execs) != 1 {
					t.Fatalf("expected 1 persist exec, got %d", len(execs))
				}
				if !strings.Contains(execs[0].sql, "gas_price_poll_state") {
					t.Errorf("exec sql missing target table: %q", execs[0].sql)
				}
				if len(execs[0].args) != 1 || execs[0].args[0] != tc.wantEnabled {
					t.Errorf("exec args = %v, want [%v]", execs[0].args, tc.wantEnabled)
				}
			}
		})
	}
}

func TestHandler_Toggle_NilDBSkipsPersistence(t *testing.T) {
	poller := newFakePoller()
	h := newHandler(nil, poller) // nil querier — persistToggle must no-op, not panic

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/gas-price/toggle", strings.NewReader(`{"enabled":true}`))
	h.Toggle(rec, req)

	assertStatus(t, rec, http.StatusOK)
	if resume, _, _ := poller.snapshot(); resume != 1 {
		t.Errorf("resume calls = %d, want 1", resume)
	}
}

// ---------------------------------------------------------------------------
// UpdateConfig
// ---------------------------------------------------------------------------

func TestHandler_UpdateConfig(t *testing.T) {
	tests := []struct {
		name          string
		body          string
		execErr       error
		wantStatus    int
		wantCode      string
		wantInterval  string
		wantSetCalled bool
		wantExec      bool
	}{
		{name: "daily", body: `{"poll_interval":"daily"}`, wantStatus: http.StatusOK, wantInterval: "daily", wantSetCalled: true, wantExec: true},
		{name: "7d", body: `{"poll_interval":"7d"}`, wantStatus: http.StatusOK, wantInterval: "7d", wantSetCalled: true, wantExec: true},
		{name: "15d", body: `{"poll_interval":"15d"}`, wantStatus: http.StatusOK, wantInterval: "15d", wantSetCalled: true, wantExec: true},
		{name: "30d", body: `{"poll_interval":"30d"}`, wantStatus: http.StatusOK, wantInterval: "30d", wantSetCalled: true, wantExec: true},
		{
			name:          "persist failure still succeeds",
			body:          `{"poll_interval":"daily"}`,
			execErr:       errors.New("db down"),
			wantStatus:    http.StatusOK,
			wantInterval:  "daily",
			wantSetCalled: true,
			wantExec:      true,
		},
		{name: "invalid interval rejected", body: `{"poll_interval":"hourly"}`, wantStatus: http.StatusBadRequest, wantCode: "BAD_REQUEST"},
		{name: "empty interval rejected", body: `{"poll_interval":""}`, wantStatus: http.StatusBadRequest, wantCode: "BAD_REQUEST"},
		{name: "malformed json rejected", body: `{`, wantStatus: http.StatusBadRequest, wantCode: "BAD_REQUEST"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			poller := newFakePoller()
			q := &fakeQuerier{execErr: tc.execErr}
			h := newHandler(q, poller)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPut, "/gas-price/config", strings.NewReader(tc.body))
			h.UpdateConfig(rec, req)

			assertStatus(t, rec, tc.wantStatus)

			_, _, intervals := poller.snapshot()
			execs := q.execSnapshot()

			if tc.wantStatus != http.StatusOK {
				assertErrorBody(t, rec, tc.wantCode)
				if len(intervals) != 0 {
					t.Errorf("SetPollInterval must not run on invalid input, got %v", intervals)
				}
				if len(execs) != 0 {
					t.Errorf("no persistence expected on invalid input, got %d execs", len(execs))
				}
				return
			}

			if got := decodeMap(t, rec)["poll_interval"]; got != tc.wantInterval {
				t.Errorf("poll_interval = %v, want %v", got, tc.wantInterval)
			}
			if tc.wantSetCalled {
				if len(intervals) != 1 || intervals[0] != tc.wantInterval {
					t.Errorf("SetPollInterval calls = %v, want [%q]", intervals, tc.wantInterval)
				}
			}
			if tc.wantExec {
				if len(execs) != 1 {
					t.Fatalf("expected 1 persist exec, got %d", len(execs))
				}
				if len(execs[0].args) != 1 || execs[0].args[0] != tc.wantInterval {
					t.Errorf("exec args = %v, want [%q]", execs[0].args, tc.wantInterval)
				}
			}
		})
	}
}

func TestHandler_UpdateConfig_NilDBSkipsPersistence(t *testing.T) {
	poller := newFakePoller()
	h := newHandler(nil, poller)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/gas-price/config", strings.NewReader(`{"poll_interval":"30d"}`))
	h.UpdateConfig(rec, req)

	assertStatus(t, rec, http.StatusOK)
	if _, _, intervals := poller.snapshot(); len(intervals) != 1 || intervals[0] != "30d" {
		t.Errorf("SetPollInterval = %v, want [30d]", intervals)
	}
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

func TestHandler_History(t *testing.T) {
	from1 := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)
	to1 := time.Date(2026, 1, 9, 0, 0, 0, 0, time.UTC)
	created1 := time.Date(2026, 1, 2, 0, 0, 1, 0, time.UTC)
	from2 := time.Date(2026, 1, 9, 0, 0, 0, 0, time.UTC)
	created2 := time.Date(2026, 1, 9, 0, 0, 1, 0, time.UTC)

	tests := []struct {
		name       string
		querier    *fakeQuerier
		nilDB      bool
		wantStatus int
		wantLen    int
		verify     func(t *testing.T, rows []gasPriceHistoryRow)
	}{
		{
			name: "two rows including open period",
			querier: &fakeQuerier{queryRows: newFakeRows([][]any{
				{int64(2), 3.79, "gallon", 26.0, from2, nil, created2},           // effective_to NULL (open)
				{int64(1), 3.59, "gallon", 25.0, from1, ptrTime(to1), created1}, // closed period
			})},
			wantStatus: http.StatusOK,
			wantLen:    2,
			verify: func(t *testing.T, rows []gasPriceHistoryRow) {
				if rows[0].ID != 2 || rows[0].PricePerUnit != 3.79 || rows[0].Unit != "gallon" {
					t.Errorf("row0 mismatch: %+v", rows[0])
				}
				if rows[0].EffectiveTo != nil {
					t.Errorf("row0 effective_to should be nil (open period), got %v", rows[0].EffectiveTo)
				}
				if rows[1].EffectiveTo == nil || !rows[1].EffectiveTo.Equal(to1) {
					t.Errorf("row1 effective_to = %v, want %v", rows[1].EffectiveTo, to1)
				}
				if rows[1].EfficiencyMPG != 25.0 {
					t.Errorf("row1 efficiency = %v, want 25", rows[1].EfficiencyMPG)
				}
			},
		},
		{
			name:       "empty result is [] not null",
			querier:    &fakeQuerier{queryRows: newFakeRows(nil)},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:       "query error -> 500",
			querier:    &fakeQuerier{queryErr: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "scan error -> 500",
			querier: &fakeQuerier{queryRows: &fakeRows{
				data:      [][]any{{int64(1), 3.59, "gallon", 25.0, from1, nil, created1}},
				cursor:    -1,
				scanErrAt: 0,
			}},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "row iteration error -> 500",
			querier: &fakeQuerier{queryRows: &fakeRows{
				data:      nil,
				cursor:    -1,
				scanErrAt: -1,
				iterErr:   errors.New("connection dropped mid-stream"),
			}},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "nil db degrades to empty array",
			nilDB:      true,
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			poller := newFakePoller()
			var h *Handler
			if tc.nilDB {
				h = newHandler(nil, poller)
			} else {
				h = newHandler(tc.querier, poller)
			}

			rec := httptest.NewRecorder()
			h.History(rec, httptest.NewRequest(http.MethodGet, "/gas-price/history", nil))

			assertStatus(t, rec, tc.wantStatus)

			if tc.wantStatus != http.StatusOK {
				assertErrorBody(t, rec, "INTERNAL_ERROR")
				return
			}

			// Success responses must always be a JSON array, never null.
			body := strings.TrimSpace(rec.Body.String())
			if strings.HasPrefix(body, "null") {
				t.Fatalf("history body must be an array, got null")
			}
			var rows []gasPriceHistoryRow
			if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if len(rows) != tc.wantLen {
				t.Fatalf("row count = %d, want %d", len(rows), tc.wantLen)
			}
			if tc.verify != nil {
				tc.verify(t, rows)
			}
		})
	}
}

func TestHandler_History_PaginationArgs(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
	}{
		{name: "defaults", query: "", wantLimit: 50, wantOffset: 0},
		{name: "explicit", query: "?limit=10&offset=20", wantLimit: 10, wantOffset: 20},
		{name: "over-cap falls back to default", query: "?limit=5000", wantLimit: 50, wantOffset: 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			q := &fakeQuerier{queryRows: newFakeRows(nil)}
			h := newHandler(q, newFakePoller())

			rec := httptest.NewRecorder()
			h.History(rec, httptest.NewRequest(http.MethodGet, "/gas-price/history"+tc.query, nil))

			assertStatus(t, rec, http.StatusOK)

			args := q.queryArgSnapshot()
			if len(args) != 2 {
				t.Fatalf("query args = %v, want [limit offset]", args)
			}
			if args[0] != tc.wantLimit {
				t.Errorf("limit arg = %v, want %d", args[0], tc.wantLimit)
			}
			if args[1] != tc.wantOffset {
				t.Errorf("offset arg = %v, want %d", args[1], tc.wantOffset)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// NewHandler — the public constructor's nil-tolerance contract.
// ---------------------------------------------------------------------------

func TestNewHandler_NilTolerant(t *testing.T) {
	realWorker := worker.NewGasPriceWorker(nil, config.GasPriceConfig{}, nil)

	tests := []struct {
		name string
		db   *database.DB
	}{
		{name: "nil db", db: nil},
		{name: "db with nil pool", db: &database.DB{}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := NewHandler(tc.db, realWorker)
			if h == nil {
				t.Fatal("NewHandler returned nil")
			}
			if h.db != nil {
				t.Errorf("expected nil querier for nil pool, got %v", h.db)
			}

			// History must degrade gracefully rather than panic on a nil pool.
			rec := httptest.NewRecorder()
			h.History(rec, httptest.NewRequest(http.MethodGet, "/gas-price/history", nil))
			assertStatus(t, rec, http.StatusOK)
			if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
				t.Errorf("history body = %q, want []", got)
			}
		})
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
