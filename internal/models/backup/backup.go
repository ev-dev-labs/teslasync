package backup

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

// Backup type values for the shared backup_type column (migration 000023).
// "incremental" is part of the documented schema domain even though the
// current Processor always performs a full logical dump.
const (
	BackupTypeFull        = "full"
	BackupTypeIncremental = "incremental"
)

// Storage provider values for the shared provider column (migration 000023).
const (
	ProviderLocal    = "local"
	ProviderS3       = "s3"
	ProviderAzure    = "azure"
	ProviderGCS      = "gcs"
	ProviderOneDrive = "onedrive"
)

// Scheduling bounds enforced at the API create/update boundary and mirrored
// by (*BackupConfig).Normalize and Validate. FrequencyDays is constrained to
// [MinFrequencyDays, MaxFrequencyDays]; MaxRetention to
// [MinRetention, MaxRetentionLimit]. A retention below the minimum is coerced
// to DefaultRetention rather than zero, because a zero keep-count turns the
// run-cleanup query into a no-op that would let history grow unbounded.
const (
	MinFrequencyDays  = 1
	MaxFrequencyDays  = 30
	MinRetention      = 1
	MaxRetentionLimit = 100
	DefaultRetention  = 5
)

// IsValidBackupType reports whether s is a recognised backup type.
func IsValidBackupType(s string) bool {
	switch s {
	case BackupTypeFull, BackupTypeIncremental:
		return true
	default:
		return false
	}
}

// IsValidProvider reports whether s is a recognised storage provider.
func IsValidProvider(s string) bool {
	switch s {
	case ProviderLocal, ProviderS3, ProviderAzure, ProviderGCS, ProviderOneDrive:
		return true
	default:
		return false
	}
}

// Normalize clamps the numeric scheduling bounds into their supported ranges,
// matching the API create/update boundary: FrequencyDays into
// [MinFrequencyDays, MaxFrequencyDays] and MaxRetention into
// [MinRetention, MaxRetentionLimit], with a non-positive retention coerced to
// DefaultRetention. It is a no-op on a nil receiver.
func (c *BackupConfig) Normalize() {
	if c == nil {
		return
	}
	if c.FrequencyDays < MinFrequencyDays {
		c.FrequencyDays = MinFrequencyDays
	} else if c.FrequencyDays > MaxFrequencyDays {
		c.FrequencyDays = MaxFrequencyDays
	}
	if c.MaxRetention < MinRetention {
		c.MaxRetention = DefaultRetention
	} else if c.MaxRetention > MaxRetentionLimit {
		c.MaxRetention = MaxRetentionLimit
	}
}

// ApplyDefaults fills empty transport fields with the server-side defaults
// used when a backup config is created: an unset BackupType becomes "full",
// an unset Provider becomes "local", and an empty ProviderConfig becomes an
// empty JSON object so downstream provider construction never sees a NULL
// credential blob. No-op on a nil receiver.
func (c *BackupConfig) ApplyDefaults() {
	if c == nil {
		return
	}
	if c.BackupType == "" {
		c.BackupType = BackupTypeFull
	}
	if c.Provider == "" {
		c.Provider = ProviderLocal
	}
	if len(c.ProviderConfig) == 0 {
		c.ProviderConfig = json.RawMessage(`{}`)
	}
}

// Validate reports the first domain rule the config violates, or nil when it
// is well-formed. It enforces the invariants documented by the backup_configs
// schema (migration 000023): a non-empty Name, a known BackupType and
// Provider, FrequencyDays within [MinFrequencyDays, MaxFrequencyDays], and a
// MaxRetention of at least MinRetention. A nil receiver is itself invalid.
// Callers that prefer silent coercion should use Normalize / ApplyDefaults.
func (c *BackupConfig) Validate() error {
	if c == nil {
		return errors.New("backup config: must not be nil")
	}
	if strings.TrimSpace(c.Name) == "" {
		return errors.New("backup config: name must not be empty")
	}
	if !IsValidBackupType(c.BackupType) {
		return fmt.Errorf("backup config: unknown backup_type %q", c.BackupType)
	}
	if !IsValidProvider(c.Provider) {
		return fmt.Errorf("backup config: unknown provider %q", c.Provider)
	}
	if c.FrequencyDays < MinFrequencyDays || c.FrequencyDays > MaxFrequencyDays {
		return fmt.Errorf("backup config: frequency_days %d out of range [%d,%d]", c.FrequencyDays, MinFrequencyDays, MaxFrequencyDays)
	}
	if c.MaxRetention < MinRetention {
		return fmt.Errorf("backup config: max_retention %d must be >= %d", c.MaxRetention, MinRetention)
	}
	return nil
}

