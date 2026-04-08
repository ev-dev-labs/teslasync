package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// LiveStateRepo manages the vehicle_live_state table — one row per vehicle
// with always-complete signal state, updated via UPSERT.
type LiveStateRepo struct {
	db *DB
}

// NewLiveStateRepo creates a new LiveStateRepo.
func NewLiveStateRepo(db *DB) *LiveStateRepo {
	return &LiveStateRepo{db: db}
}

// signalToColumn maps Tesla signal names to vehicle_live_state column names.
var signalToColumn = map[string]string{
	// Location
	"Latitude":  "latitude",
	"Longitude": "longitude",
	"GpsHeading": "heading",
	"GpsState":  "gps_state",

	// Driving
	"VehicleSpeed":   "speed",
	"Odometer":       "odometer",
	"Gear":           "gear",
	"PedalPosition":  "pedal_position",
	"BrakePedal":     "brake_pedal",

	// Battery / Range
	"BatteryLevel":    "battery_level",
	"Soc":             "soc",
	"IdealBatteryRange": "ideal_range",
	"RatedRange":      "rated_range",
	"EstBatteryRange": "est_range",
	"EnergyRemaining": "energy_remaining",

	// Climate
	"InsideTemp":  "inside_temp",
	"OutsideTemp": "outside_temp",

	// Charging
	"ChargeState":         "charge_state",
	"DetailedChargeState": "detailed_charge_state",
	"ChargerVoltage":      "charger_voltage",
	"ChargeAmps":          "charge_amps",
	"ChargeRateMilePerHour": "charge_rate",
	"DCChargingPower":     "charger_power",
	"ACChargingPower":     "charger_power",
	"ChargeLimitSoc":      "charge_limit_soc",
	"TimeToFullCharge":    "time_to_full_charge",
	"ChargingCableType":   "charging_cable_type",

	// Security
	"Locked":       "locked",
	"SentryMode":   "sentry_mode",
	"DoorState":    "door_state",
	"FdWindow":     "fd_window",
	"FpWindow":     "fp_window",
	"RdWindow":     "rd_window",
	"RpWindow":     "rp_window",
	"CenterDisplay": "center_display",

	// Tire Pressure
	"TpmsPressureFl": "tire_pressure_fl",
	"TpmsPressureFr": "tire_pressure_fr",
	"TpmsPressureRl": "tire_pressure_rl",
	"TpmsPressureRr": "tire_pressure_rr",

	// Vehicle Info
	"VehicleName":   "vehicle_name",
	"CarType":       "car_type",
	"Version":       "version",
	"WheelType":     "wheel_type",
	"ExteriorColor": "exterior_color",
}

