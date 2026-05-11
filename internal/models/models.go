package models

import (
	"encoding/json"
	"strings"
	"time"
)

// APIKey represents a user-generated API key for external integrations.
type APIKey struct {
	ID          int64      `json:"id" db:"id"`
	Name        string     `json:"name" db:"name"`
	KeyHash     string     `json:"-" db:"key_hash"`
	KeyPrefix   string     `json:"key_prefix" db:"key_prefix"`
	Permissions string     `json:"permissions" db:"permissions"`
	LastUsedAt  *time.Time `json:"last_used_at" db:"last_used_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at" db:"expires_at"`
}

// AuditLog has moved to system.go (regenerated for post-migration schema).

// Vehicle has moved to vehicle.go (regenerated for post-migration schema).

// Position has moved to position.go (regenerated for post-migration schema).

// Drive has moved to drive.go (regenerated for post-migration schema).

// DriveTelemetryReading has moved to drive.go.

// ChargeTelemetryReading has moved to charging.go.

// ChargingSession is defined in charging.go to mirror the post-migration
// `charging_sessions` schema (migrations/000142_baseline_typed.up.sql).

// Address represents a reverse-geocoded location.
type Address struct {
	ID          int64     `json:"id" db:"id"`
	DisplayName string    `json:"display_name" db:"display_name"`
	Latitude    float64   `json:"latitude" db:"latitude"`
	Longitude   float64   `json:"longitude" db:"longitude"`
	Name        *string   `json:"name,omitempty" db:"name"`
	HouseNumber *string   `json:"house_number,omitempty" db:"house_number"`
	Road        *string   `json:"road,omitempty" db:"road"`
	City        *string   `json:"city,omitempty" db:"city"`
	County      *string   `json:"county,omitempty" db:"county"`
	State       *string   `json:"state,omitempty" db:"state"`
	Country     *string   `json:"country,omitempty" db:"country"`
	PostCode    *string   `json:"postcode,omitempty" db:"postcode"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// Geofence has moved to system.go (regenerated for post-migration schema).

// SoftwareUpdate has moved to vehicle.go.

// Token represents stored OAuth tokens.
type Token struct {
	ID           int64     `json:"id" db:"id"`
	AccessToken  string    `json:"-" db:"access_token"`
	RefreshToken string    `json:"-" db:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// LegacySettings stores application-level user settings.
//
// Deprecated: superseded by the typed key-value `Setting` struct in system.go,
// which mirrors the post-migration `settings` table. Retained temporarily so
// that internal/database/settings_repo.go and internal/api/settings_handler.go
// continue to build; these will be rewritten in phase-5 prompts 30-66.
type LegacySettings struct {
	ID                int64               `json:"id" db:"id"`
	UnitOfLength      string              `json:"unit_of_length" db:"unit_of_length"`     // km, mi
	UnitOfTemp        string              `json:"unit_of_temp" db:"unit_of_temp"`         // C, F
	UnitOfPressure    string              `json:"unit_of_pressure" db:"unit_of_pressure"` // bar, psi
	PreferredRange    string              `json:"preferred_range" db:"preferred_range"`   // ideal, rated
	Language          string              `json:"language" db:"language"`
	BaseCostPerKWh    float64             `json:"base_cost_per_kwh" db:"base_cost_per_kwh"`
	APISuspended      bool                `json:"api_suspended" db:"api_suspended"`
	Theme             string              `json:"theme" db:"theme"`                           // neon-cyan, tesla-red, etc.
	Mode              string              `json:"mode" db:"mode"`                             // dark, light, oled, midnight
	CustomPrimary     string              `json:"custom_primary" db:"custom_primary"`         // hex color for custom theme
	CustomAccent      string              `json:"custom_accent" db:"custom_accent"`           // hex color for custom theme
	GasPricePerUnit   float64             `json:"gas_price_per_unit" db:"gas_price_per_unit"` // price per gallon/liter
	GasUnit           string              `json:"gas_unit" db:"gas_unit"`                     // gallon, liter
	GasEfficiencyMPG  float64             `json:"gas_efficiency_mpg" db:"gas_efficiency_mpg"` // equivalent ICE car MPG for comparison
	DecimalPrecision  int                 `json:"decimal_precision" db:"decimal_precision"`   // 1, 2, 3, or 4 decimal places for display
	QuietHoursEnabled bool                `json:"quiet_hours_enabled" db:"quiet_hours_enabled"`
	QuietHoursStart   string              `json:"quiet_hours_start" db:"quiet_hours_start"` // HH:MM (24h)
	QuietHoursEnd     string              `json:"quiet_hours_end" db:"quiet_hours_end"`     // HH:MM (24h)
	AlertDigestMode   string              `json:"alert_digest_mode" db:"alert_digest_mode"` // instant, hourly, daily
	PollingConfig     LegacyPollingConfig `json:"polling_config" db:"polling_config"`
}

// LegacyPollingConfig controls which Tesla Fleet API endpoints are enabled.
//
// Deprecated: superseded by the typed `PollingConfig` struct in system.go,
// which mirrors the post-migration `polling_config` table (per-vehicle polling
// intervals). Retained temporarily so that internal/worker/, internal/database/
// settings_repo.go, and internal/api/settings_handler.go continue to build;
// these will be rewritten in phase-5 prompts 30-66.
type LegacyPollingConfig struct {
	// Polling endpoints (automatic, worker-driven)
	VehicleDiscovery bool `json:"vehicle_discovery"` // GET /api/1/vehicles (auto-discovery)
	ChargeState      bool `json:"charge_state"`      // vehicle_data sub-endpoint
	ClimateState     bool `json:"climate_state"`     // vehicle_data sub-endpoint
	DriveState       bool `json:"drive_state"`       // vehicle_data sub-endpoint
	LocationData     bool `json:"location_data"`     // vehicle_data sub-endpoint
	VehicleState     bool `json:"vehicle_state"`     // vehicle_data sub-endpoint
	VehicleConfig    bool `json:"vehicle_config"`    // vehicle_data sub-endpoint

	// On-demand counterparts for polling endpoints (user-triggered)
	OnDemandVehicleDiscovery bool `json:"on_demand_vehicle_discovery"` // Sync from Tesla button
	OnDemandChargeState      bool `json:"on_demand_charge_state"`      // live vehicle view
	OnDemandClimateState     bool `json:"on_demand_climate_state"`     // live vehicle view
	OnDemandDriveState       bool `json:"on_demand_drive_state"`       // live vehicle view
	OnDemandLocationData     bool `json:"on_demand_location_data"`     // live vehicle view
	OnDemandVehicleState     bool `json:"on_demand_vehicle_state"`     // live vehicle view
	OnDemandVehicleConfig    bool `json:"on_demand_vehicle_config"`    // live vehicle view

	// On-demand only endpoints
	NearbyChargingSites bool `json:"nearby_charging_sites"` // GET /vehicles/{vin}/nearby_charging_sites
	ReleaseNotes        bool `json:"release_notes"`         // GET /vehicles/{vin}/release_notes
	RecentAlerts        bool `json:"recent_alerts"`         // GET /vehicles/{vin}/recent_alerts
	ServiceData         bool `json:"service_data"`          // GET /vehicles/{vin}/service_data

	// Commands
	WakeUp   bool `json:"wake_up"`  // POST /vehicles/{vin}/wake_up
	Commands bool `json:"commands"` // POST /vehicles/{vin}/command/*

	// Telemetry capture (raw signal recording to MongoDB)
	TelemetryCapture              bool `json:"telemetry_capture"`                // enable raw signal recording
	TelemetryCaptureRetentionDays int  `json:"telemetry_capture_retention_days"` // TTL in days (default: 7)
}

// DefaultPollingConfig returns a LegacyPollingConfig with all endpoints enabled.
//
// Deprecated: returns the legacy feature-flag struct, not the per-vehicle
// `PollingConfig` from system.go. Will be removed in phase-5 prompts 30-66.
func DefaultPollingConfig() LegacyPollingConfig {
	return LegacyPollingConfig{
		VehicleDiscovery:              true,
		ChargeState:                   true,
		ClimateState:                  true,
		DriveState:                    true,
		LocationData:                  true,
		VehicleState:                  true,
		VehicleConfig:                 true,
		OnDemandVehicleDiscovery:      true,
		OnDemandChargeState:           true,
		OnDemandClimateState:          true,
		OnDemandDriveState:            true,
		OnDemandLocationData:          true,
		OnDemandVehicleState:          true,
		OnDemandVehicleConfig:         true,
		NearbyChargingSites:           true,
		ReleaseNotes:                  true,
		RecentAlerts:                  true,
		ServiceData:                   true,
		WakeUp:                        true,
		Commands:                      true,
		TelemetryCapture:              false,
		TelemetryCaptureRetentionDays: 7,
	}
}

// EnabledVehicleDataEndpoints returns the list of enabled vehicle_data sub-endpoints
// for use in the Tesla API query string (e.g., "charge_state;drive_state").
func (pc *LegacyPollingConfig) EnabledVehicleDataEndpoints() []string {
	var endpoints []string
	if pc.ChargeState {
		endpoints = append(endpoints, "charge_state")
	}
	if pc.ClimateState {
		endpoints = append(endpoints, "climate_state")
	}
	if pc.DriveState {
		endpoints = append(endpoints, "drive_state")
	}
	if pc.LocationData {
		endpoints = append(endpoints, "location_data")
	}
	if pc.VehicleState {
		endpoints = append(endpoints, "vehicle_state")
	}
	if pc.VehicleConfig {
		endpoints = append(endpoints, "vehicle_config")
	}
	return endpoints
}

// VehicleDataEndpointsString returns enabled sub-endpoints as a semicolon-separated string.
func (pc *LegacyPollingConfig) VehicleDataEndpointsString() string {
	return strings.Join(pc.EnabledVehicleDataEndpoints(), ";")
}

// HasAnyVehicleDataEndpoint returns true if at least one vehicle_data sub-endpoint is enabled.
func (pc *LegacyPollingConfig) HasAnyVehicleDataEndpoint() bool {
	return pc.ChargeState || pc.ClimateState || pc.DriveState ||
		pc.LocationData || pc.VehicleState || pc.VehicleConfig
}

// EnabledOnDemandVehicleDataEndpoints returns the list of enabled on-demand vehicle_data sub-endpoints.
func (pc *LegacyPollingConfig) EnabledOnDemandVehicleDataEndpoints() []string {
	var endpoints []string
	if pc.OnDemandChargeState {
		endpoints = append(endpoints, "charge_state")
	}
	if pc.OnDemandClimateState {
		endpoints = append(endpoints, "climate_state")
	}
	if pc.OnDemandDriveState {
		endpoints = append(endpoints, "drive_state")
	}
	if pc.OnDemandLocationData {
		endpoints = append(endpoints, "location_data")
	}
	if pc.OnDemandVehicleState {
		endpoints = append(endpoints, "vehicle_state")
	}
	if pc.OnDemandVehicleConfig {
		endpoints = append(endpoints, "vehicle_config")
	}
	return endpoints
}

// VehicleState has moved to vehicle.go.

// Alert and AlertRule have moved to alert.go. The legacy `alerts` table is
// dropped by the Phase 4 baseline migration; only `alert_rules` remains and is
// modeled by AlertRule in alert.go.

// CommandLog has moved to vehicle.go.

// EnergyStatsRow represents a single day of energy data from cagg_fleet_stats.
type EnergyStatsRow struct {
	Date             string  `json:"date"`
	EnergyWh         float64 `json:"energy_wh"`
	DistanceM        float64 `json:"distance_m"`
	EfficiencyWhPerM float64 `json:"efficiency_wh_per_m"`
	Cost             float64 `json:"cost"`
}

// BatterySnapshot was removed with the dropped battery_snapshots table.

// NotificationChannel represents a configured notification delivery channel.
type NotificationChannel struct {
	ID        int64             `json:"id" db:"id"`
	Name      string            `json:"name" db:"name"`
	Type      string            `json:"type" db:"kind"` // discord, email, slack, telegram, webhook, ntfy, pushover
	Config    map[string]string `json:"config" db:"-"`  // populated from per-kind child tables, not a DB column
	Enabled   bool              `json:"enabled" db:"enabled"`
	CreatedAt time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt time.Time         `json:"updated_at" db:"updated_at"`
}

// NotificationLog records a notification delivery attempt.
//
// ReadAt / ArchivedAt (Phase 40 / Prompt 29) drive the inbox UX on
// /notifications: NULL means "unread" / "still in the inbox", a non-nil
// timestamp records when the user (or an auto-mark policy) flipped the bit.
//
// Severity (Phase-46 / Prompt 19) is the wire severity the dispatcher
// saw when the row was enqueued. NULL on legacy rows captured before
// the quiet-hours migration. Used by the replay loop to re-evaluate a
// deferred row against active DND windows.
//
// AcknowledgedAt / AcknowledgedBy / AcknowledgementNote (Phase-46 / Prompt 20)
// carry the latest acknowledgement state of the alert this row represents.
// NULL means "not yet acknowledged"; a non-nil AcknowledgedAt records when,
// by whom, and (optionally) why. Cleared by /alerts/{id}/reopen. The
// per-acknowledgement audit timeline lives in notification_log_events.
type NotificationLog struct {
	ID                  int64      `json:"id" db:"id"`
	ChannelID           int64      `json:"channel_id" db:"channel_id"`
	AlertID             *int64     `json:"alert_id,omitempty" db:"alert_id"`
	Title               string     `json:"title" db:"title"`
	Message             string     `json:"message" db:"message"`
	Status              string     `json:"status" db:"status"` // pending, sent, failed, deferred_dnd
	Severity            string     `json:"severity,omitempty" db:"severity"`
	Error               string     `json:"error,omitempty" db:"error"`
	ScheduledAt         *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	LatencyMs           *int       `json:"latency_ms,omitempty" db:"latency_ms"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	SentAt              *time.Time `json:"sent_at,omitempty" db:"sent_at"`
	ReadAt              *time.Time `json:"read_at,omitempty" db:"read_at"`
	ArchivedAt          *time.Time `json:"archived_at,omitempty" db:"archived_at"`
	AcknowledgedAt      *time.Time `json:"acknowledged_at,omitempty" db:"acknowledged_at"`
	AcknowledgedBy      *string    `json:"acknowledged_by,omitempty" db:"acknowledged_by"`
	AcknowledgementNote *string    `json:"acknowledgement_note,omitempty" db:"acknowledgement_note"`
}

// NotificationSchedule represents a scheduled or recurring notification.
type NotificationSchedule struct {
	ID          int64      `json:"id" db:"id"`
	ChannelID   int64      `json:"channel_id" db:"channel_id"`
	Title       string     `json:"title" db:"title"`
	Message     string     `json:"message" db:"message"`
	CronExpr    *string    `json:"cron_expr,omitempty" db:"cron_expr"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	LastRunAt   *time.Time `json:"last_run_at,omitempty" db:"last_run_at"`
	NextRunAt   *time.Time `json:"next_run_at,omitempty" db:"next_run_at"`
	Enabled     bool       `json:"enabled" db:"enabled"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// NotificationPreference controls which event types trigger a channel.
type NotificationPreference struct {
	ID        int64     `json:"id" db:"id"`
	ChannelID int64     `json:"channel_id" db:"channel_id"`
	EventType string    `json:"event_type" db:"event_type"`
	Enabled   bool      `json:"enabled" db:"enabled"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// NotificationMetric tracks daily delivery metrics per channel.
type NotificationMetric struct {
	ID           int64     `json:"id" db:"id"`
	ChannelID    int64     `json:"channel_id" db:"channel_id"`
	Date         time.Time `json:"date" db:"date"`
	TotalSent    int       `json:"total_sent" db:"total_sent"`
	TotalFailed  int       `json:"total_failed" db:"total_failed"`
	AvgLatencyMs int       `json:"avg_latency_ms" db:"avg_latency_ms"`
}

// ChatMessage represents a single chatbot message.
type ChatMessage struct {
	ID        int64     `json:"id" db:"id"`
	SessionID string    `json:"session_id" db:"session_id"`
	Role      string    `json:"role" db:"role"` // user, assistant
	Content   string    `json:"content" db:"content"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// ChatSessionInfo is the per-session metadata returned by the Sessions
// listing endpoint. The frontend sidebar uses Title (renameable, may fall
// back to FirstMessage when no explicit title is set), MessageCount, and
// LastMessageAt to render and order the list. Backed by chatbot_sessions
// (Phase 40 / Prompt 56) joined against chatbot_messages.
type ChatSessionInfo struct {
	ID            string     `json:"id" db:"session_id"`
	Title         *string    `json:"title" db:"title"`
	FirstMessage  *string    `json:"first_message" db:"first_message"`
	MessageCount  int        `json:"message_count" db:"message_count"`
	LastMessageAt *time.Time `json:"last_message_at" db:"last_message_at"`
	CreatedAt     *time.Time `json:"created_at" db:"created_at"`
}

// TirePressureSnapshot has moved to vehicle.go.

// VampireDrainEvent has moved to vehicle.go.

// DailyMileage was removed; mileage endpoints derive from SI drives data.

// VisitedLocation represents an aggregated visited place.
type VisitedLocation struct {
	ID             int64      `json:"id" db:"id"`
	VehicleID      int64      `json:"vehicle_id" db:"vehicle_id"`
	AddressID      *int64     `json:"address_id,omitempty" db:"address_id"`
	AddressName    string     `json:"address_name" db:"address_name"`
	VisitCount     int        `json:"visit_count" db:"visit_count"`
	TotalDurationS float64    `json:"total_duration_s" db:"total_duration_s"`
	LastVisited    *time.Time `json:"last_visited,omitempty" db:"last_visited"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// Trip is defined in trip.go (regenerated to match post-migration schema).

// VehicleStateRecord was removed; vehicle-state endpoints derive from fsm_transitions.

// APICallLog has been moved to tesla.go and regenerated to match the
// post-migration api_call_logs schema (ADR-005: no raw_json bodies).

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

// MotorSnapshot moved to motor.go (regenerated for post-migration schema).

// ClimateSnapshot moved to climate.go (regenerated for post-migration schema).

// SecurityEvent moved to security.go (regenerated for post-migration schema).

// ChargingTelemetry moved to charging_telemetry.go (regenerated for post-migration schema).

// MediaSnapshot has moved to vehicle.go.

// VehicleConfigSnapshot has moved to vehicle.go.

// LocationSnapshot has moved to vehicle.go.

// SafetySnapshot has moved to vehicle.go.

// UserPreferenceSnapshot has moved to vehicle.go.

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

// RawTelemetrySignal has moved to telemetry.go.

// Automation has been moved to automation.go to match the post-migration
// schema (ADR-001 typed-by-default, ADR-004 class-table-inheritance root).
// Trigger, conditions, and actions now live in the automation_steps CTI tree.

// AutomationHistory records the result of a single automation execution.
type AutomationHistory struct {
	ID                 int64           `json:"id" db:"id"`
	AutomationID       int64           `json:"automation_id" db:"automation_id"`
	AutomationName     string          `json:"automation_name" db:"automation_name"`
	VehicleID          *int64          `json:"vehicle_id" db:"vehicle_id"`
	TriggeredAt        time.Time       `json:"triggered_at" db:"triggered_at"`
	CompletedAt        *time.Time      `json:"completed_at" db:"completed_at"`
	DurationMs         *int            `json:"duration_ms" db:"duration_ms"`
	TriggerType        string          `json:"trigger_type" db:"trigger_type"`
	TriggerSnapshot    json.RawMessage `json:"trigger_snapshot" db:"trigger_snapshot"`
	ConditionsMet      bool            `json:"conditions_met" db:"conditions_met"`
	ConditionsSnapshot json.RawMessage `json:"conditions_snapshot" db:"conditions_snapshot"`
	ActionsExecuted    json.RawMessage `json:"actions_executed" db:"actions_executed"`
	ActionsTotal       int             `json:"actions_total" db:"actions_total"`
	ActionsSucceeded   int             `json:"actions_succeeded" db:"actions_succeeded"`
	ActionsFailed      int             `json:"actions_failed" db:"actions_failed"`
	Status             string          `json:"status" db:"status"`
	Error              *string         `json:"error" db:"error"`
	FSMState           *string         `json:"fsm_state" db:"fsm_state"`
	CreatedAt          time.Time       `json:"created_at" db:"created_at"`
}

// TeslaEnergySite represents a Tesla energy product (Powerwall, Solar Roof, Wall Connector).
// Discovered via GET /api/1/products and persisted for reference by other energy endpoints.
type TeslaEnergySite struct {
	ID                int64      `json:"id" db:"id"`
	EnergySiteID      int64      `json:"energy_site_id" db:"energy_site_id"`
	ResourceType      string     `json:"resource_type" db:"resource_type"`
	SiteName          string     `json:"site_name" db:"site_name"`
	GatewayID         *string    `json:"gateway_id" db:"gateway_id"`
	TotalPackEnergy   *float64   `json:"total_pack_energy" db:"total_pack_energy"`
	PercentageCharged *float64   `json:"percentage_charged" db:"percentage_charged"`
	BatteryType       *string    `json:"battery_type" db:"battery_type"`
	BackupCapable     bool       `json:"backup_capable" db:"backup_capable"`
	StormModeEnabled  bool       `json:"storm_mode_enabled" db:"storm_mode_enabled"`
	HasSolar          bool       `json:"has_solar" db:"has_solar"`
	HasBattery        bool       `json:"has_battery" db:"has_battery"`
	HasGrid           bool       `json:"has_grid" db:"has_grid"`
	HasLoadMeter      bool       `json:"has_load_meter" db:"has_load_meter"`
	TOUCapable        bool       `json:"tou_capable" db:"tou_capable"`
	StormModeCapable  bool       `json:"storm_mode_capable" db:"storm_mode_capable"`
	SiteInfoJSON      *string    `json:"site_info_json,omitempty" db:"site_info_json"`
	SiteInfoFetchedAt *time.Time `json:"site_info_fetched_at,omitempty" db:"site_info_fetched_at"`
	FetchedAt         time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt         time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at" db:"updated_at"`
}

// TeslaEnergyLiveStatus represents a point-in-time power flow snapshot from a Tesla Energy site.
// Stored in tesla_energy_live_status for historical charting. Power values are in watts.
type TeslaEnergyLiveStatus struct {
	ID                int64     `json:"id" db:"id"`
	EnergySiteID      int64     `json:"energy_site_id" db:"energy_site_id"`
	SolarPower        *float64  `json:"solar_power" db:"solar_power"`
	BatteryPower      *float64  `json:"battery_power" db:"battery_power"`
	LoadPower         *float64  `json:"load_power" db:"load_power"`
	GridPower         *float64  `json:"grid_power" db:"grid_power"`
	GridServicesPower *float64  `json:"grid_services_power" db:"grid_services_power"`
	EnergyLeft        *float64  `json:"energy_left" db:"energy_left"`
	TotalPackEnergy   *float64  `json:"total_pack_energy" db:"total_pack_energy"`
	PercentageCharged *float64  `json:"percentage_charged" db:"percentage_charged"`
	GridStatus        *string   `json:"grid_status" db:"grid_status"`
	BackupCapable     *bool     `json:"backup_capable" db:"backup_capable"`
	StormModeActive   *bool     `json:"storm_mode_active" db:"storm_mode_active"`
	Timestamp         time.Time `json:"timestamp" db:"timestamp"`
	FetchedAt         time.Time `json:"fetched_at" db:"fetched_at"`
}

// DerefFloat64 safely dereferences a *float64, returning 0 if nil.
func DerefFloat64(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// DerefString safely dereferences a *string, returning "" if nil.
func DerefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// DerefBool safely dereferences a *bool, returning false if nil.
func DerefBool(p *bool) bool {
	if p == nil {
		return false
	}
	return *p
}

// AutomationVariable stores cross-automation key-value state.
type AutomationVariable struct {
	ID        int64     `json:"id" db:"id"`
	Key       string    `json:"key" db:"key"`
	Value     string    `json:"value" db:"value"`
	VehicleID *int64    `json:"vehicle_id" db:"vehicle_id"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// TeslaChargingHistoryEntry represents a Supercharger/DC charging session from Tesla billing.
type TeslaChargingHistoryEntry struct {
	ID                  int64      `json:"id" db:"id"`
	SessionID           int64      `json:"session_id" db:"session_id"`
	VIN                 string     `json:"vin" db:"vin"`
	SiteLocationName    string     `json:"site_location_name" db:"site_location_name"`
	ChargeStartDatetime time.Time  `json:"charge_start_datetime" db:"charge_start_datetime"`
	ChargeStopDatetime  *time.Time `json:"charge_stop_datetime" db:"charge_stop_datetime"`
	Country             *string    `json:"country" db:"country"`
	State               *string    `json:"state" db:"state"`
	County              *string    `json:"county" db:"county"`
	PostalCode          *string    `json:"postal_code" db:"postal_code"`
	BillingType         *string    `json:"billing_type" db:"billing_type"`
	FeeType             *string    `json:"fee_type" db:"fee_type"`
	CurrencyCode        *string    `json:"currency_code" db:"currency_code"`
	PricingType         *string    `json:"pricing_type" db:"pricing_type"`
	RateBase            *float64   `json:"rate_base" db:"rate_base"`
	UsageWh             *float64   `json:"usage_wh" db:"usage_wh"`
	TotalDue            *float64   `json:"total_due" db:"total_due"`
	HasInvoice          bool       `json:"has_invoice" db:"has_invoice"`
	InvoiceContentID    *string    `json:"invoice_content_id" db:"invoice_content_id"`
	FetchedAt           time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
}

// TeslaChargingHistorySummary holds aggregated stats for Tesla charging history.
type TeslaChargingHistorySummary struct {
	TotalSessions int      `json:"total_sessions"`
	TotalWh       *float64 `json:"total_wh"`
	TotalSpend    *float64 `json:"total_spend"`
	AvgCostPerKWh *float64 `json:"avg_cost_per_kwh"`
}

// TeslaChargingSession represents a fleet charging session from Tesla billing (business accounts).
type TeslaChargingSession struct {
	ID                  int64      `json:"id" db:"id"`
	SessionID           int64      `json:"session_id" db:"session_id"`
	VIN                 string     `json:"vin" db:"vin"`
	ChargerID           *string    `json:"charger_id" db:"charger_id"`
	SiteLocationName    string     `json:"site_location_name" db:"site_location_name"`
	ChargeStartDatetime time.Time  `json:"charge_start_datetime" db:"charge_start_datetime"`
	ChargeStopDatetime  *time.Time `json:"charge_stop_datetime" db:"charge_stop_datetime"`
	EnergyAddedKWh      *float64   `json:"energy_added_kwh" db:"energy_added_kwh"`
	PeakPowerKW         *float64   `json:"peak_power_kw" db:"peak_power_kw"`
	MaxChargeRateKW     *float64   `json:"max_charge_rate_kw" db:"max_charge_rate_kw"`
	ChargeDurationS     *int       `json:"charge_duration_s" db:"charge_duration_s"`
	ChargerType         *string    `json:"charger_type" db:"charger_type"`
	CurrencyCode        *string    `json:"currency_code" db:"currency_code"`
	TotalCost           *float64   `json:"total_cost" db:"total_cost"`
	PerKWhRate          *float64   `json:"per_kwh_rate" db:"per_kwh_rate"`
	IdleFee             *float64   `json:"idle_fee" db:"idle_fee"`
	CongestionFee       *float64   `json:"congestion_fee" db:"congestion_fee"`
	Latitude            *float64   `json:"latitude" db:"latitude"`
	Longitude           *float64   `json:"longitude" db:"longitude"`
	FetchedAt           time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
}

// TeslaChargingSessionSummary holds aggregated stats for Tesla fleet charging sessions.
type TeslaChargingSessionSummary struct {
	TotalSessions int      `json:"total_sessions"`
	TotalWh       *float64 `json:"total_wh"`
	TotalCost     *float64 `json:"total_cost"`
	AvgCostPerKWh *float64 `json:"avg_cost_per_kwh"`
	PeakPowerKW   *float64 `json:"peak_power_kw"`
}

// TeslaEnergyHistory represents an energy measurement from Tesla calendar_history (kind=energy).
// Values are stored in watt-hours as returned by the Tesla API.
type TeslaEnergyHistory struct {
	ID                 int64     `json:"id" db:"id"`
	EnergySiteID       int64     `json:"energy_site_id" db:"energy_site_id"`
	Period             string    `json:"period" db:"period"`
	Timestamp          time.Time `json:"timestamp" db:"timestamp"`
	SolarEnergyWh      *float64  `json:"solar_energy_wh" db:"solar_energy_wh"`
	BatteryEnergyInWh  *float64  `json:"battery_energy_in_wh" db:"battery_energy_in_wh"`
	BatteryEnergyOutWh *float64  `json:"battery_energy_out_wh" db:"battery_energy_out_wh"`
	GridEnergyInWh     *float64  `json:"grid_energy_in_wh" db:"grid_energy_in_wh"`
	GridEnergyOutWh    *float64  `json:"grid_energy_out_wh" db:"grid_energy_out_wh"`
	ConsumerEnergyWh   *float64  `json:"consumer_energy_wh" db:"consumer_energy_wh"`
	FetchedAt          time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaEnergyBackupEvent represents an off-grid backup event from Tesla calendar_history (kind=backup).
type TeslaEnergyBackupEvent struct {
	ID              int64     `json:"id" db:"id"`
	EnergySiteID    int64     `json:"energy_site_id" db:"energy_site_id"`
	Period          string    `json:"period" db:"period"`
	Timestamp       time.Time `json:"timestamp" db:"timestamp"`
	DurationSeconds int       `json:"duration_seconds" db:"duration_seconds"`
	FetchedAt       time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaEnergyWCCharging represents a wall connector charging record from Tesla telemetry_history (kind=charge).
// Energy is stored in watt-hours as returned by the Tesla API.
type TeslaEnergyWCCharging struct {
	ID           int64     `json:"id" db:"id"`
	EnergySiteID int64     `json:"energy_site_id" db:"energy_site_id"`
	DIN          *string   `json:"din" db:"din"`
	Timestamp    time.Time `json:"timestamp" db:"timestamp"`
	EnergyWh     *float64  `json:"energy_wh" db:"energy_wh"`
	FetchedAt    time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaFleetTelemetryError has moved to telemetry.go.

// TeslaFleetTelemetryErrorVIN has moved to telemetry.go.

// TeslaUserConfig stores a Tesla user configuration blob (feature_config, region, etc.)
type TeslaUserConfig struct {
	ID         int64     `json:"id" db:"id"`
	ConfigType string    `json:"config_type" db:"config_type"`
	Data       string    `json:"data" db:"data"`
	FetchedAt  time.Time `json:"fetched_at" db:"fetched_at"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
}

// TeslaUserOrder represents an active Tesla vehicle order.
type TeslaUserOrder struct {
	ID           int64      `json:"id" db:"id"`
	OrderID      string     `json:"order_id" db:"order_id"`
	Model        string     `json:"model" db:"model"`
	Status       string     `json:"status" db:"status"`
	DeliveryDate *time.Time `json:"delivery_date" db:"delivery_date"`
	VIN          *string    `json:"vin" db:"vin"`
	ReferralCode *string    `json:"referral_code,omitempty" db:"referral_code"`
	IsUpgradable bool       `json:"is_upgradable" db:"is_upgradable"`
	FetchedAt    time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at" db:"updated_at"`
}

// TeslaUserProfile represents the Tesla account owner's profile.
type TeslaUserProfile struct {
	ID              int64     `json:"id" db:"id"`
	Email           string    `json:"email" db:"email"`
	FullName        string    `json:"full_name" db:"full_name"`
	ProfileImageURL *string   `json:"profile_image_url" db:"profile_image_url"`
	FetchedAt       time.Time `json:"fetched_at" db:"fetched_at"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time `json:"updated_at" db:"updated_at"`
}

// TeslaVehicleDriver represents a driver who has access to a vehicle.
type TeslaVehicleDriver struct {
	ID          int64     `json:"id" db:"id"`
	VehicleID   int64     `json:"vehicle_id" db:"vehicle_id"`
	VIN         string    `json:"-" db:"vin"`
	ShareUserID *int64    `json:"share_user_id" db:"share_user_id"`
	DriverEmail *string   `json:"driver_email" db:"driver_email"`
	DriverName  *string   `json:"driver_name" db:"driver_name"`
	Role        *string   `json:"role" db:"role"`
	FetchedAt   time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaVehicleInvitation represents a pending share invitation for a vehicle.
type TeslaVehicleInvitation struct {
	ID           int64      `json:"id" db:"id"`
	VehicleID    int64      `json:"vehicle_id" db:"vehicle_id"`
	VIN          string     `json:"-" db:"vin"`
	InvitationID string     `json:"invitation_id" db:"invitation_id"`
	InviteURL    *string    `json:"invite_url" db:"invite_url"`
	Status       string     `json:"status" db:"status"`
	ExpiresAt    *time.Time `json:"expires_at" db:"expires_at"`
	CreatedBy    *string    `json:"created_by" db:"created_by"`
	FetchedAt    time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
}

// GuardConfig has moved to vehicle.go.

// ShareToken has moved to drive.go.

// GuardEvent has moved to vehicle.go.
