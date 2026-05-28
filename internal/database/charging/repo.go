package charging

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/jackc/pgx/v5"
)

// ChargingRepo provides charging session data access against the SI canonical
// charging_sessions table (migration 000184_charging_si). Phase-48 Slice 2
// removes the former translation layer; callers pass and receive SI fields.
type ChargingRepo struct {
	db *database.DB
}

func NewChargingRepo(db *database.DB) *ChargingRepo {
	return &ChargingRepo{db: db}
}

const chargingColumns = `id, vehicle_id, started_at, ended_at,
start_soc_pct, end_soc_pct, delta_soc_pct,
start_odometer_m, end_odometer_m, start_lat, start_lng,
start_place, total_energy_added_wh, peak_power_w, avg_power_w,
cost_decimal, cost_currency, cable_type, charger_type`

func scanChargingSession(row interface{ Scan(dest ...any) error }) (*chargingmodel.ChargingSession, error) {
	c := &chargingmodel.ChargingSession{}
	err := row.Scan(
		&c.ID, &c.VehicleID, &c.StartedAt, &c.EndedAt,
		&c.StartSocPct, &c.EndSocPct, &c.DeltaSocPct,
		&c.StartOdometerM, &c.EndOdometerM, &c.StartLat, &c.StartLng,
		&c.StartPlace, &c.TotalEnergyAddedWh, &c.PeakPowerW, &c.AvgPowerW,
		&c.CostDecimal, &c.CostCurrency, &c.CableType, &c.ChargerType,
	)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (r *ChargingRepo) Create(ctx context.Context, c *chargingmodel.ChargingSession) error {
	query := `
INSERT INTO charging_sessions (vehicle_id, started_at, start_soc_pct, charger_type, start_place, start_lat, start_lng, start_odometer_m)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		c.VehicleID, c.StartedAt, c.StartSocPct, c.ChargerType, c.StartPlace, c.StartLat, c.StartLng, c.StartOdometerM,
	).Scan(&c.ID)
}

func (r *ChargingRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	totalEnergyAddedWh *float64, endSocPct *float64, peakPowerW, avgPowerW *float64,
	costDecimal *float64, costCurrency *string) error {
	query := `
UPDATE charging_sessions SET
ended_at=$2, total_energy_added_wh=$3, end_soc_pct=$4,
delta_soc_pct = CASE WHEN start_soc_pct IS NOT NULL AND $4::double precision IS NOT NULL THEN $4::double precision - start_soc_pct ELSE delta_soc_pct END,
peak_power_w=$5, avg_power_w=$6,
cost_decimal=$7, cost_currency=$8
WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs,
		totalEnergyAddedWh, endSocPct, peakPowerW, avgPowerW, costDecimal, costCurrency)
	return err
}

func (r *ChargingRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*chargingmodel.ChargingSession, error) {
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

	var sessions []*chargingmodel.ChargingSession
	for rows.Next() {
		c, err := scanChargingSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

func (r *ChargingRepo) GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error) {
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

func (r *ChargingRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, error) {
	query := `SELECT ` + chargingColumns + ` FROM charging_sessions
WHERE ended_at IS NULL AND started_at < $1
ORDER BY started_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*chargingmodel.ChargingSession
	for rows.Next() {
		c, err := scanChargingSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

var ChargingPartialAllowed = map[string]string{
	"ended_at":              "ended_at",
	"start_soc_pct":         "start_soc_pct",
	"end_soc_pct":           "end_soc_pct",
	"delta_soc_pct":         "delta_soc_pct",
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

func filterChargingPartialFields(in map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(in))
	for k, v := range in {
		if _, ok := ChargingPartialAllowed[k]; ok {
			out[k] = v
		}
	}
	return out
}

func (r *ChargingRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	siFields := filterChargingPartialFields(fields)
	query, args := database.BuildPartialUpdate("charging_sessions", id, siFields, ChargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := r.db.Pool.Exec(ctx, query, args...)
	return err
}

func (r *ChargingRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM charging_sessions WHERE id=$1", id)
	return err
}

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

func (r *ChargingRepo) CompleteWithTx(ctx context.Context, tx database.DBTX, id int64, endTs time.Time,
	totalEnergyAddedWh *float64, endSocPct *float64, peakPowerW, avgPowerW *float64,
	costDecimal *float64, costCurrency *string) error {
	query := `
UPDATE charging_sessions SET
ended_at=$2, total_energy_added_wh=$3, end_soc_pct=$4,
delta_soc_pct = CASE WHEN start_soc_pct IS NOT NULL AND $4::double precision IS NOT NULL THEN $4::double precision - start_soc_pct ELSE delta_soc_pct END,
peak_power_w=$5, avg_power_w=$6,
cost_decimal=$7, cost_currency=$8
WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs,
		totalEnergyAddedWh, endSocPct, peakPowerW, avgPowerW, costDecimal, costCurrency)
	return err
}

func (r *ChargingRepo) PartialUpdateWithTx(ctx context.Context, tx database.DBTX, id int64, fields map[string]interface{}) error {
	siFields := filterChargingPartialFields(fields)
	query, args := database.BuildPartialUpdate("charging_sessions", id, siFields, ChargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}

func (r *ChargingRepo) BackfillChargingTelemetrySessionIDInTx(ctx context.Context, tx database.DBTX, sessionID, vehicleID int64, startTs, endTs time.Time) (int64, error) {
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
