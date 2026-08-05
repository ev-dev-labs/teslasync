package nhtsa

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const clientTestVIN = "5YJ3E1EA7KF317000"

func testClient(server *httptest.Server, mutate func(*Config)) *Client {
	cfg := Config{
		VPICBaseURL:   server.URL,
		SafetyBaseURL: server.URL,
		Timeout:       time.Second,
		CacheTTL:      time.Hour,
		MaxBodyBytes:  64 * 1024,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	return NewClient(cfg)
}

func writeJSONResponse(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

func validDecodeBody() string {
	return `{"Count":1,"Results":[{"Make":"TESLA","Model":"Model 3","ModelYear":"2019","Manufacturer":"TESLA, INC.","VehicleType":"PASSENGER CAR","PlantCountry":"UNITED STATES (USA)","PlantState":"CALIFORNIA","PlantCity":"FREMONT","VehicleDescriptor":"5YJ3E1EA*KF","ErrorCode":"0"}]}`
}

func validRecallBody() string {
	return `{"Count":1,"results":[{"Manufacturer":"Tesla, Inc.","NHTSACampaignNumber":"22V037000","parkIt":false,"parkOutSide":false,"overTheAirUpdate":true,"ReportReceivedDate":"27/01/2022","Component":"ELECTRICAL SYSTEM: SOFTWARE","Summary":"A software behavior may increase crash risk.","Consequence":"Crash risk may increase.","Remedy":"An over-the-air update will be provided.","Notes":"","ModelYear":"2019","Make":"TESLA","Model":"MODEL 3"}]}`
}

func TestClientDecodeVINAndRecallsNormalizeTypedData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "DecodeVinValuesExtended"):
			if got := r.URL.Query().Get("format"); got != "json" {
				t.Errorf("format = %q, want json", got)
			}
			writeJSONResponse(t, w, validDecodeBody())
		case r.URL.Path == "/recalls/recallsByVehicle":
			if got := r.URL.Query().Get("make"); got != "TESLA" {
				t.Errorf("make = %q, want TESLA", got)
			}
			if got := r.URL.Query().Get("model"); got != "Model 3" {
				t.Errorf("model = %q, want Model 3", got)
			}
			if got := r.URL.Query().Get("modelYear"); got != "2019" {
				t.Errorf("modelYear = %q, want 2019", got)
			}
			writeJSONResponse(t, w, validRecallBody())
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := testClient(server, nil)
	decoded, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{})
	if err != nil {
		t.Fatalf("DecodeVIN: %v", err)
	}
	if decoded.Vehicle.Make != "TESLA" || decoded.Vehicle.Model != "Model 3" || decoded.Vehicle.ModelYear != 2019 {
		t.Fatalf("decoded vehicle = %+v", decoded.Vehicle)
	}
	if decoded.Source.Status != SourceStatusAvailable || decoded.Source.RecordCount != 1 {
		t.Fatalf("decode source = %+v", decoded.Source)
	}

	recalls, err := client.Recalls(context.Background(), VehicleQuery{
		Make:      decoded.Vehicle.Make,
		Model:     decoded.Vehicle.Model,
		ModelYear: decoded.Vehicle.ModelYear,
	}, FetchOptions{})
	if err != nil {
		t.Fatalf("Recalls: %v", err)
	}
	if len(recalls.Recalls) != 1 {
		t.Fatalf("len(recalls) = %d, want 1", len(recalls.Recalls))
	}
	recall := recalls.Recalls[0]
	if recall.CampaignNumber != "22V037000" || recall.ReportReceivedAt == nil || !recall.OverTheAirUpdate {
		t.Fatalf("recall = %+v", recall)
	}
	if !strings.HasPrefix(recall.SourceDocumentURL, "https://www.nhtsa.gov/recalls?") {
		t.Errorf("source document URL = %q", recall.SourceDocumentURL)
	}
}

