package export

import "time"

// ExportJob represents an async export job persisted in the database.
type ExportJob struct {
	ID           string     `json:"id"`
	Type         string     `json:"type"`
	Format       string     `json:"format"`
	Status       string     `json:"status"`
	VehicleID    *int64     `json:"vehicle_id,omitempty"`
	StartDate    *time.Time `json:"start_date,omitempty"`
	EndDate      *time.Time `json:"end_date,omitempty"`
	FileName     *string    `json:"file_name,omitempty"`
	FileSize     int64      `json:"file_size"`
	RecordCount  int        `json:"record_count"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

// ExportJobSummary is a lightweight view of an export job (without file data).
type ExportJobSummary struct {
	ID           string     `json:"id"`
	Type         string     `json:"type"`
	Format       string     `json:"format"`
	Status       string     `json:"status"`
	VehicleID    *int64     `json:"vehicle_id,omitempty"`
	FileName     *string    `json:"file_name,omitempty"`
	FileSize     int64      `json:"file_size"`
	RecordCount  int        `json:"record_count"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	DurationMs   *float64   `json:"duration_ms,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

// ExportJobRequest is the message published to MQTT to trigger export processing.
type ExportJobRequest struct {
	JobID     string     `json:"job_id"`
	Type      string     `json:"type"`
	Format    string     `json:"format"`
	VehicleID *int64     `json:"vehicle_id,omitempty"`
	StartDate *time.Time `json:"start_date,omitempty"`
	EndDate   *time.Time `json:"end_date,omitempty"`
}
