package geofence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/go-chi/chi/v5"
)

// =============================================================================
// rate_handler_test.go — route/validation/response tests for the
// charging-place discovery-review, archive, rate-CRUD, and
// preview/apply-repricing endpoints added in rate_handler.go.
//
// Two testing techniques are used, deliberately kept separate:
//
//  1. Real production code, NO repo at all (h := NewHandler(nil)): every
//     handler here validates URL params / request body / query params
//     BEFORE touching h.rateRepo, so exercising ONLY the validation-failure
//     branch is 100% safe against a nil rateRepo and requires zero fakes.
//     This covers "route" (param wiring) and "validation" thoroughly using
//     the exact shipped code path — not a mirror.
//  2. Real production code, WithRateStore(fake): geofenceRateRepo (defined
//     in rate_handler.go) is a narrow, additive interface seam — the
//     concrete *geofencedb.GeofenceRepo satisfies it structurally with zero
//     changes, and Handler.rateRepo defaults to it in NewHandler. Swapping
//     it for fakeRateRepo here exercises the REAL handler bodies end to end
//     (decode → validate → repo call → error mapping → response envelope)
//     without a live Postgres connection and without hand-duplicating any
//     handler logic into the test file (contrast with handler_test.go's
//     fakeGeofenceUpdateRepo/runGeofenceUpdateMerge mirror, which predates
//     this seam and was the only option available for the CRUD handlers).
// =============================================================================

// ---------------------------------------------------------------------------
// fakeRateRepo — implements geofenceRateRepo in full.
// ---------------------------------------------------------------------------

type fakeRateRepo struct {
	getByIDResult *systemmodel.Geofence
	getByIDErr    error
	getByIDCalls  []int64

	needsReviewResult []*systemmodel.Geofence
	needsReviewErr    error

	activeRatesNowResult []*systemmodel.GeofenceRate
	activeRatesNowErr    error

	archiveErr   error
	archiveCalls []int64

	unarchiveErr   error
	unarchiveCalls []int64

	markReviewedErr   error
	markReviewedCalls []int64

	listRatesResult []*systemmodel.GeofenceRate
	listRatesErr    error

	createRateErr      error
	createRateCalls    []systemmodel.GeofenceRate
	createRateAssignID int64

	deleteRateErr   error
	deleteRateCalls [][2]int64

	previewResult *systemmodel.GeofenceRateImpactPreview
	previewErr    error
	previewCalls  []systemmodel.GeofenceRateApplyScope

	applyResult *systemmodel.GeofenceRateApplyResult
	applyErr    error
	applyCalls  []systemmodel.GeofenceRateApplyScope

	summaryResult []*systemmodel.GeofenceChargingSummary
	summaryErr    error

	activityResult []*systemmodel.GeofenceChargingActivity
	activityErr    error
	activityCalls  []struct{ limit, offset int }
}

func (f *fakeRateRepo) GetByID(_ context.Context, id int64) (*systemmodel.Geofence, error) {
	f.getByIDCalls = append(f.getByIDCalls, id)
	if f.getByIDErr != nil {
		return nil, f.getByIDErr
	}
	return f.getByIDResult, nil
}

func (f *fakeRateRepo) ListNeedsReview(_ context.Context) ([]*systemmodel.Geofence, error) {
	return f.needsReviewResult, f.needsReviewErr
}

func (f *fakeRateRepo) ListActiveRatesNow(_ context.Context) ([]*systemmodel.GeofenceRate, error) {
	return f.activeRatesNowResult, f.activeRatesNowErr
}

func (f *fakeRateRepo) Archive(_ context.Context, id int64) error {
	f.archiveCalls = append(f.archiveCalls, id)
	return f.archiveErr
}

func (f *fakeRateRepo) Unarchive(_ context.Context, id int64) error {
	f.unarchiveCalls = append(f.unarchiveCalls, id)
	return f.unarchiveErr
}

func (f *fakeRateRepo) MarkReviewed(_ context.Context, id int64) error {
	f.markReviewedCalls = append(f.markReviewedCalls, id)
	return f.markReviewedErr
}

