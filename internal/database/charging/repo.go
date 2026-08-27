package charging

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// ChargingRepo provides charging session data access against the SI canonical
// charging_sessions table (migration 000184_charging_si). The former translation
// layer is gone; callers pass and receive SI fields.
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
cost_decimal, cost_currency, cable_type, charger_type,
geofence_id, rate_id, cost_source`

func scanChargingSession(row interface{ Scan(dest ...any) error }) (*chargingmodel.ChargingSession, error) {
	c := &chargingmodel.ChargingSession{}
	err := row.Scan(
		&c.ID, &c.VehicleID, &c.StartedAt, &c.EndedAt,
		&c.StartSocPct, &c.EndSocPct, &c.DeltaSocPct,
		&c.StartOdometerM, &c.EndOdometerM, &c.StartLat, &c.StartLng,
		&c.StartPlace, &c.TotalEnergyAddedWh, &c.PeakPowerW, &c.AvgPowerW,
		&c.CostDecimal, &c.CostCurrency, &c.CableType, &c.ChargerType,
		&c.GeofenceID, &c.RateID, &c.CostSource,
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
cost_decimal=COALESCE($7, cost_decimal),
cost_currency=COALESCE($8, cost_currency)
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
	// ID is a deterministic tie-breaker for sessions with the same
	// telemetry timestamp, keeping offset pagination stable between requests.
	query += fmt.Sprintf(" ORDER BY started_at DESC, id DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.resolveCurrentGeofenceNames(ctx, sessions); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).
			Msg("charging sessions: failed to resolve current geofence names")
	}
	return sessions, nil
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
	if err := r.resolveCurrentGeofenceNames(ctx, []*chargingmodel.ChargingSession{c}); err != nil {
		log.Warn().Err(err).Int64("session_id", id).
			Msg("charging session: failed to resolve current geofence name")
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.resolveCurrentGeofenceNames(ctx, sessions); err != nil {
		log.Warn().Err(err).Msg("stale charging sessions: failed to resolve current geofence names")
	}
	return sessions, nil
}

// GetOpenSince returns open charging sessions that started at or after cutoff.
// Restart recovery restores only these plausible live sessions; abandoned
// historical rows remain available for evidence-based operator review.
func (r *ChargingRepo) GetOpenSince(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, error) {
	query := `SELECT ` + chargingColumns + ` FROM charging_sessions
WHERE ended_at IS NULL AND started_at >= $1
ORDER BY started_at DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, fmt.Errorf("get open charging sessions since %s: %w", cutoff.Format(time.RFC3339), err)
	}
	defer rows.Close()

	var sessions []*chargingmodel.ChargingSession
	for rows.Next() {
		c, err := scanChargingSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan open charging session: %w", err)
		}
		sessions = append(sessions, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate open charging sessions: %w", err)
	}
	return sessions, nil
}

