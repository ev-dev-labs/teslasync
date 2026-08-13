package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

type vehicleManagementRouteFake struct {
	operation string
}

func (f *vehicleManagementRouteFake) respond(operation string, w http.ResponseWriter) {
	f.operation = operation
	w.WriteHeader(http.StatusNoContent)
}

func (f *vehicleManagementRouteFake) VehicleOptions(w http.ResponseWriter, _ *http.Request) {
	f.respond("options", w)
}

func (f *vehicleManagementRouteFake) RefreshVehicleOptions(w http.ResponseWriter, _ *http.Request) {
	f.respond("options_refresh", w)
}

func (f *vehicleManagementRouteFake) VehicleSpecs(w http.ResponseWriter, _ *http.Request) {
	f.respond("specs", w)
}

func (f *vehicleManagementRouteFake) RefreshVehicleSpecs(w http.ResponseWriter, _ *http.Request) {
	f.respond("specs_refresh", w)
}

func (f *vehicleManagementRouteFake) SubscriptionEligibility(w http.ResponseWriter, _ *http.Request) {
	f.respond("subscriptions", w)
}

func (f *vehicleManagementRouteFake) RefreshSubscriptionEligibility(w http.ResponseWriter, _ *http.Request) {
	f.respond("subscriptions_refresh", w)
}

func (f *vehicleManagementRouteFake) UpgradeEligibility(w http.ResponseWriter, _ *http.Request) {
	f.respond("upgrades", w)
}

func (f *vehicleManagementRouteFake) RefreshUpgradeEligibility(w http.ResponseWriter, _ *http.Request) {
	f.respond("upgrades_refresh", w)
}

func (f *vehicleManagementRouteFake) WarrantyDetails(w http.ResponseWriter, _ *http.Request) {
	f.respond("warranty", w)
}

func (f *vehicleManagementRouteFake) RefreshWarrantyDetails(w http.ResponseWriter, _ *http.Request) {
	f.respond("warranty_refresh", w)
}

func (f *vehicleManagementRouteFake) VehiclePricing(w http.ResponseWriter, _ *http.Request) {
	f.respond("pricing", w)
}

func (f *vehicleManagementRouteFake) EnterpriseRoles(w http.ResponseWriter, _ *http.Request) {
	f.respond("enterprise_roles", w)
}

func (f *vehicleManagementRouteFake) RefreshEnterpriseRoles(w http.ResponseWriter, _ *http.Request) {
	f.respond("enterprise_roles_refresh", w)
}

func (f *vehicleManagementRouteFake) EnterprisePayer(w http.ResponseWriter, _ *http.Request) {
	f.respond("enterprise_payer", w)
}

func TestVehicleManagementRoutes(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		path      string
		operation string
	}{
		{"options cached GET", http.MethodGet, "/api/v1/vehicles/7/options", "options"},
		{"options refresh", http.MethodPost, "/api/v1/vehicles/7/options/refresh", "options_refresh"},
		{"paid specs cached GET", http.MethodGet, "/api/v1/vehicles/7/specs", "specs"},
		{"paid specs refresh", http.MethodPost, "/api/v1/vehicles/7/specs/refresh", "specs_refresh"},
		{"warranty cached GET", http.MethodGet, "/api/v1/vehicles/7/warranty", "warranty"},
		{"warranty refresh", http.MethodPost, "/api/v1/vehicles/7/warranty/refresh", "warranty_refresh"},
		{"subscriptions cached GET", http.MethodGet, "/api/v1/vehicles/7/subscriptions", "subscriptions"},
		{"subscriptions refresh", http.MethodPost, "/api/v1/vehicles/7/subscriptions/refresh", "subscriptions_refresh"},
		{"upgrades cached GET", http.MethodGet, "/api/v1/vehicles/7/upgrades", "upgrades"},
		{"upgrades refresh", http.MethodPost, "/api/v1/vehicles/7/upgrades/refresh", "upgrades_refresh"},
		{"pricing query", http.MethodPost, "/api/v1/tesla/vehicle-pricing", "pricing"},
		{"enterprise roles cached GET", http.MethodGet, "/api/v1/vehicles/7/enterprise-roles", "enterprise_roles"},
		{"enterprise roles refresh", http.MethodPost, "/api/v1/vehicles/7/enterprise-roles/refresh", "enterprise_roles_refresh"},
		{"enterprise payer", http.MethodPost, "/api/v1/vehicles/7/enterprise-payer", "enterprise_payer"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := &vehicleManagementRouteFake{}
			router := chi.NewRouter()
			router.Route("/api/v1", func(r chi.Router) {
				mountAccountVehicleManagementRoutes(r, handler)
				r.Route("/vehicles/{vehicleID}", func(r chi.Router) {
					mountVehicleScopedManagementRoutes(r, handler)
				})
			})

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204", rec.Code)
			}
			if handler.operation != tt.operation {
				t.Fatalf("operation = %q, want %q", handler.operation, tt.operation)
			}
		})
	}
}