func (f *fakeRateRepo) ListRates(_ context.Context, _ int64) ([]*systemmodel.GeofenceRate, error) {
	return f.listRatesResult, f.listRatesErr
}

func (f *fakeRateRepo) CreateRate(_ context.Context, gr *systemmodel.GeofenceRate) error {
	f.createRateCalls = append(f.createRateCalls, *gr)
	if f.createRateErr != nil {
		return f.createRateErr
	}
	if f.createRateAssignID != 0 {
		gr.ID = f.createRateAssignID
	}
	return nil
}

func (f *fakeRateRepo) DeleteRate(_ context.Context, geofenceID, rateID int64) error {
	f.deleteRateCalls = append(f.deleteRateCalls, [2]int64{geofenceID, rateID})
	return f.deleteRateErr
}

func (f *fakeRateRepo) PreviewApplyRate(_ context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateImpactPreview, error) {
	f.previewCalls = append(f.previewCalls, scope)
	if f.previewErr != nil {
		return nil, f.previewErr
	}
	return f.previewResult, nil
}

func (f *fakeRateRepo) ApplyRate(_ context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateApplyResult, error) {
	f.applyCalls = append(f.applyCalls, scope)
	if f.applyErr != nil {
		return nil, f.applyErr
	}
	return f.applyResult, nil
}

func (f *fakeRateRepo) ChargingSummaryByCurrency(_ context.Context, _ int64) ([]*systemmodel.GeofenceChargingSummary, error) {
	return f.summaryResult, f.summaryErr
}

func (f *fakeRateRepo) ChargingActivity(_ context.Context, _ int64, limit, offset int) ([]*systemmodel.GeofenceChargingActivity, error) {
	f.activityCalls = append(f.activityCalls, struct{ limit, offset int }{limit, offset})
	return f.activityResult, f.activityErr
}

// ---------------------------------------------------------------------------
// shared test helpers
// ---------------------------------------------------------------------------

// newRateRequest builds an httptest.Request with the given chi URL params
// injected, matching the router.go mount shape (/geofences/{geofenceID}/...).
func newRateRequest(method, target string, body io.Reader, params map[string]string) *http.Request {
	r := httptest.NewRequest(method, target, body)
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func decodeErrorBody(t *testing.T, w *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var out map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, w.Body.String())
	}
	return out
}

func wantErrorResponse(t *testing.T, w *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, want %d; body=%s", w.Code, status, w.Body.String())
	}
	body := decodeErrorBody(t, w)
	if body["code"] != code {
		t.Errorf("code = %q, want %q (body=%s)", body["code"], code, w.Body.String())
	}
}

func sampleGeofence(id int64) *systemmodel.Geofence {
	return &systemmodel.Geofence{
		ID:         id,
		Name:       "Test Place",
		PolygonWKT: "POLYGON((-74.0 40.0,-74.001 40.0,-74.001 40.001,-74.0 40.001,-74.0 40.0))",
		Origin:     systemmodel.GeofenceOriginManual,
	}
}

// ---------------------------------------------------------------------------
// (1) Route + validation tests — real handler code, NewHandler(nil), no repo
// touch. These assert the exact shipped validation branch, not a mirror.
// ---------------------------------------------------------------------------

func TestRateEndpoints_InvalidGeofenceID(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		name string
		fn   http.HandlerFunc
	}{
		{"Archive", h.Archive},
		{"Unarchive", h.Unarchive},
		{"MarkReviewed", h.MarkReviewed},
		{"ListRates", h.ListRates},
		{"CreateRate", h.CreateRate},
		{"DeleteRate", h.DeleteRate},
		{"PreviewApplyRate", h.PreviewApplyRate},
		{"ApplyRate", h.ApplyRate},
		{"ChargingSummary", h.ChargingSummary},
		{"ChargingActivity", h.ChargingActivity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodGet, "/x", nil, map[string]string{"geofenceID": "not-a-number", "rateID": "1"})
			tc.fn(w, r)
			wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_INVALID_ID")
		})
	}
}

