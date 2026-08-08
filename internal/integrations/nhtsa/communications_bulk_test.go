package nhtsa

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func communicationsRow(
	id, received, filename, published, number, kind, make, model, year, component, summary string,
) string {
	return strings.Join([]string{
		id, "", received, filename, published, number, kind, make, model, year,
		component, "", "", summary,
	}, "\t") + "\n"
}

func communicationsZIP(t *testing.T, filename, content string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create(filename)
	if err != nil {
		t.Fatalf("create ZIP entry: %v", err)
	}
	if _, err := entry.Write([]byte(content)); err != nil {
		t.Fatalf("write ZIP entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close ZIP: %v", err)
	}
	return buffer.Bytes()
}

func communicationsBulkTestClient(server *httptest.Server, mutate func(*CommunicationsBulkConfig)) *CommunicationsBulkClient {
	config := CommunicationsBulkConfig{
		BaseURL:              server.URL,
		Timeout:              time.Second,
		MaxCompressedBytes:   1 << 20,
		MaxUncompressedBytes: 1 << 20,
		MaxRows:              100,
		MaxMatches:           20,
	}
	if mutate != nil {
		mutate(&config)
	}
	client := NewCommunicationsBulkClient(config)
	client.now = func() time.Time {
		return time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	}
	return client
}

func TestCommunicationsBulkClientNormalizesOfficialRowsAndConditionalHeaders(t *testing.T) {
	content := communicationsRow(
		"11012218",
		"20250103",
		"SB-21-12-005",
		"20241205",
		"SB-21-12-005",
		"Service Bulletin/Repair Instructions",
		"TESLA",
		"MODEL X",
		"2018",
		"STRUCTURE:BODY",
		"For some Model X vehicles, a rear door sensor alert might be displayed.",
	) + communicationsRow(
		"11012219",
		"20250103",
		"OTHER",
		"20241205",
		"OTHER",
		"Other",
		"KIA",
		"FORTE",
		"2018",
		"ENGINE",
		"Not a Tesla communication.",
	)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("If-None-Match"); got != `"prior"` {
			t.Errorf("If-None-Match = %q", got)
		}
		if got := r.Header.Get("If-Modified-Since"); got != "Mon, 01 Jan 2024 00:00:00 GMT" {
			t.Errorf("If-Modified-Since = %q", got)
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("ETag", `"current"`)
		w.Header().Set("Last-Modified", "Tue, 05 Aug 2026 00:00:00 GMT")
		_, _ = w.Write(communicationsZIP(
			t,
			"TSBS_RECEIVED_2025-2026.txt",
			content,
		))
	}))
	defer server.Close()

	client := communicationsBulkTestClient(server, nil)
	result, err := client.ImportManufacturerCommunications(
		context.Background(),
		server.URL+"/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip",
		CommunicationsArtifactValidator{
			ETag:         `"prior"`,
			LastModified: "Mon, 01 Jan 2024 00:00:00 GMT",
		},
	)
	if err != nil {
		t.Fatalf("ImportManufacturerCommunications: %v", err)
	}
	if result.TotalRows != 2 || len(result.Records) != 1 || result.RejectedRows != 0 {
		t.Fatalf("artifact counts = total %d records %d rejected %d", result.TotalRows, len(result.Records), result.RejectedRows)
	}
	record := result.Records[0]
	if record.NHTSAID != "11012218" ||
		record.CommunicationNumber != "SB-21-12-005" ||
		record.Model != "MODEL X" ||
		record.ModelYear != 2018 ||
		record.PublishedAt == nil {
		t.Fatalf("normalized communication = %+v", record)
	}
	if record.SourceDocumentURL != "https://static.nhtsa.gov/odi/tsbs/2025/MC-11012218-0001.pdf" {
		t.Errorf("source document URL = %q", record.SourceDocumentURL)
	}
	if result.SHA256 == "" || result.ETag != `"current"` {
		t.Errorf("artifact metadata = %+v", result)
	}
	wire, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	if strings.Contains(string(wire), "Not a Tesla communication") || strings.Contains(string(wire), "\t") {
		t.Fatalf("raw or non-Tesla artifact data retained: %s", wire)
	}
}