// EffectiveTables returns the explicit IncludeTables allow-list when the
// config specifies one, otherwise the supplied defaults (the processor's full
// table set). This centralises the "empty include list means back up
// everything" rule. The returned slice aliases the config's own IncludeTables
// when non-empty, so callers must treat it as read-only. Safe on a nil
// receiver, which yields the defaults unchanged.
func (c *BackupConfig) EffectiveTables(defaults []string) []string {
	if c == nil || len(c.IncludeTables) == 0 {
		return defaults
	}
	return c.IncludeTables
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

// Run type values for BackupRun.RunType (migration 000023).
const (
	RunTypeBackup  = "backup"
	RunTypeRestore = "restore"
)

// Run status values for BackupRun.Status. queued and running are the
// non-terminal states; the remainder are terminal. StatusCompleted is the
// ONLY status treated as a fully-successful backup (see
// BackupRunRepo.LatestSuccessful). StatusPartial means at least one — but not
// all — tables failed to export; StatusVerifyFailed means the artifact was
// written but its post-upload checksum re-verification failed.
const (
	StatusQueued       = "queued"
	StatusRunning      = "running"
	StatusCompleted    = "completed"
	StatusPartial      = "partial"
	StatusFailed       = "failed"
	StatusVerifyFailed = "verify_failed"
	StatusCancelled    = "cancelled"
)

// IsValidRunType reports whether s is a recognised run type.
func IsValidRunType(s string) bool {
	switch s {
	case RunTypeBackup, RunTypeRestore:
		return true
	default:
		return false
	}
}

// IsValidStatus reports whether s is a recognised backup run status.
func IsValidStatus(s string) bool {
	switch s {
	case StatusQueued, StatusRunning, StatusCompleted, StatusPartial,
		StatusFailed, StatusVerifyFailed, StatusCancelled:
		return true
	default:
		return false
	}
}

// IsBackup reports whether this run is a backup (as opposed to a restore).
// Nil-safe.
func (r *BackupRun) IsBackup() bool { return r != nil && r.RunType == RunTypeBackup }

// IsRestore reports whether this run is a restore. Nil-safe.
func (r *BackupRun) IsRestore() bool { return r != nil && r.RunType == RunTypeRestore }

// IsActive reports whether the run is still in flight (queued or running) and
// therefore has no final artifact yet. Nil-safe.
func (r *BackupRun) IsActive() bool {
	return r != nil && (r.Status == StatusQueued || r.Status == StatusRunning)
}

// IsTerminal reports whether the run has reached a final status. It is
// implemented as an explicit allow-list (rather than !IsActive) so an unknown
// status counts as neither active nor terminal instead of being silently
// treated as done. Nil-safe.
func (r *BackupRun) IsTerminal() bool {
	if r == nil {
		return false
	}
	switch r.Status {
	case StatusCompleted, StatusPartial, StatusFailed, StatusVerifyFailed, StatusCancelled:
		return true
	default:
		return false
	}
}

// IsSuccessful reports whether the run produced a fully-successful backup.
// Only StatusCompleted qualifies — "partial", "verify_failed" and the error
// states do not — matching the definition used by
// BackupRunRepo.LatestSuccessful. Nil-safe.
func (r *BackupRun) IsSuccessful() bool { return r != nil && r.Status == StatusCompleted }

// HasArtifact reports whether the run references a stored backup file that can
// be downloaded or restored (a non-empty FilePath). Nil-safe.
func (r *BackupRun) HasArtifact() bool {
	return r != nil && r.FilePath != nil && *r.FilePath != ""
}

// CanVerify reports whether the run has both a stored artifact and a recorded
// checksum — the two pre-conditions Processor.VerifyBackup needs to
// re-download the file and confirm its integrity. Nil-safe.
func (r *BackupRun) CanVerify() bool {
	return r.HasArtifact() && r.Checksum != nil && *r.Checksum != ""
}

// Duration returns the wall-clock time the run took, derived from the
// persisted DurationMs. A zero or negative stored value yields 0. Nil-safe.
func (r *BackupRun) Duration() time.Duration {
	if r == nil || r.DurationMs <= 0 {
		return 0
	}
	return time.Duration(r.DurationMs) * time.Millisecond
}
