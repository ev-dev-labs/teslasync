package vehicleinfo

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
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/go-chi/chi/v5"
)

const testVIN = "5YJ3E1EA7KF000001"

// TestNewHandler_WiresPorts covers the production constructor. The repositories
// only capture the *database.DB pointer (no connection is opened) so a zero DB
// is enough to prove every port is wired and the Tesla client is reachable.
func TestNewHandler_WiresPorts(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{
		BaseURL: "http://localhost",
		AuthURL: "http://localhost",
		Timeout: time.Second,
	})
	h := NewHandler(tc, &database.DB{})

	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.teslaClient == nil || h.configRepo == nil || h.vehicleRepo == nil {
		t.Fatalf("NewHandler left a nil port: %+v", h)
	}
	// The wired client must be the real one: a fresh client holds no token.
	if h.teslaClient.HasValidToken() {
		t.Fatal("expected a fresh Tesla client to report no valid token")
	}
}

// ---------------------------------------------------------------------------
// Fakes — in-memory doubles for the three handler ports. They are used from a
// single goroutine per handler call (httptest is synchronous) so no locking is
// needed to stay clean under -race.
// ---------------------------------------------------------------------------

// compile-time proof the fakes satisfy the production ports.
var (
	_ teslaInfoClient = (*fakeTeslaClient)(nil)
	_ userConfigStore = (*fakeConfigStore)(nil)
	_ vehicleFinder   = (*fakeVehicleFinder)(nil)
)

type teslaCall struct {
	method  string
	vin     string
	payload tesla.JSONRequestObject
}

// fakeTeslaClient returns the same canned (body,status,err) for every fetch
// method and records each call so tests can assert routing (method + vin).
type fakeTeslaClient struct {
	validToken bool
	body       []byte
	status     int
	err        error
	calls      []teslaCall
}

func (f *fakeTeslaClient) HasValidToken() bool { return f.validToken }

func (f *fakeTeslaClient) record(method, vin string) ([]byte, int, error) {
	f.calls = append(f.calls, teslaCall{method: method, vin: vin})
	return f.body, f.status, f.err
}

func (f *fakeTeslaClient) GetMobileEnabled(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("mobile_enabled", vin)
}

func (f *fakeTeslaClient) GetVehicleOptions(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("vehicle_options", vin)
}

func (f *fakeTeslaClient) GetVehicleSpecs(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("vehicle_specs", vin)
}

func (f *fakeTeslaClient) GetSubscriptionEligibility(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("subscriptions", vin)
}

func (f *fakeTeslaClient) GetUpgradeEligibility(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("upgrades", vin)
}

func (f *fakeTeslaClient) GetWarrantyDetails(_ context.Context) ([]byte, int, error) {
	return f.record("warranty", "")
}

func (f *fakeTeslaClient) GetVehiclePricing(
	_ context.Context,
	payload tesla.JSONRequestObject,
) ([]byte, int, error) {
	f.calls = append(f.calls, teslaCall{method: "vehicle_pricing", payload: payload})
	return f.body, f.status, f.err
}

func (f *fakeTeslaClient) GetEnterpriseRoles(_ context.Context, vin string) ([]byte, int, error) {
	return f.record("enterprise_roles", vin)
}

func (f *fakeTeslaClient) SetEnterprisePayer(
	_ context.Context,
	vin string,
	payload tesla.JSONRequestObject,
) ([]byte, int, error) {
	f.calls = append(f.calls, teslaCall{method: "enterprise_payer", vin: vin, payload: payload})
	return f.body, f.status, f.err
}

type upsertCall struct {
	configType string
	data       string
}

type fakeConfigStore struct {
	byType    map[string]*teslamodel.TeslaUserConfig
	getErr    error
	upsertErr error
	upserts   []upsertCall
	getKeys   []string
}

func newFakeConfigStore() *fakeConfigStore {
	return &fakeConfigStore{byType: map[string]*teslamodel.TeslaUserConfig{}}
}

func (f *fakeConfigStore) GetByType(_ context.Context, configType string) (*teslamodel.TeslaUserConfig, error) {
	f.getKeys = append(f.getKeys, configType)
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.byType[configType], nil
}

