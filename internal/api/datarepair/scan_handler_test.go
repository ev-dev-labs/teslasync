package datarepair

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type fakeRepairScanner struct {
	result ScanResult
	err    error
	opts   ScanOptions
	calls  int
}

func (f *fakeRepairScanner) Scan(_ context.Context, opts ScanOptions) (ScanResult, error) {
	f.calls++
	f.opts = opts
	return f.result, f.err
}

func TestScanCasesRunsSharedScanner(t *testing.T) {
	scanner := &fakeRepairScanner{
		result: ScanResult{
			RunID:      41,
			Status:     systemmodel.RepairScanStatusCompleted,
			Discovered: 3,
			Refreshed:  2,
		},
	}
	handler := NewDataRepairHandler(
		nil,
		WithScanner(scanner),
		WithForwardAuthHeader("X-Forwarded-User"),
	)
	req := httptest.NewRequest(http.MethodPost, "/data-repair/cases/scan", strings.NewReader(
		`{"vehicle_id":17}`,
	))
	req.Header.Set("X-Forwarded-User", "operator@example.test")
	rec := httptest.NewRecorder()

	handler.ScanCases(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if scanner.calls != 1 {
		t.Fatalf("scanner calls = %d, want 1", scanner.calls)
	}
	if scanner.opts.Trigger != systemmodel.RepairScanTriggerManual {
		t.Fatalf("trigger = %q, want manual", scanner.opts.Trigger)
	}
	if scanner.opts.VehicleID == nil || *scanner.opts.VehicleID != 17 {
		t.Fatalf("vehicle_id = %v, want 17", scanner.opts.VehicleID)
	}
	if scanner.opts.InitiatedBy != "operator@example.test" {
		t.Fatalf("initiated_by = %q, want operator identity", scanner.opts.InitiatedBy)
	}

	var got ScanResult
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got != scanner.result {
		t.Fatalf("response = %+v, want %+v", got, scanner.result)
	}
}

func TestScanCasesRejectsInvalidVehicleID(t *testing.T) {
	scanner := &fakeRepairScanner{}
	handler := NewDataRepairHandler(nil, WithScanner(scanner))
	req := httptest.NewRequest(
		http.MethodPost,
		"/data-repair/cases/scan",
		strings.NewReader(`{"vehicle_id":0}`),
	)
	rec := httptest.NewRecorder()

	handler.ScanCases(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if scanner.calls != 0 {
		t.Fatalf("scanner calls = %d, want 0", scanner.calls)
	}
}

func TestScanCasesReportsConcurrentScan(t *testing.T) {
	scanner := &fakeRepairScanner{err: ErrScanAlreadyRunning}
	handler := NewDataRepairHandler(nil, WithScanner(scanner))
	req := httptest.NewRequest(
		http.MethodPost,
		"/data-repair/cases/scan",
		strings.NewReader(`{}`),
	)
	rec := httptest.NewRecorder()

	handler.ScanCases(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestScanCasesHidesInternalFailure(t *testing.T) {
	scanner := &fakeRepairScanner{err: errors.New("database credentials leaked")}
	handler := NewDataRepairHandler(nil, WithScanner(scanner))
	req := httptest.NewRequest(
		http.MethodPost,
		"/data-repair/cases/scan",
		strings.NewReader(`{}`),
	)
	rec := httptest.NewRecorder()

	handler.ScanCases(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "credentials") {
		t.Fatalf("response exposed internal error: %s", rec.Body.String())
	}
}

func TestScanCasesRequiresConfiguredScanner(t *testing.T) {
	handler := NewDataRepairHandler(nil)
	req := httptest.NewRequest(
		http.MethodPost,
		"/data-repair/cases/scan",
		strings.NewReader(`{}`),
	)
	rec := httptest.NewRecorder()

	handler.ScanCases(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body=%s", rec.Code, rec.Body.String())
	}
}
