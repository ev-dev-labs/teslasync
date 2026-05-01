// Package export provides an MQTT-backed background worker for processing
// data exports and database backups asynchronously. Instead of generating
// exports synchronously inside HTTP handlers, callers submit an ExportJob
// to the MQTT broker. The Worker subscribes to the internal topic, processes
// the job in the background, and stores the result in the database.
package export

// MQTT topic for internal export job dispatch.
const InternalTopic = "teslasync/internal/exports"

// JobStatus represents the lifecycle state of an export job.
type JobStatus string

const (
	StatusQueued     JobStatus = "queued"
	StatusProcessing JobStatus = "processing"
	StatusReady      JobStatus = "ready"
	StatusFailed     JobStatus = "failed"
)

// JobType represents the kind of export to perform.
type JobType string

const (
	TypeDrives         JobType = "drives"
	TypeCharging       JobType = "charging"
	TypeBackup         JobType = "backup"
	TypeAnalytics      JobType = "analytics"
	TypeImportDrives   JobType = "import_drives"
	TypeImportCharging JobType = "import_charging"
	// TypeAccount is a GDPR-style "Download my data" export — produces a ZIP
	// containing one CSV per table in database.AllowedAccountTables plus a
	// manifest.json. Phase 40 / Prompt 31.
	TypeAccount JobType = "account"
)

// MaxAccountRowsPerTable caps the number of rows fetched per table during a
// full account export. Prevents unbounded memory growth when tables like
// signal_log contain hundreds of millions of rows.
const MaxAccountRowsPerTable = 250_000

// AccountSchemaVersion is the version of the account-export ZIP layout. Bump
// this when columns are added or removed so consumers can detect changes.
const AccountSchemaVersion = "1.0.0"
