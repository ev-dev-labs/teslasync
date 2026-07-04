package energysite

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/go-chi/chi/v5"
)

// ---------------------------------------------------------------------------
// Test doubles (ports declared in handler.go). Same-package tests can satisfy
// the unexported teslaEnergyClient / energySiteStore interfaces directly.
// ---------------------------------------------------------------------------

type fakeEnergyClient struct {
	hasToken bool

	productsBody   []byte
	productsStatus int
	productsErr    error
	productsCalls  int

	siteInfoBody   []byte
	siteInfoStatus int
	siteInfoErr    error
	siteInfoCalls  int
	gotSiteInfoID  int64

	touBody    []byte
	touStatus  int
	touErr     error
	touCalls   int
	gotTOUID   int64
	gotTOUBody []byte
}

func (f *fakeEnergyClient) HasValidToken() bool { return f.hasToken }

func (f *fakeEnergyClient) GetProducts(_ context.Context) ([]byte, int, error) {
	f.productsCalls++
	return f.productsBody, f.productsStatus, f.productsErr
}

func (f *fakeEnergyClient) GetEnergySiteInfo(_ context.Context, id int64) ([]byte, int, error) {
	f.siteInfoCalls++
	f.gotSiteInfoID = id
	return f.siteInfoBody, f.siteInfoStatus, f.siteInfoErr
}

func (f *fakeEnergyClient) SetEnergySiteTOUSettings(_ context.Context, id int64, body io.Reader) ([]byte, int, error) {
	f.touCalls++
	f.gotTOUID = id
	if body != nil {
		f.gotTOUBody, _ = io.ReadAll(body)
	}
	return f.touBody, f.touStatus, f.touErr
}

type fakeSiteRepo struct {
	getAll    []*teslamodel.TeslaEnergySite
	getAllErr error
	getAllN   int

	replaceErr error
	replaceN   int
	replaceGot []*teslamodel.TeslaEnergySite

	infoJSON  *string
	infoTime  *time.Time
	infoErr   error
	getInfoN  int
	getInfoID int64

	updateErr  error
	updateN    int
	updateID   int64
	updateJSON string
}

func (f *fakeSiteRepo) GetAll(_ context.Context) ([]*teslamodel.TeslaEnergySite, error) {
	f.getAllN++
	return f.getAll, f.getAllErr
}

func (f *fakeSiteRepo) ReplaceAll(_ context.Context, sites []*teslamodel.TeslaEnergySite) error {
	f.replaceN++
	f.replaceGot = sites
	return f.replaceErr
}

func (f *fakeSiteRepo) GetSiteInfo(_ context.Context, id int64) (*string, *time.Time, error) {
	f.getInfoN++
	f.getInfoID = id
	return f.infoJSON, f.infoTime, f.infoErr
}

func (f *fakeSiteRepo) UpdateSiteInfo(_ context.Context, id int64, siteInfoJSON string) error {
	f.updateN++
	f.updateID = id
	f.updateJSON = siteInfoJSON
	return f.updateErr
}

// Compile-time assertions the fakes implement the production ports.
var (
	_ teslaEnergyClient = (*fakeEnergyClient)(nil)
	_ energySiteStore   = (*fakeSiteRepo)(nil)
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(tc teslaEnergyClient, repo energySiteStore) *EnergySiteHandler {
	return &EnergySiteHandler{teslaClient: tc, repo: repo}
}

// siteReq builds a request with the chi {siteID} URL param wired so
// apiparams.URLParamInt64(r, "siteID") resolves inside the handler.
func siteReq(t *testing.T, method, siteID string, body io.Reader) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, "/tesla/energy-sites/"+siteID+"/x", body)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("siteID", siteID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

func decodeErrorBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v; raw=%q", err, rec.Body.String())
	}
	return m
}

func strptr(s string) *string        { return &s }
func timeptr(t time.Time) *time.Time { return &t }

func sampleSite(id int64, name string) *teslamodel.TeslaEnergySite {
	return &teslamodel.TeslaEnergySite{
		EnergySiteID: id,
		ResourceType: "battery",
		SiteName:     name,
		HasBattery:   true,
	}
}

