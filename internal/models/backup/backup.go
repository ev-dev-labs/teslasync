package backup

import (
	"encoding/json"
	"time"
)

// BackupConfig represents a user-defined backup schedule configuration.
type BackupConfig struct {
	ID             int64           `json:"id" db:"id"`
	Name           string          `json:"name" db:"name"`
	Enabled        bool            `json:"enabled" db:"enabled"`
	BackupType     string          `json:"backup_type" db:"backup_type"`         // full, incremental
	FrequencyDays  int             `json:"frequency_days" db:"frequency_days"`   // 1-30
	MaxRetention   int             `json:"max_retention" db:"max_retention"`     // keep last N
	Provider       string          `json:"provider" db:"provider"`               // local, s3, azure, gcs, onedrive
	ProviderConfig json.RawMessage `json:"provider_config" db:"provider_config"` // provider credentials
	IncludeTables  []string        `json:"include_tables,omitempty" db:"include_tables"`
	Compress       bool            `json:"compress" db:"compress"`
	Encrypt        bool            `json:"encrypt" db:"encrypt"`
	LastRunAt      *time.Time      `json:"last_run_at,omitempty" db:"last_run_at"`
	NextRunAt      *time.Time      `json:"next_run_at,omitempty" db:"next_run_at"`
	CreatedAt      time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at" db:"updated_at"`
}

// BackupRun represents a single backup or restore execution.
type BackupRun struct {
	ID           int64           `json:"id" db:"id"`
	ConfigID     *int64          `json:"config_id,omitempty" db:"config_id"`
	RunType      string          `json:"run_type" db:"run_type"`       // backup, restore
	BackupType   string          `json:"backup_type" db:"backup_type"` // full, incremental
	Status       string          `json:"status" db:"status"`           // queued, running, completed, failed, cancelled
	Provider     string          `json:"provider" db:"provider"`
	FileName     *string         `json:"file_name,omitempty" db:"file_name"`
	FilePath     *string         `json:"file_path,omitempty" db:"file_path"`
	FileSize     int64           `json:"file_size" db:"file_size"`
	RecordCount  int             `json:"record_count" db:"record_count"`
	TableCount   int             `json:"table_count" db:"table_count"`
	Checksum     *string         `json:"checksum,omitempty" db:"checksum"`
	DurationMs   int64           `json:"duration_ms" db:"duration_ms"`
	ErrorMessage *string         `json:"error_message,omitempty" db:"error_message"`
	Metadata     json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	StartedAt    *time.Time      `json:"started_at,omitempty" db:"started_at"`
	CompletedAt  *time.Time      `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
}