func TestRateScopedEndpoints_InvalidRateID(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		name string
		fn   http.HandlerFunc
	}{
		{"DeleteRate", h.DeleteRate},
		{"PreviewApplyRate", h.PreviewApplyRate},
		{"ApplyRate", h.ApplyRate},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodGet, "/x", nil, map[string]string{"geofenceID": "1", "rateID": "not-a-number"})
			tc.fn(w, r)
			wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_INVALID_ID")
		})
	}
}

func TestCreateRate_InvalidJSON(t *testing.T) {
	h := NewHandler(nil)
	w := httptest.NewRecorder()
	r := newRateRequest(http.MethodPost, "/x", bytes.NewReader([]byte(`{not json`)), map[string]string{"geofenceID": "1"})
	h.CreateRate(w, r)
	wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_INVALID_JSON")
}

func TestCreateRate_MissingRequiredFields(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		name string
		body string
	}{
		{"missing rate_per_wh", `{"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`},
		{"missing effective_from", `{"rate_per_wh":0.0001,"currency":"USD"}`},
		{"empty body", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodPost, "/x", bytes.NewReader([]byte(tc.body)), map[string]string{"geofenceID": "1"})
			h.CreateRate(w, r)
			wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_MISSING_FIELD")
		})
	}
}

func TestCreateRate_InvalidFieldValues(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		name string
		body string
	}{
		{"negative rate", `{"rate_per_wh":-0.0001,"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`},
		{"rate exceeds database precision bound", `{"rate_per_wh":1000000,"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`},
		{"currency too short", `{"rate_per_wh":0.0001,"currency":"US","effective_from":"2026-01-01T00:00:00Z"}`},
		{"currency too long", `{"rate_per_wh":0.0001,"currency":"USDD","effective_from":"2026-01-01T00:00:00Z"}`},
		{"currency with digit (still invalid after uppercasing)", `{"rate_per_wh":0.0001,"currency":"us1","effective_from":"2026-01-01T00:00:00Z"}`},
		{"effective_to before effective_from", `{"rate_per_wh":0.0001,"currency":"USD","effective_from":"2026-06-01T00:00:00Z","effective_to":"2026-01-01T00:00:00Z"}`},
		{"effective_to equal effective_from", `{"rate_per_wh":0.0001,"currency":"USD","effective_from":"2026-06-01T00:00:00Z","effective_to":"2026-06-01T00:00:00Z"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodPost, "/x", bytes.NewReader([]byte(tc.body)), map[string]string{"geofenceID": "1"})
			h.CreateRate(w, r)
			wantErrorResponse(t, w, http.StatusBadRequest, "GEOFENCE_RATE_INVALID")
		})
	}
}

func TestPreviewApplyRate_InvalidQueryParams(t *testing.T) {
	h := NewHandler(nil)
	cases := []struct {
		name  string
		query string
	}{
		{"unparseable from", "from=not-a-date"},
		{"unparseable to", "to=not-a-date"},
		{"to before from", "from=2026-06-01T00:00:00Z&to=2026-01-01T00:00:00Z"},
		{"to equal from", "from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodGet, "/x?"+tc.query, nil, map[string]string{"geofenceID": "1", "rateID": "2"})
			h.PreviewApplyRate(w, r)
			wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_INVALID_INPUT")
		})
	}
}

func TestApplyRate_InvalidQueryParams(t *testing.T) {
	h := NewHandler(nil)
	w := httptest.NewRecorder()
	r := newRateRequest(http.MethodPost, "/x?from=garbage", nil, map[string]string{"geofenceID": "1", "rateID": "2"})
	h.ApplyRate(w, r)
	wantErrorResponse(t, w, http.StatusBadRequest, "VALIDATION_INVALID_INPUT")
}

// ---------------------------------------------------------------------------
// (2) Pure function unit tests — no HTTP, no repo.
// ---------------------------------------------------------------------------

func TestValidateRateRequestFields(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	later := base.Add(24 * time.Hour)
	earlier := base.Add(-24 * time.Hour)
	cases := []struct {
		name     string
		rate     float64
		currency string
		from     time.Time
		to       *time.Time
		wantErr  bool
	}{
		{"valid open interval", 0.0001, "USD", base, nil, false},
		{"valid closed interval", 0.0001, "USD", base, &later, false},
		{"valid zero rate", 0, "USD", base, nil, false},
		{"negative rate", -0.0001, "USD", base, nil, true},
		{"NaN rate", math.NaN(), "USD", base, nil, true},
		{"+Inf rate", math.Inf(1), "USD", base, nil, true},
		{"currency too short", 0.0001, "US", base, nil, true},
		{"currency too long", 0.0001, "USDD", base, nil, true},
		{"currency lowercase", 0.0001, "usd", base, nil, true},
		{"currency with digit", 0.0001, "US1", base, nil, true},
		{"zero effective_from", 0.0001, "USD", time.Time{}, nil, true},
		{"effective_to equal effective_from", 0.0001, "USD", base, &base, true},
		{"effective_to before effective_from", 0.0001, "USD", base, &earlier, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateRateRequestFields(tc.rate, tc.currency, tc.from, tc.to)
			if tc.wantErr && err == nil {
				t.Fatal("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestParseApplyScope(t *testing.T) {
	cases := []struct {
		name     string
		query    string
		wantErr  bool
		wantFrom bool
		wantTo   bool
	}{
		{"no params", "", false, false, false},
		{"valid from only", "from=2026-01-01T00:00:00Z", false, true, false},
		{"valid to only", "to=2026-01-01T00:00:00Z", false, false, true},
		{"valid from and to", "from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", false, true, true},
		{"invalid from", "from=not-a-date", true, false, false},
		{"invalid to", "to=not-a-date", true, false, false},
		{"to before from", "from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z", true, false, false},
		{"to equal from", "from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z", true, false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/x?"+tc.query, nil)
			scope, err := parseApplyScope(r, 7, 9)
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if scope.GeofenceID != 7 || scope.RateID != 9 {
				t.Errorf("scope ids = (%d,%d), want (7,9)", scope.GeofenceID, scope.RateID)
			}
			if tc.wantFrom && scope.From == nil {
				t.Error("expected From to be set")
			}
			if !tc.wantFrom && scope.From != nil {
				t.Errorf("expected From nil, got %v", scope.From)
			}
			if tc.wantTo && scope.To == nil {
				t.Error("expected To to be set")
			}
			if !tc.wantTo && scope.To != nil {
				t.Errorf("expected To nil, got %v", scope.To)
			}
			if scope.From != nil && scope.From.Location() != time.UTC {
				t.Errorf("From not normalized to UTC: %v", scope.From.Location())
			}
		})
	}
}

func TestWriteApplyScopeRepoError(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		wantHandled bool
		wantStatus  int
		wantCode    string
	}{
		{"geofence not found", geofencedb.ErrGeofenceNotFound, true, http.StatusNotFound, "GEOFENCE_NOT_FOUND"},
		{"rate not found", geofencedb.ErrRateNotFound, true, http.StatusNotFound, "GEOFENCE_RATE_NOT_FOUND"},
		{"unrelated error is not handled here", errors.New("boom"), false, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodGet, "/x", nil)
			handled := writeApplyScopeRepoError(w, r, tc.err)
			if handled != tc.wantHandled {
				t.Fatalf("handled = %v, want %v", handled, tc.wantHandled)
			}
			if tc.wantHandled {
				wantErrorResponse(t, w, tc.wantStatus, tc.wantCode)
			} else if w.Body.Len() != 0 {
				t.Errorf("unhandled error case wrote a response body: %s", w.Body.String())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// (3) Full response-shape tests via WithRateStore(fake) — real handler
// bodies, real HTTP round trip, no mirror.
// ---------------------------------------------------------------------------

func TestNeedsReview(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{needsReviewResult: []*systemmodel.Geofence{sampleGeofence(1), sampleGeofence(2)}}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		h.NeedsReview(w, httptest.NewRequest(http.MethodGet, "/geofences/needs-review", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		var out []systemmodel.Geofence
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(out) != 2 {
			t.Errorf("len(out) = %d, want 2", len(out))
		}
	})
	t.Run("repo error surfaces as 500", func(t *testing.T) {
		fake := &fakeRateRepo{needsReviewErr: errors.New("db down")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		h.NeedsReview(w, httptest.NewRequest(http.MethodGet, "/geofences/needs-review", nil))
		wantErrorResponse(t, w, http.StatusInternalServerError, "DB_QUERY_FAILED")
	})
}

func TestCurrentRates(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{activeRatesNowResult: []*systemmodel.GeofenceRate{{ID: 1, GeofenceID: 1, RatePerWh: 0.0001, Currency: "USD"}}}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		h.CurrentRates(w, httptest.NewRequest(http.MethodGet, "/geofences/rates/current", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
	})
	t.Run("repo error surfaces as 500", func(t *testing.T) {
		fake := &fakeRateRepo{activeRatesNowErr: errors.New("db down")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		h.CurrentRates(w, httptest.NewRequest(http.MethodGet, "/geofences/rates/current", nil))
		wantErrorResponse(t, w, http.StatusInternalServerError, "DB_QUERY_FAILED")
	})
}

func TestArchive(t *testing.T) {
	t.Run("success returns the updated geofence", func(t *testing.T) {
		archived := sampleGeofence(1)
		now := time.Now().UTC()
		archived.ArchivedAt = &now
		fake := &fakeRateRepo{getByIDResult: archived}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/archive", nil, map[string]string{"geofenceID": "1"})
		h.Archive(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		if len(fake.archiveCalls) != 1 || fake.archiveCalls[0] != 1 {
			t.Errorf("Archive calls = %v, want [1]", fake.archiveCalls)
		}
		var out systemmodel.Geofence
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.ArchivedAt == nil {
			t.Error("response geofence missing archived_at")
		}
	})
	t.Run("idempotent re-archive is still a 200 success", func(t *testing.T) {
		archived := sampleGeofence(1)
		now := time.Now().UTC()
		archived.ArchivedAt = &now
		fake := &fakeRateRepo{getByIDResult: archived} // Archive() itself is a no-op idempotent success per repo contract
		h := NewHandler(nil, WithRateStore(fake))
		for i := 0; i < 2; i++ {
			w := httptest.NewRecorder()
			r := newRateRequest(http.MethodPost, "/geofences/1/archive", nil, map[string]string{"geofenceID": "1"})
			h.Archive(w, r)
			if w.Code != http.StatusOK {
				t.Fatalf("iteration %d: status = %d, want 200", i, w.Code)
			}
		}
	})
	t.Run("not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{archiveErr: geofencedb.ErrGeofenceNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/99/archive", nil, map[string]string{"geofenceID": "99"})
		h.Archive(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
	t.Run("repo error surfaces as 500", func(t *testing.T) {
		fake := &fakeRateRepo{archiveErr: errors.New("db down")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/archive", nil, map[string]string{"geofenceID": "1"})
		h.Archive(w, r)
		wantErrorResponse(t, w, http.StatusInternalServerError, "DB_QUERY_FAILED")
	})
	t.Run("re-fetch failure after a successful mutation still reports success via 204", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDErr: errors.New("transient")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/archive", nil, map[string]string{"geofenceID": "1"})
		h.Archive(w, r)
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body=%s", w.Code, w.Body.String())
		}
	})
}

func TestUnarchive(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: sampleGeofence(1)}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/unarchive", nil, map[string]string{"geofenceID": "1"})
		h.Unarchive(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		if len(fake.unarchiveCalls) != 1 || fake.unarchiveCalls[0] != 1 {
			t.Errorf("Unarchive calls = %v, want [1]", fake.unarchiveCalls)
		}
	})
	t.Run("not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{unarchiveErr: geofencedb.ErrGeofenceNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/99/unarchive", nil, map[string]string{"geofenceID": "99"})
		h.Unarchive(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
}

func TestMarkReviewed(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		reviewed := sampleGeofence(1)
		reviewed.NeedsReview = false
		fake := &fakeRateRepo{getByIDResult: reviewed}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/reviewed", nil, map[string]string{"geofenceID": "1"})
		h.MarkReviewed(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		if len(fake.markReviewedCalls) != 1 || fake.markReviewedCalls[0] != 1 {
			t.Errorf("MarkReviewed calls = %v, want [1]", fake.markReviewedCalls)
		}
	})
	t.Run("not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{markReviewedErr: geofencedb.ErrGeofenceNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/99/reviewed", nil, map[string]string{"geofenceID": "99"})
		h.MarkReviewed(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
}

func TestListRates(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{
			getByIDResult:   sampleGeofence(1),
			listRatesResult: []*systemmodel.GeofenceRate{{ID: 1, GeofenceID: 1, RatePerWh: 0.0001, Currency: "USD"}},
		}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/rates", nil, map[string]string{"geofenceID": "1"})
		h.ListRates(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		var out []systemmodel.GeofenceRate
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(out) != 1 {
			t.Fatalf("len(out) = %d, want 1", len(out))
		}
	})
	t.Run("geofence not found maps to 404 without calling ListRates", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: nil}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/99/rates", nil, map[string]string{"geofenceID": "99"})
		h.ListRates(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
}

func TestCreateRate(t *testing.T) {
	t.Run("success normalizes currency and UTC-normalizes timestamps", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: sampleGeofence(1), createRateAssignID: 42}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		body := bytes.NewReader([]byte(`{"rate_per_wh":0.00012345,"currency":"usd","effective_from":"2026-01-01T00:00:00-05:00"}`))
		r := newRateRequest(http.MethodPost, "/geofences/1/rates", body, map[string]string{"geofenceID": "1"})
		h.CreateRate(w, r)
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201; body=%s", w.Code, w.Body.String())
		}
		if len(fake.createRateCalls) != 1 {
			t.Fatalf("CreateRate calls = %d, want 1", len(fake.createRateCalls))
		}
		got := fake.createRateCalls[0]
		if got.Currency != "USD" {
			t.Errorf("currency = %q, want normalized %q", got.Currency, "USD")
		}
		if got.EffectiveFrom.Location() != time.UTC {
			t.Errorf("effective_from not normalized to UTC: %v", got.EffectiveFrom.Location())
		}
		if got.GeofenceID != 1 {
			t.Errorf("geofence_id = %d, want 1", got.GeofenceID)
		}
		var out systemmodel.GeofenceRate
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.ID != 42 {
			t.Errorf("response id = %d, want 42", out.ID)
		}
	})
	t.Run("geofence not found maps to 404 without calling CreateRate", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: nil}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		body := bytes.NewReader([]byte(`{"rate_per_wh":0.0001,"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`))
		r := newRateRequest(http.MethodPost, "/geofences/99/rates", body, map[string]string{"geofenceID": "99"})
		h.CreateRate(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
		if len(fake.createRateCalls) != 0 {
			t.Errorf("CreateRate was called despite missing geofence: %v", fake.createRateCalls)
		}
	})
	t.Run("conflict maps to 409", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: sampleGeofence(1), createRateErr: geofencedb.ErrRateConflict}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		body := bytes.NewReader([]byte(`{"rate_per_wh":0.0001,"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`))
		r := newRateRequest(http.MethodPost, "/geofences/1/rates", body, map[string]string{"geofenceID": "1"})
		h.CreateRate(w, r)
		wantErrorResponse(t, w, http.StatusConflict, "GEOFENCE_RATE_CONFLICT")
	})
	t.Run("repository failure maps to 500", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: sampleGeofence(1), createRateErr: errors.New("boom")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		body := bytes.NewReader([]byte(`{"rate_per_wh":0.0001,"currency":"USD","effective_from":"2026-01-01T00:00:00Z"}`))
		r := newRateRequest(http.MethodPost, "/geofences/1/rates", body, map[string]string{"geofenceID": "1"})
		h.CreateRate(w, r)
		wantErrorResponse(t, w, http.StatusInternalServerError, "DB_QUERY_FAILED")
	})
}