func (f *fakeConfigStore) Upsert(_ context.Context, configType, data string) error {
	f.upserts = append(f.upserts, upsertCall{configType: configType, data: data})
	if f.upsertErr != nil {
		return f.upsertErr
	}
	f.byType[configType] = &teslamodel.TeslaUserConfig{
		ConfigType: configType,
		Data:       data,
		FetchedAt:  time.Now().UTC(),
	}
	return nil
}

type fakeVehicleFinder struct {
	vehicle *vehiclemodel.Vehicle
	err     error
	gotID   int64
}

func (f *fakeVehicleFinder) GetByID(_ context.Context, id int64) (*vehiclemodel.Vehicle, error) {
	f.gotID = id
	return f.vehicle, f.err
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

func newHandler(tc teslaInfoClient, cfg userConfigStore, veh vehicleFinder) *Handler {
	return &Handler{teslaClient: tc, configRepo: cfg, vehicleRepo: veh}
}

func okVehicle() *vehiclemodel.Vehicle {
	return &vehiclemodel.Vehicle{ID: 7, VIN: testVIN}
}

// vehReq builds a request, optionally injecting the chi {vehicleID} URL param
// the same way the production router does.
func vehReq(method, vehicleID string) *http.Request {
	r := httptest.NewRequest(method, "/x", nil)
	if vehicleID != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("vehicleID", vehicleID)
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	}
	return r
}

func vehJSONReq(method, vehicleID, body string) *http.Request {
	r := httptest.NewRequest(method, "/x", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if vehicleID != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("vehicleID", vehicleID)
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	}
	return r
}

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) vehicleInfoEnvelope {
	t.Helper()
	var env vehicleInfoEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
	}
	return env
}

func decodeErrBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	m := map[string]string{}
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, rec.Body.String())
	}
	return m
}

func assertContentTypeJSON(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
}

// ---------------------------------------------------------------------------
// resolveVIN
// ---------------------------------------------------------------------------

func TestResolveVIN(t *testing.T) {
	tests := []struct {
		name       string
		vehicleID  string
		finder     *fakeVehicleFinder
		wantVIN    string
		wantStatus int
		wantErr    bool
	}{
		{
			name:       "non-numeric id is a 400",
			vehicleID:  "abc",
			finder:     &fakeVehicleFinder{},
			wantStatus: http.StatusBadRequest,
			wantErr:    true,
		},
		{
			name:       "missing id is a 400",
			vehicleID:  "",
			finder:     &fakeVehicleFinder{},
			wantStatus: http.StatusBadRequest,
			wantErr:    true,
		},
		{
			name:       "repo error is a 500",
			vehicleID:  "7",
			finder:     &fakeVehicleFinder{err: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
			wantErr:    true,
		},
		{
			name:       "unknown vehicle is a 404",
			vehicleID:  "7",
			finder:     &fakeVehicleFinder{vehicle: nil},
			wantStatus: http.StatusNotFound,
			wantErr:    true,
		},
		{
			name:       "known vehicle returns vin + 200",
			vehicleID:  "7",
			finder:     &fakeVehicleFinder{vehicle: okVehicle()},
			wantVIN:    testVIN,
			wantStatus: http.StatusOK,
			wantErr:    false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandler(&fakeTeslaClient{}, newFakeConfigStore(), tt.finder)
			vin, status, err := h.resolveVIN(vehReq(http.MethodGet, tt.vehicleID))

			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if status != tt.wantStatus {
				t.Fatalf("status = %d, want %d", status, tt.wantStatus)
			}
			if vin != tt.wantVIN {
				t.Fatalf("vin = %q, want %q", vin, tt.wantVIN)
			}
		})
	}
}

