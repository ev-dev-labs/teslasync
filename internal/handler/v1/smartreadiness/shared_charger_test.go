package smartreadiness

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	testSharedChargerHeader = "X-Verified-Subject"
	testSharedChargerPath   = "/api/v1/smart-charging/shared-chargers"
)

func mountTestSharedCharger(service sharedChargerService, header string) http.Handler {
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		(&Handler{}).MountRoutes(r)
		NewSharedChargerHandler(service, header).MountRoutes(r)
	})
	return router
}

func sharedChargerTestRequest(method, path, subject, body string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set(testSharedChargerHeader, subject)
	r.Header.Set(tsauth.ExpectedPrincipalHeader, "subject:"+url.PathEscape(subject))
	r.Header.Set("Content-Type", "application/json")
	return r
}

func TestSharedChargerHTTPRequiresExactVerifiedBrowser(t *testing.T) {
	for _, tc := range []struct {
		name, header, code string
		status             int
		mutate             func(*http.Request) *http.Request
	}{
		{"open mode", "", "AUTH_MODE_OPEN", 501, nil},
		{"missing subject", testSharedChargerHeader, "MISSING_IDENTITY", 401, func(r *http.Request) *http.Request {
			r.Header.Del(testSharedChargerHeader)
			return r
		}},
		{"stale expected subject", testSharedChargerHeader, "IDENTITY_CHANGED", 409, func(r *http.Request) *http.Request {
			r.Header.Set(tsauth.ExpectedPrincipalHeader, "subject:alice")
			return r
		}},
		{"missing expected subject", testSharedChargerHeader, "IDENTITY_CHANGED", 409, func(r *http.Request) *http.Request {
			r.Header.Del(tsauth.ExpectedPrincipalHeader)
			return r
		}},
		{"verified app token", testSharedChargerHeader, "BROWSER_IDENTITY_REQUIRED", 403, func(r *http.Request) *http.Request {
			return r.WithContext(tsauth.WithAppTokenSubject(r.Context(), "Alice"))
		}},
		{"impersonated identity", testSharedChargerHeader, "PERSONAL_DATA_IMPERSONATION_DENIED", 403, func(r *http.Request) *http.Request {
			return r.WithContext(tsauth.WithImpersonationForTests(r.Context(), tsauth.ImpersonationClaim{}))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := mountTestSharedCharger(sharedChargerHTTPFake{t: t}, tc.header)
			request := sharedChargerTestRequest("GET", testSharedChargerPath, "Alice", "")
			if tc.mutate != nil {
				request = tc.mutate(request)
			}
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.status || recorder.Header().Get("Cache-Control") != "private, no-store" ||
				!strings.Contains(recorder.Body.String(), tc.code) {
				t.Fatalf("status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
			}
		})
	}
}

func TestSharedChargerHTTPBoundedPrivateProjections(t *testing.T) {
	fake := sharedChargerHTTPFake{t: t, now: time.Date(2026, 11, 21, 4, 0, 0, 0, time.UTC)}
	router := mountTestSharedCharger(fake, testSharedChargerHeader)
	list := httptest.NewRecorder()
	router.ServeHTTP(list, sharedChargerTestRequest("GET", testSharedChargerPath+"?limit=8&offset=2", "Alice", ""))
	var envelope struct {
		Data sharedChargerListResponse `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	listing := envelope.Data
	if list.Code != 200 || listing.CanManage || listing.Owned == nil || len(listing.Owned) != 0 ||
		len(listing.Invitations) != 1 || listing.Invitations[0].ID != 9 || listing.Invitations[0].Revision != 2 ||
		listing.Invitations[0].VehicleID != 11 || !listing.Invitations[0].Confirmed ||
		strings.Contains(list.Body.String(), "subject") || strings.Contains(list.Body.String(), "Bob") {
		t.Fatalf("listing = %d %s", list.Code, list.Body.String())
	}
	for _, subject := range []string{"Alice", "Bob", "stranger"} {
		result := httptest.NewRecorder()
		router.ServeHTTP(result, sharedChargerTestRequest("GET", testSharedChargerPath+"/9/card?revision=2", subject, ""))
		var envelope struct {
			Data sharedChargerViewResponse `json:"data"`
		}
		if err := json.Unmarshal(result.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		view := envelope.Data
		if result.Code != 200 || result.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("view status = %d, headers = %v", result.Code, result.Header())
		}
		if subject == "stranger" {
			if view.Card != nil || view.Reminder != nil {
				t.Fatalf("outsider view = %s", result.Body.String())
			}
			continue
		}
		if view.Card == nil || view.Card.First.VehicleID != 11 || view.Card.Second.VehicleID != 22 ||
			(view.Reminder != nil) != (subject == "Bob") {
			t.Fatalf("participant view = %s", result.Body.String())
		}
		for _, rawEvidence := range []string{"subject", "energy_needed_wh", "available_at", "departure_at", "conservative_power_w", "already_plugged"} {
			if strings.Contains(result.Body.String(), rawEvidence) {
				t.Errorf("card leaks %s", rawEvidence)
			}
		}
	}
}

func TestSharedChargerHTTPRevisionBoundMutations(t *testing.T) {
	const grant = `{"place_id":8,"place_updated_at":"2026-11-21T03:04:05.123456Z","expires_at":"2026-11-21T09:00:00Z","participants":[{"vehicle_id":11,"subject":"Alice"},{"vehicle_id":22,"subject":"Bob"}],"reminder_vehicle_id":22}`
	const evidence = `{"available_at":"2026-11-21T04:00:00Z","departure_at":"2026-11-21T09:00:00Z","energy_needed_wh":0,"conservative_power_w":3600,"already_plugged":false}`
	for _, tc := range []struct {
		method, suffix, subject, body, code string
		wantStatus                          int
	}{
		{"POST", "", "operator", grant, `"revision":2`, 201},
		{"PUT", "/9?revision=2", "operator", grant, `"revision":3`, 200},
		{"POST", "", "other", grant, "SHARED_CHARGER_OPERATOR_REQUIRED", 403},
		{"POST", "", "conflicting operator", grant, "SHARED_CHARGER_ACTIVE_PLAN", 409},
		{"POST", "", "operator", grant + `{}`, "VALIDATION_ERROR", 400},
		{"POST", "", "operator", strings.Replace(grant, `"Alice"`, `"Alice","unexpected":true`, 1), "VALIDATION_ERROR", 400},
		{"PUT", "/9/vehicles/22?revision=2", "Bob", evidence, "", 204},
		{"PUT", "/9/vehicles/22", "Bob", evidence, "VALIDATION_ERROR", 400},
		{"PUT", "/9/vehicles/22?revision=2&revision=3", "Bob", evidence, "VALIDATION_ERROR", 400},
		{"PUT", "/9/vehicles/22?revision=2", "Bob", strings.Replace(evidence, `,"already_plugged":false`, "", 1), "VALIDATION_ERROR", 400},
		{"DELETE", "/9/vehicles/22?revision=2", "Bob", "", "", 204},
		{"DELETE", "/9?revision=2", "operator", "", "", 204},
	} {
		t.Run(tc.method+tc.suffix+tc.code, func(t *testing.T) {
			router := mountTestSharedCharger(sharedChargerHTTPFake{t: t}, testSharedChargerHeader)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, sharedChargerTestRequest(tc.method, testSharedChargerPath+tc.suffix, tc.subject, tc.body))
			if recorder.Code != tc.wantStatus || !strings.Contains(recorder.Body.String(), tc.code) {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

type sharedChargerHTTPFake struct {
	t   *testing.T
	now time.Time
}

var sharedChargerTestRef = domain.SharedChargerRef{ID: 9, Revision: 2}

func (s sharedChargerHTTPFake) ListPlanning(_ context.Context, subject string, limit, offset int) (port.SharedChargerPlanning, error) {
	if subject != "Alice" || limit != 8 || offset != 2 {
		s.t.Fatalf("unexpected list params %q, %d, %d", subject, limit, offset)
	}
	return port.SharedChargerPlanning{Invitations: []domain.SharedChargerInvitation{{
		Ref: sharedChargerTestRef, VehicleID: 11, PlaceID: 8, PlaceUpdatedAt: s.now, ExpiresAt: s.now.Add(4 * time.Hour), Confirmed: true,
	}}}, nil
}

func (s sharedChargerHTTPFake) Authorize(_ context.Context, subject string, ref domain.SharedChargerRef, spec domain.SharedChargerAuthorization) (domain.SharedChargerRef, error) {
	switch subject {
	case "other":
		return domain.SharedChargerRef{}, smartreadinesssvc.ErrSharedChargerOperatorRequired
	case "conflicting operator":
		return domain.SharedChargerRef{}, port.ErrSharedChargerActivePlan
	case "operator":
	default:
		s.t.Fatalf("unexpected subject %q", subject)
	}
	if spec.Participants[0].Subject != "Alice" || spec.Participants[1].VehicleID != 22 ||
		spec.PlaceUpdatedAt.Nanosecond() != 123456000 || spec.ReminderVehicleID != 22 {
		s.t.Fatalf("unexpected authorization input: %+v", spec)
	}
	if ref == (domain.SharedChargerRef{}) {
		return sharedChargerTestRef, nil
	}
	if ref != sharedChargerTestRef {
		s.t.Fatalf("unexpected ref: %+v", ref)
	}
	return domain.SharedChargerRef{ID: ref.ID, Revision: ref.Revision + 1}, nil
}

func (s sharedChargerHTTPFake) Confirm(_ context.Context, subject string, ref domain.SharedChargerRef, vehicleID int64, input smartreadinesssvc.SharedChargerConfirmationInput) error {
	if subject != "Bob" || ref != sharedChargerTestRef || vehicleID != 22 || input.EnergyNeededWh != 0 ||
		input.AlreadyPlugged == nil || *input.AlreadyPlugged || input.AcceptReminder {
		s.t.Fatalf("unexpected confirmation: %s %+v %d %+v", subject, ref, vehicleID, input)
	}
	return nil
}

func (s sharedChargerHTTPFake) Withdraw(_ context.Context, subject string, ref domain.SharedChargerRef, vehicleID int64) error {
	if subject != "Bob" || ref != sharedChargerTestRef || vehicleID != 22 {
		s.t.Fatalf("unexpected withdrawal: %s %+v %d", subject, ref, vehicleID)
	}
	return nil
}

func (s sharedChargerHTTPFake) Revoke(_ context.Context, subject string, ref domain.SharedChargerRef) error {
	if subject != "operator" || ref != sharedChargerTestRef {
		s.t.Fatalf("unexpected revocation: %s %+v", subject, ref)
	}
	return nil
}

func (s sharedChargerHTTPFake) Card(_ context.Context, subject string, ref domain.SharedChargerRef) (*domain.SharedChargerCard, error) {
	if ref != sharedChargerTestRef {
		s.t.Fatalf("unexpected card ref %+v", ref)
	}
	if subject != "Alice" && subject != "Bob" {
		return nil, nil
	}
	swap, exchangeDone := s.now.Add(time.Hour), s.now.Add(70*time.Minute)
	return &domain.SharedChargerCard{
		Ref: ref, PlaceID: 8, EvaluatedAt: s.now, ExpiresAt: exchangeDone,
		Schedule: domain.SharedChargerSchedule{
			First:  domain.SharedChargerSlot{VehicleID: 11, StartsAt: s.now, EndsAt: swap},
			Second: domain.SharedChargerSlot{VehicleID: 22, StartsAt: exchangeDone, EndsAt: s.now.Add(130 * time.Minute)},
			SwapAt: swap,
		},
	}, nil
}

func (s sharedChargerHTTPFake) Reminder(_ context.Context, subject string, ref domain.SharedChargerRef) (*domain.SharedChargerReminder, error) {
	if ref != sharedChargerTestRef || subject == "stranger" {
		s.t.Fatalf("unexpected reminder read %s %+v", subject, ref)
	}
	if subject != "Bob" {
		return nil, nil
	}
	return &domain.SharedChargerReminder{
		Ref: ref, VehicleID: 22, SwapAt: s.now.Add(time.Hour), ExpiresAt: s.now.Add(70 * time.Minute),
	}, nil
}
