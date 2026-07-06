package apicalllog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// The concrete production repo MUST satisfy the interface the handler
// depends on. NewHandler already enforces this at compile time, but the
// explicit assertion documents the contract the fake below stands in for
// and fails the build early if the repo signature drifts.
var _ apiCallLogRepository = (*systemdb.APICallLogRepo)(nil)

// ---------- fake repo ----------

// getAllCall records the exact arguments the handler forwarded to
// GetAll so tests can assert the query-param → repo-arg wiring.
type getAllCall struct {
	limit, offset int
	method        string
	status        string
	endpoint      string
	service       string
	start         string
	end           string
}

type fakeAPICallLogRepo struct {
	// GetAll behaviour.
	logs  []*teslamodel.APICallLog
	total int
	err   error

	// GetStats behaviour.
	stats    map[string]interface{}
	statsErr error

	// Recorded invocations.
	gotGetAll   []getAllCall
	getStatsN   int
	getStatsCtx context.Context
}

func (f *fakeAPICallLogRepo) GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, startDate, endDate string) ([]*teslamodel.APICallLog, int, error) {
	f.gotGetAll = append(f.gotGetAll, getAllCall{
		limit:    limit,
		offset:   offset,
		method:   method,
		status:   statusFilter,
		endpoint: endpoint,
		service:  service,
		start:    startDate,
		end:      endDate,
	})
	if f.err != nil {
		return nil, 0, f.err
	}
	return f.logs, f.total, nil
}

func (f *fakeAPICallLogRepo) GetStats(ctx context.Context) (map[string]interface{}, error) {
	f.getStatsN++
	f.getStatsCtx = ctx
	if f.statsErr != nil {
		return nil, f.statsErr
	}
	return f.stats, nil
}

func newHandlerForTest(repo apiCallLogRepository) *Handler {
	return &Handler{repo: repo}
}

func strptr(s string) *string { return &s }

func int64ptr(v int64) *int64 { return &v }

// sampleLog builds a representative APICallLog for wire-shape assertions.
func sampleLog() *teslamodel.APICallLog {
	return &teslamodel.APICallLog{
		ID:           7,
		VehicleID:    int64ptr(42),
		Service:      "tesla-api",
		HTTPMethod:   http.MethodGet,
		Endpoint:     "/api/1/vehicles",
		StatusCode:   200,
		DurationMs:   123,
		ErrorMessage: strptr("none"),
		RateLimited:  false,
		RequestBody:  strptr("{}"),
		ResponseBody: strptr("{\"ok\":true}"),
	}
}

// ---------- List: query-param forwarding ----------

// TestHandler_List_QueryForwarding pins the contract that every supported
// query parameter is forwarded verbatim to the repo, and that pagination
// defaults / clamps flow through apiparams.Pagination. A regression that
// drops a filter, swaps two args, or forwards a camelCase key would break
// the observability UI silently — this catches it.
func TestHandler_List_QueryForwarding(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		query string
		want  getAllCall
	}{
		{
			name:  "defaults when no params",
			query: "",
			want:  getAllCall{limit: 50, offset: 0},
		},
		{
			name:  "custom pagination",
			query: "limit=10&offset=20",
			want:  getAllCall{limit: 10, offset: 20},
		},
		{
			name:  "all filters forwarded",
			query: "method=POST&status=5xx&endpoint=%2Fvehicles&service=fleet-api&start=2026-01-01&end=2026-02-01",
			want: getAllCall{
				limit: 50, offset: 0,
				method: http.MethodPost, status: "5xx",
				endpoint: "/vehicles", service: "fleet-api",
				start: "2026-01-01", end: "2026-02-01",
			},
		},
		{
			name:  "over-cap limit falls back to default",
			query: "limit=5000",
			want:  getAllCall{limit: 50, offset: 0},
		},
		{
			name:  "negative offset ignored",
			query: "offset=-5",
			want:  getAllCall{limit: 50, offset: 0},
		},
		{
			name:  "non-numeric limit ignored",
			query: "limit=abc",
			want:  getAllCall{limit: 50, offset: 0},
		},
		{
			name:  "boundary limit 1000 honored",
			query: "limit=1000",
			want:  getAllCall{limit: 1000, offset: 0},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeAPICallLogRepo{}
			h := newHandlerForTest(repo)

			rec := httptest.NewRecorder()
			target := "/api-logs"
			if c.query != "" {
				target += "?" + c.query
			}
			h.List(rec, httptest.NewRequest(http.MethodGet, target, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotGetAll) != 1 {
				t.Fatalf("GetAll call count = %d, want 1", len(repo.gotGetAll))
			}
			if got := repo.gotGetAll[0]; !reflect.DeepEqual(got, c.want) {
				t.Fatalf("forwarded args = %+v, want %+v", got, c.want)
			}
		})
	}
}