// resolveCurrentGeofenceNames overlays the latest user-defined geofence name
// onto a session's stored start_place fallback. Renaming an auto-discovered
// place therefore improves historical charging labels without rewriting
// session rows; if the geofence cannot be resolved, the original text stays.
func (r *ChargingRepo) resolveCurrentGeofenceNames(ctx context.Context, sessions []*chargingmodel.ChargingSession) error {
	ids := make(map[int64]struct{})
	for _, session := range sessions {
		if session != nil && session.GeofenceID != nil {
			ids[*session.GeofenceID] = struct{}{}
		}
	}
	if len(ids) == 0 {
		return nil
	}

	idList := make([]int64, 0, len(ids))
	for id := range ids {
		idList = append(idList, id)
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id, name FROM geofences WHERE id = ANY($1)`, idList)
	if err != nil {
		return err
	}
	defer rows.Close()

	names := make(map[int64]string, len(ids))
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return err
		}
		names[id] = name
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, session := range sessions {
		if session == nil || session.GeofenceID == nil {
			continue
		}
		if name, ok := names[*session.GeofenceID]; ok {
			session.StartPlace = &name
		}
	}
	return nil
}

var ChargingPartialAllowed = map[string]string{
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
	"geofence_id":           "geofence_id",
	"rate_id":               "rate_id",
	"cost_source":           "cost_source",
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

const updateRepairBoundaryIfUnchangedSQL = `
	UPDATE charging_sessions
	SET ended_at = $3
	WHERE id = $1
	  AND ended_at IS NOT DISTINCT FROM $2`

// UpdateRepairBoundaryIfUnchanged atomically applies a reviewed data-repair
// boundary only when ended_at still matches the value observed during review.
// IS NOT DISTINCT FROM gives NULL-safe compare-and-swap semantics.
func (r *ChargingRepo) UpdateRepairBoundaryIfUnchanged(
	ctx context.Context,
	id int64,
	expectedEndedAt *time.Time,
	endedAt time.Time,
) (bool, error) {
	return r.UpdateRepairBoundaryIfUnchangedWithTx(
		ctx, r.db.Pool, id, expectedEndedAt, endedAt,
	)
}

// UpdateRepairBoundaryIfUnchangedWithTx applies the boundary through the
// supplied transaction so the repair and its audit row can commit atomically.
func (r *ChargingRepo) UpdateRepairBoundaryIfUnchangedWithTx(
	ctx context.Context,
	tx database.DBTX,
	id int64,
	expectedEndedAt *time.Time,
	endedAt time.Time,
) (bool, error) {
	tag, err := tx.Exec(ctx, updateRepairBoundaryIfUnchangedSQL,
		id, expectedEndedAt, endedAt.UTC())
	if err != nil {
		return false, fmt.Errorf("update charging session %d repair boundary: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *ChargingRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.DeleteWithTx(ctx, r.db.Pool, id)
	return err
}

// DeleteWithTx deletes through the supplied transaction.
func (r *ChargingRepo) DeleteWithTx(ctx context.Context, tx database.DBTX, id int64) (bool, error) {
	tag, err := tx.Exec(ctx, "DELETE FROM charging_sessions WHERE id=$1", id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
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
	deleted, err := r.BulkDeleteReturning(ctx, ids)
	if err != nil {
		return 0, err
	}
	return int64(len(deleted)), nil
}

// BulkDeleteReturning removes sessions in a single transaction and returns
// the IDs that actually changed. This closes the preflight/delete race for
// callers that need a truthful partial-result response.
func (r *ChargingRepo) BulkDeleteReturning(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return []int64{}, nil
	}
	deleted := make([]int64, 0, len(ids))
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `DELETE FROM charging_sessions WHERE id = ANY($1) RETURNING id`, ids)
		if err != nil {
			return fmt.Errorf("delete charging sessions: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return fmt.Errorf("scan deleted charging session: %w", err)
			}
			deleted = append(deleted, id)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("iterate deleted charging sessions: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("bulk delete charging sessions: %w", err)
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
cost_decimal=COALESCE($7, cost_decimal),
cost_currency=COALESCE($8, cost_currency)
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

// PartialUpdateForRepairWithTx applies a reviewed non-boundary repair and
// reports whether the target row still existed.
func (r *ChargingRepo) PartialUpdateForRepairWithTx(
	ctx context.Context,
	tx database.DBTX,
	id int64,
	fields map[string]interface{},
) (bool, error) {
	siFields := filterChargingPartialFields(fields)
	query, args := database.BuildPartialUpdate("charging_sessions", id, siFields, ChargingPartialAllowed)
	if query == "" {
		return false, nil
	}
	tag, err := tx.Exec(ctx, query, args...)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
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

// ApplyGeofenceTariff prices a single completed charging session using one
// specific geofence rate version, computing cost_decimal via PostgreSQL
// NUMERIC arithmetic (never Go float64 multiplication) per the SI /
// no-binary-float-money design rule. total_energy_added_wh is already SI
// watt-hours, so no unit conversion is needed — only a currency-safe decimal
// multiply.
//
// It is idempotent and safe to call repeatedly (e.g. from the async
// post-completion telemetry leg, which may retry): the WHERE clause can
// replace a default estimate and reapply the SAME pinned geofence rate, while
// NULL/unknown provenance is only eligible when cost_decimal is also NULL.
// A different geofence rate can only replace history through the explicit
// preview/apply flow. It never touches manual, Tesla-actual, or pre-feature
// costs with unknown provenance. Returns whether a row was actually updated
// (false means the session already has a protected cost, is missing energy
// data, or does not exist).
func (r *ChargingRepo) ApplyGeofenceTariff(ctx context.Context, sessionID, geofenceID, rateID int64, ratePerWh float64, currency string) (bool, error) {
	const query = `
UPDATE charging_sessions
   SET cost_decimal  = ROUND((COALESCE(total_energy_added_wh, 0)::numeric * $4::numeric), 6),
       cost_currency = $5,
       geofence_id   = $2,
       rate_id       = $3,
       cost_source   = 'geofence_tariff'
 WHERE id = $1
   AND total_energy_added_wh IS NOT NULL
   AND (
       cost_source = 'default_estimate'
       OR (cost_source = 'geofence_tariff' AND rate_id = $3)
       OR (cost_source IS NULL AND cost_decimal IS NULL)
       OR (cost_source = 'unknown' AND cost_decimal IS NULL)
   )`
	tag, err := r.db.Pool.Exec(ctx, query, sessionID, geofenceID, rateID, ratePerWh, currency)
	if err != nil {
		return false, fmt.Errorf("apply geofence tariff to session %d: %w", sessionID, err)
	}
	return tag.RowsAffected() > 0, nil
}
