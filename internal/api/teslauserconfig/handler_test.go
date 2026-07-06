package teslauserconfig

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// --- test doubles ------------------------------------------------------------

// fakeClient implements teslaConfigClient without any network or OAuth.
type fakeClient struct {
	hasToken bool

	featureFn func(ctx context.Context) ([]byte, int, error)
	regionFn  func(ctx context.Context) ([]byte, int, error)

	featureCalls int
	regionCalls  int
}

func (f *fakeClient) HasValidToken() bool { return f.hasToken }

func (f *fakeClient) GetUserFeatureConfig(ctx context.Context) ([]byte, int, error) {
	f.featureCalls++
	if f.featureFn != nil {
		return f.featureFn(ctx)
	}
	return []byte(`{"response":{}}`), http.StatusOK, nil
}

func (f *fakeClient) GetUserRegion(ctx context.Context) ([]byte, int, error) {
	f.regionCalls++
	if f.regionFn != nil {
		return f.regionFn(ctx)
	}
	return []byte(`{"response":{}}`), http.StatusOK, nil
}

// fakeStore implements teslaConfigStore. When getFn/upsertFn are nil it
// behaves as a simple in-memory store so refresh → getConfig round-trips work.
type fakeStore struct {
	getFn    func(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error)
	upsertFn func(ctx context.Context, configType, data string) error

	saved map[string]*teslamodel.TeslaUserConfig

	getTypes    []string
	getCalls    int
	upsertTypes []string
	upsertData  []string
	upsertCalls int
}

func newFakeStore() *fakeStore {
	return &fakeStore{saved: map[string]*teslamodel.TeslaUserConfig{}}
}

func (s *fakeStore) GetByType(ctx context.Context, configType string) (*teslamodel.TeslaUserConfig, error) {
	s.getCalls++
	s.getTypes = append(s.getTypes, configType)
	if s.getFn != nil {
		return s.getFn(ctx, configType)
	}
	if c, ok := s.saved[configType]; ok {
		return c, nil
	}
	return nil, nil
}

func (s *fakeStore) Upsert(ctx context.Context, configType, data string) error {
	s.upsertCalls++
	s.upsertTypes = append(s.upsertTypes, configType)
	s.upsertData = append(s.upsertData, data)
	if s.upsertFn != nil {
		return s.upsertFn(ctx, configType, data)
	}
	if s.saved == nil {
		s.saved = map[string]*teslamodel.TeslaUserConfig{}
	}
	s.saved[configType] = &teslamodel.TeslaUserConfig{
		ConfigType: configType,
		Data:       data,
		FetchedAt:  time.Date(2024, 5, 1, 12, 30, 45, 0, time.UTC),
	}
	return nil
}

// The doubles must satisfy the same ports the production wiring uses.
var (
	_ teslaConfigClient = (*fakeClient)(nil)
	_ teslaConfigStore  = (*fakeStore)(nil)
)

// newTestHandler wires arbitrary ports into a Handler (white-box).
func newTestHandler(c teslaConfigClient, s teslaConfigStore) *Handler {
	return &Handler{teslaClient: c, configRepo: s}
}

// --- helpers -----------------------------------------------------------------

type envelopeDTO struct {
	Data      json.RawMessage `json:"data"`
	FetchedAt *string         `json:"fetched_at"`
}

func strptr(s string) *string { return &s }

// jsonEqual reports whether a and b are semantically-equal JSON. It also
// fails the test if either side is not valid JSON — which is exactly the
// contract the blank-data hardening protects.
func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var av, bv any
	if err := json.Unmarshal(a, &av); err != nil {
		t.Fatalf("left is not valid JSON: %v (%q)", err, a)
	}
	if err := json.Unmarshal(b, &bv); err != nil {
		t.Fatalf("right is not valid JSON: %v (%q)", err, b)
	}
	return reflect.DeepEqual(av, bv)
}

func decodeErrBody(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, body)
	}
	return m
}

// --- NewHandler --------------------------------------------------------------

func TestNewHandler_Wiring(t *testing.T) {
	tc := tesla.NewClient(config.TeslaConfig{BaseURL: "http://localhost", Timeout: time.Second})
	h := NewHandler(tc, &database.DB{})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	gotTC, ok := h.teslaClient.(*tesla.Client)
	if !ok || gotTC != tc {
		t.Errorf("teslaClient = %#v, want the passed *tesla.Client", h.teslaClient)
	}
	if h.configRepo == nil {
		t.Fatal("configRepo not wired")
	}
	if _, ok := h.configRepo.(*tesladb.TeslaUserConfigRepo); !ok {
		t.Errorf("configRepo = %T, want *tesladb.TeslaUserConfigRepo", h.configRepo)
	}
}

