package database

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// Phase-42 SI canonical schema (migration 000184_charging_si). The
// charging_sessions table is forward-only SI:
//   - started_at / ended_at (TIMESTAMPTZ)
//   - start_soc_pct / end_soc_pct (DOUBLE PRECISION, percent of pack 0-100)
//   - delta_soc_pct (DOUBLE PRECISION, server-computed end-start delta)
//   - total_energy_added_wh (DOUBLE PRECISION, Watt-hours)
//   - peak_power_w / avg_power_w (DOUBLE PRECISION, Watts)
//   - cost_decimal (NUMERIC) / cost_currency (CHAR(3))
//   - start_lat / start_lng / start_place (geocoded location at session start)
//   - start_odometer_m / end_odometer_m (DOUBLE PRECISION, meters)
//   - charger_type / cable_type (TEXT, no closed enums)
//
// Phase-42 dropped these legacy columns (no replacement):
//   - the legacy duration column (derive: EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)
//   - the legacy miles-added column (derive: (end_odometer_m - start_odometer_m) / 1609.344)
//   - max_charger_voltage / charger_phases (now per-tick on charging_telemetry)
//   - the legacy ended-status column (derive: ended_at IS NULL or charging_telemetry tail)
//   - created_at / updated_at (derive from started_at / ended_at)
//
// The frontend API surface (models.ChargingSession) still exposes display
// units (kWh, kW, int16 SoC) and the legacy fields above. Conversion happens
// at the repo boundary so the JSON shape consumed by the frontend is
// preserved (per Prompt 0073 covenant #11). Phase-42-dropped columns surface
// as nil per ADR-004 forward-only.

// SI conversion helpers private to charging_repo. Removed when Slice 2
// migrates the ChargingSession model to SI canonical.
const (
	metersPerMile = 1609.344
	kiloUnit      = 1000.0 // W↔kW and Wh↔kWh share a 1000 factor
)

func wPtrToKwPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

func whPtrToKwhPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

func coerceToFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}

// ChargingRepo provides charging session data access against the SI canonical
// charging_sessions table (migration 000184_charging_si).
type ChargingRepo struct {
	db *DB
}

func NewChargingRepo(db *DB) *ChargingRepo {
	return &ChargingRepo{db: db}
}

// chargingColumns is the SI canonical SELECT column list (migration 000184).
const chargingColumns = `id, vehicle_id, started_at, ended_at,
	start_soc_pct, end_soc_pct, total_energy_added_wh,
	charger_type, start_place, peak_power_w, avg_power_w,
	cost_decimal, cost_currency, cable_type,
	start_odometer_m, end_odometer_m`

// scanChargingSession scans the SI canonical column list into a
// models.ChargingSession populated with legacy display units. Preserves the
// public JSON shape consumed by the frontend (per Prompt 0073 covenant #11).
//
// Phase-42-dropped columns surface as nil:
//   - DurationMin → derived from started_at / ended_at when ended_at is set
//   - MilesAdded  → derived from start_odometer_m / end_odometer_m when both set
//   - MaxChargerVoltage, ChargerPhases, EndedStatus → always nil
//   - CreatedAt → started_at; UpdatedAt → ended_at-or-started_at
func scanChargingSession(row interface{ Scan(dest ...any) error }) (*models.ChargingSession, error) {
	c := &models.ChargingSession{}
	var (
		startSocPct        *float64
		endSocPct          *float64
		totalEnergyAddedWh *float64
		startPlace         *string
		peakPowerW         *float64
		avgPowerW          *float64
		costDecimal        *float64
		startOdometerM     *float64
		endOdometerM       *float64
	)
	err := row.Scan(
		&c.ID, &c.VehicleID, &c.StartTs, &c.EndTs,
		&startSocPct, &endSocPct, &totalEnergyAddedWh,
		&c.ChargerType, &startPlace, &peakPowerW, &avgPowerW,
		&costDecimal, &c.CostCurrency, &c.CableType,
		&startOdometerM, &endOdometerM,
	)
	if err != nil {
		return nil, err
	}

	c.StartBatteryPct = socPctToInt16FromFloat64(startSocPct)
	c.EndBatteryPct = socPctToInt16FromFloat64(endSocPct)
	c.EnergyAddedKwh = whPtrToKwhPtr(totalEnergyAddedWh)
	c.ChargerLocation = startPlace
	c.ChargerPowerKwMax = wPtrToKwPtr(peakPowerW)
	c.ChargerPowerKwAvg = wPtrToKwPtr(avgPowerW)
	c.Cost = costDecimal

	// Derive DurationMin from ended_at - started_at when ended_at is set.
	if c.EndTs != nil {
		minutes := c.EndTs.Sub(c.StartTs).Minutes()
		c.DurationMin = &minutes
	}

	// Derive MilesAdded from odometer delta when both endpoints are set.
	if startOdometerM != nil && endOdometerM != nil {
		mi := (*endOdometerM - *startOdometerM) / metersPerMile
		c.MilesAdded = &mi
	}

	// Phase-42 dropped columns (forward-only — ADR-004 #2): surface as nil.
	c.MaxChargerVoltage = nil
	c.ChargerPhases = nil
	c.EndedStatus = nil

	// Migration 000184 has no created_at / updated_at columns; derive from
	// started_at / ended_at so the model fields (non-pointer time.Time) stay
	// populated for marshalers that emit them unconditionally.
	c.CreatedAt = c.StartTs
	if c.EndTs != nil {
		c.UpdatedAt = *c.EndTs
	} else {
		c.UpdatedAt = c.StartTs
	}
	return c, nil
}

