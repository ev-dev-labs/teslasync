package models

import "time"

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

// Vehicle represents a tracked Tesla vehicle.
type Vehicle struct {
	ID            int64     `json:"id" db:"id"`
	VehicleID     int64     `json:"vehicle_id" db:"vehicle_id"`
	VIN           string    `json:"vin" db:"vin"`
	DisplayName   string    `json:"display_name" db:"display_name"`
	Model         string    `json:"model" db:"model"`
	TrimBadging   string    `json:"trim_badging" db:"trim_badging"`
	ExteriorColor string    `json:"exterior_color" db:"exterior_color"`
	WheelType     string    `json:"wheel_type" db:"wheel_type"`
	State         string    `json:"state" db:"state"`   // online, asleep, offline
	Healthy       bool      `json:"healthy" db:"healthy"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

// Position represents a GPS position record with telemetry.
type Position struct {
	ID          int64     `json:"id" db:"id"`
	VehicleID   int64     `json:"vehicle_id" db:"vehicle_id"`
	Latitude    float64   `json:"latitude" db:"latitude"`
	Longitude   float64   `json:"longitude" db:"longitude"`
	Speed       *float64  `json:"speed,omitempty" db:"speed"`
	Power       *float64  `json:"power,omitempty" db:"power"`
	Heading     *int      `json:"heading,omitempty" db:"heading"`
	Elevation   *float64  `json:"elevation,omitempty" db:"elevation"`
	Odometer    float64   `json:"odometer" db:"odometer"`
	IdealRange  *float64  `json:"ideal_range,omitempty" db:"ideal_range"`
	RatedRange  *float64  `json:"rated_range,omitempty" db:"rated_range"`
	BatteryLvl  int       `json:"battery_level" db:"battery_level"`
	InsideTemp  *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	FanStatus   *int      `json:"fan_status,omitempty" db:"fan_status"`
	IsClimate   *bool     `json:"is_climate_on,omitempty" db:"is_climate_on"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// Drive represents a driving session.
type Drive struct {
	ID               int64      `json:"id" db:"id"`
	VehicleID        int64      `json:"vehicle_id" db:"vehicle_id"`
	StartDate        time.Time  `json:"start_date" db:"start_date"`
	EndDate          *time.Time `json:"end_date,omitempty" db:"end_date"`
	StartPositionID  *int64     `json:"start_position_id,omitempty" db:"start_position_id"`
	EndPositionID    *int64     `json:"end_position_id,omitempty" db:"end_position_id"`
	StartAddressID   *int64     `json:"start_address_id,omitempty" db:"start_address_id"`
	EndAddressID     *int64     `json:"end_address_id,omitempty" db:"end_address_id"`
	Distance         float64    `json:"distance" db:"distance"`
	DurationMin      float64    `json:"duration_min" db:"duration_min"`
	StartRangeKm     *float64   `json:"start_range_km,omitempty" db:"start_range_km"`
	EndRangeKm       *float64   `json:"end_range_km,omitempty" db:"end_range_km"`
	SpeedMax         *float64   `json:"speed_max,omitempty" db:"speed_max"`
	PowerMax         *float64   `json:"power_max,omitempty" db:"power_max"`
	PowerMin         *float64   `json:"power_min,omitempty" db:"power_min"`
	StartBatteryLvl  *int       `json:"start_battery_level,omitempty" db:"start_battery_level"`
	EndBatteryLvl    *int       `json:"end_battery_level,omitempty" db:"end_battery_level"`
	InsideTempAvg    *float64   `json:"inside_temp_avg,omitempty" db:"inside_temp_avg"`
	OutsideTempAvg   *float64   `json:"outside_temp_avg,omitempty" db:"outside_temp_avg"`
}

// ChargingSession represents a charging event.
type ChargingSession struct {
	ID                    int64      `json:"id" db:"id"`
	VehicleID             int64      `json:"vehicle_id" db:"vehicle_id"`
	StartDate             time.Time  `json:"start_date" db:"start_date"`
	EndDate               *time.Time `json:"end_date,omitempty" db:"end_date"`
	AddressID             *int64     `json:"address_id,omitempty" db:"address_id"`
	ChargeEnergyAdded     float64    `json:"charge_energy_added" db:"charge_energy_added"`
	ChargeEnergyUsed      *float64   `json:"charge_energy_used,omitempty" db:"charge_energy_used"`
	StartBatteryLevel     int        `json:"start_battery_level" db:"start_battery_level"`
	EndBatteryLevel       *int       `json:"end_battery_level,omitempty" db:"end_battery_level"`
	StartRangeKm          *float64   `json:"start_range_km,omitempty" db:"start_range_km"`
	EndRangeKm            *float64   `json:"end_range_km,omitempty" db:"end_range_km"`
	ChargerPhases         *int       `json:"charger_phases,omitempty" db:"charger_phases"`
	ChargerVoltage        *int       `json:"charger_voltage,omitempty" db:"charger_voltage"`
	ChargerActualCurrent  *int       `json:"charger_actual_current,omitempty" db:"charger_actual_current"`
	ChargerPower          *float64   `json:"charger_power,omitempty" db:"charger_power"`
	FastChargerType       *string    `json:"fast_charger_type,omitempty" db:"fast_charger_type"`
	FastChargerBrand      *string    `json:"fast_charger_brand,omitempty" db:"fast_charger_brand"`
	ConnChargeCable       *string    `json:"conn_charge_cable,omitempty" db:"conn_charge_cable"`
	Cost                  *float64   `json:"cost,omitempty" db:"cost"`
	DurationMin           float64    `json:"duration_min" db:"duration_min"`
}

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
	PreferredRange  string  `json:"preferred_range" db:"preferred_range"`     // ideal, rated
	Language        string  `json:"language" db:"language"`
	BaseCostPerKWh  float64 `json:"base_cost_per_kwh" db:"base_cost_per_kwh"`
	APISuspended    bool    `json:"api_suspended" db:"api_suspended"`
	Theme           string  `json:"theme" db:"theme"`                         // neon-cyan, tesla-red, etc.
	Mode            string  `json:"mode" db:"mode"`                           // dark, light, oled, midnight
	CustomPrimary   string  `json:"custom_primary" db:"custom_primary"`       // hex color for custom theme
	CustomAccent    string  `json:"custom_accent" db:"custom_accent"`         // hex color for custom theme
}

