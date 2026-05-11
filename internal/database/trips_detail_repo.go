package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrTripNotFound is the sentinel returned by TripsDetailRepo.GetTrip
// when the requested trip id does not exist. The handler maps this to
// HTTP 404 via errors.Is so that lookup-or-404 disambiguates from
// internal errors. Mirrors the Phase-43a/0006 ErrGuardEventNotFound
// precedent.
var ErrTripNotFound = errors.New("trip not found")

// tripsDetailPool is the minimal pgxpool surface used by
// TripsDetailRepo. Restricting to (Query, QueryRow) keeps unit-tests
// trivial: a fake that records the SQL it was called with is enough.
//
// *pgxpool.Pool already satisfies this interface, so production
// wiring passes the production pool directly.
type tripsDetailPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Compile-time guard that *pgxpool.Pool still satisfies the narrow
// interface. If pgx renames Query/QueryRow this fails at build time
// rather than at runtime.
var _ tripsDetailPool = (*pgxpool.Pool)(nil)

// TripsDetailRepo serves the GET /trips/{id} endpoint.
//
// The trips table (mig 000185_drives_si.up.sql) intentionally does
// NOT denormalize totals — they are recomputed from the constituent
// drives via the trip_drives JOIN every time the detail is read.
// charging_sessions are NOT joined to trips at all in the schema, so
// the cost/charge_count fields are derived from a vehicle-scoped
// time-window OVERLAP query (see chargesAggregateSelectSQL). Overlap
// (not start-only) ensures sessions that began just before the trip
// window but ended inside it are counted; this matters for the
// monthly-summary trips that GenerateMonthlyTrips creates.
type TripsDetailRepo struct {
	pool tripsDetailPool
}

// NewTripsDetailRepo panics on a nil pool. Mirrors Phase-43a/0007
// SignalsCatalogRepo + Phase-42a/0010 newSnapshotWriter precedent
// (fail-fast at construction so a misconfigured router crashes at
// startup instead of at first request).
func NewTripsDetailRepo(pool tripsDetailPool) *TripsDetailRepo {
	if pool == nil {
		panic("database: NewTripsDetailRepo requires non-nil pool")
	}
	return &TripsDetailRepo{pool: pool}
}

// TripDetail is the raw repo-level result. SI-canonical units:
//   - DistanceM       meters
//   - EnergyUsedWh    Watt-hours
//   - DurationS       seconds
//
// The handler converts to display-friendly km / kWh and adds the
// frontend-aliased fields (start_date, total_distance_km, etc.).
//
// CostDecimal is summed as float64 from the NUMERIC(12,4) column —
// the precision loss is bounded (≤14 significant digits, well within
// IEEE-754 double precision) and matches what the existing
// ChargingSessionRepo already does for cost reads.
type TripDetail struct {
	ID            int64
	VehicleID     int64
	Name          *string
	StartedAt     time.Time
	EndedAt       *time.Time
	DistanceM     float64
	EnergyUsedWh  float64
	DurationS     int64
	DriveCount    int64
	ChargeCount   int64
	TotalCost     float64
	Drives        []TripDriveSummary
}

// TripDriveSummary is the per-drive projection rendered inside the
// trip-detail "drives" array. SI columns are exposed as km / kWh by
// the handler conversion layer.
type TripDriveSummary struct {
	ID           int64
	StartedAt    time.Time
	EndedAt      *time.Time
	DistanceM    *float64
	EnergyUsedWh *float64
	DurationS    *int64
	StartPlace   *string
	EndPlace     *string
}

