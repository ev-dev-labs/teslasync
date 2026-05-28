package tesla

import "time"

// EnergySite represents a Tesla energy product (Powerwall, Solar Roof, Wall Connector).
// Discovered via GET /api/1/products and persisted for reference by other energy endpoints.
//
// Caller alias: imported as `teslamodel`, so original name `TeslaEnergySite`
// stays as `teslamodel.TeslaEnergySite` per the >5-caller bisectability rule.
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