// --- GET (FeatureConfig / Region → getConfig) --------------------------------

func TestGetConfig(t *testing.T) {
	fetchedAt := time.Date(2024, 5, 1, 12, 30, 45, 0, time.UTC)

	tests := []struct {
		name        string
		store       *fakeStore
		wantStatus  int
		wantErrCode string  // non-empty ⇒ expect an error envelope
		wantData    string  // canonical JSON expected in data
		wantFetched *string // expected fetched_at (nil ⇒ JSON null)
	}{
		{
			name: "repo error yields 500",
			store: &fakeStore{getFn: func(context.Context, string) (*teslamodel.TeslaUserConfig, error) {
				return nil, errors.New("pg pool exhausted")
			}},
			wantStatus:  http.StatusInternalServerError,
			wantErrCode: "INTERNAL_ERROR",
		},
		{
			name:        "not found yields empty object with null fetched_at",
			store:       newFakeStore(),
			wantStatus:  http.StatusOK,
			wantData:    "{}",
			wantFetched: nil,
		},
		{
			name: "stored config returned verbatim",
			store: &fakeStore{getFn: func(context.Context, string) (*teslamodel.TeslaUserConfig, error) {
				return &teslamodel.TeslaUserConfig{Data: `{"a":1,"b":true}`, FetchedAt: fetchedAt}, nil
			}},
			wantStatus:  http.StatusOK,
			wantData:    `{"a":1,"b":true}`,
			wantFetched: strptr("2024-05-01T12:30:45Z"),
		},
		{
			name: "blank data normalised to empty object",
			store: &fakeStore{getFn: func(context.Context, string) (*teslamodel.TeslaUserConfig, error) {
				return &teslamodel.TeslaUserConfig{Data: "", FetchedAt: fetchedAt}, nil
			}},
			wantStatus:  http.StatusOK,
			wantData:    "{}",
			wantFetched: strptr("2024-05-01T12:30:45Z"),
		},
		{
			name: "whitespace-only data normalised to empty object",
			store: &fakeStore{getFn: func(context.Context, string) (*teslamodel.TeslaUserConfig, error) {
				return &teslamodel.TeslaUserConfig{Data: "  \n\t ", FetchedAt: fetchedAt}, nil
			}},
			wantStatus:  http.StatusOK,
			wantData:    "{}",
			wantFetched: strptr("2024-05-01T12:30:45Z"),
		},
		{
			name: "non-UTC fetched_at is rendered in UTC",
			store: &fakeStore{getFn: func(context.Context, string) (*teslamodel.TeslaUserConfig, error) {
				loc := time.FixedZone("UTC+2", 2*3600)
				return &teslamodel.TeslaUserConfig{
					Data:      `{"x":"y"}`,
					FetchedAt: time.Date(2024, 5, 1, 14, 30, 45, 0, loc), // == 12:30:45Z
				}, nil
			}},
			wantStatus:  http.StatusOK,
			wantData:    `{"x":"y"}`,
			wantFetched: strptr("2024-05-01T12:30:45Z"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHandler(&fakeClient{}, tt.store)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/tesla/user/feature-config", nil)

			h.FeatureConfig(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}

			if tt.wantErrCode != "" {
				m := decodeErrBody(t, rec.Body.Bytes())
				if m["code"] != tt.wantErrCode {
					t.Errorf("code = %q, want %q", m["code"], tt.wantErrCode)
				}
				if m["error"] == "" {
					t.Errorf("expected non-empty error message; got %v", m)
				}
				return
			}

			var env envelopeDTO
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
			}
			if !jsonEqual(t, env.Data, []byte(tt.wantData)) {
				t.Errorf("data = %s, want %s", env.Data, tt.wantData)
			}
			switch {
			case tt.wantFetched == nil && env.FetchedAt != nil:
				t.Errorf("fetched_at = %q, want null", *env.FetchedAt)
			case tt.wantFetched != nil && env.FetchedAt == nil:
				t.Errorf("fetched_at = null, want %q", *tt.wantFetched)
			case tt.wantFetched != nil && *env.FetchedAt != *tt.wantFetched:
				t.Errorf("fetched_at = %q, want %q", *env.FetchedAt, *tt.wantFetched)
			}
		})
	}
}