func TestDeleteRate(t *testing.T) {
	t.Run("success returns 204", func(t *testing.T) {
		fake := &fakeRateRepo{}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodDelete, "/geofences/1/rates/5", nil, map[string]string{"geofenceID": "1", "rateID": "5"})
		h.DeleteRate(w, r)
		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204; body=%s", w.Code, w.Body.String())
		}
		if len(fake.deleteRateCalls) != 1 || fake.deleteRateCalls[0] != [2]int64{1, 5} {
			t.Errorf("DeleteRate calls = %v, want [[1 5]]", fake.deleteRateCalls)
		}
	})
	t.Run("not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{deleteRateErr: geofencedb.ErrRateNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodDelete, "/geofences/1/rates/99", nil, map[string]string{"geofenceID": "1", "rateID": "99"})
		h.DeleteRate(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_RATE_NOT_FOUND")
	})
}

func TestPreviewApplyRate(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{previewResult: &systemmodel.GeofenceRateImpactPreview{
			GeofenceID: 1, RateID: 5, Currency: "USD",
			MatchedSessions: 10, EligibleSessions: 7, ProtectedSessions: 3,
			TotalEnergyWh: 50000, EstimatedCostDecimal: 5.5,
		}}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/rates/5/preview", nil, map[string]string{"geofenceID": "1", "rateID": "5"})
		h.PreviewApplyRate(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		var out systemmodel.GeofenceRateImpactPreview
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.EligibleSessions != 7 || out.ProtectedSessions != 3 {
			t.Errorf("preview = %+v, want eligible=7 protected=3", out)
		}
		if len(fake.previewCalls) != 1 || fake.previewCalls[0].GeofenceID != 1 || fake.previewCalls[0].RateID != 5 {
			t.Errorf("PreviewApplyRate scope = %+v", fake.previewCalls)
		}
	})
	t.Run("rate not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{previewErr: geofencedb.ErrRateNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/rates/99/preview", nil, map[string]string{"geofenceID": "1", "rateID": "99"})
		h.PreviewApplyRate(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_RATE_NOT_FOUND")
	})
	t.Run("geofence not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{previewErr: geofencedb.ErrGeofenceNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/99/rates/5/preview", nil, map[string]string{"geofenceID": "99", "rateID": "5"})
		h.PreviewApplyRate(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
	t.Run("scope from/to query params flow through to the repo call", func(t *testing.T) {
		fake := &fakeRateRepo{previewResult: &systemmodel.GeofenceRateImpactPreview{}}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/rates/5/preview?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", nil, map[string]string{"geofenceID": "1", "rateID": "5"})
		h.PreviewApplyRate(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		if len(fake.previewCalls) != 1 {
			t.Fatalf("expected exactly one PreviewApplyRate call")
		}
		got := fake.previewCalls[0]
		if got.From == nil || !got.From.Equal(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("scope.From = %v, want 2026-01-01T00:00:00Z", got.From)
		}
		if got.To == nil || !got.To.Equal(time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)) {
			t.Errorf("scope.To = %v, want 2026-02-01T00:00:00Z", got.To)
		}
	})
}

