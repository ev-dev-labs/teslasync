package smartreadiness

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/go-chi/chi/v5"
)

const sharedTripTestPath = "/api/v1/smart-charging/shared-trips"

func TestSharedTripRejectsNonBrowserAndStalePrincipal(t *testing.T) {
	tests := []struct {
		name     string
		header   string
		subject  string
		expected string
		repeated bool
		ctx      func(context.Context) context.Context
		status   int
		code     string
	}{
		{name: "open", status: 501, code: tsauth.AuthModeOpenCode},
		{name: "missing", header: "X-Forwarded-User", status: 401, code: tsauth.MissingIdentityCode},
		{name: "missing expected principal", header: "X-Forwarded-User", subject: "verified", status: 409, code: "IDENTITY_CHANGED"},
		{name: "duplicate expected principal", header: "X-Forwarded-User", subject: "verified", expected: "subject:verified", repeated: true, status: 409, code: "IDENTITY_CHANGED"},
		{name: "switched", header: "X-Forwarded-User", subject: "verified", expected: "subject:previous", status: 409, code: "IDENTITY_CHANGED"},
		{
			name: "native", header: "X-Forwarded-User", subject: "verified", status: 403, code: "BROWSER_IDENTITY_REQUIRED",
			ctx: func(ctx context.Context) context.Context { return tsauth.WithAppTokenSubject(ctx, "verified") },
		},
		{
			name: "impersonated", header: "X-Forwarded-User", subject: "verified", status: 403, code: "PERSONAL_DATA_IMPERSONATION_DENIED",
			ctx: func(ctx context.Context) context.Context {
				return tsauth.WithImpersonationForTests(ctx, tsauth.ImpersonationClaim{})
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Its embedded service is nil: any call through the browser guard fails the test.
			router := sharedTripTestRouter(&sharedTripHTTPStub{}, tt.header)
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				req := httptest.NewRequest(method, sharedTripTestPath, nil)
				if tt.header != "" {
					req.Header.Set(tt.header, tt.subject)
				}
				if tt.expected != "" {
					req.Header.Set(tsauth.ExpectedPrincipalHeader, tt.expected)
				}
				if tt.repeated {
					req.Header.Add(tsauth.ExpectedPrincipalHeader, tt.expected)
				}
				if tt.ctx != nil {
					req = req.WithContext(tt.ctx(req.Context()))
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, req)
				if w.Code != tt.status || !strings.Contains(w.Body.String(), `"`+tt.code+`"`) ||
					w.Header().Get("Cache-Control") != "private, no-store" {
					t.Fatalf("%s: got status %d, headers %v, body %s", method, w.Code, w.Header(), w.Body)
				}
			}
		})
	}
}

func TestSharedTripScopedHTTPResponsesAndRevisionFence(t *testing.T) {
	now := time.Date(2026, 12, 31, 12, 0, 0, 0, time.UTC)
	stub := &sharedTripHTTPStub{now: now}
	router := sharedTripTestRouter(stub, "X-Forwarded-User")
	call := func(method, suffix, subject, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, sharedTripTestPath+suffix, strings.NewReader(body))
		req.Header.Set("X-Forwarded-User", subject)
		req.Header.Set(tsauth.ExpectedPrincipalHeader, "subject:"+subject)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Fatalf("%s %s: cache control = %q", method, suffix, got)
		}
		return w
	}
	w := call(http.MethodGet, "", "participant", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"can_manage":false,"owned":[]`) ||
		!strings.Contains(w.Body.String(), `"vehicle_id":8,"entry_version":2`) || strings.Contains(w.Body.String(), "subject") {
		t.Fatalf("private invitations: %d %s", w.Code, w.Body)
	}
	const confirmation = `{"revision":3,"entry_version":2,"trip_use_low_pct":0,"trip_use_high_pct":22,"reserve_pct":10,"schedule_clear":false,"maintenance_clear":true}`
	w = call(http.MethodPut, "/17/vehicles/8", "participant", confirmation)
	if w.Code != http.StatusNoContent || stub.confirmed != (domain.SharedTripEntryKey{TripID: 17, Revision: 3, VehicleID: 8, EntryVersion: 2}) ||
		stub.confirmation.ScheduleClear == nil || *stub.confirmation.ScheduleClear ||
		stub.confirmation.TripUseLowPct == nil || *stub.confirmation.TripUseLowPct != 0 {
		t.Fatalf("explicit false and zero lost: %d %s, %+v, %+v", w.Code, w.Body, stub.confirmed, stub.confirmation)
	}
	w = call(http.MethodPut, "/17/vehicles/8", "participant", strings.TrimSuffix(confirmation, "}")+`,"subject":"other"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("request overrides browser subject: %d %s", w.Code, w.Body)
	}
	w = call(http.MethodDelete, "/17/vehicles/8?revision=3&entry_version=2&entry_version=3", "participant", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("ambiguous revision accepted: %d %s", w.Code, w.Body)
	}
	w = call(http.MethodGet, "/17/comparison", "outsider", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("outsider comparison: %d %s", w.Code, w.Body)
	}
	w = call(http.MethodGet, "/17/comparison", "participant", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"comparison":null`) {
		t.Fatalf("suppressed comparison: %d %s", w.Code, w.Body)
	}
	stub.withOptions = true
	w = call(http.MethodGet, "/17/comparison", "participant", "")
	var payload struct {
		Data struct {
			Comparison struct {
				ID      int64 `json:"id"`
				Options []struct {
					VehicleID int64 `json:"vehicle_id"`
				} `json:"options"`
			} `json:"comparison"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	comparison := payload.Data.Comparison
	if w.Code != http.StatusOK || comparison.ID != 17 || len(comparison.Options) != 2 || comparison.Options[0].VehicleID != 12 ||
		strings.Contains(w.Body.String(), "subject") || strings.Contains(w.Body.String(), "schedule") || strings.Contains(w.Body.String(), "maintenance") {
		t.Fatalf("unsafe or malformed comparison: %d %s", w.Code, w.Body)
	}
}

