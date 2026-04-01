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

	// Enhanced tracking fields (migration 21)
	StartOdometer    *float64 `json:"start_odometer,omitempty" db:"start_odometer"`
	EndOdometer      *float64 `json:"end_odometer,omitempty" db:"end_odometer"`
	SpeedAvg         *float64 `json:"speed_avg,omitempty" db:"speed_avg"`
	SpeedMin         *float64 `json:"speed_min,omitempty" db:"speed_min"`

	// Rated range stats
	StartRatedRangeKm *float64 `json:"start_rated_range_km,omitempty" db:"start_rated_range_km"`
	EndRatedRangeKm   *float64 `json:"end_rated_range_km,omitempty" db:"end_rated_range_km"`
	RatedRangeAvg     *float64 `json:"rated_range_avg,omitempty" db:"rated_range_avg"`
	RatedRangeMax     *float64 `json:"rated_range_max,omitempty" db:"rated_range_max"`
	RatedRangeMin     *float64 `json:"rated_range_min,omitempty" db:"rated_range_min"`

	// Ideal range stats
	StartIdealRangeKm *float64 `json:"start_ideal_range_km,omitempty" db:"start_ideal_range_km"`
	EndIdealRangeKm   *float64 `json:"end_ideal_range_km,omitempty" db:"end_ideal_range_km"`
	IdealRangeAvg     *float64 `json:"ideal_range_avg,omitempty" db:"ideal_range_avg"`
	IdealRangeMax     *float64 `json:"ideal_range_max,omitempty" db:"ideal_range_max"`
	IdealRangeMin     *float64 `json:"ideal_range_min,omitempty" db:"ideal_range_min"`

	// Estimated range stats
	StartEstRangeKm *float64 `json:"start_est_range_km,omitempty" db:"start_est_range_km"`
	EndEstRangeKm   *float64 `json:"end_est_range_km,omitempty" db:"end_est_range_km"`
	EstRangeAvg     *float64 `json:"est_range_avg,omitempty" db:"est_range_avg"`
	EstRangeMax     *float64 `json:"est_range_max,omitempty" db:"est_range_max"`
	EstRangeMin     *float64 `json:"est_range_min,omitempty" db:"est_range_min"`

	// SOC stats
	SocStart *float64 `json:"soc_start,omitempty" db:"soc_start"`
	SocEnd   *float64 `json:"soc_end,omitempty" db:"soc_end"`
	SocAvg   *float64 `json:"soc_avg,omitempty" db:"soc_avg"`
	SocMax   *float64 `json:"soc_max,omitempty" db:"soc_max"`
	SocMin   *float64 `json:"soc_min,omitempty" db:"soc_min"`

	// Usable SOC
	UsableSocStart *float64 `json:"usable_soc_start,omitempty" db:"usable_soc_start"`
	UsableSocEnd   *float64 `json:"usable_soc_end,omitempty" db:"usable_soc_end"`
	UsableSocAvg   *float64 `json:"usable_soc_avg,omitempty" db:"usable_soc_avg"`
	UsableSocMax   *float64 `json:"usable_soc_max,omitempty" db:"usable_soc_max"`
	UsableSocMin   *float64 `json:"usable_soc_min,omitempty" db:"usable_soc_min"`

	// Elevation
	ElevationStart *float64 `json:"elevation_start,omitempty" db:"elevation_start"`
	ElevationEnd   *float64 `json:"elevation_end,omitempty" db:"elevation_end"`
	ElevationGain  *float64 `json:"elevation_gain,omitempty" db:"elevation_gain"`
	ElevationLoss  *float64 `json:"elevation_loss,omitempty" db:"elevation_loss"`

	// Additional temperature stats
	DriverTempAvg    *float64 `json:"driver_temp_avg,omitempty" db:"driver_temp_avg"`
	PassengerTempAvg *float64 `json:"passenger_temp_avg,omitempty" db:"passenger_temp_avg"`

	// Battery heater
	BatteryHeaterOn *bool `json:"battery_heater_on,omitempty" db:"battery_heater_on"`

	// Address names (denormalized)
	StartAddress *string `json:"start_address,omitempty" db:"start_address"`
	EndAddress   *string `json:"end_address,omitempty" db:"end_address"`

	// Start/end coordinates (denormalized)
	StartLatitude  *float64 `json:"start_latitude,omitempty" db:"start_latitude"`
	StartLongitude *float64 `json:"start_longitude,omitempty" db:"start_longitude"`
	EndLatitude    *float64 `json:"end_latitude,omitempty" db:"end_latitude"`
	EndLongitude   *float64 `json:"end_longitude,omitempty" db:"end_longitude"`
}

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
	ID              int64      `json:"id" db:"id"`
	VehicleID       *int64     `json:"vehicle_id,omitempty" db:"vehicle_id"`
	VIN             string     `json:"vin" db:"vin"`
	Signals         []string   `json:"signals" db:"signals"`
	IntervalSeconds int        `json:"interval_seconds" db:"interval_seconds"`
	Hostname        string     `json:"hostname" db:"hostname"`
	Port            int        `json:"port" db:"port"`
	Protocol        string     `json:"protocol" db:"protocol"`
	CaPEM           *string    `json:"ca_pem,omitempty" db:"ca_pem"`
	SubscribedAt    time.Time  `json:"subscribed_at" db:"subscribed_at"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty" db:"expires_at"`
	Status          string     `json:"status" db:"status"`
	ResponseCode    *int       `json:"response_code,omitempty" db:"response_code"`
	ResponseBody    *string    `json:"response_body,omitempty" db:"response_body"`
	CreatedAt       time.Time  `json:"created_at" db:"created_at"`
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

	// Enhanced tracking fields (migration 21)
	Latitude       *float64 `json:"latitude,omitempty" db:"latitude"`
	Longitude      *float64 `json:"longitude,omitempty" db:"longitude"`
	LocationName   *string  `json:"location_name,omitempty" db:"location_name"`
	InsideTempAvg  *float64 `json:"inside_temp_avg,omitempty" db:"inside_temp_avg"`
	OutsideTempAvg *float64 `json:"outside_temp_avg,omitempty" db:"outside_temp_avg"`
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
	GasPricePerUnit float64 `json:"gas_price_per_unit" db:"gas_price_per_unit"` // price per gallon/liter
	GasUnit         string  `json:"gas_unit" db:"gas_unit"`                   // gallon, liter
	GasEfficiencyMPG float64 `json:"gas_efficiency_mpg" db:"gas_efficiency_mpg"` // equivalent ICE car MPG for comparison
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