func TestClientRejectsStatusContentTypeOversizeAndMalformedResponses(t *testing.T) {
	tests := []struct {
		name     string
		handler  http.HandlerFunc
		maxBytes int64
		wantKind ErrorKind
		wantIs   error
	}{
		{
			name: "status",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
			},
			wantKind: ErrorKindStatus,
			wantIs:   ErrUnexpectedStatus,
		},
		{
			name: "content_type",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/html")
				_, _ = w.Write([]byte(`{"Count":1}`))
			},
			wantKind: ErrorKindContentType,
			wantIs:   ErrUnexpectedContentType,
		},
		{
			name: "oversize",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(strings.Repeat("x", 256)))
			},
			maxBytes: 32,
			wantKind: ErrorKindOversize,
			wantIs:   ErrResponseTooLarge,
		},
		{
			name: "malformed_json",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"Count":1,"Results":[`))
			},
			wantKind: ErrorKindMalformed,
			wantIs:   ErrMalformedResponse,
		},
		{
			name: "malformed_typed_data",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				writeJSONResponse(t, w, `{"Count":1,"Results":[{"Make":"","Model":"","ModelYear":"unknown","ErrorCode":"0"}]}`)
			},
			wantKind: ErrorKindMalformed,
			wantIs:   ErrMalformedResponse,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			client := testClient(server, func(cfg *Config) {
				if test.maxBytes > 0 {
					cfg.MaxBodyBytes = test.maxBytes
				}
			})

			_, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{Refresh: true})
			if err == nil {
				t.Fatal("DecodeVIN error = nil")
			}
			var upstream *UpstreamError
			if !errors.As(err, &upstream) {
				t.Fatalf("error %T is not UpstreamError: %v", err, err)
			}
			if upstream.Kind != test.wantKind {
				t.Errorf("kind = %q, want %q", upstream.Kind, test.wantKind)
			}
			if !errors.Is(err, test.wantIs) {
				t.Errorf("errors.Is(%v) = false, want %v", err, test.wantIs)
			}
		})
	}
}

func TestClientTimeoutIsBoundedAndTyped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(150 * time.Millisecond)
		writeJSONResponse(t, w, validDecodeBody())
	}))
	defer server.Close()
	client := testClient(server, func(cfg *Config) {
		cfg.Timeout = 20 * time.Millisecond
	})

	start := time.Now()
	_, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{Refresh: true})
	if elapsed := time.Since(start); elapsed > 120*time.Millisecond {
		t.Errorf("timeout elapsed = %s, want bounded below 120ms", elapsed)
	}
	var upstream *UpstreamError
	if !errors.As(err, &upstream) || upstream.Kind != ErrorKindTimeout {
		t.Fatalf("error = %v, want timeout UpstreamError", err)
	}
	if !errors.Is(err, ErrUpstreamTimeout) {
		t.Errorf("errors.Is(ErrUpstreamTimeout) = false")
	}
}

func TestClientUsesETagForRefreshWithoutStoringRawJSON(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call := calls.Add(1)
		if call == 1 {
			w.Header().Set("ETag", `"decode-v1"`)
			w.Header().Set("Cache-Control", "max-age=0")
			writeJSONResponse(t, w, validDecodeBody())
			return
		}
		if got := r.Header.Get("If-None-Match"); got != `"decode-v1"` {
			t.Errorf("If-None-Match = %q", got)
		}
		w.Header().Set("ETag", `"decode-v1"`)
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()
	client := testClient(server, nil)

	first, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{})
	if err != nil {
		t.Fatalf("first DecodeVIN: %v", err)
	}
	second, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{Refresh: true})
	if err != nil {
		t.Fatalf("second DecodeVIN: %v", err)
	}
	if second.Vehicle != first.Vehicle || !second.Source.FromCache {
		t.Fatalf("conditional result = %+v, first = %+v", second, first)
	}
	if calls.Load() != 2 {
		t.Errorf("calls = %d, want 2", calls.Load())
	}
}

func TestClientPrivacyNoVINInResultOrErrors(t *testing.T) {
	successServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSONResponse(t, w, validDecodeBody())
	}))
	defer successServer.Close()
	client := testClient(successServer, nil)
	result, err := client.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{})
	if err != nil {
		t.Fatalf("DecodeVIN: %v", err)
	}
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if strings.Contains(string(body), clientTestVIN) {
		t.Fatalf("VIN leaked in result: %s", body)
	}

	errorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer errorServer.Close()
	errorClient := testClient(errorServer, nil)
	_, err = errorClient.DecodeVIN(context.Background(), clientTestVIN, FetchOptions{Refresh: true})
	if err == nil {
		t.Fatal("DecodeVIN error = nil")
	}
	if strings.Contains(err.Error(), clientTestVIN) {
		t.Fatalf("VIN leaked in error: %v", err)
	}
}

func TestUnavailableManufacturerCommunicationsProviderIsExplicit(t *testing.T) {
	provider := NewUnavailableManufacturerCommunicationsProvider()
	result, err := provider.ManufacturerCommunications(
		context.Background(),
		VehicleQuery{Make: "TESLA", Model: "Model 3", ModelYear: 2019},
		FetchOptions{},
	)
	if err != nil {
		t.Fatalf("ManufacturerCommunications: %v", err)
	}
	if result.Source.Status != SourceStatusUnavailable {
		t.Errorf("status = %q, want unavailable", result.Source.Status)
	}
	if result.Source.Detail == nil || !strings.Contains(*result.Source.Detail, "does not document") {
		t.Errorf("detail = %v", result.Source.Detail)
	}
	if result.Communications == nil || len(result.Communications) != 0 {
		t.Errorf("communications = %#v, want explicit empty slice", result.Communications)
	}
}
