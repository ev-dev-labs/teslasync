// Package export provides an MQTT-backed background worker for processing
// data exports and database backups asynchronously. Instead of generating
// exports synchronously inside HTTP handlers, callers submit an ExportJob
// to the MQTT broker. The Worker subscribes to the internal topic, processes
// the job in the background, and stores the result in the database.
package export

import (
	"github.com/ev-dev-labs/teslasync/internal/models"
)

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
	TypeTrips          JobType = "trips"
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
const AccountSchemaVersion = "2.0.0"

// JobRequest is the in-process representation of an export job request.
// It is the single shape the worker decodes from MQTT, the processor
// receives, and api handlers publish — extending the durable
// models.ExportJobRequest with the Phase-46/62 column allowlist that
// lives entirely inside the export package's contract.
//
// The embedded models.ExportJobRequest carries all wire-stable fields
// (job_id, type, format, vehicle_id, start_date, end_date). Columns is
// an optional caller-supplied allowlist of output column names. When
// nil/empty the writer emits its full canonical column set, preserving
// the pre-Phase-46/62 default behaviour byte-for-byte. When non-empty,
// the writer validates each entry against the published catalog (see
// AvailableColumns) and emits only those columns, in the caller's
// order — primary-key / always-included columns are re-added
// transparently when omitted.
//
// Encoded as a flat JSON object: Go's encoding/json promotes the
// embedded struct's fields to the top level, so the wire format is
// exactly `{"job_id":...,"type":...,...,"columns":[...]}`. Backwards
// compatible with existing publishers that omit the columns key.
type JobRequest struct {
	models.ExportJobRequest
	Columns []string `json:"columns,omitempty"`
}

// FromModel adapts a stable models.ExportJobRequest into the in-process
// JobRequest type. The returned request carries no column allowlist; use
// when bridging code that hasn't been migrated to set Columns directly.
func FromModel(m *models.ExportJobRequest) *JobRequest {
	if m == nil {
		return nil
	}
	return &JobRequest{ExportJobRequest: *m}
}