func TestCommunicationsBulkClientRejectsUntrustedArtifactURLs(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	client := communicationsBulkTestClient(server, nil)

	for _, raw := range []string{
		"https://example.com/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		server.URL + "/odi/ffdd/tsbs/not-a-tsb.zip",
		server.URL + "/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip?redirect=1",
		server.URL + "/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2035.zip",
	} {
		if err := client.ValidateManufacturerCommunicationsArtifactURL(raw); err == nil {
			t.Errorf("ValidateManufacturerCommunicationsArtifactURL(%q) = nil", raw)
		}
	}
}

func TestCommunicationsBulkClientProductionAllowlist(t *testing.T) {
	client := NewCommunicationsBulkClient(CommunicationsBulkConfig{})
	client.now = func() time.Time {
		return time.Date(2026, 8, 5, 6, 0, 0, 0, time.UTC)
	}
	if err := client.ValidateManufacturerCommunicationsArtifactURL(
		"https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip",
	); err != nil {
		t.Fatalf("official artifact rejected: %v", err)
	}
	for _, raw := range []string{
		"https://static.nhtsa.gov.evil.example/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		"http://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		"https://static.nhtsa.gov/odi/ffdd/tsbs/../../secret.zip",
	} {
		if err := client.ValidateManufacturerCommunicationsArtifactURL(raw); err == nil {
			t.Errorf("untrusted artifact accepted: %q", raw)
		}
	}
}

func TestCommunicationsBulkClientHandlesNotModified(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("ETag", `"same"`)
		w.WriteHeader(http.StatusNotModified)
	}))
	defer server.Close()
	client := communicationsBulkTestClient(server, nil)
	result, err := client.ImportManufacturerCommunications(
		context.Background(),
		server.URL+"/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		CommunicationsArtifactValidator{ETag: `"same"`},
	)
	if err != nil {
		t.Fatalf("ImportManufacturerCommunications: %v", err)
	}
	if !result.NotModified || result.ETag != `"same"` || result.Records != nil {
		t.Errorf("not-modified result = %+v", result)
	}
}

func TestCommunicationsBulkClientRejectsUnsafeResponses(t *testing.T) {
	validRow := communicationsRow(
		"11012218", "20250103", "SB", "20241205", "SB", "Bulletin",
		"TESLA", "MODEL 3", "2024", "ELECTRICAL SYSTEM", "Software update.",
	)
	tests := []struct {
		name     string
		handler  http.HandlerFunc
		mutate   func(*CommunicationsBulkConfig)
		wantKind ErrorKind
	}{
		{
			name: "status",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusServiceUnavailable)
			},
			wantKind: ErrorKindStatus,
		},
		{
			name: "content_type",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/html")
				_, _ = w.Write([]byte("not a zip"))
			},
			wantKind: ErrorKindContentType,
		},
		{
			name: "compressed_oversize",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write(communicationsZIP(t, "TSBS_RECEIVED_2025.txt", validRow))
			},
			mutate: func(config *CommunicationsBulkConfig) {
				config.MaxCompressedBytes = 16
			},
			wantKind: ErrorKindOversize,
		},
		{
			name: "malformed_zip",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write([]byte("not a zip"))
			},
			wantKind: ErrorKindMalformed,
		},
		{
			name: "unexpected_entry_name",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write(communicationsZIP(t, "../TSBS_RECEIVED_2025.txt", validRow))
			},
			wantKind: ErrorKindMalformed,
		},
		{
			name: "uncompressed_oversize",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write(communicationsZIP(t, "TSBS_RECEIVED_2025.txt", validRow))
			},
			mutate: func(config *CommunicationsBulkConfig) {
				config.MaxUncompressedBytes = 20
			},
			wantKind: ErrorKindOversize,
		},
		{
			name: "wrong_field_count",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write(communicationsZIP(t, "TSBS_RECEIVED_2025.txt", "too\tfew\n"))
			},
			wantKind: ErrorKindMalformed,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			client := communicationsBulkTestClient(server, test.mutate)
			_, err := client.ImportManufacturerCommunications(
				context.Background(),
				server.URL+"/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
				CommunicationsArtifactValidator{},
			)
			var upstream *UpstreamError
			if !errors.As(err, &upstream) || upstream.Kind != test.wantKind {
				t.Fatalf("error = %v, want kind %q", err, test.wantKind)
			}
		})
	}
}