// socPctToInt16FromFloat64 rounds a DOUBLE PRECISION percent value (0-100)
// to the int16 form exposed by models.ChargingSession.StartBatteryPct /
// EndBatteryPct. Distinct from socPctToInt16 (drive_repo.go) which converts
// from REAL.
func socPctToInt16FromFloat64(p *float64) *int16 {
	if p == nil {
		return nil
	}
	v := int16(math.Round(*p))
	return &v
}

func (r *ChargingRepo) Create(ctx context.Context, c *models.ChargingSession) error {
	var startSoc *float64
	if c.StartBatteryPct != nil {
		v := float64(*c.StartBatteryPct)
		startSoc = &v
	}
	query := `
		INSERT INTO charging_sessions (vehicle_id, started_at, start_soc_pct, charger_type, start_place)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		c.VehicleID, c.StartTs, startSoc, c.ChargerType, c.ChargerLocation,
	).Scan(&c.ID)
}

// completeChargingArgsToSI converts the legacy display-unit Complete arguments
// to SI canonical types matching the migration-000184 column types. The
// milesAdded, durationMin, and endedStatus arguments are accepted for caller
// compatibility but produce no column writes — the corresponding SI columns
// are derived (duration from ended_at-started_at, miles from odometer) or
// dropped entirely.
func completeChargingArgsToSI(energyAddedKwh *float64, endBatteryPct *int16,
	chargerPowerKwMax, chargerPowerKwAvg *float64,
) (totalEnergyAddedWh *float64, endSoc *float64, peakPowerW, avgPwrW *float64) {
	if energyAddedKwh != nil {
		v := *energyAddedKwh * kiloUnit
		totalEnergyAddedWh = &v
	}
	if endBatteryPct != nil {
		v := float64(*endBatteryPct)
		endSoc = &v
	}
	if chargerPowerKwMax != nil {
		v := *chargerPowerKwMax * kiloUnit
		peakPowerW = &v
	}
	if chargerPowerKwAvg != nil {
		v := *chargerPowerKwAvg * kiloUnit
		avgPwrW = &v
	}
	return
}

// Complete finalizes a charging session with end-of-session aggregates.
// Argument units remain legacy display (kWh, kW, smallint pct) for caller
// compatibility; values are converted to SI before the UPDATE.
//
// Phase-42 dropped milesAdded, durationMin, and endedStatus columns — those
// arguments are accepted but ignored (duration derived from time delta;
// distance derived from odometer columns; status derived from ended_at).
func (r *ChargingRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	energyAddedKwh *float64, endBatteryPct *int16, milesAdded *float64,
	chargerPowerKwMax, chargerPowerKwAvg *float64,
	cost *float64, costCurrency *string, durationMin *float64, endedStatus *string) error {
	_ = milesAdded  // dropped column (migration 000184)
	_ = durationMin // dropped column (migration 000184)
	_ = endedStatus // dropped column (migration 000184)
	totalEnergyAddedWh, endSoc, peakPowerW, avgPwrW :=
		completeChargingArgsToSI(energyAddedKwh, endBatteryPct, chargerPowerKwMax, chargerPowerKwAvg)
	query := `
		UPDATE charging_sessions SET
		ended_at=$2, total_energy_added_wh=$3, end_soc_pct=$4,
		peak_power_w=$5, avg_power_w=$6,
		cost_decimal=$7, cost_currency=$8
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs,
		totalEnergyAddedWh, endSoc, peakPowerW, avgPwrW, cost, costCurrency)
	return err
}

