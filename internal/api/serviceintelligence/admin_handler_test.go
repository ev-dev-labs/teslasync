package serviceintelligence

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/go-chi/chi/v5"
)

type fakeCommunicationsImporterService struct {
	state     CommunicationsCatalogState
	statusErr error
	result    *CommunicationImportStatus
	importErr error
	gotURL    string
}

func (f *fakeCommunicationsImporterService) Status(context.Context) (CommunicationsCatalogState, error) {
	return f.state, f.statusErr
}

func (f *fakeCommunicationsImporterService) Import(
	_ context.Context,
	artifactURL string,
) (*CommunicationImportStatus, error) {
	f.gotURL = artifactURL
	return f.result, f.importErr
}

func mountedCommunicationsAdminHandler(imports communicationsImporter) http.Handler {
	router := chi.NewRouter()
	handler := &CommunicationsAdminHandler{imports: imports}
	MountAdmin(router, handler)
	return router
}

func TestCommunicationsAdminStatus(t *testing.T) {
	imports := &fakeCommunicationsImporterService{state: CommunicationsCatalogState{RecordCount: 42}}
	recorder := httptest.NewRecorder()
	mountedCommunicationsAdminHandler(imports).ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/admin/service-intelligence/communications/status", nil),
	)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"record_count":42`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "private, no-store" {
		t.Errorf("Cache-Control = %q", recorder.Header().Get("Cache-Control"))
	}
}

func TestCommunicationsAdminImportValidatesStrictPayload(t *testing.T) {
	for _, body := range []string{
		`{}`,
		`{"artifact_url":""}`,
		`{"artifact_url":"https://static.nhtsa.gov/example.zip","extra":true}`,
		`{"artifact_url":"https://static.nhtsa.gov/example.zip"} {}`,
		`not-json`,
	} {
		imports := &fakeCommunicationsImporterService{}
		recorder := httptest.NewRecorder()
		mountedCommunicationsAdminHandler(imports).ServeHTTP(
			recorder,
			httptest.NewRequest(
				http.MethodPost,
				"/admin/service-intelligence/communications/import",
				strings.NewReader(body),
			),
		)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("body %q status=%d body=%s", body, recorder.Code, recorder.Body.String())
		}
		if imports.gotURL != "" {
			t.Errorf("body %q reached service with %q", body, imports.gotURL)
		}
	}
}

func TestCommunicationsAdminImportSuccess(t *testing.T) {
	url := "https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025-2026.zip"
	imports := &fakeCommunicationsImporterService{result: &CommunicationImportStatus{
		ID:     3,
		Status: "succeeded",
	}}
	recorder := httptest.NewRecorder()
	mountedCommunicationsAdminHandler(imports).ServeHTTP(
		recorder,
		httptest.NewRequest(
			http.MethodPost,
			"/admin/service-intelligence/communications/import",
			strings.NewReader(`{"artifact_url":"`+url+`"}`),
		),
	)
	if recorder.Code != http.StatusOK || imports.gotURL != url {
		t.Fatalf("status=%d url=%q body=%s", recorder.Code, imports.gotURL, recorder.Body.String())
	}
}

func TestCommunicationsAdminImportMapsErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "invalid_url", err: nhtsa.ErrInvalidRequest, want: http.StatusBadRequest},
		{name: "already_running", err: ErrCommunicationImportInProgress, want: http.StatusConflict},
		{
			name: "upstream_timeout",
			err: &nhtsa.UpstreamError{
				Operation: "manufacturer communications import",
				Kind:      nhtsa.ErrorKindTimeout,
			},
			want: http.StatusGatewayTimeout,
		},
		{name: "internal", err: errors.New("database unavailable"), want: http.StatusInternalServerError},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			imports := &fakeCommunicationsImporterService{importErr: test.err}
			recorder := httptest.NewRecorder()
			mountedCommunicationsAdminHandler(imports).ServeHTTP(
				recorder,
				httptest.NewRequest(
					http.MethodPost,
					"/admin/service-intelligence/communications/import",
					strings.NewReader(`{"artifact_url":"https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS_RECEIVED_2025.zip"}`),
				),
			)
			if recorder.Code != test.want {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}