// ---------- List: success shape ----------

// TestHandler_List_Success verifies the 200 envelope: content-type, the
// data/total/limit/offset keys, and that the model round-trips through the
// JSON encoder with its snake_case field names intact.
func TestHandler_List_Success(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{
		logs:  []*teslamodel.APICallLog{sampleLog()},
		total: 137,
	}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-logs?limit=25&offset=50", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}

	var body struct {
		Data   []teslamodel.APICallLog `json:"data"`
		Total  int                     `json:"total"`
		Limit  int                     `json:"limit"`
		Offset int                     `json:"offset"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.Total != 137 {
		t.Errorf("total = %d, want 137", body.Total)
	}
	if body.Limit != 25 {
		t.Errorf("limit = %d, want 25", body.Limit)
	}
	if body.Offset != 50 {
		t.Errorf("offset = %d, want 50", body.Offset)
	}
	if len(body.Data) != 1 {
		t.Fatalf("data length = %d, want 1", len(body.Data))
	}
	got := body.Data[0]
	if got.ID != 7 || got.HTTPMethod != http.MethodGet || got.Endpoint != "/api/1/vehicles" || got.StatusCode != 200 {
		t.Errorf("data[0] mismatch: %+v", got)
	}
	// snake_case wire keys the observability UI reads must be present.
	for _, key := range []string{"http_method", "status_code", "duration_ms", "vehicle_id"} {
		if !strings.Contains(rec.Body.String(), "\""+key+"\"") {
			t.Errorf("response missing wire key %q\nbody=%s", key, rec.Body.String())
		}
	}
}

// TestHandler_List_NilLogsBecomeEmptyArray guards the explicit nil→[]
// normalisation: a repo that returns a nil slice (no rows) must still
// serialise as "data":[] so the frontend can .map() without a null guard.
func TestHandler_List_NilLogsBecomeEmptyArray(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{logs: nil, total: 0}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-logs", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "\"data\":[]") {
		t.Errorf("expected empty data array, got body=%s", body)
	}
	if strings.Contains(body, "\"data\":null") {
		t.Errorf("data must not serialise as null: %s", body)
	}
}

// TestHandler_List_RepoError verifies the 500 error envelope shape on a
// repo failure and that no partial success envelope leaks through.
func TestHandler_List_RepoError(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{err: errors.New("db exploded")}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.List(rec, httptest.NewRequest(http.MethodGet, "/api-logs", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.Error != "failed to list api call logs" {
		t.Errorf("error = %q, want 'failed to list api call logs'", body.Error)
	}
	if body.Code != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body.Code)
	}
	// The internal error text must not leak to the client.
	if strings.Contains(rec.Body.String(), "db exploded") {
		t.Errorf("internal error text leaked to client: %s", rec.Body.String())
	}
}

// TestHandler_List_ContextPropagated confirms the request context reaches
// the repo (so downstream query cancellation / deadlines are honoured).
func TestHandler_List_ContextPropagated(t *testing.T) {
	t.Parallel()
	type ctxKey string
	const k ctxKey = "trace"

	var gotCtx context.Context
	repo := &fakeAPICallLogRepo{}
	// Wrap GetAll capture via a closure-backed fake.
	capturing := &ctxCapturingRepo{
		fakeAPICallLogRepo: repo,
		onGetAll:           func(ctx context.Context) { gotCtx = ctx },
	}
	h := newHandlerForTest(capturing)

	req := httptest.NewRequest(http.MethodGet, "/api-logs", nil)
	req = req.WithContext(context.WithValue(req.Context(), k, "abc"))
	h.List(httptest.NewRecorder(), req)

	if gotCtx == nil {
		t.Fatal("repo never received a context")
	}
	if v, _ := gotCtx.Value(k).(string); v != "abc" {
		t.Errorf("request context not propagated to repo; got %v", gotCtx.Value(k))
	}
}

// ctxCapturingRepo lets a test observe the context passed to GetAll while
// delegating all other behaviour to the embedded fake.
type ctxCapturingRepo struct {
	*fakeAPICallLogRepo
	onGetAll func(ctx context.Context)
}

func (c *ctxCapturingRepo) GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, startDate, endDate string) ([]*teslamodel.APICallLog, int, error) {
	if c.onGetAll != nil {
		c.onGetAll(ctx)
	}
	return c.fakeAPICallLogRepo.GetAll(ctx, limit, offset, method, statusFilter, endpoint, service, startDate, endDate)
}

// ---------- Stats ----------

// TestHandler_Stats_Success verifies the stats map is passed through
// verbatim with a 200 and the JSON content-type.
func TestHandler_Stats_Success(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{
		stats: map[string]interface{}{
			"total_calls":     1000,
			"error_count":     10,
			"error_rate":      1.0,
			"avg_duration_ms": 42.5,
			"last_24h":        7,
			"by_method":       map[string]int{"GET": 900, "POST": 100},
			"by_service":      map[string]int{"tesla-api": 1000},
		},
	}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/api-logs/stats", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}
	if repo.getStatsN != 1 {
		t.Errorf("GetStats call count = %d, want 1", repo.getStatsN)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if got := body["total_calls"]; got != float64(1000) {
		t.Errorf("total_calls = %v, want 1000", got)
	}
	if got := body["error_rate"]; got != float64(1.0) {
		t.Errorf("error_rate = %v, want 1", got)
	}
	byMethod, ok := body["by_method"].(map[string]interface{})
	if !ok {
		t.Fatalf("by_method missing or wrong type: %T", body["by_method"])
	}
	if byMethod["GET"] != float64(900) {
		t.Errorf("by_method[GET] = %v, want 900", byMethod["GET"])
	}
}

// TestHandler_Stats_EmptyMap ensures an empty (but non-nil) stats map
// serialises as {} rather than null.
func TestHandler_Stats_EmptyMap(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{stats: map[string]interface{}{}}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/api-logs/stats", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "{}" {
		t.Errorf("body = %q, want {}", got)
	}
}

// TestHandler_Stats_RepoError verifies the 500 error envelope on a repo
// failure and that the internal error text is not leaked.
func TestHandler_Stats_RepoError(t *testing.T) {
	t.Parallel()
	repo := &fakeAPICallLogRepo{statsErr: errors.New("aggregate query failed")}
	h := newHandlerForTest(repo)

	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/api-logs/stats", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.Error != "failed to get api call log stats" {
		t.Errorf("error = %q, want 'failed to get api call log stats'", body.Error)
	}
	if body.Code != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body.Code)
	}
	if strings.Contains(rec.Body.String(), "aggregate query failed") {
		t.Errorf("internal error text leaked to client: %s", rec.Body.String())
	}
}

// TestHandler_Stats_ContextPropagated confirms the request context reaches
// the repo GetStats call.
func TestHandler_Stats_ContextPropagated(t *testing.T) {
	t.Parallel()
	type ctxKey string
	const k ctxKey = "trace"

	repo := &fakeAPICallLogRepo{stats: map[string]interface{}{}}
	h := newHandlerForTest(repo)

	req := httptest.NewRequest(http.MethodGet, "/api-logs/stats", nil)
	req = req.WithContext(context.WithValue(req.Context(), k, "xyz"))
	h.Stats(httptest.NewRecorder(), req)

	if repo.getStatsCtx == nil {
		t.Fatal("repo never received a context")
	}
	if v, _ := repo.getStatsCtx.Value(k).(string); v != "xyz" {
		t.Errorf("request context not propagated to repo; got %v", repo.getStatsCtx.Value(k))
	}
}

// TestNewHandler_NotNil is a light constructor smoke test: NewHandler must
// return a non-nil handler with a wired repo so the router can mount it.
func TestNewHandler_NotNil(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil)
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("NewHandler left repo unset")
	}
}
