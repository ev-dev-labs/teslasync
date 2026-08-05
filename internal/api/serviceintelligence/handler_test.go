package serviceintelligence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/go-chi/chi/v5"
)

type fakeIntelligenceService struct {
	response  *Response
	err       error
	calls     int
	vehicleID int64
	refresh   bool
}

func (f *fakeIntelligenceService) Get(_ context.Context, vehicleID int64, refresh bool) (*Response, error) {
	f.calls++
	f.vehicleID = vehicleID
	f.refresh = refresh
	return f.response, f.err
}

func handlerResponse() *Response {
	return &Response{
		VehicleID:   42,
		GeneratedAt: time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC),
		VehicleContext: VehicleContext{
			Make:      "TESLA",
			Model:     "Model 3",
			ModelYear: 2019,
		},
		RecallFindings: make([]Finding, 0),
		Communications: make([]CommunicationFinding, 0),
		RankedSymptoms: make([]SymptomMatch, 0),
		Evidence: EvidenceBundle{
			SchemaVersion: EvidenceSchemaVersion,
			Items:         make([]EvidenceItem, 0),
			Limitations:   make([]string, 0),
			Disclaimer:    "hypotheses only",
		},
		Sources: make([]nhtsa.SourceMetadata, 0),
	}
}

func mountedHandler(service IntelligenceService) http.Handler {
	router := chi.NewRouter()
	Mount(router, NewServiceIntelligenceHandler(service))
	return router
}

func TestHandlerValidatesVehicleIDAndRefresh(t *testing.T) {
	tests := []struct {
		name   string
		target string
	}{
		{name: "non_numeric_id", target: "/service-intelligence/vehicles/nope"},
		{name: "zero_id", target: "/service-intelligence/vehicles/0"},
		{name: "negative_id", target: "/service-intelligence/vehicles/-2"},
		{name: "invalid_refresh", target: "/service-intelligence/vehicles/42?refresh=yes"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeIntelligenceService{response: handlerResponse()}
			recorder := httptest.NewRecorder()
			mountedHandler(service).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.target, nil))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", recorder.Code, recorder.Body.String())
			}
			if service.calls != 0 {
				t.Errorf("service calls = %d, want 0", service.calls)
			}
		})
	}
}

func TestHandlerSuccessRefreshAndPrivacy(t *testing.T) {
	service := &fakeIntelligenceService{response: handlerResponse()}
	recorder := httptest.NewRecorder()
	mountedHandler(service).ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/42?refresh=true", nil),
	)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", recorder.Code, recorder.Body.String())
	}
	if service.vehicleID != 42 || !service.refresh {
		t.Errorf("service args vehicle=%d refresh=%v", service.vehicleID, service.refresh)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := recorder.Header().Get("ETag"); got == "" {
		t.Error("ETag is empty")
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if _, leaked := body["vin"]; leaked {
		t.Fatal("response contains VIN field")
	}
}

func TestHandlerETagReturnsNotModified(t *testing.T) {
	service := &fakeIntelligenceService{response: handlerResponse()}
	handler := mountedHandler(service)

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/42", nil))
	etag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || etag == "" {
		t.Fatalf("first status=%d etag=%q", first.Code, etag)
	}

	request := httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/42", nil)
	request.Header.Set("If-None-Match", etag)
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, request)
	if second.Code != http.StatusNotModified {
		t.Fatalf("second status = %d, want 304 (body=%s)", second.Code, second.Body.String())
	}
	if second.Body.Len() != 0 {
		t.Errorf("304 body = %q, want empty", second.Body.String())
	}
}

func TestSemanticETagIgnoresVolatileGenerationAndCheckTimes(t *testing.T) {
	first := handlerResponse()
	first.Sources = []nhtsa.SourceMetadata{{
		ID:        nhtsa.SourceIDRecalls,
		CheckedAt: time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC),
	}}
	second := handlerResponse()
	second.GeneratedAt = first.GeneratedAt.Add(time.Minute)
	second.Sources = []nhtsa.SourceMetadata{{
		ID:        nhtsa.SourceIDRecalls,
		CheckedAt: first.Sources[0].CheckedAt.Add(time.Minute),
	}}

	firstETag, err := semanticETag(first)
	if err != nil {
		t.Fatalf("first ETag: %v", err)
	}
	secondETag, err := semanticETag(second)
	if err != nil {
		t.Fatalf("second ETag: %v", err)
	}
	if firstETag != secondETag {
		t.Errorf("ETags differ for semantically identical reports: %q != %q", firstETag, secondETag)
	}
}

func TestHandlerMapsServiceErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "vehicle_not_found",
			err:        ErrVehicleNotFound,
			wantStatus: http.StatusNotFound,
			wantCode:   "NOT_FOUND",
		},
		{
			name: "upstream_timeout",
			err: fmt.Errorf("wrapped: %w", &nhtsa.UpstreamError{
				Operation: "recalls",
				Kind:      nhtsa.ErrorKindTimeout,
			}),
			wantStatus: http.StatusGatewayTimeout,
			wantCode:   "NHTSA_TIMEOUT",
		},
		{
			name: "malformed_upstream",
			err: fmt.Errorf("wrapped: %w", &nhtsa.UpstreamError{
				Operation:  "recalls",
				Kind:       nhtsa.ErrorKindMalformed,
				StatusCode: http.StatusOK,
			}),
			wantStatus: http.StatusBadGateway,
			wantCode:   "NHTSA_UPSTREAM_ERROR",
		},
		{
			name:       "internal",
			err:        errors.New("database unavailable"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "INTERNAL_ERROR",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeIntelligenceService{err: test.err}
			recorder := httptest.NewRecorder()
			mountedHandler(service).ServeHTTP(
				recorder,
				httptest.NewRequest(http.MethodGet, "/service-intelligence/vehicles/42", nil),
			)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if body["code"] != test.wantCode {
				t.Errorf("code = %q, want %q", body["code"], test.wantCode)
			}
		})
	}
}