func TestCommunicationsBulkClientTimeoutIsBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(150 * time.Millisecond)
		w.Header().Set("Content-Type", "application/zip")
	}))
	defer server.Close()
	client := communicationsBulkTestClient(server, func(config *CommunicationsBulkConfig) {
		config.Timeout = 20 * time.Millisecond
	})

	started := time.Now()
	_, err := client.ImportManufacturerCommunications(
		context.Background(),
		server.URL+"/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		CommunicationsArtifactValidator{},
	)
	if time.Since(started) > 120*time.Millisecond {
		t.Errorf("timeout was not bounded")
	}
	var upstream *UpstreamError
	if !errors.As(err, &upstream) || upstream.Kind != ErrorKindTimeout {
		t.Fatalf("error = %v, want timeout", err)
	}
}

type communicationsTimeoutError struct{}

func (communicationsTimeoutError) Error() string   { return "network timeout" }
func (communicationsTimeoutError) Timeout() bool   { return true }
func (communicationsTimeoutError) Temporary() bool { return true }

func TestCommunicationsTransportErrorClassifiesWrappedTimeouts(t *testing.T) {
	expiredParent, cancelParent := context.WithDeadline(
		context.Background(),
		time.Now().Add(-time.Second),
	)
	defer cancelParent()
	expiredCall, cancelCall := context.WithDeadline(
		context.Background(),
		time.Now().Add(-time.Second),
	)
	defer cancelCall()

	tests := []struct {
		name       string
		parent     context.Context
		call       context.Context
		requestErr error
	}{
		{
			name:       "parent_context_deadline",
			parent:     expiredParent,
			call:       context.Background(),
			requestErr: errors.New("request failed"),
		},
		{
			name:       "call_context_deadline",
			parent:     context.Background(),
			call:       expiredCall,
			requestErr: errors.New("request failed"),
		},
		{
			name:       "wrapped_context_deadline",
			parent:     context.Background(),
			call:       context.Background(),
			requestErr: fmt.Errorf("HTTP request: %w", context.DeadlineExceeded),
		},
		{
			name:   "url_wrapped_net_timeout",
			parent: context.Background(),
			call:   context.Background(),
			requestErr: &url.Error{
				Op:  http.MethodGet,
				URL: "https://static.nhtsa.gov/official.zip",
				Err: communicationsTimeoutError{},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := communicationsTransportError(
				test.parent,
				test.call,
				test.requestErr,
			)
			var upstream *UpstreamError
			if !errors.As(err, &upstream) || upstream.Kind != ErrorKindTimeout {
				t.Fatalf("error = %v, want timeout UpstreamError", err)
			}
			if !errors.Is(err, ErrUpstreamTimeout) {
				t.Errorf("errors.Is(ErrUpstreamTimeout) = false")
			}
		})
	}
}

func TestCommunicationsBulkClientCountsMalformedTeslaRowsWithoutFabrication(t *testing.T) {
	content := communicationsRow(
		"not-an-id", "20250103", "SB", "20241205", "", "Bulletin",
		"TESLA", "MODEL 3", "2024", "ELECTRICAL", "Invalid official row.",
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(communicationsZIP(t, "TSBS_RECEIVED_2025.txt", content))
	}))
	defer server.Close()
	client := communicationsBulkTestClient(server, nil)
	result, err := client.ImportManufacturerCommunications(
		context.Background(),
		server.URL+"/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip",
		CommunicationsArtifactValidator{},
	)
	if err != nil {
		t.Fatalf("ImportManufacturerCommunications: %v", err)
	}
	if result.RejectedRows != 1 || len(result.Records) != 0 {
		t.Errorf("result = %+v", result)
	}
}