// VehicleState represents a snapshot of vehicle state at a point in time.
type VehicleState struct {
	VehicleID       int64    `json:"vehicle_id"`
	State           string   `json:"state"`
	Latitude        float64  `json:"latitude"`
	Longitude       float64  `json:"longitude"`
	Speed           float64  `json:"speed"`
	Power           float64  `json:"power"`
	BatteryLevel    int      `json:"battery_level"`
	RatedRange      float64  `json:"rated_range"`
	IdealRange      float64  `json:"ideal_range"`
	Odometer        float64  `json:"odometer"`
	InsideTemp      float64  `json:"inside_temp"`
	OutsideTemp     float64  `json:"outside_temp"`
	IsClimateOn     bool     `json:"is_climate_on"`
	IsCharging      bool     `json:"is_charging"`
	ChargerPower    float64  `json:"charger_power"`
	ChargeRate      float64  `json:"charge_rate"`
	TimeToFullChg   float64  `json:"time_to_full_charge"`
	IsLocked        bool     `json:"is_locked"`
	SentryMode      bool     `json:"sentry_mode"`
	SoftwareVersion string   `json:"software_version"`
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
type AlertRule struct {
	ID         int64   `json:"id" db:"id"`
	Name       string  `json:"name" db:"name"`
	Type       string  `json:"type" db:"type"`
	Enabled    bool    `json:"enabled" db:"enabled"`
	Threshold  float64 `json:"threshold" db:"threshold"`
	VehicleID  *int64  `json:"vehicle_id,omitempty" db:"vehicle_id"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
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
	Date     string  `json:"date"`
	Consumed float64 `json:"consumed_kwh"`
	Cost     float64 `json:"cost"`
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
	ID         int64     `json:"id" db:"id"`
	VehicleID  int64     `json:"vehicle_id" db:"vehicle_id"`
	FrontLeft  *float64  `json:"front_left" db:"front_left"`
	FrontRight *float64  `json:"front_right" db:"front_right"`
	RearLeft   *float64  `json:"rear_left" db:"rear_left"`
	RearRight  *float64  `json:"rear_right" db:"rear_right"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
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
	ID            int64   `json:"id" db:"id"`
	VehicleID     int64   `json:"vehicle_id" db:"vehicle_id"`
	Date          string  `json:"date" db:"date"`
	DistanceKm    float64 `json:"distance_km" db:"distance_km"`
	OdometerStart float64 `json:"odometer_start" db:"odometer_start"`
	OdometerEnd   float64 `json:"odometer_end" db:"odometer_end"`
	DriveCount    int     `json:"drive_count" db:"drive_count"`
	EnergyUsedKWh float64 `json:"energy_used_kwh" db:"energy_used_kwh"`
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

// Trip represents a multi-drive journey.
type Trip struct {
	ID              int64      `json:"id" db:"id"`
	VehicleID       int64      `json:"vehicle_id" db:"vehicle_id"`
	Name            *string    `json:"name,omitempty" db:"name"`
	StartDate       time.Time  `json:"start_date" db:"start_date"`
	EndDate         *time.Time `json:"end_date,omitempty" db:"end_date"`
	TotalDistanceKm float64    `json:"total_distance_km" db:"total_distance_km"`
	TotalEnergyKWh  float64    `json:"total_energy_kwh" db:"total_energy_kwh"`
	TotalCost       float64    `json:"total_cost" db:"total_cost"`
	DriveCount      int        `json:"drive_count" db:"drive_count"`
	ChargeCount     int        `json:"charge_count" db:"charge_count"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
}

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
