package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models/settings"
	"github.com/jackc/pgx/v5"
)

// Endpoint controls are installation-wide flags, not per-vehicle polling intervals.
// Keep the persisted JSONB shape restricted to Fleet API switches;
// LegacyPollingConfig's MongoDB capture fields are response-only compatibility.
const endpointControlsKey = "fleet_api_endpoint_controls"

type endpointControls struct {
	AutoPollingEnabled       bool            `json:"auto_polling_enabled"`
	FleetEndpoints           map[string]bool `json:"fleet_endpoints"`
	AutoEndpoints            map[string]bool `json:"auto_endpoints"`
	VehicleDiscovery         bool            `json:"vehicle_discovery"`
	ChargeState              bool            `json:"charge_state"`
	ClimateState             bool            `json:"climate_state"`
	DriveState               bool            `json:"drive_state"`
	LocationData             bool            `json:"location_data"`
	VehicleState             bool            `json:"vehicle_state"`
	VehicleConfig            bool            `json:"vehicle_config"`
	OnDemandVehicleDiscovery bool            `json:"on_demand_vehicle_discovery"`
	OnDemandChargeState      bool            `json:"on_demand_charge_state"`
	OnDemandClimateState     bool            `json:"on_demand_climate_state"`
	OnDemandDriveState       bool            `json:"on_demand_drive_state"`
	OnDemandLocationData     bool            `json:"on_demand_location_data"`
	OnDemandVehicleState     bool            `json:"on_demand_vehicle_state"`
	OnDemandVehicleConfig    bool            `json:"on_demand_vehicle_config"`
	NearbyChargingSites      bool            `json:"nearby_charging_sites"`
	ReleaseNotes             bool            `json:"release_notes"`
	RecentAlerts             bool            `json:"recent_alerts"`
	ServiceData              bool            `json:"service_data"`
	WakeUp                   bool            `json:"wake_up"`
	Commands                 bool            `json:"commands"`
}

func endpointControlsFrom(pc settings.LegacyPollingConfig) endpointControls {
	return endpointControls{
		AutoPollingEnabled:       pc.AutoPollingEnabled,
		FleetEndpoints:           pc.FleetEndpoints,
		AutoEndpoints:            pc.AutoEndpoints,
		VehicleDiscovery:         pc.VehicleDiscovery,
		ChargeState:              pc.ChargeState,
		ClimateState:             pc.ClimateState,
		DriveState:               pc.DriveState,
		LocationData:             pc.LocationData,
		VehicleState:             pc.VehicleState,
		VehicleConfig:            pc.VehicleConfig,
		OnDemandVehicleDiscovery: pc.OnDemandVehicleDiscovery,
		OnDemandChargeState:      pc.OnDemandChargeState,
		OnDemandClimateState:     pc.OnDemandClimateState,
		OnDemandDriveState:       pc.OnDemandDriveState,
		OnDemandLocationData:     pc.OnDemandLocationData,
		OnDemandVehicleState:     pc.OnDemandVehicleState,
		OnDemandVehicleConfig:    pc.OnDemandVehicleConfig,
		NearbyChargingSites:      pc.NearbyChargingSites,
		ReleaseNotes:             pc.ReleaseNotes,
		RecentAlerts:             pc.RecentAlerts,
		ServiceData:              pc.ServiceData,
		WakeUp:                   pc.WakeUp,
		Commands:                 pc.Commands,
	}
}

func (r *SettingsRepo) GetEndpointControls(ctx context.Context) (settings.LegacyPollingConfig, error) {
	pc := settings.DefaultPollingConfig()
	var raw []byte
	err := r.db.Pool.QueryRow(ctx,
		`SELECT value_jsonb FROM settings WHERE key = $1`, endpointControlsKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return pc, nil
	}
	if err != nil {
		return pc, fmt.Errorf("get endpoint controls: %w", err)
	}
	if len(raw) == 0 || string(raw) == "null" {
		return pc, errors.New("endpoint controls row has no configuration")
	}
	if err := json.Unmarshal(raw, &pc); err != nil {
		return pc, fmt.Errorf("decode endpoint controls: %w", err)
	}
	// Raw MongoDB capture is not implemented by this configuration. Never
	// advertise it as enabled, even if an old row contains that property.
	pc.TelemetryCapture = false
	pc.TelemetryCaptureRetentionDays = 7
	return pc, nil
}

func (r *SettingsRepo) UpsertEndpointControls(ctx context.Context, pc settings.LegacyPollingConfig) error {
	raw, err := json.Marshal(endpointControlsFrom(pc))
	if err != nil {
		return fmt.Errorf("encode endpoint controls: %w", err)
	}
	_, err = r.db.Pool.Exec(ctx, `
		INSERT INTO settings (key, value_jsonb, data_kind)
		VALUES ($1, $2::jsonb, 'jsonb')
		ON CONFLICT (key) DO UPDATE SET
			value_jsonb = EXCLUDED.value_jsonb, value_text = NULL,
			value_num = NULL, value_bool = NULL, data_kind = 'jsonb'`,
		endpointControlsKey, raw)
	if err != nil {
		return fmt.Errorf("upsert endpoint controls: %w", err)
	}
	return nil
}
