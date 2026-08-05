package advancedintelligence

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
)

type fakeService struct {
	twinCalls        int
	firmwareVehicle  int64
	firmwareLimit    int
	firmwareOffset   int
	federatedSubject string
	causalSubject    string
}

func (f *fakeService) TwinLab(
	context.Context, domain.TwinLabRequest,
) (*domain.TwinLabResponse, error) {
	f.twinCalls++
	return &domain.TwinLabResponse{Scenarios: []domain.TwinScenarioOutput{}}, nil
}

func (f *fakeService) FirmwareCanary(
	_ context.Context, vehicleID int64, limit, offset int,
) (*domain.Page[domain.FirmwareCanary], error) {
	f.firmwareVehicle, f.firmwareLimit, f.firmwareOffset = vehicleID, limit, offset
	return &domain.Page[domain.FirmwareCanary]{
		Items: []domain.FirmwareCanary{}, Limit: limit, Offset: offset,
	}, nil
}

func (f *fakeService) ComponentSurvival(
	context.Context, int64, int, int,
) (*domain.Page[domain.ComponentSurvival], error) {
	return &domain.Page[domain.ComponentSurvival]{Items: []domain.ComponentSurvival{}}, nil
}

func (f *fakeService) RoadHazards(
	context.Context, int64, int, int,
) (*domain.HazardPage, error) {
	return &domain.HazardPage{
		Page: domain.Page[domain.HazardCluster]{Items: []domain.HazardCluster{}},
	}, nil
}

func (f *fakeService) BehavioralSentinel(
	context.Context, int64, int, int,
) (*domain.SentinelPage, error) {
	return &domain.SentinelPage{
		Page: domain.Page[domain.SentinelFinding]{Items: []domain.SentinelFinding{}},
	}, nil
}

func (f *fakeService) ChargingForensics(
	context.Context, int64, int, int,
) (*domain.ChargingForensicsPage, error) {
	return &domain.ChargingForensicsPage{
		Page: domain.Page[domain.ChargingForensicsItem]{Items: []domain.ChargingForensicsItem{}},
	}, nil
}

func (f *fakeService) JourneyAssurance(
	context.Context, domain.JourneyAssuranceRequest,
) (*domain.JourneyAssuranceResponse, error) {
	return &domain.JourneyAssuranceResponse{Factors: []domain.ReadinessFactor{}}, nil
}

func (f *fakeService) ChargingSiteTwin(
	context.Context, domain.ChargingSiteTwinRequest,
) (*domain.ChargingSiteTwinResponse, error) {
	return &domain.ChargingSiteTwinResponse{Mitigations: []domain.RankedMitigation{}}, nil
}

func (f *fakeService) FederatedStatus(
	_ context.Context, subject string, vehicleID int64, limit, offset int,
) (*domain.FederatedStatusPage, error) {
	f.federatedSubject = subject
	return &domain.FederatedStatusPage{
		Page:      domain.Page[domain.FederatedModelCard]{Items: []domain.FederatedModelCard{}},
		VehicleID: vehicleID,
	}, nil
}

func (f *fakeService) StartFederatedRound(
	_ context.Context, subject string, _ domain.StartFederatedRoundRequest,
) (*domain.FederatedRoundResult, error) {
	f.federatedSubject = subject
	return &domain.FederatedRoundResult{}, nil
}

func (f *fakeService) ResiliencePlan(
	context.Context, domain.ResiliencePlanRequest,
) (*domain.ResiliencePlanResponse, error) {
	return &domain.ResiliencePlanResponse{
		RiskTimeline: []domain.ResilienceTimelinePoint{},
	}, nil
}

func (f *fakeService) ListCausalExperiments(
	_ context.Context, subject string, _ int64, _, _ int,
) (*domain.Page[domain.CausalExperiment], error) {
	f.causalSubject = subject
	return &domain.Page[domain.CausalExperiment]{Items: []domain.CausalExperiment{}}, nil
}

func (f *fakeService) CreateCausalExperiment(
	_ context.Context, subject string, _ domain.CreateCausalExperimentRequest,
) (*domain.CausalExperiment, error) {
	f.causalSubject = subject
	return &domain.CausalExperiment{}, nil
}

