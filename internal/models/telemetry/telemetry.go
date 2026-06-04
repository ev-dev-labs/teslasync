package telemetry

import "time"

// RawTelemetrySignal previously stored a raw signal batch from Tesla fleet
// telemetry for debugging. ADR-001/ADR-005 eliminated the `signals` JSONB
// blob — typed columns now hold each signal. This struct is retained for
// metadata-only use (vin/source/count/timestamp) until the raw_telemetry repo
// is removed.
type RawTelemetrySignal struct {
	VIN         string    `json:"vin" bson:"vin"`
	Source      string    `json:"source" bson:"source"`
	SignalCount int       `json:"signal_count" bson:"signal_count"`
	CreatedAt   time.Time `json:"created_at" bson:"created_at"`
}

// TeslaFleetTelemetryError represents a fleet telemetry error from the partner endpoint.
// Persisted for historical tracking and alerting.
type TeslaFleetTelemetryError struct {
	ID             int64      `json:"id" db:"id"`
	VIN            string     `json:"vin" db:"vin"`
	ErrorCode      *string    `json:"error_code" db:"error_code"`
	ErrorMessage   *string    `json:"error_message" db:"error_message"`
	ReportedAt     *time.Time `json:"reported_at" db:"reported_at"`
	TeslaUpdatedAt *time.Time `json:"tesla_updated_at" db:"tesla_updated_at"`
	FetchedAt      time.Time  `json:"fetched_at" db:"fetched_at"`
}

// TeslaFleetTelemetryErrorVIN tracks a VIN with active or previously active telemetry errors.
type TeslaFleetTelemetryErrorVIN struct {
	ID          int64      `json:"id" db:"id"`
	VIN         string     `json:"vin" db:"vin"`
	Active      bool       `json:"active" db:"active"`
	FirstSeenAt time.Time  `json:"first_seen_at" db:"first_seen_at"`
	LastSeenAt  time.Time  `json:"last_seen_at" db:"last_seen_at"`
	ResolvedAt  *time.Time `json:"resolved_at" db:"resolved_at"`
}
