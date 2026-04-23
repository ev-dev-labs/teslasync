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

// AuditLog represents a record of a mutation action for auditing.
type AuditLog struct {
	ID        int64     `json:"id" db:"id"`
	Action    string    `json:"action" db:"action"`
	Resource  string    `json:"resource" db:"resource"`
	Details   string    `json:"details" db:"details"`
	IP        string    `json:"ip" db:"ip"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Vehicle has moved to vehicle.go (regenerated for post-migration schema).

// Position has moved to position.go (regenerated for post-migration schema).

// Drive has moved to drive.go (regenerated for post-migration schema).

// DriveTelemetryReading represents a single telemetry snapshot during a drive.
type DriveTelemetryReading struct {
	ID              int64     `json:"id" db:"id"`
	DriveID         int64     `json:"drive_id" db:"drive_id"`
	VehicleID       int64     `json:"vehicle_id" db:"vehicle_id"`
	Latitude        *float64  `json:"latitude,omitempty" db:"latitude"`
	Longitude       *float64  `json:"longitude,omitempty" db:"longitude"`
	Elevation       *float64  `json:"elevation,omitempty" db:"elevation"`
	Heading         *int      `json:"heading,omitempty" db:"heading"`
	Odometer        *float64  `json:"odometer,omitempty" db:"odometer"`
	Speed           *float64  `json:"speed,omitempty" db:"speed"`
	Power           *float64  `json:"power,omitempty" db:"power"`
	BatteryLevel    *int      `json:"battery_level,omitempty" db:"battery_level"`
	Soc             *float64  `json:"soc,omitempty" db:"soc"`
	UsableSoc       *float64  `json:"usable_soc,omitempty" db:"usable_soc"`
	RatedRange      *float64  `json:"rated_range,omitempty" db:"rated_range"`
	IdealRange      *float64  `json:"ideal_range,omitempty" db:"ideal_range"`
	EstRange        *float64  `json:"est_range,omitempty" db:"est_range"`
	InsideTemp      *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp     *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	DriverTemp      *float64  `json:"driver_temp,omitempty" db:"driver_temp"`
	PassengerTemp   *float64  `json:"passenger_temp,omitempty" db:"passenger_temp"`
	FanStatus       *int      `json:"fan_status,omitempty" db:"fan_status"`
	IsClimateOn     *bool     `json:"is_climate_on,omitempty" db:"is_climate_on"`
	TirePressureFL  *float64  `json:"tire_pressure_fl,omitempty" db:"tire_pressure_fl"`
	TirePressureFR  *float64  `json:"tire_pressure_fr,omitempty" db:"tire_pressure_fr"`
	TirePressureRL  *float64  `json:"tire_pressure_rl,omitempty" db:"tire_pressure_rl"`
	TirePressureRR  *float64  `json:"tire_pressure_rr,omitempty" db:"tire_pressure_rr"`
	BatteryHeaterOn *bool     `json:"battery_heater_on,omitempty" db:"battery_heater_on"`
	AccelerationGs  *float64  `json:"acceleration_gs,omitempty" db:"acceleration_gs"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// ChargeTelemetryReading represents a single telemetry snapshot during a charging session.
type ChargeTelemetryReading struct {
	ID           int64     `json:"id" db:"id"`
	SessionID    int64     `json:"session_id" db:"session_id"`
	VehicleID    int64     `json:"vehicle_id" db:"vehicle_id"`
	BatteryLevel *int      `json:"battery_level,omitempty" db:"battery_level"`
	Soc          *float64  `json:"soc,omitempty" db:"soc"`
	PowerKW      *float64  `json:"power_kw,omitempty" db:"power_kw"`
	Voltage      *float64  `json:"voltage,omitempty" db:"voltage"`
	CurrentAmps  *float64  `json:"current_amps,omitempty" db:"current_amps"`
	Phases       *int      `json:"phases,omitempty" db:"phases"`
	EnergyAdded  *float64  `json:"energy_added,omitempty" db:"energy_added"`
	RatedRange   *float64  `json:"rated_range,omitempty" db:"rated_range"`
	IdealRange   *float64  `json:"ideal_range,omitempty" db:"ideal_range"`
	EstRange     *float64  `json:"est_range,omitempty" db:"est_range"`
	InsideTemp   *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp  *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	BatteryTemp  *float64  `json:"battery_temp,omitempty" db:"battery_temp"`
	Latitude     *float64  `json:"latitude,omitempty" db:"latitude"`
	Longitude    *float64  `json:"longitude,omitempty" db:"longitude"`
	ChargeRate   *float64  `json:"charge_rate,omitempty" db:"charge_rate"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

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

// Geofence represents a user-defined geofenced area.
type Geofence struct {
	ID          int64      `json:"id" db:"id"`
	Name        string     `json:"name" db:"name"`
	Latitude    float64    `json:"latitude" db:"latitude"`
	Longitude   float64    `json:"longitude" db:"longitude"`
	Radius      float64    `json:"radius" db:"radius"` // meters
	CostPerKwh  *float64   `json:"cost_per_kwh" db:"cost_per_kwh"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// SoftwareUpdate represents a vehicle software update.
type SoftwareUpdate struct {
	ID          int64     `json:"id" db:"id"`
	VehicleID   int64     `json:"vehicle_id" db:"vehicle_id"`
	Version     string    `json:"version" db:"version"`
	Status      string    `json:"status" db:"status"` // available, downloading, installing, installed
	ScheduledAt *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	InstalledAt *time.Time `json:"installed_at,omitempty" db:"installed_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
}

// Token represents stored OAuth tokens.
type Token struct {
	ID           int64     `json:"id" db:"id"`
	AccessToken  string    `json:"-" db:"access_token"`
	RefreshToken string    `json:"-" db:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at" db:"expires_at"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// Settings stores application-level user settings.
type Settings struct {
	ID              int64   `json:"id" db:"id"`
	UnitOfLength    string  `json:"unit_of_length" db:"unit_of_length"`       // km, mi
	UnitOfTemp      string  `json:"unit_of_temp" db:"unit_of_temp"`           // C, F
	UnitOfPressure  string  `json:"unit_of_pressure" db:"unit_of_pressure"`   // bar, psi
	PreferredRange  string  `json:"preferred_range" db:"preferred_range"`     // ideal, rated
	Language        string  `json:"language" db:"language"`
	BaseCostPerKWh  float64 `json:"base_cost_per_kwh" db:"base_cost_per_kwh"`
	APISuspended    bool    `json:"api_suspended" db:"api_suspended"`
	Theme           string  `json:"theme" db:"theme"`                         // neon-cyan, tesla-red, etc.
	Mode            string  `json:"mode" db:"mode"`                           // dark, light, oled, midnight
	CustomPrimary   string  `json:"custom_primary" db:"custom_primary"`       // hex color for custom theme
	CustomAccent    string  `json:"custom_accent" db:"custom_accent"`         // hex color for custom theme
	GasPricePerUnit float64 `json:"gas_price_per_unit" db:"gas_price_per_unit"` // price per gallon/liter
	GasUnit         string  `json:"gas_unit" db:"gas_unit"`                   // gallon, liter
	GasEfficiencyMPG float64 `json:"gas_efficiency_mpg" db:"gas_efficiency_mpg"` // equivalent ICE car MPG for comparison
	DecimalPrecision int     `json:"decimal_precision" db:"decimal_precision"`   // 1, 2, 3, or 4 decimal places for display
	QuietHoursEnabled bool   `json:"quiet_hours_enabled" db:"quiet_hours_enabled"`
	QuietHoursStart   string `json:"quiet_hours_start" db:"quiet_hours_start"`   // HH:MM (24h)
	QuietHoursEnd     string `json:"quiet_hours_end" db:"quiet_hours_end"`       // HH:MM (24h)
	AlertDigestMode   string `json:"alert_digest_mode" db:"alert_digest_mode"`   // instant, hourly, daily
	PollingConfig   PollingConfig `json:"polling_config" db:"polling_config"`
}

// PollingConfig controls which Tesla Fleet API endpoints are enabled.
// All fields default to true (enabled) to preserve existing behavior.
// Endpoints that appear in both Polling and On-Demand have separate toggles
// (e.g., VehicleDiscovery controls auto-polling, OnDemandVehicleDiscovery
// controls manual sync).
type PollingConfig struct {
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
	WakeUp   bool `json:"wake_up"`   // POST /vehicles/{vin}/wake_up
	Commands bool `json:"commands"`  // POST /vehicles/{vin}/command/*

	// Telemetry capture (raw signal recording to MongoDB)
	TelemetryCapture              bool `json:"telemetry_capture"`                // enable raw signal recording
	TelemetryCaptureRetentionDays int  `json:"telemetry_capture_retention_days"` // TTL in days (default: 7)
}

// DefaultPollingConfig returns a PollingConfig with all endpoints enabled.
func DefaultPollingConfig() PollingConfig {
	return PollingConfig{
		VehicleDiscovery:         true,
		ChargeState:              true,
		ClimateState:             true,
		DriveState:               true,
		LocationData:             true,
		VehicleState:             true,
		VehicleConfig:            true,
		OnDemandVehicleDiscovery: true,
		OnDemandChargeState:      true,
		OnDemandClimateState:     true,
		OnDemandDriveState:       true,
		OnDemandLocationData:     true,
		OnDemandVehicleState:     true,
		OnDemandVehicleConfig:    true,
		NearbyChargingSites:      true,
		ReleaseNotes:             true,
		RecentAlerts:             true,
		ServiceData:              true,
		WakeUp:                   true,
		Commands:                 true,
		TelemetryCapture:              false,
		TelemetryCaptureRetentionDays: 7,
	}
}

// EnabledVehicleDataEndpoints returns the list of enabled vehicle_data sub-endpoints
// for use in the Tesla API query string (e.g., "charge_state;drive_state").
func (pc *PollingConfig) EnabledVehicleDataEndpoints() []string {
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
func (pc *PollingConfig) VehicleDataEndpointsString() string {
	return strings.Join(pc.EnabledVehicleDataEndpoints(), ";")
}

// HasAnyVehicleDataEndpoint returns true if at least one vehicle_data sub-endpoint is enabled.
func (pc *PollingConfig) HasAnyVehicleDataEndpoint() bool {
	return pc.ChargeState || pc.ClimateState || pc.DriveState ||
		pc.LocationData || pc.VehicleState || pc.VehicleConfig
}

// EnabledOnDemandVehicleDataEndpoints returns the list of enabled on-demand vehicle_data sub-endpoints.
func (pc *PollingConfig) EnabledOnDemandVehicleDataEndpoints() []string {
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

// VehicleState represents a snapshot of vehicle state at a point in time.
type VehicleState struct {
	VehicleID       int64      `json:"vehicle_id"`
	State           string     `json:"state"`
	Since           *time.Time `json:"since,omitempty"`
	Latitude        float64    `json:"latitude"`
	Longitude       float64    `json:"longitude"`
	Heading         *float64   `json:"heading,omitempty"`
	Speed           float64    `json:"speed"`
	Power           float64    `json:"power"`
	BatteryLevel    int        `json:"battery_level"`
	RatedRange      float64    `json:"rated_range"`
	IdealRange      float64    `json:"ideal_range"`
	Odometer        float64    `json:"odometer"`
	InsideTemp      float64    `json:"inside_temp"`
	OutsideTemp     float64    `json:"outside_temp"`
	IsClimateOn     bool       `json:"is_climate_on"`
	IsCharging      bool       `json:"is_charging"`
	ChargerPower    float64    `json:"charger_power"`
	ChargeRate      float64    `json:"charge_rate"`
	TimeToFullChg   float64    `json:"time_to_full_charge"`
	IsLocked        bool       `json:"is_locked"`
	SentryMode      bool       `json:"sentry_mode"`
	SoftwareVersion string     `json:"software_version"`
}

// Alert represents a system or vehicle alert/notification.
type Alert struct {
	ID        int64     `json:"id" db:"id"`
	VehicleID *int64    `json:"vehicle_id,omitempty" db:"vehicle_id"`
	Type      string    `json:"type" db:"type"`           // geofence, battery_low, battery_full, sentry, speed, maintenance, software, custom
	Severity  string    `json:"severity" db:"severity"`   // info, warning, critical
	Title     string    `json:"title" db:"title"`
	Message   string    `json:"message" db:"message"`
	IsRead    bool      `json:"is_read" db:"is_read"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// AlertRule defines when an alert should be triggered.
// Supports both legacy simple rules (Type + Threshold) and CEP rules (Conditions JSONB).
type AlertRule struct {
	ID         int64   `json:"id" db:"id"`
	Name       string  `json:"name" db:"name"`
	Type       string  `json:"type" db:"type"`
	Enabled    bool    `json:"enabled" db:"enabled"`
	Threshold  float64 `json:"threshold" db:"threshold"`
	VehicleID  *int64  `json:"vehicle_id,omitempty" db:"vehicle_id"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`

	// CEP rule engine fields
	Conditions     json.RawMessage `json:"conditions,omitempty" db:"conditions"`
	Expression     string          `json:"expression,omitempty" db:"expression"`
	CooldownMin    int             `json:"cooldown_min" db:"cooldown_min"`
	ForDurationS   *int            `json:"for_duration_s,omitempty" db:"for_duration_s"`
	Severity       string          `json:"severity" db:"severity"`
	MsgTemplate    string          `json:"msg_template,omitempty" db:"msg_template"`
	NotifyChannels []int64         `json:"notify_channels,omitempty" db:"notify_channels"`
	LastFiredAt    *time.Time      `json:"last_fired_at,omitempty" db:"last_fired_at"`
	FireCount      int             `json:"fire_count" db:"fire_count"`
	Tags           []string        `json:"tags,omitempty" db:"tags"`
}

// IsCEPRule returns true if this rule uses the CEP condition engine (vs legacy type+threshold).
func (r *AlertRule) IsCEPRule() bool {
	return len(r.Conditions) > 0 && string(r.Conditions) != "null"
}

// RuleCondition represents a node in the condition tree.
// Can be a leaf (signal comparison) or a branch (AND/OR/NOT combinator).
type RuleCondition struct {
	// Branch fields (combinator)
	Op    string          `json:"op,omitempty"`    // "AND", "OR", "NOT"
	Rules []RuleCondition `json:"rules,omitempty"` // child conditions

	// Leaf fields (signal comparison)
	Signal  string      `json:"signal,omitempty"`  // e.g. "BatteryLevel", "Gear"
	Compare string      `json:"compare,omitempty"` // "==", "!=", ">", "<", ">=", "<=", "contains", "changed_to", "changed_from", "is_true", "is_false"
	Value   interface{} `json:"value,omitempty"`   // comparison target

	// Temporal (applies to branch or leaf)
	ForSeconds *int `json:"for_seconds,omitempty"` // condition must hold for this duration
}

// CommandLog records a vehicle command execution.
type CommandLog struct {
	ID        int64     `json:"id" db:"id"`
	VehicleID int64     `json:"vehicle_id" db:"vehicle_id"`
	Command   string    `json:"command" db:"command"`
	Params    string    `json:"params,omitempty" db:"params"`
	Status    string    `json:"status" db:"status"` // success, failed, pending
	Error     string    `json:"error,omitempty" db:"error"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// EnergyStatsRow represents a single day of energy data.
type EnergyStatsRow struct {
	Date       string  `json:"date"`
	EnergyKWh  float64 `json:"energy_kwh"`
	DistanceKm float64 `json:"distance_km"`
	Efficiency float64 `json:"efficiency"`
	Cost       float64 `json:"cost"`
}

// BatterySnapshot represents a point-in-time battery health reading.
type BatterySnapshot struct {
	ID              int64     `json:"id" db:"id"`
	VehicleID       int64     `json:"vehicle_id" db:"vehicle_id"`
	HealthScore     float64   `json:"health_score" db:"health_score"`
	CapacityKWh     float64   `json:"capacity_kwh" db:"capacity_kwh"`
	DegradationPct  float64   `json:"degradation_pct" db:"degradation_pct"`
	EstRangeKm      float64   `json:"est_range_km" db:"est_range_km"`
	CycleCount      int       `json:"cycle_count" db:"cycle_count"`
	AvgCellTempC    float64   `json:"avg_cell_temp_c" db:"avg_cell_temp_c"`
	CreatedAt       time.Time `json:"created_at" db:"created_at"`
}

// NotificationChannel represents a configured notification delivery channel.
type NotificationChannel struct {
	ID        int64             `json:"id" db:"id"`
	Name      string            `json:"name" db:"name"`
	Type      string            `json:"type" db:"type"` // discord, email, slack, telegram, webhook, ntfy, pushover
	Config    map[string]string `json:"config" db:"config"`
	Enabled   bool              `json:"enabled" db:"enabled"`
	CreatedAt time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt time.Time         `json:"updated_at" db:"updated_at"`
}

// NotificationLog records a notification delivery attempt.
type NotificationLog struct {
	ID          int64      `json:"id" db:"id"`
	ChannelID   int64      `json:"channel_id" db:"channel_id"`
	AlertID     *int64     `json:"alert_id,omitempty" db:"alert_id"`
	Title       string     `json:"title" db:"title"`
	Message     string     `json:"message" db:"message"`
	Status      string     `json:"status" db:"status"` // pending, sent, failed
	Error       string     `json:"error,omitempty" db:"error"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	LatencyMs   *int       `json:"latency_ms,omitempty" db:"latency_ms"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	SentAt      *time.Time `json:"sent_at,omitempty" db:"sent_at"`
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

// TirePressureSnapshot represents a point-in-time tire pressure reading.
type TirePressureSnapshot struct {
	ID             int64      `json:"id" db:"id"`
	VehicleID      int64      `json:"vehicle_id" db:"vehicle_id"`
	FrontLeft      *float64   `json:"front_left" db:"front_left"`
	FrontRight     *float64   `json:"front_right" db:"front_right"`
	RearLeft       *float64   `json:"rear_left" db:"rear_left"`
	RearRight      *float64   `json:"rear_right" db:"rear_right"`
	TpmsHardWarn   *string    `json:"tpms_hard_warnings,omitempty" db:"tpms_hard_warnings"`
	TpmsSoftWarn   *string    `json:"tpms_soft_warnings,omitempty" db:"tpms_soft_warnings"`
	LastSeenTimeFl *time.Time `json:"last_seen_time_fl,omitempty" db:"last_seen_time_fl"`
	LastSeenTimeFr *time.Time `json:"last_seen_time_fr,omitempty" db:"last_seen_time_fr"`
	LastSeenTimeRl *time.Time `json:"last_seen_time_rl,omitempty" db:"last_seen_time_rl"`
	LastSeenTimeRr *time.Time `json:"last_seen_time_rr,omitempty" db:"last_seen_time_rr"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// VampireDrainEvent represents an energy loss event while parked.
type VampireDrainEvent struct {
	ID                 int64      `json:"id" db:"id"`
	VehicleID          int64      `json:"vehicle_id" db:"vehicle_id"`
	StartDate          time.Time  `json:"start_date" db:"start_date"`
	EndDate            *time.Time `json:"end_date,omitempty" db:"end_date"`
	StartBattery       int        `json:"start_battery" db:"start_battery"`
	EndBattery         *int       `json:"end_battery,omitempty" db:"end_battery"`
	BatteryLost        int        `json:"battery_lost" db:"battery_lost"`
	RangeLostKm        float64    `json:"range_lost_km" db:"range_lost_km"`
	DurationHours      float64    `json:"duration_hours" db:"duration_hours"`
	DrainRatePctPerHr  float64    `json:"drain_rate_pct_per_hour" db:"drain_rate_pct_per_hour"`
	OutsideTempAvg     *float64   `json:"outside_temp_avg,omitempty" db:"outside_temp_avg"`
	SentryMode         bool       `json:"sentry_mode" db:"sentry_mode"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
}

// DailyMileage represents mileage data for a single day.
type DailyMileage struct {
	ID            int64     `json:"id" db:"id"`
	VehicleID     int64     `json:"vehicle_id" db:"vehicle_id"`
	Date          time.Time `json:"date" db:"date"`
	DistanceKm    float64   `json:"distance_km" db:"distance_km"`
	OdometerStart float64   `json:"odometer_start" db:"odometer_start"`
	OdometerEnd   float64   `json:"odometer_end" db:"odometer_end"`
	DriveCount    int       `json:"drive_count" db:"drive_count"`
	EnergyUsedKWh float64  `json:"energy_used_kwh" db:"energy_used_kwh"`
}

// VisitedLocation represents an aggregated visited place.
type VisitedLocation struct {
	ID               int64      `json:"id" db:"id"`
	VehicleID        int64      `json:"vehicle_id" db:"vehicle_id"`
	AddressID        *int64     `json:"address_id,omitempty" db:"address_id"`
	AddressName      string     `json:"address_name" db:"address_name"`
	VisitCount       int        `json:"visit_count" db:"visit_count"`
	TotalDurationMin float64    `json:"total_duration_min" db:"total_duration_min"`
	LastVisited      *time.Time `json:"last_visited,omitempty" db:"last_visited"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
}

// Trip is defined in trip.go (regenerated to match post-migration schema).

// VehicleStateRecord represents a vehicle state change record from the DB.
type VehicleStateRecord struct {
	ID          int64      `json:"id" db:"id"`
	VehicleID   int64      `json:"vehicle_id" db:"vehicle_id"`
	State       string     `json:"state" db:"state"`
	StartDate   time.Time  `json:"start_date" db:"start_date"`
	EndDate     *time.Time `json:"end_date,omitempty" db:"end_date"`
	DurationMin float64    `json:"duration_min" db:"duration_min"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
}

// APICallLog records a Tesla API call for auditing and debugging.
type APICallLog struct {
	ID           int64     `json:"id" db:"id"`
	Method       string    `json:"method" db:"method"`
	URL          string    `json:"url" db:"url"`
	StatusCode   *int      `json:"status_code,omitempty" db:"status_code"`
	RequestBody  *string   `json:"request_body,omitempty" db:"request_body"`
	ResponseBody *string   `json:"response_body,omitempty" db:"response_body"`
	DurationMs   int       `json:"duration_ms" db:"duration_ms"`
	Error        *string   `json:"error,omitempty" db:"error"`
	Source       string    `json:"source" db:"source"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}

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


// MediaSnapshot represents a point-in-time media playback telemetry reading.
type MediaSnapshot struct {
	ID                  int64     `json:"id" db:"id"`
	VehicleID           int64     `json:"vehicle_id" db:"vehicle_id"`
	NowPlayingTitle     *string   `json:"now_playing_title,omitempty" db:"now_playing_title"`
	NowPlayingArtist    *string   `json:"now_playing_artist,omitempty" db:"now_playing_artist"`
	NowPlayingAlbum     *string   `json:"now_playing_album,omitempty" db:"now_playing_album"`
	NowPlayingStation   *string   `json:"now_playing_station,omitempty" db:"now_playing_station"`
	NowPlayingDuration  *int      `json:"now_playing_duration,omitempty" db:"now_playing_duration"`
	NowPlayingElapsed   *int      `json:"now_playing_elapsed,omitempty" db:"now_playing_elapsed"`
	PlaybackStatus      *string   `json:"playback_status,omitempty" db:"playback_status"`
	PlaybackSource      *string   `json:"playback_source,omitempty" db:"playback_source"`
	AudioVolume         *float64  `json:"audio_volume,omitempty" db:"audio_volume"`
	AudioVolumeMax      *float64  `json:"audio_volume_max,omitempty" db:"audio_volume_max"`
	AudioVolumeIncrement *float64 `json:"audio_volume_increment,omitempty" db:"audio_volume_increment"`
	CreatedAt           time.Time `json:"created_at" db:"created_at"`
}

// VehicleConfigSnapshot represents a point-in-time vehicle configuration snapshot.
type VehicleConfigSnapshot struct {
	ID                          int64     `json:"id" db:"id"`
	VehicleID                   int64     `json:"vehicle_id" db:"vehicle_id"`
	CarType                     *string   `json:"car_type,omitempty" db:"car_type"`
	Trim                        *string   `json:"trim,omitempty" db:"trim"`
	ExteriorColor               *string   `json:"exterior_color,omitempty" db:"exterior_color"`
	RoofColor                   *string   `json:"roof_color,omitempty" db:"roof_color"`
	WheelType                   *string   `json:"wheel_type,omitempty" db:"wheel_type"`
	RearSeatHeaters             *string   `json:"rear_seat_heaters,omitempty" db:"rear_seat_heaters"`
	SunroofInstalled            *string   `json:"sunroof_installed,omitempty" db:"sunroof_installed"`
	EfficiencyPackage           *string   `json:"efficiency_package,omitempty" db:"efficiency_package"`
	EuropeVehicle               *bool     `json:"europe_vehicle,omitempty" db:"europe_vehicle"`
	RightHandDrive              *bool     `json:"right_hand_drive,omitempty" db:"right_hand_drive"`
	RemoteStartEnabled          *bool     `json:"remote_start_enabled,omitempty" db:"remote_start_enabled"`
	ChargePort                  *string   `json:"charge_port,omitempty" db:"charge_port"`
	OffroadLightbarPresent      *bool     `json:"offroad_lightbar_present,omitempty" db:"offroad_lightbar_present"`
	Version                     *string   `json:"version,omitempty" db:"version"`
	VehicleName                 *string   `json:"vehicle_name,omitempty" db:"vehicle_name"`
	SoftwareUpdateVersion       *string   `json:"software_update_version,omitempty" db:"software_update_version"`
	SoftwareUpdateDownloadPct   *int      `json:"software_update_download_pct,omitempty" db:"software_update_download_pct"`
	SoftwareUpdateInstallPct    *int      `json:"software_update_install_pct,omitempty" db:"software_update_install_pct"`
	SoftwareUpdateExpectedDuration *int   `json:"software_update_expected_duration,omitempty" db:"software_update_expected_duration"`
	SoftwareUpdateScheduledStart  *string `json:"software_update_scheduled_start,omitempty" db:"software_update_scheduled_start"`
	CreatedAt                   time.Time `json:"created_at" db:"created_at"`
}

// LocationSnapshot represents a point-in-time navigation/location telemetry reading.
type LocationSnapshot struct {
	ID                     int64     `json:"id" db:"id"`
	VehicleID              int64     `json:"vehicle_id" db:"vehicle_id"`
	DestinationName        *string   `json:"destination_name,omitempty" db:"destination_name"`
	DestinationLat         *float64  `json:"destination_lat,omitempty" db:"destination_lat"`
	DestinationLon         *float64  `json:"destination_lon,omitempty" db:"destination_lon"`
	OriginLat              *float64  `json:"origin_lat,omitempty" db:"origin_lat"`
	OriginLon              *float64  `json:"origin_lon,omitempty" db:"origin_lon"`
	MilesToArrival         *float64  `json:"miles_to_arrival,omitempty" db:"miles_to_arrival"`
	MinutesToArrival       *float64  `json:"minutes_to_arrival,omitempty" db:"minutes_to_arrival"`
	RouteLine              *string   `json:"route_line,omitempty" db:"route_line"`
	RouteTrafficDelayMin   *float64  `json:"route_traffic_delay_min,omitempty" db:"route_traffic_delay_min"`
	LocatedAtHome          *bool     `json:"located_at_home,omitempty" db:"located_at_home"`
	LocatedAtWork          *bool     `json:"located_at_work,omitempty" db:"located_at_work"`
	LocatedAtFavorite      *bool     `json:"located_at_favorite,omitempty" db:"located_at_favorite"`
	GpsState               *string   `json:"gps_state,omitempty" db:"gps_state"`
	RouteLastUpdated       *time.Time `json:"route_last_updated,omitempty" db:"route_last_updated"`
	CurrentLat             *float64  `json:"current_lat,omitempty" db:"current_lat"`
	CurrentLon             *float64  `json:"current_lon,omitempty" db:"current_lon"`
	CreatedAt              time.Time `json:"created_at" db:"created_at"`
}

// SafetySnapshot represents a point-in-time safety settings telemetry reading.
type SafetySnapshot struct {
	ID                              int64     `json:"id" db:"id"`
	VehicleID                       int64     `json:"vehicle_id" db:"vehicle_id"`
	AutomaticBlindSpotCamera        *bool     `json:"automatic_blind_spot_camera,omitempty" db:"automatic_blind_spot_camera"`
	AutomaticEmergencyBrakingOff    *bool     `json:"automatic_emergency_braking_off,omitempty" db:"automatic_emergency_braking_off"`
	BlindSpotCollisionWarning       *bool     `json:"blind_spot_collision_warning,omitempty" db:"blind_spot_collision_warning"`
	CruiseFollowDistance            *string   `json:"cruise_follow_distance,omitempty" db:"cruise_follow_distance"`
	EmergencyLaneDepartureAvoidance *bool     `json:"emergency_lane_departure_avoidance,omitempty" db:"emergency_lane_departure_avoidance"`
	ForwardCollisionWarning         *string   `json:"forward_collision_warning,omitempty" db:"forward_collision_warning"`
	LaneDepartureAvoidance          *string   `json:"lane_departure_avoidance,omitempty" db:"lane_departure_avoidance"`
	SpeedLimitWarning               *string   `json:"speed_limit_warning,omitempty" db:"speed_limit_warning"`
	PinToDriveEnabled               *bool     `json:"pin_to_drive_enabled,omitempty" db:"pin_to_drive_enabled"`
	MilesSinceReset                 *float64  `json:"miles_since_reset,omitempty" db:"miles_since_reset"`
	SelfDrivingMilesSinceReset      *float64  `json:"self_driving_miles_since_reset,omitempty" db:"self_driving_miles_since_reset"`
	CreatedAt                       time.Time `json:"created_at" db:"created_at"`
}

// UserPreferenceSnapshot represents a point-in-time user preference telemetry reading.
type UserPreferenceSnapshot struct {
	ID                      int64     `json:"id" db:"id"`
	VehicleID               int64     `json:"vehicle_id" db:"vehicle_id"`
	Setting24hrTime         *bool     `json:"setting_24hr_time,omitempty" db:"setting_24hr_time"`
	SettingChargeUnit       *string   `json:"setting_charge_unit,omitempty" db:"setting_charge_unit"`
	SettingDistanceUnit     *string   `json:"setting_distance_unit,omitempty" db:"setting_distance_unit"`
	SettingTemperatureUnit  *string   `json:"setting_temperature_unit,omitempty" db:"setting_temperature_unit"`
	SettingTirePressureUnit *string   `json:"setting_tire_pressure_unit,omitempty" db:"setting_tire_pressure_unit"`
	CreatedAt               time.Time `json:"created_at" db:"created_at"`
}

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
	ID            int64           `json:"id" db:"id"`
	ConfigID      *int64          `json:"config_id,omitempty" db:"config_id"`
	RunType       string          `json:"run_type" db:"run_type"`           // backup, restore
	BackupType    string          `json:"backup_type" db:"backup_type"`     // full, incremental
	Status        string          `json:"status" db:"status"`               // queued, running, completed, failed, cancelled
	Provider      string          `json:"provider" db:"provider"`
	FileName      *string         `json:"file_name,omitempty" db:"file_name"`
	FilePath      *string         `json:"file_path,omitempty" db:"file_path"`
	FileSize      int64           `json:"file_size" db:"file_size"`
	RecordCount   int             `json:"record_count" db:"record_count"`
	TableCount    int             `json:"table_count" db:"table_count"`
	Checksum      *string         `json:"checksum,omitempty" db:"checksum"`
	DurationMs    int64           `json:"duration_ms" db:"duration_ms"`
	ErrorMessage  *string         `json:"error_message,omitempty" db:"error_message"`
	Metadata      json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	StartedAt     *time.Time      `json:"started_at,omitempty" db:"started_at"`
	CompletedAt   *time.Time      `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt     time.Time       `json:"created_at" db:"created_at"`
}

// RawTelemetrySignal stores a raw signal batch from Tesla fleet telemetry for debugging.
type RawTelemetrySignal struct {
	VIN         string                 `json:"vin" bson:"vin"`
	Source      string                 `json:"source" bson:"source"`
	Signals     map[string]interface{} `json:"signals" bson:"signals"`
	SignalCount int                    `json:"signal_count" bson:"signal_count"`
	CreatedAt   time.Time              `json:"created_at" bson:"created_at"`
}

// Automation represents a user-defined automation rule with trigger, conditions, and actions.
type Automation struct {
	ID                  int64           `json:"id" db:"id"`
	Name                string          `json:"name" db:"name"`
	Description         string          `json:"description" db:"description"`
	VehicleID           *int64          `json:"vehicle_id" db:"vehicle_id"`
	Enabled             bool            `json:"enabled" db:"enabled"`
	TriggerType         string          `json:"trigger_type" db:"trigger_type"`
	TriggerConfig       json.RawMessage `json:"trigger_config" db:"trigger_config"`
	Conditions          json.RawMessage `json:"conditions" db:"conditions"`
	Actions             json.RawMessage `json:"actions" db:"actions"`
	CooldownMinutes     int             `json:"cooldown_minutes" db:"cooldown_minutes"`
	MaxExecutionsHour   int             `json:"max_executions_hour" db:"max_executions_hour"`
	StopOnFailure       bool            `json:"stop_on_failure" db:"stop_on_failure"`
	NotifyOnRun         bool            `json:"notify_on_run" db:"notify_on_run"`
	NotifyOnFailure     bool            `json:"notify_on_failure" db:"notify_on_failure"`
	SeasonalStart       *int            `json:"seasonal_start" db:"seasonal_start"`
	SeasonalEnd         *int            `json:"seasonal_end" db:"seasonal_end"`
	Priority            int             `json:"priority" db:"priority"`
	LastTriggeredAt     *time.Time      `json:"last_triggered_at" db:"last_triggered_at"`
	LastSuccessAt       *time.Time      `json:"last_success_at" db:"last_success_at"`
	LastFailureAt       *time.Time      `json:"last_failure_at" db:"last_failure_at"`
	ExecutionCount      int64           `json:"execution_count" db:"execution_count"`
	FailureCount        int64           `json:"failure_count" db:"failure_count"`
	ConsecutiveFailures int             `json:"consecutive_failures" db:"consecutive_failures"`
	AutoDisabled        bool            `json:"auto_disabled" db:"auto_disabled"`
	AutoDisabledReason  *string         `json:"auto_disabled_reason" db:"auto_disabled_reason"`
	PresetID            *string         `json:"preset_id" db:"preset_id"`
	Tags                []string        `json:"tags" db:"tags"`
	CreatedAt           time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at" db:"updated_at"`
}

// AutomationHistory records the result of a single automation execution.
type AutomationHistory struct {
	ID                int64           `json:"id" db:"id"`
	AutomationID      int64           `json:"automation_id" db:"automation_id"`
	AutomationName    string          `json:"automation_name" db:"automation_name"`
	VehicleID         *int64          `json:"vehicle_id" db:"vehicle_id"`
	TriggeredAt       time.Time       `json:"triggered_at" db:"triggered_at"`
	CompletedAt       *time.Time      `json:"completed_at" db:"completed_at"`
	DurationMs        *int            `json:"duration_ms" db:"duration_ms"`
	TriggerType       string          `json:"trigger_type" db:"trigger_type"`
	TriggerSnapshot   json.RawMessage `json:"trigger_snapshot" db:"trigger_snapshot"`
	ConditionsMet     bool            `json:"conditions_met" db:"conditions_met"`
	ConditionsSnapshot json.RawMessage `json:"conditions_snapshot" db:"conditions_snapshot"`
	ActionsExecuted   json.RawMessage `json:"actions_executed" db:"actions_executed"`
	ActionsTotal      int             `json:"actions_total" db:"actions_total"`
	ActionsSucceeded  int             `json:"actions_succeeded" db:"actions_succeeded"`
	ActionsFailed     int             `json:"actions_failed" db:"actions_failed"`
	Status            string          `json:"status" db:"status"`
	Error             *string         `json:"error" db:"error"`
	FSMState          *string         `json:"fsm_state" db:"fsm_state"`
	CreatedAt         time.Time       `json:"created_at" db:"created_at"`
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
	RawJSON           string     `json:"raw_json,omitempty" db:"raw_json"`
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
	RawJSON           string    `json:"raw_json,omitempty" db:"raw_json"`
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
	UsageKWh            *float64   `json:"usage_kwh" db:"usage_kwh"`
	TotalDue            *float64   `json:"total_due" db:"total_due"`
	HasInvoice          bool       `json:"has_invoice" db:"has_invoice"`
	InvoiceContentID    *string    `json:"invoice_content_id" db:"invoice_content_id"`
	RawJSON             string     `json:"raw_json,omitempty" db:"raw_json"`
	FetchedAt           time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
}

// TeslaChargingHistorySummary holds aggregated stats for Tesla charging history.
type TeslaChargingHistorySummary struct {
	TotalSessions int      `json:"total_sessions"`
	TotalKWh      *float64 `json:"total_kwh"`
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
	RawJSON             string     `json:"raw_json,omitempty" db:"raw_json"`
	FetchedAt           time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
}

// TeslaChargingSessionSummary holds aggregated stats for Tesla fleet charging sessions.
type TeslaChargingSessionSummary struct {
	TotalSessions int      `json:"total_sessions"`
	TotalKWh      *float64 `json:"total_kwh"`
	TotalCost     *float64 `json:"total_cost"`
	AvgCostPerKWh *float64 `json:"avg_cost_per_kwh"`
	PeakPowerKW   *float64 `json:"peak_power_kw"`
}

// TeslaEnergyHistory represents an energy measurement from Tesla calendar_history (kind=energy).
// Values are stored in watt-hours as returned by the Tesla API.
type TeslaEnergyHistory struct {
	ID                 int64      `json:"id" db:"id"`
	EnergySiteID       int64      `json:"energy_site_id" db:"energy_site_id"`
	Period             string     `json:"period" db:"period"`
	Timestamp          time.Time  `json:"timestamp" db:"timestamp"`
	SolarEnergyWh      *float64   `json:"solar_energy_wh" db:"solar_energy_wh"`
	BatteryEnergyInWh  *float64   `json:"battery_energy_in_wh" db:"battery_energy_in_wh"`
	BatteryEnergyOutWh *float64   `json:"battery_energy_out_wh" db:"battery_energy_out_wh"`
	GridEnergyInWh     *float64   `json:"grid_energy_in_wh" db:"grid_energy_in_wh"`
	GridEnergyOutWh    *float64   `json:"grid_energy_out_wh" db:"grid_energy_out_wh"`
	ConsumerEnergyWh   *float64   `json:"consumer_energy_wh" db:"consumer_energy_wh"`
	RawJSON            string     `json:"raw_json,omitempty" db:"raw_json"`
	FetchedAt          time.Time  `json:"fetched_at" db:"fetched_at"`
}

// TeslaEnergyBackupEvent represents an off-grid backup event from Tesla calendar_history (kind=backup).
type TeslaEnergyBackupEvent struct {
	ID              int64     `json:"id" db:"id"`
	EnergySiteID    int64     `json:"energy_site_id" db:"energy_site_id"`
	Period          string    `json:"period" db:"period"`
	Timestamp       time.Time `json:"timestamp" db:"timestamp"`
	DurationSeconds int       `json:"duration_seconds" db:"duration_seconds"`
	RawJSON         string    `json:"raw_json,omitempty" db:"raw_json"`
	FetchedAt       time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaEnergyWCCharging represents a wall connector charging record from Tesla telemetry_history (kind=charge).
// Energy is stored in watt-hours as returned by the Tesla API.
type TeslaEnergyWCCharging struct {
	ID             int64     `json:"id" db:"id"`
	EnergySiteID   int64     `json:"energy_site_id" db:"energy_site_id"`
	DIN            *string   `json:"din" db:"din"`
	Timestamp      time.Time `json:"timestamp" db:"timestamp"`
	EnergyWh       *float64  `json:"energy_wh" db:"energy_wh"`
	RawJSON        string    `json:"raw_json,omitempty" db:"raw_json"`
	FetchedAt      time.Time `json:"fetched_at" db:"fetched_at"`
}

// TeslaFleetTelemetryError represents a fleet telemetry error from the partner endpoint.
// Persisted for historical tracking and alerting.
type TeslaFleetTelemetryError struct {
	ID             int64      `json:"id" db:"id"`
	VIN            string     `json:"vin" db:"vin"`
	ErrorCode      *string    `json:"error_code" db:"error_code"`
	ErrorMessage   *string    `json:"error_message" db:"error_message"`
	ReportedAt     *time.Time `json:"reported_at" db:"reported_at"`
	RawJSON        string     `json:"raw_json,omitempty" db:"raw_json"`
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
	RawJSON      string     `json:"-" db:"raw_json"`
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
	RawJSON         string    `json:"-" db:"raw_json"`
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
	RawJSON     string    `json:"-" db:"raw_json"`
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
	RawJSON      string     `json:"-" db:"raw_json"`
	FetchedAt    time.Time  `json:"fetched_at" db:"fetched_at"`
	CreatedAt    time.Time  `json:"created_at" db:"created_at"`
}

// GuardConfig holds per-vehicle anti-theft guard mode configuration.
type GuardConfig struct {
	VehicleID      int64     `json:"vehicle_id" db:"vehicle_id"`
	Enabled        bool      `json:"enabled" db:"enabled"`
	HomeGeofenceID *int64    `json:"home_geofence_id" db:"home_geofence_id"`
	Sensitivity    string    `json:"sensitivity" db:"sensitivity"`
	AutoPanic      bool      `json:"auto_panic" db:"auto_panic"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
}

// ShareToken represents a public share link for a drive.
type ShareToken struct {
	ID               int64      `json:"id" db:"id"`
	Token            string     `json:"token" db:"token"`
	DriveID          int64      `json:"drive_id" db:"drive_id"`
	CreatedBy        *string    `json:"created_by,omitempty" db:"created_by"`
	Title            *string    `json:"title,omitempty" db:"title"`
	Description      *string    `json:"description,omitempty" db:"description"`
	IncludeMap       bool       `json:"include_map" db:"include_map"`
	IncludeTelemetry bool       `json:"include_telemetry" db:"include_telemetry"`
	IncludeSpeed     bool       `json:"include_speed" db:"include_speed"`
	Views            int        `json:"views" db:"views"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
}

// GuardEvent records a guard mode alert (movement, unlock, panic, etc.).
type GuardEvent struct {
	ID               int64                  `json:"id" db:"id"`
	VehicleID        int64                  `json:"vehicle_id" db:"vehicle_id"`
	EventType        string                 `json:"event_type" db:"event_type"`
	Latitude         *float64               `json:"latitude" db:"latitude"`
	Longitude        *float64               `json:"longitude" db:"longitude"`
	Speed            *float64               `json:"speed" db:"speed"`
	Details          map[string]interface{} `json:"details" db:"details"`
	NotifiedChannels []string               `json:"notified_channels" db:"notified_channels"`
	Acknowledged     bool                   `json:"acknowledged" db:"acknowledged"`
	AcknowledgedAt   *time.Time             `json:"acknowledged_at" db:"acknowledged_at"`
	CreatedAt        time.Time              `json:"created_at" db:"created_at"`
}