func (f *fakeService) TCOOptimizer(
	context.Context, domain.TCOOptimizerRequest,
) (*domain.TCOOptimizerResponse, error) {
	return &domain.TCOOptimizerResponse{Strategies: []domain.TCOStrategy{}}, nil
}

func TestMountRoutesMethodAndResponseContracts(t *testing.T) {
	now := time.Now().UTC()
	departure := now.Add(time.Hour).Format(time.RFC3339)
	baselineStart := now.Add(-96 * time.Hour).Format(time.RFC3339)
	baselineEnd := now.Add(-72 * time.Hour).Format(time.RFC3339)
	treatmentStart := now.Add(-48 * time.Hour).Format(time.RFC3339)
	treatmentEnd := now.Add(-24 * time.Hour).Format(time.RFC3339)
	tests := []struct {
		method string
		path   string
		body   string
		status int
	}{
		{http.MethodPost, "/advanced-intelligence/twin-lab/scenarios",
			`{"vehicle_id":1,"confirmed":true,"scenarios":[{"name":"a","horizon_s":3600,"distance_m":1000,"speed_mps":10,"auxiliary_load_w":0}]}`, 200},
		{http.MethodGet, "/advanced-intelligence/firmware-canary?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodGet, "/advanced-intelligence/component-survival?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodGet, "/advanced-intelligence/road-hazards?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodGet, "/advanced-intelligence/behavioral-sentinel?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodGet, "/advanced-intelligence/charging-forensics?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodPost, "/advanced-intelligence/journey-assurance/scenarios",
			fmt.Sprintf(`{"vehicle_id":1,"route_distance_m":1000,"departure_at":%q,"reserve_target_pct":20,"confirmed":true}`, departure), 200},
		{http.MethodPost, "/advanced-intelligence/charging-site-twin/scenarios",
			`{"vehicle_id":1,"charger_count":2,"charger_power_w":10000,"panel_limit_w":20000,"arrival_rate_per_s":0.0001,"mean_service_s":1800,"arrival_distribution":"poisson","service_distribution":"exponential","fleet_growth_pct":0,"confirmed":true}`, 200},
		{http.MethodGet, "/advanced-intelligence/federated-learning/model-cards?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodPost, "/advanced-intelligence/federated-learning/rounds",
			`{"vehicle_id":1,"model_name":"local efficiency","model_version":"v1","task":"efficiency","epsilon":0.1,"epsilon_budget":1,"expected_version":0,"confirmed":true}`, 201},
		{http.MethodPost, "/advanced-intelligence/resilience/plans",
			`{"vehicle_id":1,"vehicle_energy_wh":10000,"stationary_storage_wh":1000,"expected_solar_wh":1000,"essential_load_w":1000,"outage_duration_s":3600,"evacuation_reserve_wh":1000,"restoration_uncertainty_pct":20,"confirmed":true}`, 200},
		{http.MethodGet, "/advanced-intelligence/causal-experiments?vehicle_id=1&limit=10&offset=0", "", 200},
		{http.MethodPost, "/advanced-intelligence/causal-experiments",
			fmt.Sprintf(`{"vehicle_id":1,"intervention_kind":"software_update","metric":"drive_energy_wh_per_m","baseline_start":%q,"baseline_end":%q,"treatment_start":%q,"treatment_end":%q,"confirmed":true}`,
				baselineStart, baselineEnd, treatmentStart, treatmentEnd), 201},
		{http.MethodPost, "/advanced-intelligence/tco-optimizer/scenarios",
			`{"vehicle_id":1,"horizon_s":31536000,"annual_distance_m":10000000,"home_charging_pct":70,"public_charging_pct":30,"risk_tolerance_pct":50,"budget_minor":500000,"currency":"USD","confirmed":true}`, 200},
	}

	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			router := chi.NewRouter()
			NewHandler(&fakeService{}, "").MountRoutes(router)
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d; body=%s", response.Code, test.status, response.Body.String())
			}
			if contentType := response.Header().Get("Content-Type"); contentType != "application/json" {
				t.Fatalf("content type = %q", contentType)
			}
		})
	}
}