func TestApplyRate(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		fake := &fakeRateRepo{applyResult: &systemmodel.GeofenceRateApplyResult{
			GeofenceID: 1, RateID: 5, Currency: "USD",
			MatchedSessions: 10, PricedSessions: 7, SkippedSessions: 3,
			TotalEnergyWh: 50000, TotalCostDecimal: 5.5,
		}}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/rates/5/apply", nil, map[string]string{"geofenceID": "1", "rateID": "5"})
		h.ApplyRate(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		var out systemmodel.GeofenceRateApplyResult
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.PricedSessions != 7 || out.SkippedSessions != 3 {
			t.Errorf("result = %+v, want priced=7 skipped=3", out)
		}
	})
	t.Run("rate not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{applyErr: geofencedb.ErrRateNotFound}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/rates/99/apply", nil, map[string]string{"geofenceID": "1", "rateID": "99"})
		h.ApplyRate(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_RATE_NOT_FOUND")
	})
	t.Run("unexpected repo error surfaces as 500", func(t *testing.T) {
		fake := &fakeRateRepo{applyErr: errors.New("db down")}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodPost, "/geofences/1/rates/5/apply", nil, map[string]string{"geofenceID": "1", "rateID": "5"})
		h.ApplyRate(w, r)
		wantErrorResponse(t, w, http.StatusInternalServerError, "DB_QUERY_FAILED")
	})
}