func TestResolveVINOrWriteError_Responses(t *testing.T) {
	tests := []struct {
		name       string
		vehicleID  string
		finder     *fakeVehicleFinder
		wantOK     bool
		wantStatus int
		wantMsg    string
	}{
		{"bad id", "abc", &fakeVehicleFinder{}, false, http.StatusBadRequest, "invalid vehicle ID"},
		{"not found", "7", &fakeVehicleFinder{}, false, http.StatusNotFound, "vehicle not found"},
		{"repo error", "7", &fakeVehicleFinder{err: errors.New("boom-secret")}, false, http.StatusInternalServerError, "failed to resolve vehicle"},
		{"success", "7", &fakeVehicleFinder{vehicle: okVehicle()}, true, 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandler(&fakeTeslaClient{}, newFakeConfigStore(), tt.finder)
			rec := httptest.NewRecorder()
			vin, ok := h.resolveVINOrWriteError(rec, vehReq(http.MethodGet, tt.vehicleID))

			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if tt.wantOK {
				if vin != testVIN {
					t.Fatalf("vin = %q, want %q", vin, testVIN)
				}
				return
			}
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			body := decodeErrBody(t, rec)
			if body["error"] != tt.wantMsg {
				t.Fatalf("error = %q, want %q", body["error"], tt.wantMsg)
			}
			// Server-side failures must never leak the underlying error text.
			if strings.Contains(body["error"], "boom-secret") {
				t.Fatalf("internal error leaked to client: %q", body["error"])
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GET handlers — getVehicleConfig behaviour + per-endpoint config-key routing
// ---------------------------------------------------------------------------

func TestGetHandlers_ConfigKeyRouting(t *testing.T) {
	tests := []struct {
		name     string
		call     func(*Handler, http.ResponseWriter, *http.Request)
		wantKey  string
		needsVIN bool
	}{
		{"mobile-enabled", (*Handler).MobileEnabled, "mobile_enabled:" + testVIN, true},
		{"options", (*Handler).VehicleOptions, "vehicle_options:" + testVIN, true},
		{"specs", (*Handler).VehicleSpecs, "vehicle_specs:" + testVIN, true},
		{"subscriptions", (*Handler).SubscriptionEligibility, "subscriptions:" + testVIN, true},
		{"upgrades", (*Handler).UpgradeEligibility, "upgrades:" + testVIN, true},
		{"enterprise-roles", (*Handler).EnterpriseRoles, "enterprise_roles:" + testVIN, true},
		{"warranty", (*Handler).WarrantyDetails, "warranty", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := newFakeConfigStore()
			const data = `{"k":"v"}`
			cfg.byType[tt.wantKey] = &teslamodel.TeslaUserConfig{
				ConfigType: tt.wantKey,
				Data:       data,
				FetchedAt:  time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
			}
			h := newHandler(&fakeTeslaClient{}, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

			rec := httptest.NewRecorder()
			vehicleID := ""
			if tt.needsVIN {
				vehicleID = "7"
			}
			tt.call(h, rec, vehReq(http.MethodGet, vehicleID))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			assertContentTypeJSON(t, rec)
			env := decodeEnvelope(t, rec)
			if string(env.Data) != data {
				t.Fatalf("data = %s, want %s", env.Data, data)
			}
			if env.FetchedAt == nil || *env.FetchedAt != "2026-01-02T03:04:05Z" {
				t.Fatalf("fetched_at = %v, want 2026-01-02T03:04:05Z", env.FetchedAt)
			}
			found := false
			for _, k := range cfg.getKeys {
				if k == tt.wantKey {
					found = true
				}
			}
			if !found {
				t.Fatalf("handler queried keys %v, expected %q", cfg.getKeys, tt.wantKey)
			}
		})
	}
}

func TestGetVehicleConfig_AbsentReturnsJSONNull(t *testing.T) {
	h := newHandler(&fakeTeslaClient{}, newFakeConfigStore(), &fakeVehicleFinder{vehicle: okVehicle()})
	rec := httptest.NewRecorder()
	h.MobileEnabled(rec, vehReq(http.MethodGet, "7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	env := decodeEnvelope(t, rec)
	if string(env.Data) != "null" {
		t.Fatalf("data = %s, want null", env.Data)
	}
	if env.FetchedAt != nil {
		t.Fatalf("fetched_at = %v, want nil", *env.FetchedAt)
	}
}

func TestGetVehicleConfig_RepoErrorReturns500(t *testing.T) {
	cfg := newFakeConfigStore()
	cfg.getErr = errors.New("db down")
	h := newHandler(&fakeTeslaClient{}, cfg, &fakeVehicleFinder{vehicle: okVehicle()})
	rec := httptest.NewRecorder()
	h.MobileEnabled(rec, vehReq(http.MethodGet, "7"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if msg := decodeErrBody(t, rec)["error"]; msg != "failed to fetch vehicle info" {
		t.Fatalf("error = %q, want 'failed to fetch vehicle info'", msg)
	}
}

// A resolve failure in any vin-scoped GET must short-circuit before the config
// repo is touched, and surface the differentiated status.
func TestVINHandlers_PropagateResolveErrors(t *testing.T) {
	tests := []struct {
		name       string
		vehicleID  string
		finder     *fakeVehicleFinder
		wantStatus int
	}{
		{"bad id → 400", "abc", &fakeVehicleFinder{}, http.StatusBadRequest},
		{"unknown → 404", "7", &fakeVehicleFinder{}, http.StatusNotFound},
		{"repo error → 500", "7", &fakeVehicleFinder{err: errors.New("x")}, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := newFakeConfigStore()
			h := newHandler(&fakeTeslaClient{}, cfg, tt.finder)
			rec := httptest.NewRecorder()
			h.VehicleOptions(rec, vehReq(http.MethodGet, tt.vehicleID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if len(cfg.getKeys) != 0 {
				t.Fatalf("config repo queried on resolve failure: %v", cfg.getKeys)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Refresh handlers — success path, Tesla routing, and persistence
// ---------------------------------------------------------------------------

func TestRefresh_SuccessAndPersistence(t *testing.T) {
	tests := []struct {
		name       string
		call       func(*Handler, http.ResponseWriter, *http.Request)
		teslaBody  string
		wantMethod string
		wantKey    string
		wantData   string
		needsVIN   bool
		confirmed  bool
	}{
		{"mobile-enabled", (*Handler).RefreshMobileEnabled, `{"response":true}`, "mobile_enabled", "mobile_enabled:" + testVIN, `{"enabled":true}`, true, false},
		{"options", (*Handler).RefreshVehicleOptions, `{"response":{"codes":["A"]}}`, "vehicle_options", "vehicle_options:" + testVIN, `{"codes":["A"]}`, true, false},
		{"specs", (*Handler).RefreshVehicleSpecs, `{"response":{"weight":1000}}`, "vehicle_specs", "vehicle_specs:" + testVIN, `{"weight":1000}`, true, true},
		{"subscriptions", (*Handler).RefreshSubscriptionEligibility, `{"response":{"eligible":true}}`, "subscriptions", "subscriptions:" + testVIN, `{"eligible":true}`, true, false},
		{"upgrades", (*Handler).RefreshUpgradeEligibility, `{"response":{"tier":"x"}}`, "upgrades", "upgrades:" + testVIN, `{"tier":"x"}`, true, false},
		{"enterprise-roles", (*Handler).RefreshEnterpriseRoles, `{"response":{"roles":["fleet_manager"]}}`, "enterprise_roles", "enterprise_roles:" + testVIN, `{"roles":["fleet_manager"]}`, true, false},
		{"warranty", (*Handler).RefreshWarrantyDetails, `{"response":{"active":true}}`, "warranty", "warranty", `{"active":true}`, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(tt.teslaBody)}
			cfg := newFakeConfigStore()
			h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

			rec := httptest.NewRecorder()
			vehicleID := ""
			if tt.needsVIN {
				vehicleID = "7"
			}
			req := vehReq(http.MethodPost, vehicleID)
			if tt.confirmed {
				req = vehJSONReq(http.MethodPost, vehicleID, `{"confirmed":true}`)
			}
			tt.call(h, rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if len(tc.calls) != 1 {
				t.Fatalf("tesla calls = %d, want 1", len(tc.calls))
			}
			if tc.calls[0].method != tt.wantMethod {
				t.Fatalf("tesla method = %q, want %q", tc.calls[0].method, tt.wantMethod)
			}
			wantVin := ""
			if tt.needsVIN {
				wantVin = testVIN
			}
			if tc.calls[0].vin != wantVin {
				t.Fatalf("tesla vin = %q, want %q", tc.calls[0].vin, wantVin)
			}
			if len(cfg.upserts) != 1 {
				t.Fatalf("upserts = %d, want 1", len(cfg.upserts))
			}
			if cfg.upserts[0].configType != tt.wantKey {
				t.Fatalf("upsert key = %q, want %q", cfg.upserts[0].configType, tt.wantKey)
			}
			if cfg.upserts[0].data != tt.wantData {
				t.Fatalf("upsert data = %q, want %q", cfg.upserts[0].data, tt.wantData)
			}
			env := decodeEnvelope(t, rec)
			if string(env.Data) != tt.wantData {
				t.Fatalf("response data = %s, want %s", env.Data, tt.wantData)
			}
			if env.FetchedAt == nil {
				t.Fatalf("expected fetched_at to be set after refresh")
			}
		})
	}
}

func TestRefresh_ErrorPaths(t *testing.T) {
	tests := []struct {
		name       string
		tc         *fakeTeslaClient
		cfg        *fakeConfigStore
		wantStatus int
		wantUpsert bool
		wantNoCall bool
	}{
		{
			name:       "not authenticated → 401",
			tc:         &fakeTeslaClient{validToken: false},
			cfg:        newFakeConfigStore(),
			wantStatus: http.StatusUnauthorized,
			wantNoCall: true,
		},
		{
			name:       "tesla transport error → 502",
			tc:         &fakeTeslaClient{validToken: true, err: errors.New("timeout")},
			cfg:        newFakeConfigStore(),
			wantStatus: http.StatusBadGateway,
		},
		{
			name:       "tesla authorization failure remains 403",
			tc:         &fakeTeslaClient{validToken: true, status: http.StatusForbidden, body: []byte(`{"error":"nope"}`)},
			cfg:        newFakeConfigStore(),
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "unparseable tesla json → 500",
			tc:         &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`not json`)},
			cfg:        newFakeConfigStore(),
			wantStatus: http.StatusInternalServerError,
		},
		{
			name:       "persistence failure → 500",
			tc:         &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`{"response":true}`)},
			cfg:        &fakeConfigStore{byType: map[string]*teslamodel.TeslaUserConfig{}, upsertErr: errors.New("write fail")},
			wantStatus: http.StatusInternalServerError,
			wantUpsert: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newHandler(tt.tc, tt.cfg, &fakeVehicleFinder{vehicle: okVehicle()})
			rec := httptest.NewRecorder()
			h.RefreshMobileEnabled(rec, vehReq(http.MethodPost, "7"))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantUpsert && len(tt.cfg.upserts) == 0 {
				t.Fatalf("expected an upsert attempt")
			}
			if tt.wantNoCall && len(tt.tc.calls) != 0 {
				t.Fatalf("expected no Tesla call, got %d", len(tt.tc.calls))
			}
		})
	}
}

// TestRefreshMobileEnabled_Wrapping pins the mobile_enabled boolean-wrapping
// contract and guards the regression where an empty/null Tesla response
// produced syntactically invalid JSON (`{"enabled":}`).
func TestRefreshMobileEnabled_Wrapping(t *testing.T) {
	tests := []struct {
		name      string
		teslaBody string
		wantData  string
	}{
		{"true wraps to enabled:true", `{"response":true}`, `{"enabled":true}`},
		{"false wraps to enabled:false", `{"response":false}`, `{"enabled":false}`},
		{"null response normalises to empty object", `{"response":null}`, `{}`},
		{"missing response normalises to empty object", `{}`, `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(tt.teslaBody)}
			cfg := newFakeConfigStore()
			h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

			rec := httptest.NewRecorder()
			h.RefreshMobileEnabled(rec, vehReq(http.MethodPost, "7"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if len(cfg.upserts) != 1 {
				t.Fatalf("upserts = %d, want 1", len(cfg.upserts))
			}
			got := cfg.upserts[0].data
			if got != tt.wantData {
				t.Fatalf("persisted data = %q, want %q", got, tt.wantData)
			}
			if !json.Valid([]byte(got)) {
				t.Fatalf("persisted invalid JSON: %q", got)
			}
		})
	}
}

// Non-mobile endpoints must also collapse a null/empty Tesla response into a
// valid empty object rather than persisting "" or "null".
func TestRefresh_NonMobileNullResponseNormalises(t *testing.T) {
	tests := []struct {
		name      string
		teslaBody string
	}{
		{"null response", `{"response":null}`},
		{"missing response", `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(tt.teslaBody)}
			cfg := newFakeConfigStore()
			h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

			rec := httptest.NewRecorder()
			h.RefreshVehicleOptions(rec, vehReq(http.MethodPost, "7"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if got := cfg.upserts[0].data; got != "{}" {
				t.Fatalf("persisted data = %q, want {}", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// RefreshVehicleSpecs — paid-endpoint freshness guard
// ---------------------------------------------------------------------------

func TestRefreshVehicleSpecs_FreshnessGuard(t *testing.T) {
	key := "vehicle_specs:" + testVIN
	tests := []struct {
		name       string
		existing   *teslamodel.TeslaUserConfig
		getErr     error
		wantStatus int
		wantTesla  bool
	}{
		{
			name:       "fetched within 24h is rejected 429 without paying",
			existing:   &teslamodel.TeslaUserConfig{ConfigType: key, Data: "{}", FetchedAt: time.Now().Add(-1 * time.Hour)},
			wantStatus: http.StatusTooManyRequests,
			wantTesla:  false,
		},
		{
			name:       "fetched over 24h ago proceeds",
			existing:   &teslamodel.TeslaUserConfig{ConfigType: key, Data: "{}", FetchedAt: time.Now().Add(-25 * time.Hour)},
			wantStatus: http.StatusOK,
			wantTesla:  true,
		},
		{
			name:       "never fetched proceeds",
			existing:   nil,
			wantStatus: http.StatusOK,
			wantTesla:  true,
		},
		{
			name:       "freshness lookup failure → 500 without paying",
			getErr:     errors.New("db down"),
			wantStatus: http.StatusInternalServerError,
			wantTesla:  false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := newFakeConfigStore()
			if tt.existing != nil {
				cfg.byType[key] = tt.existing
			}
			cfg.getErr = tt.getErr
			tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`{"response":{"weight":1000}}`)}
			h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

			rec := httptest.NewRecorder()
			h.RefreshVehicleSpecs(rec, vehJSONReq(http.MethodPost, "7", `{"confirmed":true}`))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if calledTesla := len(tc.calls) > 0; calledTesla != tt.wantTesla {
				t.Fatalf("tesla called = %v, want %v", calledTesla, tt.wantTesla)
			}
		})
	}
}

func TestRefreshVehicleSpecs_RequiresExplicitConfirmation(t *testing.T) {
	tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`{"response":{}}`)}
	cfg := newFakeConfigStore()
	h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

	rec := httptest.NewRecorder()
	h.RefreshVehicleSpecs(rec, vehJSONReq(http.MethodPost, "7", `{"confirmed":false}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(tc.calls) != 0 {
		t.Fatalf("Tesla calls = %d, want 0", len(tc.calls))
	}
	if len(cfg.upserts) != 0 {
		t.Fatalf("upserts = %d, want 0", len(cfg.upserts))
	}
}

// A specs refresh that is guarded away must persist nothing.
func TestRefreshVehicleSpecs_GuardDoesNotPersist(t *testing.T) {
	key := "vehicle_specs:" + testVIN
	cfg := newFakeConfigStore()
	cfg.byType[key] = &teslamodel.TeslaUserConfig{ConfigType: key, Data: "{}", FetchedAt: time.Now()}
	tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`{"response":{}}`)}
	h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

	rec := httptest.NewRecorder()
	h.RefreshVehicleSpecs(rec, vehJSONReq(http.MethodPost, "7", `{"confirmed":true}`))

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if len(cfg.upserts) != 0 {
		t.Fatalf("guarded refresh persisted %d upsert(s), want 0", len(cfg.upserts))
	}
}

// The warranty endpoints are account-level and must not require a vehicle id.
func TestWarranty_DoesNotRequireVehicleID(t *testing.T) {
	tc := &fakeTeslaClient{validToken: true, status: http.StatusOK, body: []byte(`{"response":{"active":true}}`)}
	cfg := newFakeConfigStore()
	// A finder that would fail if consulted proves warranty never resolves a VIN.
	veh := &fakeVehicleFinder{err: errors.New("should not be called")}
	h := newHandler(tc, cfg, veh)

	rec := httptest.NewRecorder()
	h.RefreshWarrantyDetails(rec, vehReq(http.MethodPost, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if veh.gotID != 0 {
		t.Fatalf("vehicle finder was consulted for account-level warranty")
	}

	rec = httptest.NewRecorder()
	h.WarrantyDetails(rec, vehReq(http.MethodGet, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	env := decodeEnvelope(t, rec)
	if string(env.Data) != `{"active":true}` {
		t.Fatalf("warranty data = %s, want {\"active\":true}", env.Data)
	}
}

func TestOpaqueManagementRequestsRejectInvalidBodiesWithoutTeslaCall(t *testing.T) {
	oversized := `{"payload":{"blob":"` +
		strings.Repeat("x", int(maxOpaqueRequestBodyBytes)) +
		`"}}`
	tests := []struct {
		name       string
		call       func(*Handler, http.ResponseWriter, *http.Request)
		vehicleID  string
		body       string
		wantStatus int
	}{
		{
			name:       "pricing body required",
			call:       (*Handler).VehiclePricing,
			body:       "",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing payload rejects array",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":[]}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing payload rejects scalar",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":"unknown schema"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing payload rejects null",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":null}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing payload rejects empty object",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":{}}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing rejects trailing JSON",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":{"opaque":true}} {}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing rejects unknown wrapper fields",
			call:       (*Handler).VehiclePricing,
			body:       `{"payload":{"opaque":true},"method":"DELETE"}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "pricing enforces small body limit",
			call:       (*Handler).VehiclePricing,
			body:       oversized,
			wantStatus: http.StatusRequestEntityTooLarge,
		},
		{
			name:       "payer requires explicit confirmation",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":{"opaque":true}}`,
			wantStatus: http.StatusPreconditionFailed,
		},
		{
			name:       "payer rejects false confirmation",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":{"opaque":true},"confirmed":false}`,
			wantStatus: http.StatusPreconditionFailed,
		},
		{
			name:       "payer rejects empty object",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":{},"confirmed":true}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "payer rejects array",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":[1],"confirmed":true}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "payer rejects scalar",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":"unknown schema","confirmed":true}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "payer rejects null",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":null,"confirmed":true}`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "payer rejects trailing JSON",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       `{"payload":{"opaque":true},"confirmed":true} null`,
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "payer enforces small body limit",
			call:       (*Handler).EnterprisePayer,
			vehicleID:  "7",
			body:       strings.Replace(oversized, "}}", `},"confirmed":true}`, 1),
			wantStatus: http.StatusRequestEntityTooLarge,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &fakeTeslaClient{
				status: http.StatusOK,
				body:   []byte(`{"response":{"ok":true}}`),
			}
			cfg := newFakeConfigStore()
			h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})
			rec := httptest.NewRecorder()

			tt.call(h, rec, vehJSONReq(http.MethodPost, tt.vehicleID, tt.body))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if len(tc.calls) != 0 {
				t.Fatalf("invalid request made %d Tesla call(s), want 0", len(tc.calls))
			}
			if len(cfg.upserts) != 0 {
				t.Fatalf("invalid request persisted %d config row(s), want 0", len(cfg.upserts))
			}
		})
	}
}

func TestVehiclePricingForwardsOnlyOpaqueObject(t *testing.T) {
	tc := &fakeTeslaClient{
		status: http.StatusOK,
		body:   []byte(`{"response":{"currency":"USD","quote":17}}`),
	}
	cfg := newFakeConfigStore()
	h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})
	rec := httptest.NewRecorder()

	h.VehiclePricing(
		rec,
		vehJSONReq(
			http.MethodPost,
			"",
			`{"payload":{"opaque":{"nested":[1,true]}}}`,
		),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(tc.calls) != 1 || tc.calls[0].method != "vehicle_pricing" {
		t.Fatalf("calls = %+v, want one vehicle_pricing call", tc.calls)
	}
	if got := string(tc.calls[0].payload["opaque"]); got != `{"nested":[1,true]}` {
		t.Fatalf("opaque payload = %s", got)
	}
	if len(cfg.upserts) != 0 {
		t.Fatalf("pricing persisted %d row(s), want 0", len(cfg.upserts))
	}
	var result operationResultEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if string(result.Data) != `{"currency":"USD","quote":17}` {
		t.Fatalf("response data = %s", result.Data)
	}
}

func TestEnterpriseRolesCachedReadAndExplicitRefresh(t *testing.T) {
	key := "enterprise_roles:" + testVIN
	cfg := newFakeConfigStore()
	cfg.byType[key] = &teslamodel.TeslaUserConfig{
		ConfigType: key,
		Data:       `{"roles":["cached_role"]}`,
		FetchedAt:  time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC),
	}
	tc := &fakeTeslaClient{
		validToken: false,
		status:     http.StatusOK,
		body:       []byte(`{"response":{"roles":["refreshed_role"]}}`),
	}
	h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})

	rec := httptest.NewRecorder()
	h.EnterpriseRoles(rec, vehReq(http.MethodGet, "7"))
	if rec.Code != http.StatusOK {
		t.Fatalf("cached GET status = %d, want 200", rec.Code)
	}
	if len(tc.calls) != 0 {
		t.Fatalf("cached GET made %d Tesla call(s), want 0", len(tc.calls))
	}
	if got := string(decodeEnvelope(t, rec).Data); got != `{"roles":["cached_role"]}` {
		t.Fatalf("cached data = %s", got)
	}

	rec = httptest.NewRecorder()
	h.RefreshEnterpriseRoles(rec, vehReq(http.MethodPost, "7"))
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(tc.calls) != 1 || tc.calls[0].method != "enterprise_roles" {
		t.Fatalf("calls = %+v, want one enterprise_roles call", tc.calls)
	}
	if tc.calls[0].vin != testVIN {
		t.Fatalf("roles VIN = %q, want test VIN", tc.calls[0].vin)
	}
	if len(cfg.upserts) != 1 || cfg.upserts[0].configType != key {
		t.Fatalf("upserts = %+v, want enterprise roles cache row", cfg.upserts)
	}
}

func TestPartnerOnlyRefreshDoesNotRequireUserToken(t *testing.T) {
	tc := &fakeTeslaClient{
		validToken: false,
		status:     http.StatusOK,
		body:       []byte(`{"response":{"mass_kg":1800}}`),
	}
	h := newHandler(tc, newFakeConfigStore(), &fakeVehicleFinder{vehicle: okVehicle()})
	rec := httptest.NewRecorder()

	h.RefreshVehicleSpecs(rec, vehJSONReq(http.MethodPost, "7", `{"confirmed":true}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(tc.calls) != 1 || tc.calls[0].method != "vehicle_specs" {
		t.Fatalf("calls = %+v, want partner-scoped specs call", tc.calls)
	}
}

func TestEnterprisePayerRequiresConfirmationAndNeverPersistsPayload(t *testing.T) {
	tc := &fakeTeslaClient{
		status: http.StatusOK,
		body:   []byte(`{"response":{"updated":true}}`),
	}
	cfg := newFakeConfigStore()
	h := newHandler(tc, cfg, &fakeVehicleFinder{vehicle: okVehicle()})
	rec := httptest.NewRecorder()

	h.EnterprisePayer(
		rec,
		vehJSONReq(
			http.MethodPost,
			"7",
			`{"payload":{"opaque":{"nested":[1,true]}},"confirmed":true}`,
		),
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(tc.calls) != 1 || tc.calls[0].method != "enterprise_payer" {
		t.Fatalf("calls = %+v, want one enterprise_payer call", tc.calls)
	}
	if tc.calls[0].vin != testVIN {
		t.Fatalf("payer VIN = %q, want test VIN", tc.calls[0].vin)
	}
	if got := string(tc.calls[0].payload["opaque"]); got != `{"nested":[1,true]}` {
		t.Fatalf("payer payload = %s", got)
	}
	if len(cfg.upserts) != 0 {
		t.Fatalf("payer persisted %d row(s), want 0", len(cfg.upserts))
	}
}

func TestPartnerCapabilityFailuresPreserveExpectedStatus(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		err        error
		wantStatus int
	}{
		{"partner credentials missing", 0, tesla.ErrPartnerCredentialsMissing, http.StatusPreconditionFailed},
		{"partner authentication", http.StatusUnauthorized, errors.New("unauthorized"), http.StatusUnauthorized},
		{"payment required", http.StatusPaymentRequired, nil, http.StatusPaymentRequired},
		{"scope forbidden", http.StatusForbidden, nil, http.StatusForbidden},
		{"precondition", http.StatusPreconditionFailed, nil, http.StatusPreconditionFailed},
		{"rate limited", http.StatusTooManyRequests, nil, http.StatusTooManyRequests},
		{"upstream server error", http.StatusInternalServerError, errors.New("upstream"), http.StatusBadGateway},
		{"transport error", 0, errors.New("timeout"), http.StatusBadGateway},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tc := &fakeTeslaClient{status: tt.status, err: tt.err}
			h := newHandler(tc, newFakeConfigStore(), &fakeVehicleFinder{vehicle: okVehicle()})
			rec := httptest.NewRecorder()

			h.VehiclePricing(
				rec,
				vehJSONReq(http.MethodPost, "", `{"payload":{"opaque":true}}`),
			)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), `"data"`) {
				t.Fatalf("failure returned success-shaped data: %s", rec.Body.String())
			}
		})
	}
}