// FlushLiveState upserts the vehicle's live state into vehicle_live_state.
// Only columns with non-nil values in the signals map are updated.
func (r *LiveStateRepo) FlushLiveState(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	// Collect column names and values; parameter indices are computed at the
	// end so INSERT and ON CONFLICT UPDATE use identical numbering.
	cols := []string{}
	vals := []interface{}{}

	// Handle Location (JSON object with latitude/longitude)
	if loc, ok := signals["Location"].(map[string]interface{}); ok {
		if lat, ok := loc["latitude"]; ok {
			cols = append(cols, "latitude")
			vals = append(vals, lat)
		}
		if lon, ok := loc["longitude"]; ok {
			cols = append(cols, "longitude")
			vals = append(vals, lon)
		}
	}

	// Handle computed power
	if _, hasPV := signals["PackVoltage"]; hasPV {
		if _, hasPC := signals["PackCurrent"]; hasPC {
			pv, pvOk := toFloat64(signals["PackVoltage"])
			pc, pcOk := toFloat64(signals["PackCurrent"])
			if pvOk && pcOk {
				power := pv * pc / 1000.0
				cols = append(cols, "power")
				vals = append(vals, power)
			}
		}
	}

	// Handle HvacPower (enum → boolean)
	if v, ok := signals["HvacPower"]; ok {
		s := fmt.Sprintf("%v", v)
		isOn := strings.Contains(s, "On") || strings.Contains(s, "Precondition")
		cols = append(cols, "hvac_power")
		vals = append(vals, isOn)
	}

	// Handle HvacFanSpeed
	if v, ok := signals["HvacFanSpeed"]; ok {
		cols = append(cols, "fan_speed")
		vals = append(vals, v)
	}

	// Handle SentryMode (enum → boolean)
	if v, ok := signals["SentryMode"]; ok {
		s := fmt.Sprintf("%v", v)
		isActive := !strings.Contains(s, "Off") && s != "" && s != "false" && s != "0"
		cols = append(cols, "sentry_mode")
		vals = append(vals, isActive)
	}

	// Handle Locked (may be bool or string)
	if v, ok := signals["Locked"]; ok {
		locked := false
		switch lv := v.(type) {
		case bool:
			locked = lv
		case string:
			locked = lv == "true" || lv == "1"
		}
		cols = append(cols, "locked")
		vals = append(vals, locked)
	}

	// Map all simple signals
	for signalName, colName := range signalToColumn {
		// Skip signals already handled above
		if colName == "latitude" || colName == "longitude" || colName == "locked" || colName == "sentry_mode" {
			continue
		}
		v, ok := signals[signalName]
		if !ok || v == nil {
			continue
		}
		// Skip invalid markers
		if m, isMap := v.(map[string]interface{}); isMap {
			if inv, has := m["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}
		// Validate type: skip values that would cause Postgres type mismatches.
		// Fleet Telemetry can occasionally produce time.Time or string values
		// for columns that expect numeric/boolean types.
		switch v.(type) {
		case float64, int, int64, bool, string:
			// OK — these are the types pgx can handle for the live_state columns
		default:
			// Skip unexpected types (e.g., time.Time, map, slice)
			continue
		}
		cols = append(cols, colName)
		vals = append(vals, v)
	}

	if len(cols) == 0 {
		return nil // nothing to update
	}

	// Always update updated_at
	cols = append(cols, "updated_at")
	vals = append(vals, time.Now().UTC())

	// Build parameter placeholders and update clauses using the same indices.
	// $1 is vehicle_id; column values start at $2.
	colList := strings.Join(cols, ", ")
	placeholders := make([]string, len(cols))
	updates := make([]string, len(cols))
	for i, col := range cols {
		idx := i + 2 // $1 is vehicle_id
		placeholders[i] = fmt.Sprintf("$%d", idx)
		updates[i] = fmt.Sprintf("%s = $%d", col, idx)
	}

	query := fmt.Sprintf(
		`INSERT INTO vehicle_live_state (vehicle_id, %s) VALUES ($1, %s)
		 ON CONFLICT (vehicle_id) DO UPDATE SET %s`,
		colList,
		strings.Join(placeholders, ", "),
		strings.Join(updates, ", "),
	)

	allVals := make([]interface{}, 0, 1+len(vals))
	allVals = append(allVals, vehicleID)
	allVals = append(allVals, vals...)

	_, err := r.db.Pool.Exec(ctx, query, allVals...)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Int("cols", len(cols)).Msg("live_state: flush failed")
	}
	return err
}

// LoadLiveState reads the vehicle_live_state row into a signal map.
// Used to recover in-memory state after a pod restart.
func (r *LiveStateRepo) LoadLiveState(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	row := r.db.Pool.QueryRow(ctx, `
		SELECT latitude, longitude, heading, speed, power, odometer, gear,
		       battery_level, soc, ideal_range, rated_range, est_range, energy_remaining,
		       inside_temp, outside_temp, hvac_power, fan_speed,
		       charge_state, detailed_charge_state, charger_voltage, charge_amps,
		       charge_rate, charger_power, charge_limit_soc, time_to_full_charge,
		       locked, sentry_mode, door_state, center_display,
		       tire_pressure_fl, tire_pressure_fr, tire_pressure_rl, tire_pressure_rr,
		       vehicle_name, car_type, version
		FROM vehicle_live_state WHERE vehicle_id = $1`, vehicleID)

	var lat, lon, speed, power, odo, idealR, ratedR, estR, energyRem *float64
	var insideT, outsideT, chargerV, chargeAmps, chargeRate, chargerPower, ttfc *float64
	var tpFL, tpFR, tpRL, tpRR *float64
	var heading, battLvl, fanSpeed, chargeLimitSoc *int
	var soc *float64
	var gear, chargeState, detailedCS, doorState, centerDisp *string
	var vehicleName, carType, version *string
	var hvacPower, locked, sentryMode *bool

	err := row.Scan(
		&lat, &lon, &heading, &speed, &power, &odo, &gear,
		&battLvl, &soc, &idealR, &ratedR, &estR, &energyRem,
		&insideT, &outsideT, &hvacPower, &fanSpeed,
		&chargeState, &detailedCS, &chargerV, &chargeAmps,
		&chargeRate, &chargerPower, &chargeLimitSoc, &ttfc,
		&locked, &sentryMode, &doorState, &centerDisp,
		&tpFL, &tpFR, &tpRL, &tpRR,
		&vehicleName, &carType, &version,
	)
	if err != nil {
		return nil, err
	}

	result := make(map[string]interface{})
	if lat != nil { result["Latitude"] = *lat }
	if lon != nil { result["Longitude"] = *lon }
	if heading != nil { result["GpsHeading"] = *heading }
	if speed != nil { result["VehicleSpeed"] = *speed }
	if power != nil { result["Power"] = *power }
	if odo != nil { result["Odometer"] = *odo }
	if gear != nil { result["Gear"] = *gear }
	if battLvl != nil { result["BatteryLevel"] = *battLvl }
	if soc != nil { result["Soc"] = *soc }
	if idealR != nil { result["IdealBatteryRange"] = *idealR }
	if ratedR != nil { result["RatedRange"] = *ratedR }
	if estR != nil { result["EstBatteryRange"] = *estR }
	if energyRem != nil { result["EnergyRemaining"] = *energyRem }
	if insideT != nil { result["InsideTemp"] = *insideT }
	if outsideT != nil { result["OutsideTemp"] = *outsideT }
	if hvacPower != nil { result["HvacPower"] = *hvacPower }
	if fanSpeed != nil { result["HvacFanSpeed"] = *fanSpeed }
	if chargeState != nil { result["ChargeState"] = *chargeState }
	if detailedCS != nil { result["DetailedChargeState"] = *detailedCS }
	if chargerV != nil { result["ChargerVoltage"] = *chargerV }
	if chargeAmps != nil { result["ChargeAmps"] = *chargeAmps }
	if chargeRate != nil { result["ChargeRateMilePerHour"] = *chargeRate }
	if chargerPower != nil { result["ChargingPower"] = *chargerPower }
	if chargeLimitSoc != nil { result["ChargeLimitSoc"] = *chargeLimitSoc }
	if ttfc != nil { result["TimeToFullCharge"] = *ttfc }
	if locked != nil { result["Locked"] = *locked }
	if sentryMode != nil { result["SentryMode"] = *sentryMode }
	if doorState != nil { result["DoorState"] = *doorState }
	if centerDisp != nil { result["CenterDisplay"] = *centerDisp }
	if tpFL != nil { result["TpmsPressureFl"] = *tpFL }
	if tpFR != nil { result["TpmsPressureFr"] = *tpFR }
	if tpRL != nil { result["TpmsPressureRl"] = *tpRL }
	if tpRR != nil { result["TpmsPressureRr"] = *tpRR }
	if vehicleName != nil { result["VehicleName"] = *vehicleName }
	if carType != nil { result["CarType"] = *carType }
	if version != nil { result["Version"] = *version }

	return result, nil
}

func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	}
	return 0, false
}