// TestGetConfig_PassesConfigType proves FeatureConfig and Region read the
// correct config_type key from the store.
func TestGetConfig_PassesConfigType(t *testing.T) {
	tests := []struct {
		name     string
		call     func(*Handler, http.ResponseWriter, *http.Request)
		wantType string
	}{
		{"feature-config", (*Handler).FeatureConfig, "feature_config"},
		{"region", (*Handler).Region, "region"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := newFakeStore()
			h := newTestHandler(&fakeClient{}, store)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/x", nil)

			tt.call(h, rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if len(store.getTypes) != 1 || store.getTypes[0] != tt.wantType {
				t.Fatalf("GetByType types = %v, want [%s]", store.getTypes, tt.wantType)
			}
		})
	}
}

// --- POST refresh (RefreshFeatureConfig → refreshConfig) ---------------------

func TestRefreshFeatureConfig(t *testing.T) {
	tests := []struct {
		name          string
		hasToken      bool
		fetchBody     string
		fetchStatus   int
		fetchErr      error
		upsertErr     error
		wantStatus    int
		wantErrCode   string // non-empty ⇒ expect error envelope
		wantFetchCall bool
		wantUpsert    bool
		wantData      string // success ⇒ canonical data persisted + echoed
	}{
		{
			name:          "unauthenticated returns 401 without side effects",
			hasToken:      false,
			wantStatus:    http.StatusUnauthorized,
			wantErrCode:   "UNAUTHORIZED",
			wantFetchCall: false,
			wantUpsert:    false,
		},
		{
			name:          "fetch transport error returns 502",
			hasToken:      true,
			fetchErr:      errors.New("dial tcp: connection refused"),
			wantStatus:    http.StatusBadGateway,
			wantErrCode:   "ERROR",
			wantFetchCall: true,
			wantUpsert:    false,
		},
		{
			name:          "tesla 5xx status returns 502",
			hasToken:      true,
			fetchBody:     `{"error":"upstream"}`,
			fetchStatus:   http.StatusInternalServerError,
			wantStatus:    http.StatusBadGateway,
			wantErrCode:   "ERROR",
			wantFetchCall: true,
			wantUpsert:    false,
		},
		{
			name:          "tesla 4xx status returns 502",
			hasToken:      true,
			fetchBody:     `{"error":"forbidden"}`,
			fetchStatus:   http.StatusForbidden,
			wantStatus:    http.StatusBadGateway,
			wantErrCode:   "ERROR",
			wantFetchCall: true,
			wantUpsert:    false,
		},
		{
			name:          "status just below 200 returns 502 (lower boundary)",
			hasToken:      true,
			fetchBody:     `{"response":{}}`,
			fetchStatus:   http.StatusContinue, // 100
			wantStatus:    http.StatusBadGateway,
			wantErrCode:   "ERROR",
			wantFetchCall: true,
			wantUpsert:    false,
		},
		{
			name:          "status 299 is treated as success (upper boundary)",
			hasToken:      true,
			fetchBody:     `{"response":{"edge":true}}`,
			fetchStatus:   299,
			wantStatus:    http.StatusOK,
			wantFetchCall: true,
			wantUpsert:    true,
			wantData:      `{"edge":true}`,
		},
		{
			name:          "malformed tesla body returns 500",
			hasToken:      true,
			fetchBody:     `this is not json`,
			fetchStatus:   http.StatusOK,
			wantStatus:    http.StatusInternalServerError,
			wantErrCode:   "INTERNAL_ERROR",
			wantFetchCall: true,
			wantUpsert:    false,
		},
		{
			name:          "null response persists empty object",
			hasToken:      true,
			fetchBody:     `{"response":null}`,
			fetchStatus:   http.StatusOK,
			wantStatus:    http.StatusOK,
			wantFetchCall: true,
			wantUpsert:    true,
			wantData:      "{}",
		},
		{
			name:          "missing response field persists empty object",
			hasToken:      true,
			fetchBody:     `{}`,
			fetchStatus:   http.StatusOK,
			wantStatus:    http.StatusOK,
			wantFetchCall: true,
			wantUpsert:    true,
			wantData:      "{}",
		},
		{
			name:          "successful refresh persists and echoes data",
			hasToken:      true,
			fetchBody:     `{"response":{"foo":"bar","n":3}}`,
			fetchStatus:   http.StatusOK,
			wantStatus:    http.StatusOK,
			wantFetchCall: true,
			wantUpsert:    true,
			wantData:      `{"foo":"bar","n":3}`,
		},
		{
			name:          "upsert failure returns 500",
			hasToken:      true,
			fetchBody:     `{"response":{"ok":true}}`,
			fetchStatus:   http.StatusOK,
			upsertErr:     errors.New("unique violation"),
			wantStatus:    http.StatusInternalServerError,
			wantErrCode:   "INTERNAL_ERROR",
			wantFetchCall: true,
			wantUpsert:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &fakeClient{
				hasToken: tt.hasToken,
				featureFn: func(ctx context.Context) ([]byte, int, error) {
					if _, ok := ctx.Deadline(); !ok {
						t.Error("fetch ctx has no deadline — context.WithTimeout not applied")
					}
					if tt.fetchErr != nil {
						return nil, 0, tt.fetchErr
					}
					return []byte(tt.fetchBody), tt.fetchStatus, nil
				},
			}
			store := newFakeStore()
			if tt.upsertErr != nil {
				store.upsertFn = func(context.Context, string, string) error { return tt.upsertErr }
			}
			h := newTestHandler(client, store)

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/tesla/user/feature-config/refresh", nil)
			h.RefreshFeatureConfig(rec, req)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if (client.featureCalls > 0) != tt.wantFetchCall {
				t.Errorf("feature fetch called = %v (n=%d), want %v", client.featureCalls > 0, client.featureCalls, tt.wantFetchCall)
			}
			if client.regionCalls != 0 {
				t.Errorf("region fetch called %d times; feature endpoint must never touch region", client.regionCalls)
			}
			if (store.upsertCalls > 0) != tt.wantUpsert {
				t.Errorf("upsert called = %v (n=%d), want %v", store.upsertCalls > 0, store.upsertCalls, tt.wantUpsert)
			}

			if tt.wantErrCode != "" {
				m := decodeErrBody(t, rec.Body.Bytes())
				if m["code"] != tt.wantErrCode {
					t.Errorf("code = %q, want %q", m["code"], tt.wantErrCode)
				}
				if m["error"] == "" {
					t.Errorf("expected non-empty error message; got %v", m)
				}
				return
			}

			// success path assertions
			if store.upsertTypes[0] != "feature_config" {
				t.Errorf("upsert configType = %q, want feature_config", store.upsertTypes[0])
			}
			if !jsonEqual(t, []byte(store.upsertData[0]), []byte(tt.wantData)) {
				t.Errorf("persisted data = %s, want %s", store.upsertData[0], tt.wantData)
			}
			var env envelopeDTO
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
			}
			if !jsonEqual(t, env.Data, []byte(tt.wantData)) {
				t.Errorf("echoed data = %s, want %s", env.Data, tt.wantData)
			}
			if env.FetchedAt == nil {
				t.Error("fetched_at is null after a successful refresh, want a timestamp")
			}
		})
	}
}