// productsEnvelope marshals a Tesla /products response envelope.
func productsEnvelope(t *testing.T, products ...map[string]any) []byte {
	t.Helper()
	resp := make([]json.RawMessage, 0, len(products))
	for _, p := range products {
		b, err := json.Marshal(p)
		if err != nil {
			t.Fatalf("marshal product: %v", err)
		}
		resp = append(resp, b)
	}
	env := map[string]any{"count": len(products), "response": resp}
	b, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return b
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestEnergySiteHandler_List(t *testing.T) {
	tests := []struct {
		name       string
		repo       *fakeSiteRepo
		wantStatus int
		wantLen    int
		wantErr    bool
	}{
		{
			name:       "success with sites",
			repo:       &fakeSiteRepo{getAll: []*teslamodel.TeslaEnergySite{sampleSite(1, "A"), sampleSite(2, "B")}},
			wantStatus: http.StatusOK,
			wantLen:    2,
		},
		{
			name:       "empty renders json array not null",
			repo:       &fakeSiteRepo{getAll: nil},
			wantStatus: http.StatusOK,
			wantLen:    0,
		},
		{
			name:       "repo error yields 500",
			repo:       &fakeSiteRepo{getAllErr: errors.New("db down")},
			wantStatus: http.StatusInternalServerError,
			wantErr:    true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(&fakeEnergyClient{}, tc.repo)
			rec := httptest.NewRecorder()
			h.List(rec, httptest.NewRequest(http.MethodGet, "/tesla/energy-sites", nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantErr {
				if got := decodeErrorBody(t, rec)["error"]; got == "" {
					t.Fatalf("expected error message in body, got %q", rec.Body.String())
				}
				return
			}
			// Body must be a JSON array (never null), of the expected length.
			body := strings.TrimSpace(rec.Body.String())
			if !strings.HasPrefix(body, "[") {
				t.Fatalf("body is not a JSON array: %q", body)
			}
			var sites []teslamodel.TeslaEnergySite
			if err := json.Unmarshal(rec.Body.Bytes(), &sites); err != nil {
				t.Fatalf("decode sites: %v", err)
			}
			if len(sites) != tc.wantLen {
				t.Fatalf("len(sites) = %d, want %d", len(sites), tc.wantLen)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Fatalf("content-type = %q", ct)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

func TestEnergySiteHandler_Refresh(t *testing.T) {
	validBody := func(t *testing.T) []byte {
		return productsEnvelope(t,
			map[string]any{"resource_type": "vehicle", "id": 99, "vin": "5YJ"},
			map[string]any{
				"resource_type":  "battery",
				"energy_site_id": 12345,
				"site_name":      "Home",
				"components":     map[string]any{"solar": true, "battery": true, "tou_capable": true},
			},
		)
	}

	tests := []struct {
		name         string
		client       *fakeEnergyClient
		repo         *fakeSiteRepo
		wantStatus   int
		wantErr      bool
		wantReplaceN int
		wantLen      int
	}{
		{
			name:       "unauthenticated yields 401",
			client:     &fakeEnergyClient{hasToken: false},
			repo:       &fakeSiteRepo{},
			wantStatus: http.StatusUnauthorized,
			wantErr:    true,
		},
		{
			name:       "tesla transport error yields 502",
			client:     &fakeEnergyClient{hasToken: true, productsErr: errors.New("dial tcp: timeout")},
			repo:       &fakeSiteRepo{},
			wantStatus: http.StatusBadGateway,
			wantErr:    true,
		},
		{
			name:       "tesla non-2xx yields 502",
			client:     &fakeEnergyClient{hasToken: true, productsStatus: 503, productsBody: []byte("upstream unavailable")},
			repo:       &fakeSiteRepo{},
			wantStatus: http.StatusBadGateway,
			wantErr:    true,
		},
		{
			name:       "malformed products json yields 500",
			client:     &fakeEnergyClient{hasToken: true, productsStatus: 200, productsBody: []byte("{not json")},
			repo:       &fakeSiteRepo{},
			wantStatus: http.StatusInternalServerError,
			wantErr:    true,
		},
		{
			name:         "replaceAll error yields 500",
			client:       &fakeEnergyClient{hasToken: true, productsStatus: 200, productsBody: validBody(t)},
			repo:         &fakeSiteRepo{replaceErr: errors.New("tx failed")},
			wantStatus:   http.StatusInternalServerError,
			wantErr:      true,
			wantReplaceN: 1,
		},
		{
			name:         "getAll after refresh error yields 500",
			client:       &fakeEnergyClient{hasToken: true, productsStatus: 200, productsBody: validBody(t)},
			repo:         &fakeSiteRepo{getAllErr: errors.New("read failed")},
			wantStatus:   http.StatusInternalServerError,
			wantErr:      true,
			wantReplaceN: 1,
		},
		{
			name:         "success returns stored sites",
			client:       &fakeEnergyClient{hasToken: true, productsStatus: 200, productsBody: validBody(t)},
			repo:         &fakeSiteRepo{getAll: []*teslamodel.TeslaEnergySite{sampleSite(12345, "Home")}},
			wantStatus:   http.StatusOK,
			wantReplaceN: 1,
			wantLen:      1,
		},
		{
			name:         "success with empty store renders json array",
			client:       &fakeEnergyClient{hasToken: true, productsStatus: 200, productsBody: validBody(t)},
			repo:         &fakeSiteRepo{getAll: nil},
			wantStatus:   http.StatusOK,
			wantReplaceN: 1,
			wantLen:      0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(tc.client, tc.repo)
			rec := httptest.NewRecorder()
			h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/tesla/energy-sites/refresh", nil))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.repo.replaceN != tc.wantReplaceN {
				t.Fatalf("ReplaceAll calls = %d, want %d", tc.repo.replaceN, tc.wantReplaceN)
			}
			if tc.wantErr {
				if got := decodeErrorBody(t, rec)["error"]; got == "" {
					t.Fatalf("expected error body, got %q", rec.Body.String())
				}
				return
			}
			var sites []teslamodel.TeslaEnergySite
			if err := json.Unmarshal(rec.Body.Bytes(), &sites); err != nil {
				t.Fatalf("decode sites: %v; raw=%s", err, rec.Body.String())
			}
			if len(sites) != tc.wantLen {
				t.Fatalf("len(sites) = %d, want %d", len(sites), tc.wantLen)
			}
			// The vehicle product must have been filtered out before ReplaceAll.
			if tc.wantReplaceN > 0 {
				if len(tc.repo.replaceGot) != 1 {
					t.Fatalf("ReplaceAll received %d sites, want 1 (vehicle filtered)", len(tc.repo.replaceGot))
				}
				if tc.repo.replaceGot[0].EnergySiteID != 12345 {
					t.Fatalf("ReplaceAll site id = %d, want 12345", tc.repo.replaceGot[0].EnergySiteID)
				}
			}
		})
	}
}

func TestEnergySiteHandler_Refresh_UnauthenticatedSkipsTeslaCall(t *testing.T) {
	client := &fakeEnergyClient{hasToken: false}
	h := newHandler(client, &fakeSiteRepo{})
	rec := httptest.NewRecorder()
	h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/tesla/energy-sites/refresh", nil))

	if client.productsCalls != 0 {
		t.Fatalf("GetProducts called %d times, want 0 (no valid token)", client.productsCalls)
	}
	if got := decodeErrorBody(t, rec)["code"]; got != "UNAUTHORIZED" {
		t.Fatalf("code = %q, want UNAUTHORIZED", got)
	}
}

// ---------------------------------------------------------------------------
// SiteInfo
// ---------------------------------------------------------------------------

func TestEnergySiteHandler_SiteInfo(t *testing.T) {
	ts := time.Date(2026, 5, 1, 12, 30, 0, 0, time.UTC)

	t.Run("invalid site id yields 400", func(t *testing.T) {
		h := newHandler(&fakeEnergyClient{}, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.SiteInfo(rec, siteReq(t, http.MethodGet, "not-a-number", nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if got := decodeErrorBody(t, rec)["code"]; got != "BAD_REQUEST" {
			t.Fatalf("code = %q, want BAD_REQUEST", got)
		}
	})

	t.Run("repo error yields 500", func(t *testing.T) {
		h := newHandler(&fakeEnergyClient{}, &fakeSiteRepo{infoErr: errors.New("query failed")})
		rec := httptest.NewRecorder()
		h.SiteInfo(rec, siteReq(t, http.MethodGet, "42", nil))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("no stored site info yields data null", func(t *testing.T) {
		repo := &fakeSiteRepo{infoJSON: nil, infoTime: nil}
		h := newHandler(&fakeEnergyClient{}, repo)
		rec := httptest.NewRecorder()
		h.SiteInfo(rec, siteReq(t, http.MethodGet, "42", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if repo.getInfoID != 42 {
			t.Fatalf("GetSiteInfo id = %d, want 42", repo.getInfoID)
		}
		var env struct {
			Data      json.RawMessage `json:"data"`
			FetchedAt *string         `json:"fetched_at"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v; raw=%s", err, rec.Body.String())
		}
		if strings.TrimSpace(string(env.Data)) != "null" {
			t.Fatalf("data = %s, want null", env.Data)
		}
		if env.FetchedAt != nil {
			t.Fatalf("fetched_at = %v, want null", *env.FetchedAt)
		}
	})

	t.Run("stored site info with timestamp", func(t *testing.T) {
		raw := `{"backup_reserve_percent":20,"version":"1.2.3"}`
		repo := &fakeSiteRepo{infoJSON: strptr(raw), infoTime: timeptr(ts)}
		h := newHandler(&fakeEnergyClient{}, repo)
		rec := httptest.NewRecorder()
		h.SiteInfo(rec, siteReq(t, http.MethodGet, "7", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var env struct {
			Data      map[string]any `json:"data"`
			FetchedAt *string        `json:"fetched_at"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v; raw=%s", err, rec.Body.String())
		}
		if env.Data["version"] != "1.2.3" {
			t.Fatalf("data.version = %v, want 1.2.3", env.Data["version"])
		}
		if env.FetchedAt == nil || *env.FetchedAt != "2026-05-01T12:30:00Z" {
			t.Fatalf("fetched_at = %v, want 2026-05-01T12:30:00Z", env.FetchedAt)
		}
	})

	// Regression: a row with site_info_json present but a NULL
	// site_info_fetched_at previously panicked on fetchedAt.Format(...).
	t.Run("stored site info with nil timestamp does not panic", func(t *testing.T) {
		raw := `{"ok":true}`
		repo := &fakeSiteRepo{infoJSON: strptr(raw), infoTime: nil}
		h := newHandler(&fakeEnergyClient{}, repo)
		rec := httptest.NewRecorder()
		h.SiteInfo(rec, siteReq(t, http.MethodGet, "7", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		var env struct {
			Data      map[string]any `json:"data"`
			FetchedAt *string        `json:"fetched_at"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode: %v; raw=%s", err, rec.Body.String())
		}
		if env.Data["ok"] != true {
			t.Fatalf("data.ok = %v, want true", env.Data["ok"])
		}
		if env.FetchedAt != nil {
			t.Fatalf("fetched_at = %v, want null", *env.FetchedAt)
		}
	})
}

// ---------------------------------------------------------------------------
// RefreshSiteInfo
// ---------------------------------------------------------------------------

func TestEnergySiteHandler_RefreshSiteInfo(t *testing.T) {
	ts := time.Date(2026, 6, 2, 8, 0, 0, 0, time.UTC)

	t.Run("invalid site id yields 400", func(t *testing.T) {
		h := newHandler(&fakeEnergyClient{hasToken: true}, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "abc", nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
	})

	t.Run("unauthenticated yields 401", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: false}
		h := newHandler(client, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rec.Code)
		}
		if client.siteInfoCalls != 0 {
			t.Fatalf("GetEnergySiteInfo called %d times, want 0", client.siteInfoCalls)
		}
	})

	t.Run("tesla transport error yields 502", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoErr: errors.New("timeout")}
		h := newHandler(client, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
	})

	t.Run("tesla non-2xx yields 502", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 404, siteInfoBody: []byte("nope")}
		h := newHandler(client, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("status = %d, want 502", rec.Code)
		}
	})

	t.Run("malformed envelope yields 500", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 200, siteInfoBody: []byte("{bad")}
		h := newHandler(client, &fakeSiteRepo{})
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("null inner response stores empty object", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 200, siteInfoBody: []byte(`{"response":null}`)}
		repo := &fakeSiteRepo{infoJSON: strptr("{}"), infoTime: timeptr(ts)}
		h := newHandler(client, repo)
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if repo.updateJSON != "{}" {
			t.Fatalf("UpdateSiteInfo json = %q, want {}", repo.updateJSON)
		}
	})

	t.Run("update error yields 500", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 200, siteInfoBody: []byte(`{"response":{"a":1}}`)}
		repo := &fakeSiteRepo{updateErr: errors.New("not found")}
		h := newHandler(client, repo)
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if repo.updateN != 1 {
			t.Fatalf("UpdateSiteInfo calls = %d, want 1", repo.updateN)
		}
	})

	t.Run("readback nil yields 500", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 200, siteInfoBody: []byte(`{"response":{"a":1}}`)}
		repo := &fakeSiteRepo{infoJSON: nil} // read-back finds nothing
		h := newHandler(client, repo)
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
	})

	t.Run("success stores inner json and returns envelope", func(t *testing.T) {
		inner := `{"backup_reserve_percent":30,"operation":"self_consumption"}`
		client := &fakeEnergyClient{
			hasToken:       true,
			siteInfoStatus: 200,
			siteInfoBody:   []byte(`{"response":` + inner + `}`),
		}
		repo := &fakeSiteRepo{infoJSON: strptr(inner), infoTime: timeptr(ts)}
		h := newHandler(client, repo)
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "77", nil))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if client.gotSiteInfoID != 77 {
			t.Fatalf("GetEnergySiteInfo id = %d, want 77", client.gotSiteInfoID)
		}
		if repo.updateID != 77 {
			t.Fatalf("UpdateSiteInfo id = %d, want 77", repo.updateID)
		}
		// The stored payload is the unwrapped inner response, not the envelope.
		var got, want map[string]any
		if err := json.Unmarshal([]byte(repo.updateJSON), &got); err != nil {
			t.Fatalf("stored json not valid: %v (%q)", err, repo.updateJSON)
		}
		if err := json.Unmarshal([]byte(inner), &want); err != nil {
			t.Fatalf("inner fixture invalid: %v", err)
		}
		if got["operation"] != want["operation"] {
			t.Fatalf("stored operation = %v, want %v", got["operation"], want["operation"])
		}
		var env struct {
			Data      map[string]any `json:"data"`
			FetchedAt *string        `json:"fetched_at"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode response: %v; raw=%s", err, rec.Body.String())
		}
		if env.FetchedAt == nil || *env.FetchedAt != "2026-06-02T08:00:00Z" {
			t.Fatalf("fetched_at = %v, want 2026-06-02T08:00:00Z", env.FetchedAt)
		}
	})

	// Defensive: read-back returning a nil timestamp must not panic.
	t.Run("success with nil readback timestamp does not panic", func(t *testing.T) {
		client := &fakeEnergyClient{hasToken: true, siteInfoStatus: 200, siteInfoBody: []byte(`{"response":{"a":1}}`)}
		repo := &fakeSiteRepo{infoJSON: strptr(`{"a":1}`), infoTime: nil}
		h := newHandler(client, repo)
		rec := httptest.NewRecorder()
		h.RefreshSiteInfo(rec, siteReq(t, http.MethodPost, "42", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"fetched_at":null`) {
			t.Fatalf("body should contain null fetched_at, got %s", rec.Body.String())
		}
	})
}

// ---------------------------------------------------------------------------
// UpdateTOUSettings
// ---------------------------------------------------------------------------

func TestEnergySiteHandler_UpdateTOUSettings(t *testing.T) {
	tests := []struct {
		name          string
		siteID        string
		client        *fakeEnergyClient
		reqBody       string
		wantStatus    int
		wantBody      string // exact expected response body (when non-empty)
		wantForwarded bool   // whether SetEnergySiteTOUSettings should have been called
	}{
		{
			name:       "invalid site id yields 400",
			siteID:     "xyz",
			client:     &fakeEnergyClient{hasToken: true},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "unauthenticated yields 401",
			siteID:     "42",
			client:     &fakeEnergyClient{hasToken: false},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:          "transport error yields 502",
			siteID:        "42",
			client:        &fakeEnergyClient{hasToken: true, touErr: errors.New("dial failed")},
			reqBody:       `{"tou_settings":{}}`,
			wantStatus:    http.StatusBadGateway,
			wantForwarded: true,
		},
		{
			name:          "client 4xx is passed through verbatim",
			siteID:        "42",
			client:        &fakeEnergyClient{hasToken: true, touStatus: 422, touBody: []byte(`{"error":"invalid tariff"}`)},
			reqBody:       `{"tou_settings":{"bad":true}}`,
			wantStatus:    http.StatusUnprocessableEntity,
			wantBody:      `{"error":"invalid tariff"}`,
			wantForwarded: true,
		},
		{
			name:          "server 5xx yields 502",
			siteID:        "42",
			client:        &fakeEnergyClient{hasToken: true, touStatus: 500, touBody: []byte("boom")},
			reqBody:       `{"tou_settings":{}}`,
			wantStatus:    http.StatusBadGateway,
			wantForwarded: true,
		},
		{
			name:          "success forwards tesla body",
			siteID:        "42",
			client:        &fakeEnergyClient{hasToken: true, touStatus: 200, touBody: []byte(`{"response":{"result":true}}`)},
			reqBody:       `{"tou_settings":{"ok":true}}`,
			wantStatus:    http.StatusOK,
			wantBody:      `{"response":{"result":true}}`,
			wantForwarded: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var body io.Reader
			if tc.reqBody != "" {
				body = strings.NewReader(tc.reqBody)
			}
			h := newHandler(tc.client, &fakeSiteRepo{})
			rec := httptest.NewRecorder()
			h.UpdateTOUSettings(rec, siteReq(t, http.MethodPost, tc.siteID, body))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantForwarded && tc.client.touCalls != 1 {
				t.Fatalf("SetEnergySiteTOUSettings calls = %d, want 1", tc.client.touCalls)
			}
			if !tc.wantForwarded && tc.client.touCalls != 0 {
				t.Fatalf("SetEnergySiteTOUSettings calls = %d, want 0", tc.client.touCalls)
			}
			if tc.wantBody != "" && strings.TrimSpace(rec.Body.String()) != tc.wantBody {
				t.Fatalf("body = %q, want %q", rec.Body.String(), tc.wantBody)
			}
			// On a forwarded call the request body must reach the Tesla client intact.
			if tc.wantForwarded && tc.reqBody != "" && string(tc.client.gotTOUBody) != tc.reqBody {
				t.Fatalf("forwarded body = %q, want %q", tc.client.gotTOUBody, tc.reqBody)
			}
			if tc.wantForwarded && tc.client.gotTOUID != 42 {
				t.Fatalf("forwarded site id = %d, want 42", tc.client.gotTOUID)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// parseProductsResponse (pure)
// ---------------------------------------------------------------------------

func TestParseProductsResponse(t *testing.T) {
	tests := []struct {
		name      string
		body      []byte
		wantIDs   []int64
		wantErr   bool
		assertOne func(t *testing.T, s *teslamodel.TeslaEnergySite)
	}{
		{
			name:    "invalid json errors",
			body:    []byte("{not json"),
			wantErr: true,
		},
		{
			name:    "empty response yields no sites",
			body:    []byte(`{"count":0,"response":[]}`),
			wantIDs: nil,
		},
		{
			name:    "vehicle is skipped",
			body:    []byte(`{"response":[{"resource_type":"vehicle","id":1,"vin":"5YJ"}]}`),
			wantIDs: nil,
		},
		{
			name:    "empty resource_type is skipped",
			body:    []byte(`{"response":[{"energy_site_id":10}]}`),
			wantIDs: nil,
		},
		{
			name:    "zero energy_site_id is skipped",
			body:    []byte(`{"response":[{"resource_type":"battery","energy_site_id":0,"site_name":"Z"}]}`),
			wantIDs: nil,
		},
		{
			name:    "unparseable element is skipped, valid retained",
			body:    []byte(`{"response":[123,{"resource_type":"battery","energy_site_id":55,"site_name":"Keep"}]}`),
			wantIDs: []int64{55},
		},
		{
			name: "valid energy site parses all fields",
			body: []byte(`{"response":[{
				"resource_type":"battery",
				"energy_site_id":12345,
				"site_name":"Home",
				"gateway_id":"GW-1",
				"total_pack_energy":13500,
				"percentage_charged":87.5,
				"battery_type":"ac_powerwall",
				"backup_capable":true,
				"storm_mode_enabled":true,
				"components":{"solar":true,"battery":true,"grid":true,"load_meter":true,"tou_capable":true,"storm_mode_capable":true}
			}]}`),
			wantIDs: []int64{12345},
			assertOne: func(t *testing.T, s *teslamodel.TeslaEnergySite) {
				if s.SiteName != "Home" {
					t.Fatalf("SiteName = %q, want Home", s.SiteName)
				}
				if s.GatewayID == nil || *s.GatewayID != "GW-1" {
					t.Fatalf("GatewayID = %v, want GW-1", s.GatewayID)
				}
				if s.TotalPackEnergy == nil || *s.TotalPackEnergy != 13500 {
					t.Fatalf("TotalPackEnergy = %v, want 13500", s.TotalPackEnergy)
				}
				if s.PercentageCharged == nil || *s.PercentageCharged != 87.5 {
					t.Fatalf("PercentageCharged = %v, want 87.5", s.PercentageCharged)
				}
				if s.BatteryType == nil || *s.BatteryType != "ac_powerwall" {
					t.Fatalf("BatteryType = %v, want ac_powerwall", s.BatteryType)
				}
				if !s.BackupCapable || !s.StormModeEnabled {
					t.Fatalf("backup/storm flags = %v/%v, want true/true", s.BackupCapable, s.StormModeEnabled)
				}
				if !s.HasSolar || !s.HasBattery || !s.HasGrid || !s.HasLoadMeter || !s.TOUCapable || !s.StormModeCapable {
					t.Fatalf("component flags not all true: %+v", s)
				}
			},
		},
		{
			name: "mixed products keep only energy sites",
			body: []byte(`{"response":[
				{"resource_type":"vehicle","id":1},
				{"resource_type":"battery","energy_site_id":100,"site_name":"A"},
				{"resource_type":"solar","energy_site_id":200,"site_name":"B"}
			]}`),
			wantIDs: []int64{100, 200},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sites, err := parseProductsResponse(tc.body)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (sites=%v)", sites)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var gotIDs []int64
			for _, s := range sites {
				gotIDs = append(gotIDs, s.EnergySiteID)
			}
			if len(gotIDs) != len(tc.wantIDs) {
				t.Fatalf("ids = %v, want %v", gotIDs, tc.wantIDs)
			}
			for i, want := range tc.wantIDs {
				if gotIDs[i] != want {
					t.Fatalf("ids[%d] = %d, want %d (all=%v)", i, gotIDs[i], want, gotIDs)
				}
			}
			if tc.assertOne != nil {
				if len(sites) != 1 {
					t.Fatalf("assertOne needs exactly 1 site, got %d", len(sites))
				}
				tc.assertOne(t, sites[0])
			}
		})
	}
}

// ---------------------------------------------------------------------------
// truncateBody (pure)
// ---------------------------------------------------------------------------

func TestTruncateBody(t *testing.T) {
	tests := []struct {
		name    string
		in      []byte
		wantLen int
	}{
		{name: "empty", in: []byte(""), wantLen: 0},
		{name: "short", in: []byte("hello"), wantLen: 5},
		{name: "exactly 500", in: make([]byte, 500), wantLen: 500},
		{name: "over 500 truncates", in: make([]byte, 750), wantLen: 500},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := truncateBody(tc.in)
			if len(got) != tc.wantLen {
				t.Fatalf("len = %d, want %d", len(got), tc.wantLen)
			}
		})
	}

	if got := truncateBody([]byte("abc")); got != "abc" {
		t.Fatalf("content = %q, want abc", got)
	}
}

// ---------------------------------------------------------------------------
// writeSiteInfoEnvelope (pure) — direct coverage of the nil-guard branch.
// ---------------------------------------------------------------------------

func TestWriteSiteInfoEnvelope(t *testing.T) {
	t.Run("nil timestamp renders null", func(t *testing.T) {
		rec := httptest.NewRecorder()
		writeSiteInfoEnvelope(rec, `{"a":1}`, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if body := strings.TrimSpace(rec.Body.String()); body != `{"data":{"a":1},"fetched_at":null}` {
			t.Fatalf("body = %q", body)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
			t.Fatalf("content-type = %q", ct)
		}
	})

	t.Run("timestamp renders rfc3339 z", func(t *testing.T) {
		rec := httptest.NewRecorder()
		ts := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
		writeSiteInfoEnvelope(rec, `{"a":1}`, &ts)
		if body := strings.TrimSpace(rec.Body.String()); body != `{"data":{"a":1},"fetched_at":"2026-01-02T03:04:05Z"}` {
			t.Fatalf("body = %q", body)
		}
	})
}