// tripHeaderSelectSQL aggregates trip + drive totals + charge totals
// in one round-trip. The drive aggregates use COALESCE(SUM(COALESCE(...)))
// so an all-null column does not propagate NULL into Go scalars (the
// outer COALESCE handles the empty-aggregate case where SUM returns
// NULL because LEFT JOIN found no rows; the inner COALESCE handles
// the per-row NULL on a nullable SI column).
//
// The charge aggregate uses INTERVAL OVERLAP semantics
// (rubber-duck issue #2): a charging session counts toward the trip
// if its [started_at, COALESCE(ended_at, started_at)] window
// overlaps [trip.started_at, COALESCE(trip.ended_at, NOW())]. This
// includes sessions that began before the trip but ended inside it.
//
// The query is parameterised so the only bind value is $1 = trip ID;
// every other reference (vehicle id, time window) is read from the
// trips row via correlated subqueries. This keeps the SQL stable
// across in-progress vs completed trips — the handler does NOT need
// to switch SQL based on trip state.
const tripHeaderSelectSQL = `
SELECT
	t.id,
	t.vehicle_id,
	t.name,
	t.started_at,
	t.ended_at,
	COALESCE(SUM(COALESCE(d.distance_m, 0)),     0)::DOUBLE PRECISION AS distance_m,
	COALESCE(SUM(COALESCE(d.energy_used_wh, 0)), 0)::DOUBLE PRECISION AS energy_used_wh,
	COALESCE(SUM(COALESCE(d.duration_s, 0)),     0)::BIGINT           AS duration_s,
	COUNT(d.id)                                                       AS drive_count,
	COALESCE((
		SELECT COUNT(*)
		FROM charging_sessions cs
		WHERE cs.vehicle_id = t.vehicle_id
		  AND cs.started_at < COALESCE(t.ended_at, NOW())
		  AND COALESCE(cs.ended_at, cs.started_at) >= t.started_at
	), 0) AS charge_count,
	COALESCE((
		SELECT SUM(cs.cost_decimal)
		FROM charging_sessions cs
		WHERE cs.vehicle_id = t.vehicle_id
		  AND cs.started_at < COALESCE(t.ended_at, NOW())
		  AND COALESCE(cs.ended_at, cs.started_at) >= t.started_at
	), 0)::DOUBLE PRECISION AS total_cost
FROM trips t
LEFT JOIN trip_drives td ON td.trip_id = t.id
LEFT JOIN drives d       ON d.id       = td.drive_id
WHERE t.id = $1
GROUP BY t.id, t.vehicle_id, t.name, t.started_at, t.ended_at
`

// tripDrivesSelectSQL projects the per-drive summary needed by the
// detail page's `drives:[...]` array. ORDER BY td.position ASC honours
// the trip_drives.position contract from mig 000185
// ("monotonically increasing per trip; the writer is responsible for
// assigning positions").
const tripDrivesSelectSQL = `
SELECT
	d.id,
	d.started_at,
	d.ended_at,
	d.distance_m,
	d.energy_used_wh,
	d.duration_s,
	d.start_place,
	d.end_place
FROM trip_drives td
JOIN drives d ON d.id = td.drive_id
WHERE td.trip_id = $1
ORDER BY td.position ASC
`

// GetTrip returns the trip header + ordered constituent drives. If
// no trip exists with the given id, returns ErrTripNotFound.
//
// Two-query implementation per Decision D5: the header query already
// has GROUP BY/aggregates and the drives query has its own ORDER BY,
// so a single combined CTE would pay double the network cost (the
// driver would have to fan-out duplicate header rows for each drive).
func (r *TripsDetailRepo) GetTrip(ctx context.Context, tripID int64) (*TripDetail, error) {
	row := r.pool.QueryRow(ctx, tripHeaderSelectSQL, tripID)

	td := &TripDetail{}
	if err := row.Scan(
		&td.ID,
		&td.VehicleID,
		&td.Name,
		&td.StartedAt,
		&td.EndedAt,
		&td.DistanceM,
		&td.EnergyUsedWh,
		&td.DurationS,
		&td.DriveCount,
		&td.ChargeCount,
		&td.TotalCost,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTripNotFound
		}
		return nil, fmt.Errorf("scan trip header %d: %w", tripID, err)
	}

	rows, err := r.pool.Query(ctx, tripDrivesSelectSQL, tripID)
	if err != nil {
		return nil, fmt.Errorf("query trip drives %d: %w", tripID, err)
	}
	defer rows.Close()

	for rows.Next() {
		var s TripDriveSummary
		if err := rows.Scan(
			&s.ID,
			&s.StartedAt,
			&s.EndedAt,
			&s.DistanceM,
			&s.EnergyUsedWh,
			&s.DurationS,
			&s.StartPlace,
			&s.EndPlace,
		); err != nil {
			return nil, fmt.Errorf("scan trip drive: %w", err)
		}
		td.Drives = append(td.Drives, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate trip drives: %w", err)
	}

	return td, nil
}
