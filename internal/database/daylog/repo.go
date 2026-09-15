package daylog

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DayDrive is the subset of a drives row the day timeline needs.
// StartedAt/EndedAt are the real column names (migration 000185);
// a NULL EndedAt means the drive is still in progress. Nullable
// measures stay pointers so "unknown" never collapses into a fake 0.
type DayDrive struct {
	ID           int64
	VehicleID    int64
	StartedAt    time.Time
	EndedAt      *time.Time
	DurationS    *int64
	DistanceM    *float64
	StartPlace   *string
	EndPlace     *string
	StartSocPct  *float64
	EndSocPct    *float64
	EnergyUsedWh *float64
}

// DayCharge is the subset of a charging_sessions row the day timeline
// needs. EndedAt NULL means the session is still in progress.
type DayCharge struct {
	ID                 int64
	VehicleID          int64
	StartedAt          time.Time
	EndedAt            *time.Time
	StartPlace         *string
	StartSocPct        *float64
	EndSocPct          *float64
	TotalEnergyAddedWh *float64
}

// DayFSMTransition is one vehicle-FSM row (fsm_name='vehicle') inside
// the day window, in chronological order.
type DayFSMTransition struct {
	ID        int64
	Ts        time.Time
	FromState *string
	ToState   string
	Trigger   *string
}

// DaySecurityEvent is one security_events row (lock/sentry/valet) inside
// the day window. ToState carries "true"/"false" for bools (Locked) and
// the proto-enum String() for SentryMode (e.g. SentryModeStateArmed).
type DaySecurityEvent struct {
	ID        int64
	Ts        time.Time
	EventType string
	FromState *string
	ToState   *string
}

// DaySignalRow is one raw signal_log observation. Exactly one of the
// typed value pointers is non-nil per row (migration 000186); edge
// detection over these rows lives in the api package as pure Go.
type DaySignalRow struct {
	Ts         time.Time
	Field      string
	StrValue   *string
	BoolValue  *bool
	IntValue   *int64
	FloatValue *float64
}

// DayGearTick is one drive_telemetry gear observation. Ticks arrive at
// ~1 Hz while driving; callers detect gear changes over them.
type DayGearTick struct {
	Ts   time.Time
	Gear string
}

// DaySoftwareUpdate is one software_updates row overlapping the day
// window (created or installed that day).
type DaySoftwareUpdate struct {
	ID          int64
	VehicleID   int64
	Version     string
	Status      string
	ScheduledAt *time.Time
	InstalledAt *time.Time
	CreatedAt   time.Time
}

// Query shapes are package-level constants so the SQL-shape test can
// assert column names, time bounds, and LIMITs without a live database.
// A mistyped column would otherwise surface only at runtime.
const (
	dayLogVehicleExistsSQL = `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`

	// Overlap predicate: a session belongs to the day when it was open
	// at any instant inside [start, end] — started before the day ended
	// AND (still open OR ended after the day began).
	dayLogDrivesSQL = `
SELECT id, vehicle_id, started_at, ended_at, duration_s, distance_m,
       start_place, end_place, start_soc_pct, end_soc_pct, energy_used_wh
FROM drives
WHERE vehicle_id = $1
  AND started_at <= $2
  AND (ended_at IS NULL OR ended_at >= $3)
ORDER BY started_at ASC`

	dayLogChargesSQL = `
SELECT id, vehicle_id, started_at, ended_at, start_place,
       start_soc_pct, end_soc_pct, total_energy_added_wh
FROM charging_sessions
WHERE vehicle_id = $1
  AND started_at <= $2
  AND (ended_at IS NULL OR ended_at >= $3)
ORDER BY started_at ASC`

	dayLogFSMSQL = `
SELECT id, ts, from_state, to_state, trigger
FROM fsm_transitions
WHERE vehicle_id = $1
  AND fsm_name = 'vehicle'
  AND ts >= $2
  AND ts <= $3
ORDER BY ts ASC`

	dayLogSecuritySQL = `
SELECT id, ts, event_type, from_state, to_state
FROM security_events
WHERE vehicle_id = $1
  AND ts >= $2
  AND ts <= $3
  AND event_type = ANY($4)
ORDER BY ts ASC`

	dayLogSignalSQL = `
SELECT ts, field, str_value, bool_value, int_value, float_value
FROM signal_log
WHERE vehicle_id = $1
  AND field = ANY($2)
  AND ts >= $3
  AND ts <= $4
ORDER BY ts ASC
LIMIT $5`

	dayLogGearSQL = `
SELECT ts, gear
FROM drive_telemetry
WHERE vehicle_id = $1
  AND ts >= $2
  AND ts <= $3
  AND gear IS NOT NULL
ORDER BY ts ASC
LIMIT $4`

	dayLogSoftwareSQL = `
SELECT id, vehicle_id, version, status, scheduled_at, installed_at, created_at
FROM software_updates
WHERE vehicle_id = $1
  AND (created_at BETWEEN $2 AND $3
       OR (installed_at IS NOT NULL AND installed_at BETWEEN $2 AND $3))
ORDER BY created_at ASC`
)

