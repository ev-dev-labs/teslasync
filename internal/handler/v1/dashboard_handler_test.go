package v1_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/api"
	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	v1 "github.com/ev-dev-labs/teslasync/internal/handler/v1"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type dashboardFleet struct {
	repository.VehicleRepository
	calls int
	err   error
}

func (r *dashboardFleet) GetAll(context.Context) ([]vehicle.Vehicle, error) {
	r.calls++
	return nil, r.err
}

func TestDashboardHandler_ForwardAuthFleetContract(t *testing.T) {
	cases := []struct {
		name       string
		authHeader string
		subject    string
		status     int
		calls      int
	}{
		{"configured_missing_principal_denied", "X-Forwarded-User", "", http.StatusUnauthorized, 0},
		{"configured_forwardauth_without_jwt_allowed", "X-Forwarded-User", "operator", http.StatusOK, 1},
		{"configured_other_principal_same_fleet", "X-Forwarded-User", "second-operator", http.StatusOK, 1},
		{"explicit_configured_dev_mode", "", "", http.StatusOK, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fleet := &dashboardFleet{}
			router := chi.NewRouter()
			router.Use(api.ForwardAuthMiddleware(c.authHeader))
			v1.NewDashboardHandler(dashboardsvc.New(fleet, nil, nil)).Register(router)
			req := httptest.NewRequest(http.MethodGet, "/dashboard/stats", nil)
			if c.subject != "" {
				req.Header.Set(c.authHeader, c.subject)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != c.status || fleet.calls != c.calls {
				t.Fatalf("status=%d fleet calls=%d, want %d/%d; body=%s", rec.Code, fleet.calls, c.status, c.calls, rec.Body.String())
			}
			if c.status == http.StatusOK {
				var wire struct {
					Data map[string]json.RawMessage `json:"data"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &wire); err != nil {
					t.Fatal(err)
				}
				if len(wire.Data) != 7 || string(wire.Data["total_vehicles"]) != "0" || string(wire.Data["avg_efficiency"]) != "null" {
					t.Fatalf("canonical empty-fleet JSON=%s", rec.Body.String())
				}
				if _, exists := wire.Data["totalVehicles"]; exists {
					t.Fatal("obsolete camelCase transport key")
				}
			}
		})
	}
}

func TestDashboardHandler_RepositoryFailure(t *testing.T) {
	fleet := &dashboardFleet{err: errors.New("private database diagnostic")}
	handler := v1.NewDashboardHandler(dashboardsvc.New(fleet, nil, nil))
	rec := httptest.NewRecorder()
	handler.GetStats(rec, httptest.NewRequest(http.MethodGet, "/dashboard/stats", nil))
	if rec.Code != http.StatusInternalServerError || fleet.calls != 1 {
		t.Fatalf("status=%d calls=%d", rec.Code, fleet.calls)
	}
	var wire struct {
		Data  json.RawMessage `json:"data"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &wire); err != nil {
		t.Fatal(err)
	}
	if len(wire.Data) != 0 || wire.Error.Code != "INTERNAL" || wire.Error.Message != "internal server error" {
		t.Fatalf("unexpected failure response=%s", rec.Body.String())
	}
}
