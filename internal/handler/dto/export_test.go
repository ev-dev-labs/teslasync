package dto

import (
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

func TestCreateExportRequest_Validate(t *testing.T) {
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		req        CreateExportRequest
		wantErr    bool
		wantFields []string
	}{
		{"valid csv", CreateExportRequest{Format: "csv", VehicleID: "v1", DateFrom: from, DateTo: to}, false, nil},
		{"valid json", CreateExportRequest{Format: "json", VehicleID: "v1", DateFrom: from, DateTo: to}, false, nil},
		{"empty format", CreateExportRequest{Format: "", VehicleID: "v1", DateFrom: from, DateTo: to}, true, []string{"format"}},
		{"unsupported format", CreateExportRequest{Format: "xml", VehicleID: "v1", DateFrom: from, DateTo: to}, true, []string{"format"}},
		{"empty vehicle id", CreateExportRequest{Format: "csv", VehicleID: "", DateFrom: from, DateTo: to}, true, []string{"vehicleId"}},
		{"zero date from", CreateExportRequest{Format: "csv", VehicleID: "v1", DateTo: to}, true, []string{"dateFrom"}},
		{"zero date to", CreateExportRequest{Format: "csv", VehicleID: "v1", DateFrom: from}, true, []string{"dateTo"}},
		{"date from equals date to", CreateExportRequest{Format: "csv", VehicleID: "v1", DateFrom: from, DateTo: from}, true, []string{"dateTo"}},
		{"date from after date to", CreateExportRequest{Format: "csv", VehicleID: "v1", DateFrom: to, DateTo: from}, true, []string{"dateTo"}},
		{"both dates zero", CreateExportRequest{Format: "csv", VehicleID: "v1"}, true, []string{"dateFrom", "dateTo"}},
		{"all fields invalid", CreateExportRequest{}, true, []string{"format", "vehicleId", "dateFrom", "dateTo"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				return
			}
			if !errors.Is(err, domain.ErrValidation) {
				t.Errorf("error should wrap domain.ErrValidation, got %v", err)
			}
			gotFields := validationFields(t, err)
			for _, f := range tt.wantFields {
				if !containsStr(gotFields, f) {
					t.Errorf("expected validation error on field %q; got fields %v", f, gotFields)
				}
			}
		})
	}
}

func TestExportJobResponse_JSON(t *testing.T) {
	created := time.Date(2024, 5, 1, 10, 0, 0, 0, time.UTC)
	completed := time.Date(2024, 5, 1, 10, 5, 0, 0, time.UTC)

	t.Run("pending omits optional fields", func(t *testing.T) {
		job := ExportJobResponse{ID: "e1", Format: "csv", VehicleID: "v1", FSMState: "processing", CreatedAt: created}
		m := marshalToMap(t, job)
		assertKeys(t, m, "id", "format", "vehicleId", "fsmState", "createdAt")
		if _, ok := m["completedAt"]; ok {
			t.Error("completedAt must be omitted while pending (regression: field must be *time.Time for omitempty to work)")
		}
		assertRoundTrip(t, job)
	})

	t.Run("completed includes file + completion fields", func(t *testing.T) {
		job := ExportJobResponse{
			ID:          "e1",
			Format:      "json",
			VehicleID:   "v1",
			FSMState:    "completed",
			FilePath:    "/exports/e1.json",
			FileSize:    2048,
			CreatedAt:   created,
			CompletedAt: &completed,
		}
		m := marshalToMap(t, job)
		assertKeys(t, m, "id", "format", "vehicleId", "fsmState", "filePath", "fileSize", "createdAt", "completedAt")
		if got := string(m["fileSize"]); got != "2048" {
			t.Errorf("fileSize = %s, want 2048", got)
		}
		assertRoundTrip(t, job)
	})

	t.Run("failed includes failedReason", func(t *testing.T) {
		job := ExportJobResponse{ID: "e1", Format: "csv", VehicleID: "v1", FSMState: "failed", FailedReason: "disk full", CreatedAt: created}
		m := marshalToMap(t, job)
		assertKeys(t, m, "id", "format", "vehicleId", "fsmState", "failedReason", "createdAt")
		assertRoundTrip(t, job)
	})
}