func sharedTripTestRouter(service SharedTripService, header string) chi.Router {
	r := chi.NewRouter()
	r.Route("/api/v1", func(v1 chi.Router) {
		new(Handler).MountRoutes(v1)
		NewSharedTripHandler(service, header).MountRoutes(v1)
	})
	return r
}

type sharedTripHTTPStub struct {
	SharedTripService
	now          time.Time
	confirmed    domain.SharedTripEntryKey
	confirmation domain.SharedTripConfirmationInput
	withOptions  bool
}

func (*sharedTripHTTPStub) ListOwnedTrips(context.Context, smartreadinesssvc.SharedTripActor, int, int) ([]domain.SharedTrip, error) {
	return nil, smartreadinesssvc.ErrSharedTripOperatorRequired
}

func (s *sharedTripHTTPStub) ListInvitations(_ context.Context, actor smartreadinesssvc.SharedTripActor, _, _ int) ([]domain.SharedTripInvitation, error) {
	if !actor.VerifiedBrowser || actor.Subject != "participant" {
		return nil, port.ErrNotFound
	}
	return []domain.SharedTripInvitation{{
		SharedTripEntryKey: domain.SharedTripEntryKey{TripID: 17, Revision: 3, VehicleID: 8, EntryVersion: 2},
		DepartureAt:        s.now.Add(time.Hour),
	}}, nil
}

func (s *sharedTripHTTPStub) ConfirmVehicle(_ context.Context, actor smartreadinesssvc.SharedTripActor, key domain.SharedTripEntryKey, input domain.SharedTripConfirmationInput) error {
	if !actor.VerifiedBrowser || actor.Subject != "participant" {
		return port.ErrNotFound
	}
	s.confirmed, s.confirmation = key, input
	return nil
}

func (s *sharedTripHTTPStub) Comparison(_ context.Context, actor smartreadinesssvc.SharedTripActor, id int64) (*domain.SharedTripComparison, error) {
	if !actor.VerifiedBrowser || actor.Subject != "participant" || id != 17 {
		return nil, port.ErrNotFound
	}
	if !s.withOptions {
		return nil, nil
	}
	expires := s.now.Add(time.Minute)
	return &domain.SharedTripComparison{
		SharedTrip: domain.SharedTrip{ID: 17, Revision: 3, DepartureAt: s.now.Add(time.Hour)}, ExpiresAt: expires,
		Options: []domain.SharedTripVehicleOption{
			{VehicleID: 12, ReturnLowPct: 54, ReturnHighPct: 76, ReservePct: 12, ObservedAt: s.now, ExpiresAt: expires},
			{VehicleID: 8, ReturnLowPct: 22, ReturnHighPct: 46, ReservePct: 10, ObservedAt: s.now, ExpiresAt: expires},
		},
	}, nil
}
