package benchmark

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

type fakeHandlerService struct {
	status     *models.PrivacyBenchmarkStatus
	release    *models.PrivacyBenchmarkRelease
	page       *models.PrivacyBenchmarkReleasePage
	err        error
	gotSubject string
	gotVehicle int64
	gotLimit   int
	gotOffset  int
}

func (f *fakeHandlerService) Status(_ context.Context, subject string, vehicleID int64) (*models.PrivacyBenchmarkStatus, error) {
	f.gotSubject, f.gotVehicle = subject, vehicleID
	return f.status, f.err
}
func (f *fakeHandlerService) Consent(_ context.Context, subject string, vehicleID int64) (*models.PrivacyBenchmarkStatus, error) {
	f.gotSubject, f.gotVehicle = subject, vehicleID
	return f.status, f.err
}
func (f *fakeHandlerService) Revoke(_ context.Context, subject string, vehicleID int64) error {
	f.gotSubject, f.gotVehicle = subject, vehicleID
	return f.err
}
func (f *fakeHandlerService) CreateRelease(_ context.Context, subject string, vehicleID int64, _ time.Time) (*models.PrivacyBenchmarkRelease, error) {
	f.gotSubject, f.gotVehicle = subject, vehicleID
	return f.release, f.err
}
func (f *fakeHandlerService) ListReleases(_ context.Context, subject string, vehicleID int64, limit, offset int) (*models.PrivacyBenchmarkReleasePage, error) {
	f.gotSubject, f.gotVehicle, f.gotLimit, f.gotOffset = subject, vehicleID, limit, offset
	return f.page, f.err
}

func TestStatusRequiresForwardAuthAndValidVehicle(t *testing.T) {
	service := &fakeHandlerService{}
	for _, tc := range []struct {
		name       string
		headerName string
		header     string
		url        string
		want       int
	}{
		{"open mode", "", "", "/benchmarks/privacy?vehicle_id=1", http.StatusNotImplemented},
		{"missing subject", "X-User", "", "/benchmarks/privacy?vehicle_id=1", http.StatusUnauthorized},
		{"bad vehicle", "X-User", "alice", "/benchmarks/privacy?vehicle_id=0", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := &Handler{service: service, headerName: tc.headerName}
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			if tc.header != "" {
				req.Header.Set(tc.headerName, tc.header)
			}
			rec := httptest.NewRecorder()
			h.Status(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d want %d body=%s", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestListReleasesValidatesPaginationAndScopesSubject(t *testing.T) {
	service := &fakeHandlerService{page: &models.PrivacyBenchmarkReleasePage{Items: []models.PrivacyBenchmarkRelease{}}}
	h := &Handler{service: service, headerName: "X-User"}
	req := httptest.NewRequest(http.MethodGet, "/benchmarks/releases?vehicle_id=42&limit=12&offset=3", nil)
	req.Header.Set("X-User", "opaque-subject")
	rec := httptest.NewRecorder()
	h.ListReleases(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if service.gotSubject != "opaque-subject" || service.gotVehicle != 42 ||
		service.gotLimit != 12 || service.gotOffset != 3 {
		t.Fatalf("unexpected scope: %+v", service)
	}

	bad := httptest.NewRequest(http.MethodGet, "/benchmarks/releases?vehicle_id=42&limit=101", nil)
	bad.Header.Set("X-User", "opaque-subject")
	badRec := httptest.NewRecorder()
	h.ListReleases(badRec, bad)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad pagination status=%d", badRec.Code)
	}
}

func TestConsentRejectsUnknownFields(t *testing.T) {
	h := &Handler{service: &fakeHandlerService{}, headerName: "X-User"}
	req := httptest.NewRequest(http.MethodPut, "/benchmarks/privacy/consent",
		strings.NewReader(`{"vehicle_id":1,"vin":"must-not-be-accepted"}`))
	req.Header.Set("X-User", "alice")
	rec := httptest.NewRecorder()
	h.Consent(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateReleaseMapsConsentRequirement(t *testing.T) {
	service := &fakeHandlerService{err: ErrConsentRequired}
	h := &Handler{service: service, headerName: "X-User"}
	req := httptest.NewRequest(http.MethodPost, "/benchmarks/releases", strings.NewReader(`{"vehicle_id":7}`))
	req.Header.Set("X-User", "alice")
	rec := httptest.NewRecorder()
	h.CreateRelease(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] == "" {
		t.Fatal("missing error envelope")
	}
}

func TestRevokeMapsNotFound(t *testing.T) {
	h := &Handler{
		service:    &fakeHandlerService{err: fmt.Errorf("wrapped: %w", ErrConsentNotFound)},
		headerName: "X-User",
	}
	req := httptest.NewRequest(http.MethodDelete, "/benchmarks/privacy/consent?vehicle_id=7", nil)
	req.Header.Set("X-User", "alice")
	rec := httptest.NewRecorder()
	h.Revoke(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