// ExportJob represents an async export job persisted in the database.
type ExportJob struct {
	ID           string     `json:"id"`
	Type         string     `json:"type"`
	Format       string     `json:"format"`
	Status       string     `json:"status"`
	VehicleID    *int64     `json:"vehicle_id,omitempty"`
	StartDate    *time.Time `json:"start_date,omitempty"`
	EndDate      *time.Time `json:"end_date,omitempty"`
	FileName     string     `json:"file_name,omitempty"`
	FileSize     int64      `json:"file_size"`
	RecordCount  int        `json:"record_count"`
	ErrorMessage string     `json:"error_message,omitempty"`
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
	FileName     string     `json:"file_name,omitempty"`
	FileSize     int64      `json:"file_size"`
	RecordCount  int        `json:"record_count"`
	ErrorMessage string     `json:"error_message,omitempty"`
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

// MotorSnapshot represents a point-in-time motor/powertrain telemetry reading.
type MotorSnapshot struct {
	ID                 int64      `json:"id" db:"id"`
	VehicleID          int64      `json:"vehicle_id" db:"vehicle_id"`
	DiState            *string    `json:"di_state,omitempty" db:"di_state"`
	DiTorque           *float64   `json:"di_torque,omitempty" db:"di_torque"`
	DiAxleSpeed        *float64   `json:"di_axle_speed,omitempty" db:"di_axle_speed"`
	DiStatorTemp       *float64   `json:"di_stator_temp,omitempty" db:"di_stator_temp"`
	PedalPosition      *float64   `json:"pedal_position,omitempty" db:"pedal_position"`
	BrakePedal         *bool      `json:"brake_pedal,omitempty" db:"brake_pedal"`
	LateralAccel       *float64   `json:"lateral_accel,omitempty" db:"lateral_accel"`
	LongitudinalAccel  *float64   `json:"longitudinal_accel,omitempty" db:"longitudinal_accel"`
	VehicleSpeed       *float64   `json:"vehicle_speed,omitempty" db:"vehicle_speed"`
	Gear               *string    `json:"gear,omitempty" db:"gear"`
	DiTorqueActualF    *float64   `json:"di_torque_actual_f,omitempty" db:"di_torque_actual_f"`
	DiTorqueActualR    *float64   `json:"di_torque_actual_r,omitempty" db:"di_torque_actual_r"`
	DiTorqueActualREL  *float64   `json:"di_torque_actual_rel,omitempty" db:"di_torque_actual_rel"`
	DiTorqueActualRER  *float64   `json:"di_torque_actual_rer,omitempty" db:"di_torque_actual_rer"`
	DiAxleSpeedF       *float64   `json:"di_axle_speed_f,omitempty" db:"di_axle_speed_f"`
	DiAxleSpeedREL     *float64   `json:"di_axle_speed_rel,omitempty" db:"di_axle_speed_rel"`
	DiAxleSpeedRER     *float64   `json:"di_axle_speed_rer,omitempty" db:"di_axle_speed_rer"`
	DiStateF           *string    `json:"di_state_f,omitempty" db:"di_state_f"`
	DiStateREL         *string    `json:"di_state_rel,omitempty" db:"di_state_rel"`
	DiStateRER         *string    `json:"di_state_rer,omitempty" db:"di_state_rer"`
	DiStatorTempF      *float64   `json:"di_stator_temp_f,omitempty" db:"di_stator_temp_f"`
	DiStatorTempREL    *float64   `json:"di_stator_temp_rel,omitempty" db:"di_stator_temp_rel"`
	DiStatorTempRER    *float64   `json:"di_stator_temp_rer,omitempty" db:"di_stator_temp_rer"`
	DiHeatsinkTF       *float64   `json:"di_heatsink_t_f,omitempty" db:"di_heatsink_t_f"`
	DiHeatsinkTR       *float64   `json:"di_heatsink_t_r,omitempty" db:"di_heatsink_t_r"`
	DiHeatsinkTREL     *float64   `json:"di_heatsink_t_rel,omitempty" db:"di_heatsink_t_rel"`
	DiHeatsinkTRER     *float64   `json:"di_heatsink_t_rer,omitempty" db:"di_heatsink_t_rer"`
	DiInverterTF       *float64   `json:"di_inverter_t_f,omitempty" db:"di_inverter_t_f"`
	DiInverterTR       *float64   `json:"di_inverter_t_r,omitempty" db:"di_inverter_t_r"`
	DiInverterTREL     *float64   `json:"di_inverter_t_rel,omitempty" db:"di_inverter_t_rel"`
	DiInverterTRER     *float64   `json:"di_inverter_t_rer,omitempty" db:"di_inverter_t_rer"`
	DiMotorCurrentF    *float64   `json:"di_motor_current_f,omitempty" db:"di_motor_current_f"`
	DiMotorCurrentR    *float64   `json:"di_motor_current_r,omitempty" db:"di_motor_current_r"`
	DiMotorCurrentREL  *float64   `json:"di_motor_current_rel,omitempty" db:"di_motor_current_rel"`
	DiMotorCurrentRER  *float64   `json:"di_motor_current_rer,omitempty" db:"di_motor_current_rer"`
	DiVBatF            *float64   `json:"di_v_bat_f,omitempty" db:"di_v_bat_f"`
	DiVBatR            *float64   `json:"di_v_bat_r,omitempty" db:"di_v_bat_r"`
	DiVBatREL          *float64   `json:"di_v_bat_rel,omitempty" db:"di_v_bat_rel"`
	DiVBatRER          *float64   `json:"di_v_bat_rer,omitempty" db:"di_v_bat_rer"`
	DiSlaveTorqueCmd   *float64   `json:"di_slave_torque_cmd,omitempty" db:"di_slave_torque_cmd"`
	Hvil               *string    `json:"hvil,omitempty" db:"hvil"`
	BrakePedalPos      *float64   `json:"brake_pedal_pos,omitempty" db:"brake_pedal_pos"`
	CruiseSetSpeed     *float64   `json:"cruise_set_speed,omitempty" db:"cruise_set_speed"`
	DriveRail          *bool      `json:"drive_rail,omitempty" db:"drive_rail"`
	CreatedAt          time.Time  `json:"created_at" db:"created_at"`
}

// ClimateSnapshot represents a point-in-time climate/HVAC telemetry reading.
type ClimateSnapshot struct {
	ID                   int64     `json:"id" db:"id"`
	VehicleID            int64     `json:"vehicle_id" db:"vehicle_id"`
	InsideTemp           *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp          *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	HvacPower            *float64  `json:"hvac_power,omitempty" db:"hvac_power"`
	HvacFanSpeed         *int      `json:"hvac_fan_speed,omitempty" db:"hvac_fan_speed"`
	HvacLeftTempRequest  *float64  `json:"hvac_left_temp_request,omitempty" db:"hvac_left_temp_request"`
	HvacRightTempRequest *float64  `json:"hvac_right_temp_request,omitempty" db:"hvac_right_temp_request"`
	CabinOverheatMode    *string   `json:"cabin_overheat_mode,omitempty" db:"cabin_overheat_mode"`
	DefrostMode          *bool     `json:"defrost_mode,omitempty" db:"defrost_mode"`
	BatteryHeaterOn      *bool     `json:"battery_heater_on,omitempty" db:"battery_heater_on"`
	HvacACEnabled        *bool     `json:"hvac_ac_enabled,omitempty" db:"hvac_ac_enabled"`
	HvacAutoMode         *string   `json:"hvac_auto_mode,omitempty" db:"hvac_auto_mode"`
	HvacFanStatus        *int      `json:"hvac_fan_status,omitempty" db:"hvac_fan_status"`
	HvacSteeringWheelHeatAuto *bool `json:"hvac_steering_wheel_heat_auto,omitempty" db:"hvac_steering_wheel_heat_auto"`
	HvacSteeringWheelHeatLevel *int `json:"hvac_steering_wheel_heat_level,omitempty" db:"hvac_steering_wheel_heat_level"`
	ClimateKeeperMode    *string   `json:"climate_keeper_mode,omitempty" db:"climate_keeper_mode"`
	CabinOverheatProtectionTempLimit *string `json:"cabin_overheat_protection_temp_limit,omitempty" db:"cabin_overheat_protection_temp_limit"`
	DefrostForPreconditioning *bool `json:"defrost_for_preconditioning,omitempty" db:"defrost_for_preconditioning"`
	SeatHeaterLeft       *int      `json:"seat_heater_left,omitempty" db:"seat_heater_left"`
	SeatHeaterRight      *int      `json:"seat_heater_right,omitempty" db:"seat_heater_right"`
	SeatHeaterRearLeft   *int      `json:"seat_heater_rear_left,omitempty" db:"seat_heater_rear_left"`
	SeatHeaterRearCenter *int      `json:"seat_heater_rear_center,omitempty" db:"seat_heater_rear_center"`
	SeatHeaterRearRight  *int      `json:"seat_heater_rear_right,omitempty" db:"seat_heater_rear_right"`
	SeatVentEnabled      *bool     `json:"seat_vent_enabled,omitempty" db:"seat_vent_enabled"`
	ClimateSeatCoolingFrontLeft *int `json:"climate_seat_cooling_front_left,omitempty" db:"climate_seat_cooling_front_left"`
	ClimateSeatCoolingFrontRight *int `json:"climate_seat_cooling_front_right,omitempty" db:"climate_seat_cooling_front_right"`
	AutoSeatClimateLeft  *bool     `json:"auto_seat_climate_left,omitempty" db:"auto_seat_climate_left"`
	AutoSeatClimateRight *bool     `json:"auto_seat_climate_right,omitempty" db:"auto_seat_climate_right"`
	RearDefrostEnabled   *bool     `json:"rear_defrost_enabled,omitempty" db:"rear_defrost_enabled"`
	RearDisplayHvacEnabled *bool   `json:"rear_display_hvac_enabled,omitempty" db:"rear_display_hvac_enabled"`
	WiperHeatEnabled     *bool     `json:"wiper_heat_enabled,omitempty" db:"wiper_heat_enabled"`
	CreatedAt            time.Time `json:"created_at" db:"created_at"`
}

// SecurityEvent represents a point-in-time security/access telemetry reading.
type SecurityEvent struct {
	ID             int64     `json:"id" db:"id"`
	VehicleID      int64     `json:"vehicle_id" db:"vehicle_id"`
	Locked         *bool     `json:"locked,omitempty" db:"locked"`
	SentryMode     *bool     `json:"sentry_mode,omitempty" db:"sentry_mode"`
	DoorState      *string   `json:"door_state,omitempty" db:"door_state"`
	FdWindow       *string   `json:"fd_window,omitempty" db:"fd_window"`
	FpWindow       *string   `json:"fp_window,omitempty" db:"fp_window"`
	RdWindow       *string   `json:"rd_window,omitempty" db:"rd_window"`
	RpWindow       *string   `json:"rp_window,omitempty" db:"rp_window"`
	HomelinkNearby *bool     `json:"homelink_nearby,omitempty" db:"homelink_nearby"`
	GuestMode      *bool     `json:"guest_mode,omitempty" db:"guest_mode"`
	HomelinkDeviceCount *int `json:"homelink_device_count,omitempty" db:"homelink_device_count"`
	GuestModeMobileAccessState *string `json:"guest_mode_mobile_access_state,omitempty" db:"guest_mode_mobile_access_state"`
	DriverSeatOccupied  *bool    `json:"driver_seat_occupied,omitempty" db:"driver_seat_occupied"`
	CenterDisplay       *string  `json:"center_display,omitempty" db:"center_display"`
	SpeedLimitMode      *bool    `json:"speed_limit_mode,omitempty" db:"speed_limit_mode"`
	ValetModeEnabled    *bool    `json:"valet_mode_enabled,omitempty" db:"valet_mode_enabled"`
	ServiceMode         *bool    `json:"service_mode,omitempty" db:"service_mode"`
	CurrentLimitMph     *float64 `json:"current_limit_mph,omitempty" db:"current_limit_mph"`
	PairedPhoneKeyCount *int     `json:"paired_phone_key_count,omitempty" db:"paired_phone_key_count"`
	LightsHazardsActive *bool    `json:"lights_hazards_active,omitempty" db:"lights_hazards_active"`
	LightsHighBeams     *bool    `json:"lights_high_beams,omitempty" db:"lights_high_beams"`
	LightsTurnSignal    *string  `json:"lights_turn_signal,omitempty" db:"lights_turn_signal"`
	TonneauPosition     *string  `json:"tonneau_position,omitempty" db:"tonneau_position"`
	TonneauOpenPercent  *float64 `json:"tonneau_open_percent,omitempty" db:"tonneau_open_percent"`
	TonneauTentMode     *string  `json:"tonneau_tent_mode,omitempty" db:"tonneau_tent_mode"`
	DriverSeatBelt      *bool    `json:"driver_seat_belt,omitempty" db:"driver_seat_belt"`
	PassengerSeatBelt   *bool    `json:"passenger_seat_belt,omitempty" db:"passenger_seat_belt"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

// ChargingTelemetry represents a point-in-time charging telemetry reading.
type ChargingTelemetry struct {
	ID                         int64     `json:"id" db:"id"`
	VehicleID                  int64     `json:"vehicle_id" db:"vehicle_id"`
	BatteryLevel               *float64  `json:"battery_level,omitempty" db:"battery_level"`
	Soc                        *float64  `json:"soc,omitempty" db:"soc"`
	ChargeState                *string   `json:"charge_state,omitempty" db:"charge_state"`
	DetailedChargeState        *string   `json:"detailed_charge_state,omitempty" db:"detailed_charge_state"`
	ChargeLimitSoc             *int      `json:"charge_limit_soc,omitempty" db:"charge_limit_soc"`
	ChargeAmps                 *float64  `json:"charge_amps,omitempty" db:"charge_amps"`
	ChargeCurrentRequest       *float64  `json:"charge_current_request,omitempty" db:"charge_current_request"`
	ChargeCurrentRequestMax    *float64  `json:"charge_current_request_max,omitempty" db:"charge_current_request_max"`
	ChargeEnableRequest        *bool     `json:"charge_enable_request,omitempty" db:"charge_enable_request"`
	ChargerVoltage             *float64  `json:"charger_voltage,omitempty" db:"charger_voltage"`
	ChargerPhases              *int      `json:"charger_phases,omitempty" db:"charger_phases"`
	ChargeRateMph              *float64  `json:"charge_rate_mph,omitempty" db:"charge_rate_mph"`
	DCChargingPower            *float64  `json:"dc_charging_power,omitempty" db:"dc_charging_power"`
	DCChargingEnergyIn         *float64  `json:"dc_charging_energy_in,omitempty" db:"dc_charging_energy_in"`
	ACChargingPower            *float64  `json:"ac_charging_power,omitempty" db:"ac_charging_power"`
	ACChargingEnergyIn         *float64  `json:"ac_charging_energy_in,omitempty" db:"ac_charging_energy_in"`
	EnergyRemaining            *float64  `json:"energy_remaining,omitempty" db:"energy_remaining"`
	EstBatteryRange            *float64  `json:"est_battery_range,omitempty" db:"est_battery_range"`
	IdealBatteryRange          *float64  `json:"ideal_battery_range,omitempty" db:"ideal_battery_range"`
	RatedRange                 *float64  `json:"rated_range,omitempty" db:"rated_range"`
	PackVoltage                *float64  `json:"pack_voltage,omitempty" db:"pack_voltage"`
	PackCurrent                *float64  `json:"pack_current,omitempty" db:"pack_current"`
	ChargePortDoorOpen         *bool     `json:"charge_port_door_open,omitempty" db:"charge_port_door_open"`
	ChargePortLatch            *string   `json:"charge_port_latch,omitempty" db:"charge_port_latch"`
	ChargePortColdWeatherMode  *bool     `json:"charge_port_cold_weather_mode,omitempty" db:"charge_port_cold_weather_mode"`
	ChargingCableType          *string   `json:"charging_cable_type,omitempty" db:"charging_cable_type"`
	FastChargerPresent         *bool     `json:"fast_charger_present,omitempty" db:"fast_charger_present"`
	FastChargerType            *string   `json:"fast_charger_type,omitempty" db:"fast_charger_type"`
	TimeToFullCharge           *float64  `json:"time_to_full_charge,omitempty" db:"time_to_full_charge"`
	EstimatedHoursToCharge     *float64  `json:"estimated_hours_to_charge,omitempty" db:"estimated_hours_to_charge"`
	ScheduledChargingMode      *string   `json:"scheduled_charging_mode,omitempty" db:"scheduled_charging_mode"`
	ScheduledChargingPending   *bool     `json:"scheduled_charging_pending,omitempty" db:"scheduled_charging_pending"`
	PreconditioningEnabled     *bool     `json:"preconditioning_enabled,omitempty" db:"preconditioning_enabled"`
	BrickVoltageMax            *float64  `json:"brick_voltage_max,omitempty" db:"brick_voltage_max"`
	BrickVoltageMin            *float64  `json:"brick_voltage_min,omitempty" db:"brick_voltage_min"`
	NumBrickVoltageMax         *int      `json:"num_brick_voltage_max,omitempty" db:"num_brick_voltage_max"`
	NumBrickVoltageMin         *int      `json:"num_brick_voltage_min,omitempty" db:"num_brick_voltage_min"`
	ModuleTempMax              *float64  `json:"module_temp_max,omitempty" db:"module_temp_max"`
	ModuleTempMin              *float64  `json:"module_temp_min,omitempty" db:"module_temp_min"`
	NumModuleTempMax           *int      `json:"num_module_temp_max,omitempty" db:"num_module_temp_max"`
	NumModuleTempMin           *int      `json:"num_module_temp_min,omitempty" db:"num_module_temp_min"`
	BatteryHeaterOn            *bool     `json:"battery_heater_on,omitempty" db:"battery_heater_on"`
	NotEnoughPowerToHeat       *bool     `json:"not_enough_power_to_heat,omitempty" db:"not_enough_power_to_heat"`
	BmsState                   *string   `json:"bms_state,omitempty" db:"bms_state"`
	BmsFullchargeComplete      *bool     `json:"bms_fullcharge_complete,omitempty" db:"bms_fullcharge_complete"`
	DcdcEnable                 *bool     `json:"dcdc_enable,omitempty" db:"dcdc_enable"`
	IsolationResistance        *float64  `json:"isolation_resistance,omitempty" db:"isolation_resistance"`
	LifetimeEnergyUsed         *float64  `json:"lifetime_energy_used,omitempty" db:"lifetime_energy_used"`
	SuperchargerSessionTripPlanner *bool  `json:"supercharger_session_trip_planner,omitempty" db:"supercharger_session_trip_planner"`
	PowershareStatus           *string   `json:"powershare_status,omitempty" db:"powershare_status"`
	PowershareType             *string   `json:"powershare_type,omitempty" db:"powershare_type"`
	PowershareStopReason       *string   `json:"powershare_stop_reason,omitempty" db:"powershare_stop_reason"`
	PowershareHoursLeft        *int      `json:"powershare_hours_left,omitempty" db:"powershare_hours_left"`
	PowersharePowerKw          *float64  `json:"powershare_power_kw,omitempty" db:"powershare_power_kw"`
	CreatedAt                  time.Time `json:"created_at" db:"created_at"`
}

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
	GpsState               *bool     `json:"gps_state,omitempty" db:"gps_state"`
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
