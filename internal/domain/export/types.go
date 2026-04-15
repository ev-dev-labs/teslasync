package export

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// ExportJob represents a data export job aggregate.
type ExportJob struct {
	ID           string    `json:"id" db:"id"`
	UserID       string    `json:"userId" db:"user_id"`
	Format       string    `json:"format" db:"format"` // "csv" or "json"
	VehicleID    string    `json:"vehicleId" db:"vehicle_id"`
	DateFrom     time.Time `json:"dateFrom" db:"date_from"`
	DateTo       time.Time `json:"dateTo" db:"date_to"`
	FSMState     fsm.State `json:"fsmState" db:"fsm_state"`
	FilePath     string    `json:"filePath,omitempty" db:"file_path"`
	FileSize     int64     `json:"fileSize,omitempty" db:"file_size"`
	FailedReason string    `json:"failedReason,omitempty" db:"failed_reason"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	CompletedAt  time.Time `json:"completedAt,omitempty" db:"completed_at"`
}
