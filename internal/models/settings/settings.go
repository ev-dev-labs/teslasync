package settings

import "strings"

// LegacySettings stores application-level user settings.
//
// Deprecated: superseded by the typed key-value `Setting` struct in
// internal/models system.go, which mirrors the post-migration `settings`
// table. Retained temporarily so that internal/database/settings_repo.go
// and internal/api/settings_handler.go continue to build; these will be
// rewritten in phase-5 prompts 30-66.
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
// The order is stable and a nil receiver yields nil (nil-safe for callers that
// hold a *LegacyPollingConfig, as the worker does).
func (pc *LegacyPollingConfig) EnabledVehicleDataEndpoints() []string {
	if pc == nil {
		return nil
	}
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

// VehicleDataEndpointsString returns enabled sub-endpoints as a semicolon-separated
// string. A nil receiver yields an empty string.
func (pc *LegacyPollingConfig) VehicleDataEndpointsString() string {
	return strings.Join(pc.EnabledVehicleDataEndpoints(), ";")
}

// HasAnyVehicleDataEndpoint returns true if at least one vehicle_data sub-endpoint is
// enabled. It considers only the automatic polling flags, not their on-demand
// counterparts. A nil receiver returns false.
func (pc *LegacyPollingConfig) HasAnyVehicleDataEndpoint() bool {
	if pc == nil {
		return false
	}
	return pc.ChargeState || pc.ClimateState || pc.DriveState ||
		pc.LocationData || pc.VehicleState || pc.VehicleConfig
}

// EnabledOnDemandVehicleDataEndpoints returns the list of enabled on-demand
// vehicle_data sub-endpoints. The order mirrors EnabledVehicleDataEndpoints and a
// nil receiver yields nil.
func (pc *LegacyPollingConfig) EnabledOnDemandVehicleDataEndpoints() []string {
	if pc == nil {
		return nil
	}
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
