package chargeopt

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// chargingPool is the minimal pgxpool subset the optimizer repo needs.
// Declared locally so tests can supply a fake pgx.Rows source without
// dragging in pgxmock (the codebase does not vendor pgxmock — see the
// mileage / vehicle-states repos for the same precedent).
type chargingPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// optimizerRepo is the data-access port GetOptimization depends on.
// Splitting the two reads behind an interface lets the handler tests
// drive every branch (validation, 500, empty, happy, degraded
// enrichment) with a fake, while the concrete pgxOptimizerRepo keeps the
// SQL in one place for the shape + scan tests.
type optimizerRepo interface {
	// Sessions returns every charging session for vehicleID, newest
	// first, with energy converted Wh→kWh and power W→kW at the SQL
	// boundary so the compute layer keeps its kWh / kW semantics.
	Sessions(ctx context.Context, vehicleID int64) ([]sessionRow, error)
	// LocationEnrichment returns the most-recent lat / lon / outside-temp
	// snapshot at each session's start, keyed by charging-session id, for
	// sessions in the trailing 90-day window. Best-effort: the handler
	// degrades gracefully (no home detection) when this errors.
	LocationEnrichment(ctx context.Context, vehicleID int64) (map[int64]sessionLocation, error)
}

// sessionLocation carries the nullable signal_log enrichment for one
// charging session. All three fields are pointers so an absent signal
// (LEFT JOIN LATERAL producing NULL) is distinguishable from a real zero
// reading — a genuine 0.0 °C outside temperature must not be dropped.
type sessionLocation struct {
	lat  *float64
	lon  *float64
	temp *float64
}

// sessionsSelectSQL is a package-level constant so the SQL-shape test can
// pin the SI-canonical column names (total_energy_added_wh, peak_power_w)
// and the Wh→kWh / W→kW conversions without a live database. A typo on
// the SI column names or a regression to legacy _kwh / _kw suffixes would
// otherwise only surface at runtime against migration 000184's schema.
const sessionsSelectSQL = `
SELECT id, started_at,
       COALESCE(cost_decimal, 0),
       COALESCE(total_energy_added_wh, 0) / 1000.0,
       COALESCE(peak_power_w, 0) / 1000.0,
       COALESCE(end_soc_pct, 0)::int,
       COALESCE(start_soc_pct, 0)::int
FROM charging_sessions
WHERE vehicle_id = $1
ORDER BY started_at DESC`

// locationEnrichSQL joins each charging session to the most-recent
// Latitude / Longitude / OutsideTemp signal at or before the session's
// start. The canonical signal_log schema splits typed value columns, so
// numeric reads COALESCE(float_value, int_value::float8) to resolve
// signals stored as whole ints (e.g. temperatures) as well as floats.
// Restricted to the trailing 90 days to bound the LATERAL scan cost.
const locationEnrichSQL = `
SELECT cs.id,
       lat.value AS latitude,
       lon.value AS longitude,
       temp.value AS outside_temp
FROM charging_sessions cs
LEFT JOIN LATERAL (
	SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
	WHERE vehicle_id = cs.vehicle_id AND field = 'Latitude'
	  AND ts <= cs.started_at
	ORDER BY ts DESC LIMIT 1
) lat ON true
LEFT JOIN LATERAL (
	SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
	WHERE vehicle_id = cs.vehicle_id AND field = 'Longitude'
	  AND ts <= cs.started_at
	ORDER BY ts DESC LIMIT 1
) lon ON true
LEFT JOIN LATERAL (
	SELECT COALESCE(float_value, int_value::float8) AS value FROM signal_log
	WHERE vehicle_id = cs.vehicle_id AND field = 'OutsideTemp'
	  AND ts <= cs.started_at
	ORDER BY ts DESC LIMIT 1
) temp ON true
WHERE cs.vehicle_id = $1
  AND cs.started_at >= NOW() - INTERVAL '90 days'`

// pgxOptimizerRepo is the production optimizerRepo backed by a pgx pool.
type pgxOptimizerRepo struct {
	pool chargingPool
}

// newPgxOptimizerRepo binds the repo to a pgx pool. Mirrors the
// mileage / vehicle-states fail-fast precedent — a nil pool at
// construction is a wiring bug, not a runtime condition.
func newPgxOptimizerRepo(pool *pgxpool.Pool) *pgxOptimizerRepo {
	if pool == nil {
		panic("chargeopt.newPgxOptimizerRepo: pool must not be nil")
	}
	return &pgxOptimizerRepo{pool: pool}
}

// Sessions loads every charging session for vehicleID (newest first).
// Unlike the pre-refactor handler it checks rows.Err() after iteration
// and surfaces scan / iteration failures to the caller rather than
// silently returning partial data when a mid-stream connection error
// terminates the cursor early.
func (r *pgxOptimizerRepo) Sessions(ctx context.Context, vehicleID int64) ([]sessionRow, error) {
	rows, err := r.pool.Query(ctx, sessionsSelectSQL, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("chargeopt: sessions query: %w", err)
	}
	defer rows.Close()

	out := make([]sessionRow, 0)
	for rows.Next() {
		var s sessionRow
		if err := rows.Scan(&s.id, &s.startDate, &s.cost, &s.kwh, &s.power,
			&s.endBattery, &s.startBattery); err != nil {
			return nil, fmt.Errorf("chargeopt: sessions row scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chargeopt: sessions rows iter: %w", err)
	}
	return out, nil
}

// LocationEnrichment loads lat / lon / outside-temp snapshots keyed by
// charging-session id. Returns wrapped errors on query / scan / iteration
// failure; the caller treats any error as "degrade gracefully" since the
// enrichment only powers optional home-location detection.
func (r *pgxOptimizerRepo) LocationEnrichment(ctx context.Context, vehicleID int64) (map[int64]sessionLocation, error) {
	rows, err := r.pool.Query(ctx, locationEnrichSQL, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("chargeopt: location query: %w", err)
	}
	defer rows.Close()

	out := make(map[int64]sessionLocation)
	for rows.Next() {
		var (
			id   int64
			loc  sessionLocation
			lat  *float64
			lon  *float64
			temp *float64
		)
		if err := rows.Scan(&id, &lat, &lon, &temp); err != nil {
			return nil, fmt.Errorf("chargeopt: location row scan: %w", err)
		}
		loc.lat, loc.lon, loc.temp = lat, lon, temp
		out[id] = loc
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("chargeopt: location rows iter: %w", err)
	}
	return out, nil
}

// Compile-time guarantee the production repo satisfies the port.
var _ optimizerRepo = (*pgxOptimizerRepo)(nil)
