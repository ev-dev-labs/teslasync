package charging

import "time"

// ChargingSession mirrors the SI-canonical `charging_sessions` schema introduced
// in migrations/000184_charging_si.up.sql.
//
// One row per charging session. EndedAt is NULL while a session is in progress.
// Nullable columns are pointer types; db/json tags match column names exactly.
type ChargingSession struct {
	ID                 int64      `db:"id" json:"id"`
	VehicleID          int64      `db:"vehicle_id" json:"vehicle_id"`
	StartedAt          time.Time  `db:"started_at" json:"started_at"`
	EndedAt            *time.Time `db:"ended_at" json:"ended_at"`
	StartSocPct        *float64   `db:"start_soc_pct" json:"start_soc_pct,omitempty"`
	EndSocPct          *float64   `db:"end_soc_pct" json:"end_soc_pct,omitempty"`
	DeltaSocPct        *float64   `db:"delta_soc_pct" json:"delta_soc_pct,omitempty"`
	StartOdometerM     *float64   `db:"start_odometer_m" json:"start_odometer_m,omitempty"`
	EndOdometerM       *float64   `db:"end_odometer_m" json:"end_odometer_m,omitempty"`
	StartLat           *float64   `db:"start_lat" json:"start_lat,omitempty"`
	StartLng           *float64   `db:"start_lng" json:"start_lng,omitempty"`
	StartPlace         *string    `db:"start_place" json:"start_place,omitempty"`
	TotalEnergyAddedWh *float64   `db:"total_energy_added_wh" json:"total_energy_added_wh,omitempty"`
	PeakPowerW         *float64   `db:"peak_power_w" json:"peak_power_w,omitempty"`
	AvgPowerW          *float64   `db:"avg_power_w" json:"avg_power_w,omitempty"`
	CostDecimal        *float64   `db:"cost_decimal" json:"cost_decimal,omitempty"`
	CostCurrency       *string    `db:"cost_currency" json:"cost_currency,omitempty"`
	ChargerType        *string    `db:"charger_type" json:"charger_type,omitempty"`
	CableType          *string    `db:"cable_type" json:"cable_type,omitempty"`

	// Charging-place pricing provenance (migration
	// 000228_geofence_charging_place_pricing). No DB-level FK on
	// GeofenceID/RateID — these are written from the async (post-completion)
	// leg of the telemetry charge tracker and must never be blocked by a
	// synchronous FK check, mirroring the existing no-FK precedent between
	// charging_telemetry and charging_sessions.id.
	//
	// GeofenceID is the charging place this session was matched (or
	// auto-discovered) to. RateID is the EXACT geofence_rates version whose
	// [effective_from, effective_to) interval contained StartedAt at the
	// moment cost was computed — pinning it (rather than re-deriving it from
	// StartedAt on every read) is what keeps a session's price frozen forever
	// even after the place's rate is corrected or superseded. CostSource
	// records provenance/precedence: "manual" > "tesla_actual" >
	// "geofence_tariff" > "default_estimate" > "unknown".
	GeofenceID *int64  `db:"geofence_id" json:"geofence_id,omitempty"`
	RateID     *int64  `db:"rate_id" json:"rate_id,omitempty"`
	CostSource *string `db:"cost_source" json:"cost_source,omitempty"`
}

// IsActive reports whether the charging session is still in progress
// (i.e. EndedAt has not been set yet).
func (c *ChargingSession) IsActive() bool { return c.EndedAt == nil }

func (c *ChargingSession) DurationMinutes() *float64 {
	if c.EndedAt == nil {
		return nil
	}
	v := c.EndedAt.Sub(c.StartedAt).Minutes()
	return &v
}

func (c *ChargingSession) DistanceAddedM() *float64 {
	if c.StartOdometerM == nil || c.EndOdometerM == nil {
		return nil
	}
	v := *c.EndOdometerM - *c.StartOdometerM
	return &v
}

// ChargeTelemetryReading mirrors the SI-canonical charging_telemetry table.
type ChargeTelemetryReading struct {
	VehicleID             int64     `json:"vehicle_id" db:"vehicle_id"`
	Ts                    time.Time `json:"ts" db:"ts"`
	SessionID             *int64    `json:"session_id,omitempty" db:"session_id"`
	ACChargingPowerW      *float64  `json:"ac_charging_power_w,omitempty" db:"ac_charging_power_w"`
	DCChargingPowerW      *float64  `json:"dc_charging_power_w,omitempty" db:"dc_charging_power_w"`
	ACChargingEnergyInWh  *float64  `json:"ac_charging_energy_in_wh,omitempty" db:"ac_charging_energy_in_wh"`
	DCChargingEnergyInWh  *float64  `json:"dc_charging_energy_in_wh,omitempty" db:"dc_charging_energy_in_wh"`
	ChargerVoltageV       *float64  `json:"charger_voltage_v,omitempty" db:"charger_voltage_v"`
	ChargerActualCurrentA *float64  `json:"charger_actual_current_a,omitempty" db:"charger_actual_current_a"`
	ChargerPilotCurrentA  *float64  `json:"charger_pilot_current_a,omitempty" db:"charger_pilot_current_a"`
	ChargerPhases         *int      `json:"charger_phases,omitempty" db:"charger_phases"`
	BatteryHeaterOn       *bool     `json:"battery_heater_on,omitempty" db:"battery_heater_on"`
	BatteryHeaterPowerW   *float64  `json:"battery_heater_power_w,omitempty" db:"battery_heater_power_w"`
	ChargeLimitSocPct     *float64  `json:"charge_limit_soc_pct,omitempty" db:"charge_limit_soc_pct"`
	ChargeRequest         *string   `json:"charge_request,omitempty" db:"charge_request"`
	FastChargerType       *string   `json:"fast_charger_type,omitempty" db:"fast_charger_type"`
	ChargingCableType     *string   `json:"charging_cable_type,omitempty" db:"charging_cable_type"`
	ChargePortDoorOpen    *bool     `json:"charge_port_door_open,omitempty" db:"charge_port_door_open"`
	ChargePortLatch       *string   `json:"charge_port_latch,omitempty" db:"charge_port_latch"`
}
