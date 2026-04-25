package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// LiveStateRepo manages the vehicle_live_state table ╬ô├ç├╢ one row per vehicle
// with always-complete signal state, updated via UPSERT.
type LiveStateRepo struct {
	db *DB
}

// NewLiveStateRepo creates a new LiveStateRepo.
func NewLiveStateRepo(db *DB) *LiveStateRepo {
	return &LiveStateRepo{db: db}
}

// normalizeSignalValue unwraps wrapped signal values and converts types.
// Fleet Telemetry occasionally wraps values in {"value": X, "timestamp": "..."}
// objects (Bug 4), or sends {"invalid": true} markers.
// Returns the unwrapped value and whether it should be used.
func normalizeSignalValue(v interface{}) (interface{}, bool) {
	if v == nil {
		return nil, false
	}
	m, isMap := v.(map[string]interface{})
	if !isMap {
		return v, true
	}
	// Skip explicit invalid markers
	if inv, has := m["invalid"]; has {
		if b, isBool := inv.(bool); isBool && b {
			return nil, false
		}
	}
	// Unwrap {"value": X, ...} envelopes
	if inner, ok := m["value"]; ok {
		return inner, true
	}
	return nil, false
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
				cols = append(cols, "power_kw")
				vals = append(vals, power)
			}
		}
	}

	// Handle HvacPower (enum → boolean proxy for is_climate_on)
	if raw, ok := signals["HvacPower"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "is_climate_on")
			vals = append(vals, enums.ParseHvacPower(fmt.Sprintf("%v", v)))
		}
	}

	// Handle SentryMode (enum → boolean)
	if raw, ok := signals["SentryMode"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "sentry_mode")
			vals = append(vals, enums.ParseEnumBool(v))
		}
	}

	// Handle Locked (may be bool or string)
	if raw, ok := signals["Locked"]; ok {
		if v, use := normalizeSignalValue(raw); use {
			cols = append(cols, "locked")
			vals = append(vals, enums.ParseEnumBool(v))
		}
	}

	// Handle charging power: DC takes priority, AC is fallback
	if raw, ok := signals["DCChargingPower"]; ok {
		if f, fOk := toFloat64(raw); fOk {
			cols = append(cols, "charger_power_kw")
			vals = append(vals, f)
		}
	} else if raw, ok := signals["ACChargingPower"]; ok {
		if f, fOk := toFloat64(raw); fOk {
			cols = append(cols, "charger_power_kw")
			vals = append(vals, f)
		}
	}

	// Columns handled above — skip in generic signalToColumn loop
	skipCols := map[string]bool{
		"latitude": true, "longitude": true,
		"locked": true, "sentry_mode": true,
	}

	// Map all simple signals
	for signalName, colName := range SignalToColumn {
		if skipCols[colName] {
			continue
		}
		raw, ok := signals[signalName]
		if !ok || raw == nil {
			continue
		}

		// Normalize: unwrap map envelopes, skip invalid markers (Bug 4)
		v, use := normalizeSignalValue(raw)
		if !use || v == nil {
			continue
		}

		// Convert TPMS timestamp floats to time.Time (Bug 3)
		if IsTimestampCol[colName] {
			switch tv := v.(type) {
			case float64:
				if tv > 1e9 {
					sec := int64(tv)
					nsec := int64((tv - float64(sec)) * 1e9)
					v = time.Unix(sec, nsec).UTC()
				} else {
					continue // not a valid epoch
				}
			case string:
				// Try parsing as RFC3339 or unix timestamp string
				if t, err := time.Parse(time.RFC3339, tv); err == nil {
					v = t
				} else {
					continue
				}
			case time.Time:
				// Already correct type
			default:
				continue
			}
		}

		// Coerce value to match the Postgres column type.
		// Tesla sends booleans for some varchar columns (e.g., Setting24HourTime)
		// and floats for some timestamptz columns (e.g., TpmsLastSeenPressureTime*).
		switch v.(type) {
		case float64, int, int64, bool, string, time.Time:
			// OK ╬ô├ç├╢ these are base types pgx can handle
		default:
			continue
		}

		// For varchar columns, ensure we write a string (not bool/float).
		// pgx cannot encode bool→varchar or float→varchar directly.
		if IsVarcharCol[colName] {
			vals = append(vals, fmt.Sprintf("%v", v))
		} else if IsTimestampCol[colName] {
			// Already converted to time.Time above — just append
			vals = append(vals, v)
		} else {
			vals = append(vals, v)
		}
		cols = append(cols, colName)
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
		SELECT latitude, longitude, heading, gps_state, speed_mph, power_kw,
		       battery_level, charge_limit_soc,
		       inside_temp_c, outside_temp_c, is_climate_on, defrost_mode,
		       charger_voltage, charger_power_kw,
		       locked, sentry_mode
		FROM vehicle_live_state WHERE vehicle_id = $1`, vehicleID)

	var lat, lon, speedMph, powerKw *float64
	var insideT, outsideT, chargerV, chargerPowerKw *float64
	var gpsState, defrostMode *string
	var heading, battLvl, chargeLimitSoc *int
	var isClimateOn, locked, sentryMode *bool

	err := row.Scan(
		&lat, &lon, &heading, &gpsState, &speedMph, &powerKw,
		&battLvl, &chargeLimitSoc,
		&insideT, &outsideT, &isClimateOn, &defrostMode,
		&chargerV, &chargerPowerKw,
		&locked, &sentryMode,
	)
	if err != nil {
		return nil, err
	}

	result := make(map[string]interface{})
	if lat != nil { result["Latitude"] = *lat }
	if lon != nil { result["Longitude"] = *lon }
	if heading != nil { result["GpsHeading"] = *heading }
	if gpsState != nil { result["GpsState"] = *gpsState }
	if speedMph != nil { result["VehicleSpeed"] = *speedMph }
	if powerKw != nil { result["Power"] = *powerKw }
	if battLvl != nil { result["BatteryLevel"] = *battLvl }
	if chargeLimitSoc != nil { result["ChargeLimitSoc"] = *chargeLimitSoc }
	if insideT != nil { result["InsideTemp"] = *insideT }
	if outsideT != nil { result["OutsideTemp"] = *outsideT }
	if isClimateOn != nil { result["HvacPower"] = *isClimateOn }
	if defrostMode != nil { result["DefrostMode"] = *defrostMode }
	if chargerV != nil { result["ChargerVoltage"] = *chargerV }
	if chargerPowerKw != nil { result["DCChargingPower"] = *chargerPowerKw }
	if locked != nil { result["Locked"] = *locked }
	if sentryMode != nil { result["SentryMode"] = *sentryMode }

	return result, nil
}

func toFloat64(v interface{}) (float64, bool) {
	// Unwrap {"value": X} envelopes
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return 0, false
		}
	}
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
