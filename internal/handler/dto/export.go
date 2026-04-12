package dto

import "time"

// CreateExportRequest is the request body for creating an export job.
type CreateExportRequest struct {
	Format    string    `json:"format"` // "csv" or "json"
	VehicleID string    `json:"vehicleId"`
	DateFrom  time.Time `json:"dateFrom"`
	DateTo    time.Time `json:"dateTo"`
}

// ExportJobResponse is the API response for an export job.
type ExportJobResponse struct {
	ID           string    `json:"id"`
	Format       string    `json:"format"`
	VehicleID    string    `json:"vehicleId"`
	FSMState     string    `json:"fsmState"`
	FilePath     string    `json:"filePath,omitempty"`
	FileSize     int64     `json:"fileSize,omitempty"`
	FailedReason string    `json:"failedReason,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	CompletedAt  time.Time `json:"completedAt,omitempty"`
}
