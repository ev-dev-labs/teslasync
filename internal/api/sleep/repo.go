package sleep

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// sleepPool is the minimal pgx surface dbSleepRepo needs. Declaring it as
// an interface (rather than binding directly to *pgxpool.Pool) lets the
// repo scan/loop logic be unit-tested with an in-package fake — this
// codebase does not vendor pgxmock. *pgxpool.Pool satisfies it, mirroring
// the mileagePool precedent in internal/database/drive/mileage_repo.go.
type sleepPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// stateCount is one vehicle-state bucket derived from fsm_transitions.
// TotalMinutes is carried through from the query so the handler owns the
// sleep-efficiency math; the current SI query pins it to 0 (see
// stateDistributionSQL) until per-transition dwell reconstruction lands.
type stateCount struct {
	State        string
	Count        int
	TotalMinutes float64
}

// sleepRepository is the data surface GetSleepAnalytics needs. Kept as an
// interface so handler tests can supply a fake without a live database,
// matching the mileage / vampire-drain handler precedent.
type sleepRepository interface {
	VehicleVINModel(ctx context.Context, vehicleID int64) (vin string, model *string, err error)
	StateDistribution(ctx context.Context, vehicleID int64, from, to time.Time) ([]stateCount, error)
	BaseCostPerKWh(ctx context.Context) (float64, error)
}

// vehicleVINModelSQL fetches the VIN + model used to estimate battery
// capacity. Exposed as a package constant so the SQL-shape test can pin
// the column list without a live DB.
const vehicleVINModelSQL = `SELECT vin, model FROM vehicles WHERE id = $1`

// stateDistributionSQL counts fsm_transitions INTO each vehicle state in
// the (from, to] window (migration 000187). total_minutes is pinned to 0
// because the legacy per-row dwell-time field has no counterpart in the
// transition log without a paired next-transition lookup.
const stateDistributionSQL = `SELECT to_state AS state, COUNT(*) AS count, 0::float AS total_minutes
		 FROM fsm_transitions
		 WHERE vehicle_id = $1
		   AND fsm_name = 'vehicle'
		   AND ts > $2 AND ts <= $3
		 GROUP BY to_state`

// baseCostPerKWhSQL reads the operator's electricity price, defaulting to
// 0.12 when the setting is absent. COALESCE guarantees exactly one row so
// the caller never sees pgx.ErrNoRows in practice.
const baseCostPerKWhSQL = `SELECT COALESCE((SELECT value_num FROM settings WHERE key = 'base_cost_per_kwh'), 0.12)`

// dbSleepRepo is the production sleepRepository backed by the pgx pool.
type dbSleepRepo struct {
	pool sleepPool
}

// newDBSleepRepo binds the repo to the shared pool. A nil pool is a wiring
// bug (mirrors NewMileageRepo's fail-fast precedent), not a runtime state.
func newDBSleepRepo(db *database.DB) *dbSleepRepo {
	if db == nil || db.Pool == nil {
		panic("sleep.newDBSleepRepo: db pool must not be nil")
	}
	return &dbSleepRepo{pool: db.Pool}
}

// VehicleVINModel returns the VIN and (nullable) model for a vehicle.
func (r *dbSleepRepo) VehicleVINModel(ctx context.Context, vehicleID int64) (string, *string, error) {
	var vin string
	var model *string
	if err := r.pool.QueryRow(ctx, vehicleVINModelSQL, vehicleID).Scan(&vin, &model); err != nil {
		return "", nil, fmt.Errorf("query vehicle vin/model: %w", err)
	}
	return vin, model, nil
}

// StateDistribution returns the per-state transition counts in the window.
func (r *dbSleepRepo) StateDistribution(ctx context.Context, vehicleID int64, from, to time.Time) ([]stateCount, error) {
	rows, err := r.pool.Query(ctx, stateDistributionSQL, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("query fsm_transitions: %w", err)
	}
	defer rows.Close()

	out := make([]stateCount, 0)
	for rows.Next() {
		var e stateCount
		if err := rows.Scan(&e.State, &e.Count, &e.TotalMinutes); err != nil {
			// A single malformed row is skipped rather than failing the
			// whole request, preserving the pre-refactor resilience.
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: state distribution row scan failed")
			continue
		}
		out = append(out, e)
	}
	// Surface iteration transport errors: the pre-refactor loop never
	// checked rows.Err(), so a mid-stream connection drop silently
	// truncated the distribution and still returned 200 with partial data.
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fsm_transitions rows: %w", err)
	}
	return out, nil
}

// BaseCostPerKWh returns the operator electricity price (or the SQL-level
// 0.12 default when the setting is absent).
func (r *dbSleepRepo) BaseCostPerKWh(ctx context.Context) (float64, error) {
	var v float64
	if err := r.pool.QueryRow(ctx, baseCostPerKWhSQL).Scan(&v); err != nil {
		return 0, fmt.Errorf("query base_cost_per_kwh: %w", err)
	}
	return v, nil
}