// TestRefreshRegion mirrors the feature path but proves the region endpoint
// routes to GetUserRegion and persists under the "region" key.
func TestRefreshRegion(t *testing.T) {
	t.Run("routes to region method and persists under region type", func(t *testing.T) {
		client := &fakeClient{
			hasToken: true,
			regionFn: func(ctx context.Context) ([]byte, int, error) {
				if _, ok := ctx.Deadline(); !ok {
					t.Error("fetch ctx has no deadline — context.WithTimeout not applied")
				}
				return []byte(`{"response":{"region":"na","fleet_api_base_url":"https://x"}}`), http.StatusOK, nil
			},
		}
		store := newFakeStore()
		h := newTestHandler(client, store)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/tesla/user/region/refresh", nil)
		h.RefreshRegion(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if client.regionCalls != 1 {
			t.Errorf("region fetch calls = %d, want 1", client.regionCalls)
		}
		if client.featureCalls != 0 {
			t.Errorf("feature fetch calls = %d, want 0; region endpoint must never touch feature", client.featureCalls)
		}
		if len(store.upsertTypes) != 1 || store.upsertTypes[0] != "region" {
			t.Fatalf("upsert types = %v, want [region]", store.upsertTypes)
		}
		if !jsonEqual(t, []byte(store.upsertData[0]), []byte(`{"region":"na","fleet_api_base_url":"https://x"}`)) {
			t.Errorf("persisted data = %s", store.upsertData[0])
		}
		var env envelopeDTO
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode envelope: %v; body=%s", err, rec.Body.String())
		}
		if env.FetchedAt == nil {
			t.Error("fetched_at is null after a successful region refresh")
		}
	})

	t.Run("unauthenticated returns 401 without side effects", func(t *testing.T) {
		client := &fakeClient{hasToken: false}
		store := newFakeStore()
		h := newTestHandler(client, store)

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/tesla/user/region/refresh", nil)
		h.RefreshRegion(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
		}
		if client.regionCalls != 0 || store.upsertCalls != 0 {
			t.Errorf("region endpoint touched deps while unauthenticated: regionCalls=%d upsertCalls=%d",
				client.regionCalls, store.upsertCalls)
		}
	})
}
