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
	TypeDrives   JobType = "drives"
	TypeCharging JobType = "charging"
	TypeBackup   JobType = "backup"
)