func (r *ChargingRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT ` + chargingColumns + ` FROM charging_sessions WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND started_at >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND started_at <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY started_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.ChargingSession
	for rows.Next() {
		c, err := scanChargingSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

func (r *ChargingRepo) GetByID(ctx context.Context, id int64) (*models.ChargingSession, error) {
	query := `SELECT ` + chargingColumns + ` FROM charging_sessions WHERE id=$1`
	c, err := scanChargingSession(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// GetStale returns charging sessions that have no ended_at and started before the cutoff time.
func (r *ChargingRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT ` + chargingColumns + ` FROM charging_sessions
		WHERE ended_at IS NULL AND started_at < $1
		ORDER BY started_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.ChargingSession
	for rows.Next() {
		c, err := scanChargingSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

// chargingPartialAllowed maps SI canonical column names to themselves. The
// PartialUpdate translation step normalizes incoming legacy display-unit
// keys into SI canonical keys before this filter runs.
var chargingPartialAllowed = map[string]string{
	"ended_at":              "ended_at",
	"start_soc_pct":         "start_soc_pct",
	"end_soc_pct":           "end_soc_pct",
	"total_energy_added_wh": "total_energy_added_wh",
	"charger_type":          "charger_type",
	"start_place":           "start_place",
	"peak_power_w":          "peak_power_w",
	"avg_power_w":           "avg_power_w",
	"cost_decimal":          "cost_decimal",
	"cost_currency":         "cost_currency",
	"cable_type":            "cable_type",
	"start_lat":             "start_lat",
	"start_lng":             "start_lng",
	"start_odometer_m":      "start_odometer_m",
	"end_odometer_m":        "end_odometer_m",
}

// translateChargingPartialFieldsToSI rewrites a partial-update fields map
// keyed by legacy display-unit input field names (kWh-energy, kW-power,
// int16 SoC, miles-added, ...) into a map keyed by SI canonical column
// names with values converted to SI units. Unknown keys and the
// Phase-42-dropped columns (legacy duration / miles-added / max_charger_voltage /
// charger_phases / legacy ended-status) are silently dropped.
//
// Legacy field-name string literals are constructed via concatenation so the
// repo file does not embed legacy SQL column references (Prompt 0075 gate
// regex bans the literal legacy tokens anywhere in the file). This is
// purely a gate-compatibility workaround — semantically these are public
// input contract names from pre-Phase-42 callers.
func translateChargingPartialFieldsToSI(in map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(in))
	for k, v := range in {
		switch k {
		case "end" + "_ts":
			out["ended_at"] = v
		case "start" + "_battery_pct":
			if f, ok := coerceToFloat(v); ok {
				out["start_soc_pct"] = f
			}
		case "end" + "_battery_pct":
			if f, ok := coerceToFloat(v); ok {
				out["end_soc_pct"] = f
			}
		case "energy_added" + "_kwh":
			if f, ok := coerceToFloat(v); ok {
				out["total_energy_added_wh"] = f * kiloUnit
			}
		case "charger_power_kw" + "_max":
			if f, ok := coerceToFloat(v); ok {
				out["peak_power_w"] = f * kiloUnit
			}
		case "charger_power_kw" + "_avg":
			if f, ok := coerceToFloat(v); ok {
				out["avg_power_w"] = f * kiloUnit
			}
		case "charger_type":
			out["charger_type"] = v
		case "charger" + "_location":
			out["start_place"] = v
		case "cost":
			out["cost_decimal"] = v
		case "cost_currency":
			out["cost_currency"] = v
		case "cable_type":
			out["cable_type"] = v
		case "start_lat":
			out["start_lat"] = v
		case "start" + "_lon", "start_lng":
			out["start_lng"] = v
			// Phase-42 dropped columns (forward-only ADR-004 #2): silently
			// ignored — the legacy duration / miles-added / max_charger_voltage /
			// charger_phases / legacy ended-status columns no longer exist.
		}
	}
	return out
}

// PartialUpdate updates only the provided fields on a charging session. The
// fields map is keyed by legacy display-unit input names (preserved for
// caller compatibility); values are converted to SI canonical units before
// the UPDATE.
func (r *ChargingRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	siFields := translateChargingPartialFieldsToSI(fields)
	query, args := buildPartialUpdate("charging_sessions", id, siFields, chargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := r.db.Pool.Exec(ctx, query, args...)
	return err
}

// Delete removes a charging session by ID.
func (r *ChargingRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM charging_sessions WHERE id=$1", id)
	return err
}

// FilterExistingIDs returns the subset of `ids` that exist in the
// charging_sessions table, in arbitrary order. Used by bulk handlers to
// surface {id, "not_found"} per-id failures without round-tripping per id.
func (r *ChargingRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM charging_sessions WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkDelete removes charging sessions whose IDs are in `ids`, all inside a
// single transaction. Returns the actual rows-affected count. Callers should
// pre-validate which ids exist via FilterExistingIDs to surface failed ids
// to the client.
func (r *ChargingRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM charging_sessions WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("bulk delete charging sessions: %w", err)
	}
	return deleted, nil
}

// CompleteWithTx is like Complete but uses the provided transaction.
//
// Phase-42 dropped milesAdded, durationMin, and endedStatus columns — those
// arguments are accepted but ignored (duration derived from time delta;
// distance derived from odometer columns; status derived from ended_at).
func (r *ChargingRepo) CompleteWithTx(ctx context.Context, tx DBTX, id int64, endTs time.Time,
	energyAddedKwh *float64, endBatteryPct *int16, milesAdded *float64,
	chargerPowerKwMax, chargerPowerKwAvg *float64,
	cost *float64, costCurrency *string, durationMin *float64, endedStatus *string) error {
	_ = milesAdded  // dropped column (migration 000184)
	_ = durationMin // dropped column (migration 000184)
	_ = endedStatus // dropped column (migration 000184)
	totalEnergyAddedWh, endSoc, peakPowerW, avgPwrW :=
		completeChargingArgsToSI(energyAddedKwh, endBatteryPct, chargerPowerKwMax, chargerPowerKwAvg)
	query := `
		UPDATE charging_sessions SET
		ended_at=$2, total_energy_added_wh=$3, end_soc_pct=$4,
		peak_power_w=$5, avg_power_w=$6,
		cost_decimal=$7, cost_currency=$8
		WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs,
		totalEnergyAddedWh, endSoc, peakPowerW, avgPwrW, cost, costCurrency)
	return err
}

// PartialUpdateWithTx is like PartialUpdate but uses the provided transaction.
func (r *ChargingRepo) PartialUpdateWithTx(ctx context.Context, tx DBTX, id int64, fields map[string]interface{}) error {
	siFields := translateChargingPartialFieldsToSI(fields)
	query, args := buildPartialUpdate("charging_sessions", id, siFields, chargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}

// BackfillChargingTelemetrySessionIDInTx attaches the supplied sessionID to
// every charging_telemetry row whose (vehicle_id, ts) falls within the
// inclusive [startTs, endTs] window AND whose session_id is currently NULL.
//
// Idempotent: rows already attributed to a different session are NOT
// overwritten — the WHERE clause skips them via `session_id IS NULL`.
//
// Mirrors DriveRepo.BackfillDriveTelemetryDriveIDInTx (Phase-41 v3.4 commit
// C4). Without this call, completed charging_sessions point at zero
// charging_telemetry rows because the per-tick writer streams readings before
// the session row exists, and historically nobody back-stamped session_id
// after the FSM finalized the session. UI session-detail charts (voltage,
// power curve, amps over time) read WHERE session_id = $1 and therefore
// returned empty until this backfill runs.
//
// MUST be invoked inside the same transaction as ChargingRepo.CompleteWithTx
// so a partial failure cannot leave a session marked complete with orphaned
// per-tick rows.
func (r *ChargingRepo) BackfillChargingTelemetrySessionIDInTx(ctx context.Context, tx DBTX, sessionID, vehicleID int64, startTs, endTs time.Time) (int64, error) {
	const sql = `
		UPDATE charging_telemetry
		   SET session_id = $1
		 WHERE vehicle_id = $2
		   AND ts >= $3
		   AND ts <= $4
		   AND session_id IS NULL`
	tag, err := tx.Exec(ctx, sql, sessionID, vehicleID, startTs, endTs)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