// dayLogPool is the minimal pgxpool subset this repo needs, so tests
// can supply a fake without pgxmock.
type dayLogPool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// DayLogRepo serves the day-timeline read model. Construct via
// NewDayLogRepo; all queries are parameterized with lower AND upper
// time bounds and hard input caps.
type DayLogRepo struct {
	pool dayLogPool
}

// NewDayLogRepo binds the repo to a pgx pool. A nil pool is a wiring
// bug, not a runtime condition.
func NewDayLogRepo(pool *pgxpool.Pool) *DayLogRepo {
	if pool == nil {
		panic("daylog.NewDayLogRepo: pool must not be nil")
	}
	return &DayLogRepo{pool: pool}
}

// VehicleExists reports whether a vehicles row exists, so the handler
// can return 404 (unknown vehicle) instead of 200 with an empty day.
func (r *DayLogRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, dayLogVehicleExistsSQL, vehicleID).Scan(&exists); err != nil {
		return false, fmt.Errorf("daylog: probe vehicle existence: %w", err)
	}
	return exists, nil
}

// DrivesOverlapping returns sessions open at any instant inside
// [windowStart, windowEnd], chronological by start.
func (r *DayLogRepo) DrivesOverlapping(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]DayDrive, error) {
	rows, err := r.pool.Query(ctx, dayLogDrivesSQL, vehicleID, windowEnd, windowStart)
	if err != nil {
		return nil, fmt.Errorf("daylog: drives query: %w", err)
	}
	defer rows.Close()

	out := make([]DayDrive, 0)
	for rows.Next() {
		var d DayDrive
		if err := rows.Scan(&d.ID, &d.VehicleID, &d.StartedAt, &d.EndedAt, &d.DurationS,
			&d.DistanceM, &d.StartPlace, &d.EndPlace, &d.StartSocPct, &d.EndSocPct,
			&d.EnergyUsedWh); err != nil {
			return nil, fmt.Errorf("daylog: drives row scan: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: drives rows iter: %w", err)
	}
	return out, nil
}

// ChargesOverlapping returns charge sessions open at any instant inside
// [windowStart, windowEnd], chronological by start.
func (r *DayLogRepo) ChargesOverlapping(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]DayCharge, error) {
	rows, err := r.pool.Query(ctx, dayLogChargesSQL, vehicleID, windowEnd, windowStart)
	if err != nil {
		return nil, fmt.Errorf("daylog: charges query: %w", err)
	}
	defer rows.Close()

	out := make([]DayCharge, 0)
	for rows.Next() {
		var c DayCharge
		if err := rows.Scan(&c.ID, &c.VehicleID, &c.StartedAt, &c.EndedAt, &c.StartPlace,
			&c.StartSocPct, &c.EndSocPct, &c.TotalEnergyAddedWh); err != nil {
			return nil, fmt.Errorf("daylog: charges row scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: charges rows iter: %w", err)
	}
	return out, nil
}

// FSMTransitions returns vehicle-FSM transitions inside the window,
// chronological. Callers suppress driving/charging targets because
// session rows already carry those boundaries.
func (r *DayLogRepo) FSMTransitions(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]DayFSMTransition, error) {
	rows, err := r.pool.Query(ctx, dayLogFSMSQL, vehicleID, windowStart, windowEnd)
	if err != nil {
		return nil, fmt.Errorf("daylog: fsm query: %w", err)
	}
	defer rows.Close()

	out := make([]DayFSMTransition, 0)
	for rows.Next() {
		var t DayFSMTransition
		if err := rows.Scan(&t.ID, &t.Ts, &t.FromState, &t.ToState, &t.Trigger); err != nil {
			return nil, fmt.Errorf("daylog: fsm row scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: fsm rows iter: %w", err)
	}
	return out, nil
}

// SecurityEvents returns security_events rows for the given event types
// inside the window, chronological.
func (r *DayLogRepo) SecurityEvents(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time, eventTypes []string) ([]DaySecurityEvent, error) {
	rows, err := r.pool.Query(ctx, dayLogSecuritySQL, vehicleID, windowStart, windowEnd, eventTypes)
	if err != nil {
		return nil, fmt.Errorf("daylog: security query: %w", err)
	}
	defer rows.Close()

	out := make([]DaySecurityEvent, 0)
	for rows.Next() {
		var e DaySecurityEvent
		if err := rows.Scan(&e.ID, &e.Ts, &e.EventType, &e.FromState, &e.ToState); err != nil {
			return nil, fmt.Errorf("daylog: security row scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: security rows iter: %w", err)
	}
	return out, nil
}

// SignalRows returns raw signal_log observations for the given fields
// inside the window, chronological, capped at limit rows. Edge
// detection over these rows is pure Go in the api package.
func (r *DayLogRepo) SignalRows(ctx context.Context, vehicleID int64, fields []string, windowStart, windowEnd time.Time, limit int) ([]DaySignalRow, error) {
	rows, err := r.pool.Query(ctx, dayLogSignalSQL, vehicleID, fields, windowStart, windowEnd, limit)
	if err != nil {
		return nil, fmt.Errorf("daylog: signal query: %w", err)
	}
	defer rows.Close()

	out := make([]DaySignalRow, 0)
	for rows.Next() {
		var s DaySignalRow
		if err := rows.Scan(&s.Ts, &s.Field, &s.StrValue, &s.BoolValue, &s.IntValue, &s.FloatValue); err != nil {
			return nil, fmt.Errorf("daylog: signal row scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: signal rows iter: %w", err)
	}
	return out, nil
}

// GearTicks returns drive_telemetry gear observations inside the
// window, chronological, capped at limit rows.
func (r *DayLogRepo) GearTicks(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time, limit int) ([]DayGearTick, error) {
	rows, err := r.pool.Query(ctx, dayLogGearSQL, vehicleID, windowStart, windowEnd, limit)
	if err != nil {
		return nil, fmt.Errorf("daylog: gear query: %w", err)
	}
	defer rows.Close()

	out := make([]DayGearTick, 0)
	for rows.Next() {
		var g DayGearTick
		if err := rows.Scan(&g.Ts, &g.Gear); err != nil {
			return nil, fmt.Errorf("daylog: gear row scan: %w", err)
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: gear rows iter: %w", err)
	}
	return out, nil
}

// SoftwareUpdates returns firmware rows created or installed inside
// the window, chronological by creation.
func (r *DayLogRepo) SoftwareUpdates(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]DaySoftwareUpdate, error) {
	rows, err := r.pool.Query(ctx, dayLogSoftwareSQL, vehicleID, windowStart, windowEnd)
	if err != nil {
		return nil, fmt.Errorf("daylog: software query: %w", err)
	}
	defer rows.Close()

	out := make([]DaySoftwareUpdate, 0)
	for rows.Next() {
		var u DaySoftwareUpdate
		if err := rows.Scan(&u.ID, &u.VehicleID, &u.Version, &u.Status, &u.ScheduledAt, &u.InstalledAt, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("daylog: software row scan: %w", err)
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("daylog: software rows iter: %w", err)
	}
	return out, nil
}
