package models

import "time"

// FleetTelemetrySubscription records a subscription request to Tesla Fleet Telemetry.
type FleetTelemetrySubscription struct {
	ID              int64          `json:"id" db:"id"`
	VehicleID       *int64         `json:"vehicle_id,omitempty" db:"vehicle_id"`
	VIN             string         `json:"vin" db:"vin"`
	Signals         []string       `json:"signals" db:"signals"`
	IntervalSeconds int            `json:"interval_seconds" db:"interval_seconds"`
	FieldIntervals  map[string]int `json:"field_intervals,omitempty" db:"field_intervals"`
	Hostname        string         `json:"hostname" db:"hostname"`
	Port            int            `json:"port" db:"port"`
	Protocol        string         `json:"protocol" db:"protocol"`
	CaPEM           *string        `json:"ca_pem,omitempty" db:"ca_pem"`
	SubscribedAt    time.Time      `json:"subscribed_at" db:"subscribed_at"`
	ExpiresAt       *time.Time     `json:"expires_at,omitempty" db:"expires_at"`
	Status          string         `json:"status" db:"status"`
	ResponseCode    *int           `json:"response_code,omitempty" db:"response_code"`
	ResponseBody    *string        `json:"response_body,omitempty" db:"response_body"`
	CreatedAt       time.Time      `json:"created_at" db:"created_at"`
}

// RawTelemetrySignal previously stored a raw signal batch from Tesla fleet
// telemetry for debugging. ADR-001/ADR-005 eliminated the `signals` JSONB
// blob — typed columns now hold each signal. This struct is retained for
// metadata-only use (vin/source/count/timestamp) until the raw_telemetry repo
// is removed in its own prompt.
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