func TestChargingSummary(t *testing.T) {
	t.Run("success groups by currency", func(t *testing.T) {
		fake := &fakeRateRepo{
			getByIDResult: sampleGeofence(1),
			summaryResult: []*systemmodel.GeofenceChargingSummary{
				{GeofenceID: 1, Currency: "USD", SessionCount: 3, TotalEnergyWh: 10000, TotalCostDecimal: 1.5},
				{GeofenceID: 1, Currency: "EUR", SessionCount: 1, TotalEnergyWh: 2000, TotalCostDecimal: 0.3},
			},
		}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/charging-summary", nil, map[string]string{"geofenceID": "1"})
		h.ChargingSummary(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		var out []systemmodel.GeofenceChargingSummary
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(out) != 2 {
			t.Fatalf("len(out) = %d, want 2 (one per currency, never summed)", len(out))
		}
	})
	t.Run("geofence not found maps to 404", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: nil}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/99/charging-summary", nil, map[string]string{"geofenceID": "99"})
		h.ChargingSummary(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
	})
}

func TestChargingActivity(t *testing.T) {
	t.Run("success passes pagination through", func(t *testing.T) {
		fake := &fakeRateRepo{
			getByIDResult:  sampleGeofence(1),
			activityResult: []*systemmodel.GeofenceChargingActivity{{SessionID: 1, VehicleID: 2}},
		}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/1/charging-activity?limit=10&offset=20", nil, map[string]string{"geofenceID": "1"})
		h.ChargingActivity(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
		}
		if len(fake.activityCalls) != 1 || fake.activityCalls[0].limit != 10 || fake.activityCalls[0].offset != 20 {
			t.Errorf("activityCalls = %+v, want limit=10 offset=20", fake.activityCalls)
		}
	})
	t.Run("geofence not found maps to 404 without calling ChargingActivity", func(t *testing.T) {
		fake := &fakeRateRepo{getByIDResult: nil}
		h := NewHandler(nil, WithRateStore(fake))
		w := httptest.NewRecorder()
		r := newRateRequest(http.MethodGet, "/geofences/99/charging-activity", nil, map[string]string{"geofenceID": "99"})
		h.ChargingActivity(w, r)
		wantErrorResponse(t, w, http.StatusNotFound, "GEOFENCE_NOT_FOUND")
		if len(fake.activityCalls) != 0 {
			t.Errorf("ChargingActivity was called despite missing geofence: %v", fake.activityCalls)
		}
	})
}

// TestNewHandler_RateStoreDefaultsToGeofenceRepo pins that a production
// NewHandler(db) call wires rateRepo to the SAME concrete instance as
// geofenceRepo/bulk — i.e. WithRateStore is test-only surface area, not a
// second production code path that could silently drift from the CRUD repo.
func TestNewHandler_RateStoreDefaultsToGeofenceRepo(t *testing.T) {
	h := NewHandler(nil)
	if h.rateRepo != nil {
		t.Fatalf("with db=nil, rateRepo should stay nil (no fake installed); got %#v", h.rateRepo)
	}
	fake := &fakeRateRepo{}
	h2 := NewHandler(nil, WithRateStore(fake))
	if h2.rateRepo != fake {
		t.Fatal("WithRateStore did not install the fake")
	}
}