func TestHandlerRejectsUnconfirmedAndUnknownBodies(t *testing.T) {
	service := &fakeService{}
	handler := NewHandler(service, "")
	for name, body := range map[string]string{
		"unconfirmed": `{"vehicle_id":1,"confirmed":false,"scenarios":[{"name":"a","horizon_s":3600,"distance_m":1000,"speed_mps":10,"auxiliary_load_w":0}]}`,
		"unknown":     `{"vehicle_id":1,"confirmed":true,"unsafe_command":"unlock","scenarios":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPost,
				"/advanced-intelligence/twin-lab/scenarios",
				strings.NewReader(body),
			)
			response := httptest.NewRecorder()
			handler.TwinLab(response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}
	if service.twinCalls != 0 {
		t.Fatalf("service called %d times for invalid requests", service.twinCalls)
	}
}

func TestHandlerRejectsOversizedBodyAndWrongMethod(t *testing.T) {
	handler := NewHandler(&fakeService{}, "")
	oversized := `{"vehicle_id":1,"confirmed":true,"padding":"` +
		strings.Repeat("x", maxRequestBodyBytes) + `"}`
	request := httptest.NewRequest(
		http.MethodPost,
		"/advanced-intelligence/twin-lab/scenarios",
		strings.NewReader(oversized),
	)
	response := httptest.NewRecorder()
	handler.TwinLab(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("oversized status = %d", response.Code)
	}

	router := chi.NewRouter()
	handler.MountRoutes(router)
	request = httptest.NewRequest(
		http.MethodGet,
		"/advanced-intelligence/twin-lab/scenarios",
		nil,
	)
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("wrong method status = %d, want 405", response.Code)
	}
}

func TestHandlerValidatesVehicleAndPagination(t *testing.T) {
	service := &fakeService{}
	handler := NewHandler(service, "")
	invalid := []string{
		"/advanced-intelligence/firmware-canary",
		"/advanced-intelligence/firmware-canary?vehicle_id=0",
		"/advanced-intelligence/firmware-canary?vehicle_id=1&limit=101",
		"/advanced-intelligence/firmware-canary?vehicle_id=1&offset=-1",
	}
	for _, path := range invalid {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.FirmwareCanary(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d", path, response.Code)
		}
	}
	request := httptest.NewRequest(
		http.MethodGet,
		"/advanced-intelligence/firmware-canary?vehicle_id=42&limit=9&offset=3",
		nil,
	)
	response := httptest.NewRecorder()
	handler.FirmwareCanary(response, request)
	if response.Code != http.StatusOK ||
		service.firmwareVehicle != 42 || service.firmwareLimit != 9 ||
		service.firmwareOffset != 3 {
		t.Fatalf("parsed request = vehicle %d limit %d offset %d; status %d",
			service.firmwareVehicle, service.firmwareLimit, service.firmwareOffset, response.Code)
	}
}

func TestHandlerSubjectIsolationModes(t *testing.T) {
	service := &fakeService{}
	openHandler := NewHandler(service, "")
	request := httptest.NewRequest(
		http.MethodGet,
		"/advanced-intelligence/federated-learning/model-cards?vehicle_id=1",
		nil,
	)
	response := httptest.NewRecorder()
	openHandler.FederatedStatus(response, request)
	if response.Code != http.StatusOK || service.federatedSubject != openModeSubject {
		t.Fatalf("open mode status/subject = %d %q", response.Code, service.federatedSubject)
	}

	configured := NewHandler(service, "X-Forward-Subject")
	request = httptest.NewRequest(
		http.MethodGet,
		"/advanced-intelligence/causal-experiments?vehicle_id=1",
		nil,
	)
	response = httptest.NewRecorder()
	configured.ListCausalExperiments(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing configured subject status = %d", response.Code)
	}
	request = httptest.NewRequest(
		http.MethodGet,
		"/advanced-intelligence/causal-experiments?vehicle_id=1",
		nil,
	)
	request.Header.Set("X-Forward-Subject", "subject-a")
	response = httptest.NewRecorder()
	configured.ListCausalExperiments(response, request)
	if response.Code != http.StatusOK || service.causalSubject != "subject-a" {
		t.Fatalf("configured status/subject = %d %q", response.Code, service.causalSubject)
	}
}
