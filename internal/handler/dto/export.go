package dto

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// CreateExportRequest is the request body for creating an export job.
type CreateExportRequest struct {
	Format    string    `json:"format"` // "csv" or "json"
	VehicleID string    `json:"vehicleId"`
	DateFrom  time.Time `json:"dateFrom"`
	DateTo    time.Time `json:"dateTo"`
}

// supportedExportFormats is the closed set of accepted export encodings.
var supportedExportFormats = map[string]struct{}{
	"csv":  {},
	"json": {},
}

// Validate checks the transport-level shape of a CreateExportRequest: the
// format must be a supported encoding, a vehicle must be named, and the date
// window must be present and correctly ordered. The returned error, if any,
// is a domain.ValidationErrors that wraps domain.ErrValidation so the handler
// error middleware maps it to HTTP 400.
func (r CreateExportRequest) Validate() error {
	var errs domain.ValidationErrors

	if r.Format == "" {
		errs = append(errs, domain.ValidationError{Field: "format", Message: "required"})
	} else if _, ok := supportedExportFormats[r.Format]; !ok {
		errs = append(errs, domain.ValidationError{Field: "format", Message: `must be "csv" or "json"`})
	}

	if r.VehicleID == "" {
		errs = append(errs, domain.ValidationError{Field: "vehicleId", Message: "required"})
	}

	if r.DateFrom.IsZero() {
		errs = append(errs, domain.ValidationError{Field: "dateFrom", Message: "required"})
	}
	if r.DateTo.IsZero() {
		errs = append(errs, domain.ValidationError{Field: "dateTo", Message: "required"})
	}
	// Order check only makes sense once both bounds are present.
	if !r.DateFrom.IsZero() && !r.DateTo.IsZero() && !r.DateFrom.Before(r.DateTo) {
		errs = append(errs, domain.ValidationError{Field: "dateTo", Message: "must be after dateFrom"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

// ExportJobResponse is the API response for an export job.
type ExportJobResponse struct {
	ID           string     `json:"id"`
	Format       string     `json:"format"`
	VehicleID    string     `json:"vehicleId"`
	FSMState     string     `json:"fsmState"`
	FilePath     string     `json:"filePath,omitempty"`
	FileSize     int64      `json:"fileSize,omitempty"`
	FailedReason string     `json:"failedReason,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
}
