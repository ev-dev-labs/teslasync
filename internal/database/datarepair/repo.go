package datarepair

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// queryTimeout bounds every diagnosis query. The evidence tables are
// hypertables; an unbounded scan caused by a missing index or a pathological
// lookback must fail fast rather than hold an API request open.
const queryTimeout = 10 * time.Second

// Repo is the read-only diagnosis data-access surface.
type Repo struct {
	query database.DBTX
}

// NewRepo constructs the diagnosis repo. A nil *database.DB yields a repo
// whose methods return an error instead of panicking, so a composition root
// that boots without Postgres degrades to "diagnosis unavailable".
func NewRepo(db *database.DB) *Repo {
	if db == nil {
		return &Repo{}
	}
	return &Repo{query: db.Pool}
}

// NewRepoWithDBTX binds diagnosis reads to an existing transaction. The
// scanner uses this so its transaction-scoped advisory lock and all detection
// queries share one connection, including on single-connection deployments.
func NewRepoWithDBTX(tx database.DBTX) *Repo {
	return &Repo{query: tx}
}

// ErrNoDatabase is returned by every method when the repo was constructed
// without a usable pool.
var ErrNoDatabase = fmt.Errorf("data-repair diagnosis: no database configured")

func (r *Repo) ready() error {
	if r == nil || r.query == nil {
		return ErrNoDatabase
	}
	return nil
}

// SessionCandidate is the minimal projection of a drive / charging_sessions row
// the analyzer needs. Unit-bearing aggregates are deliberately absent — the
// diagnosis only reasons about identity and time boundaries.
type SessionCandidate struct {
	ID        int64
	VehicleID int64
	StartedAt time.Time
	EndedAt   *time.Time
	// DurationS is the persisted drives.duration_s. Always nil for charging
	// sessions, whose duration is derived at read time (no stored column).
	DurationS *int64
}

// Observation is one durable evidence row, already rendered for display.
type Observation struct {
	Ts     time.Time
	Source systemmodel.SessionRepairEvidenceSource
	Field  string
	Value  string
}

// nullableVehicleID converts an optional vehicle filter into the
// interface-typed nil that `$n::bigint IS NULL` requires. Passing a typed zero
// would silently match vehicle 0.
func nullableVehicleID(vehicleID *int64) interface{} {
	if vehicleID == nil {
		return nil
	}
	return *vehicleID
}

// ---------------------------------------------------------------------------
// Candidate scans
// ---------------------------------------------------------------------------

// ListOpenDrives returns drives with no ended_at that started at or after
// `since`, newest first. These are the rows a missed Park (or a missed
// completion write) leaves behind.
func (r *Repo) ListOpenDrives(ctx context.Context, since time.Time, vehicleID *int64, limit int) ([]SessionCandidate, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT id, vehicle_id, started_at, ended_at, duration_s
		FROM drives
		WHERE ended_at IS NULL
		  AND started_at >= $1
		  AND ($2::bigint IS NULL OR vehicle_id = $2)
		ORDER BY started_at DESC
		LIMIT $3`
	return r.scanCandidates(ctx, "drives", query, since, nullableVehicleID(vehicleID), limit)
}

// ListOverrunDrives returns CLOSED drives whose stored ended_at is at least
// `tolerance` later than durable contradictory evidence: a charging session,
// a Park/Neutral gear observation, or an active charge-state observation.
// Those conditions are mutually exclusive with an active drive and identify
// the signature of a recovery pass that closed the row too late.
//
// The EXISTS pre-filter is what keeps the scan bounded: without it the analyzer
// would have to fetch every drive in the lookback window and run per-row
// evidence queries against each one.
func (r *Repo) ListOverrunDrives(ctx context.Context, since time.Time, vehicleID *int64, tolerance time.Duration, limit int) ([]SessionCandidate, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT d.id, d.vehicle_id, d.started_at, d.ended_at, d.duration_s
		FROM drives d
		WHERE d.ended_at IS NOT NULL
		  AND d.started_at >= $1
		  AND ($2::bigint IS NULL OR d.vehicle_id = $2)
		  AND (
		        EXISTS (
		          SELECT 1
		          FROM charging_sessions c
		          WHERE c.vehicle_id = d.vehicle_id
		            AND c.started_at > d.started_at
		            AND c.started_at < d.ended_at - make_interval(secs => $3)
		        )
		        OR EXISTS (
		          SELECT 1
		          FROM drive_telemetry dt
		          WHERE dt.vehicle_id = d.vehicle_id
		            AND dt.ts > d.started_at
		            AND dt.ts < d.ended_at - make_interval(secs => $3)
		            AND dt.gear IN ('P', 'N')
		        )
		        OR EXISTS (
		          SELECT 1
		          FROM signal_log sl
		          WHERE sl.vehicle_id = d.vehicle_id
		            AND sl.field IN ('ChargeState', 'DetailedChargeState')
		            AND sl.ts > d.started_at
		            AND sl.ts < d.ended_at - make_interval(secs => $3)
		            AND sl.str_value IN ('Charging', 'Starting')
		        )
		      )
		ORDER BY d.started_at DESC
		LIMIT $4`
	return r.scanCandidates(ctx, "drives", query, since, nullableVehicleID(vehicleID), tolerance.Seconds(), limit)
}

// ListOpenChargingSessions returns charging sessions with no ended_at that
// started at or after `since`, newest first.
func (r *Repo) ListOpenChargingSessions(ctx context.Context, since time.Time, vehicleID *int64, limit int) ([]SessionCandidate, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT id, vehicle_id, started_at, ended_at, NULL::bigint
		FROM charging_sessions
		WHERE ended_at IS NULL
		  AND started_at >= $1
		  AND ($2::bigint IS NULL OR vehicle_id = $2)
		ORDER BY started_at DESC
		LIMIT $3`
	return r.scanCandidates(ctx, "charging_sessions", query, since, nullableVehicleID(vehicleID), limit)
}

// ListOverrunChargingSessions returns CLOSED charging sessions whose stored
// ended_at is at least `tolerance` later than durable contradictory evidence:
// a drive, a Drive/Reverse gear observation, or an explicit terminal
// charge-state observation.
func (r *Repo) ListOverrunChargingSessions(ctx context.Context, since time.Time, vehicleID *int64, tolerance time.Duration, limit int) ([]SessionCandidate, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `
		SELECT c.id, c.vehicle_id, c.started_at, c.ended_at, NULL::bigint
		FROM charging_sessions c
		WHERE c.ended_at IS NOT NULL
		  AND c.started_at >= $1
		  AND ($2::bigint IS NULL OR c.vehicle_id = $2)
		  AND (
		        EXISTS (
		          SELECT 1
		          FROM drives d
		          WHERE d.vehicle_id = c.vehicle_id
		            AND d.started_at > c.started_at
		            AND d.started_at < c.ended_at - make_interval(secs => $3)
		        )
		        OR EXISTS (
		          SELECT 1
		          FROM drive_telemetry dt
		          WHERE dt.vehicle_id = c.vehicle_id
		            AND dt.ts > c.started_at
		            AND dt.ts < c.ended_at - make_interval(secs => $3)
		            AND dt.gear IN ('D', 'R')
		        )
		        OR EXISTS (
		          SELECT 1
		          FROM signal_log sl
		          WHERE sl.vehicle_id = c.vehicle_id
		            AND sl.field IN ('ChargeState', 'DetailedChargeState')
		            AND sl.ts > c.started_at
		            AND sl.ts < c.ended_at - make_interval(secs => $3)
		            AND sl.str_value IN ('Complete', 'Stopped', 'Disconnected', 'NoPower')
		        )
		      )
		ORDER BY c.started_at DESC
		LIMIT $4`
	return r.scanCandidates(ctx, "charging_sessions", query, since, nullableVehicleID(vehicleID), tolerance.Seconds(), limit)
}

func (r *Repo) scanCandidates(ctx context.Context, table, query string, args ...interface{}) ([]SessionCandidate, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", table)
	defer span.End()

	rows, err := r.query.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("data-repair: scan %s candidates: %w", table, err)
	}
	defer rows.Close()

	out := make([]SessionCandidate, 0, 16)
	for rows.Next() {
		var c SessionCandidate
		if err := rows.Scan(&c.ID, &c.VehicleID, &c.StartedAt, &c.EndedAt, &c.DurationS); err != nil {
			return nil, fmt.Errorf("data-repair: scan %s candidate row: %w", table, err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate %s candidates: %w", table, err)
	}
	return out, nil
}

// GetDriveCandidate returns one drive projection, or (nil, nil) when the id
// does not exist.
func (r *Repo) GetDriveCandidate(ctx context.Context, id int64) (*SessionCandidate, error) {
	const query = `SELECT id, vehicle_id, started_at, ended_at, duration_s FROM drives WHERE id = $1`
	return r.getCandidate(ctx, "drives", query, id)
}

// GetChargingCandidate returns one charging-session projection, or (nil, nil)
// when the id does not exist.
func (r *Repo) GetChargingCandidate(ctx context.Context, id int64) (*SessionCandidate, error) {
	const query = `SELECT id, vehicle_id, started_at, ended_at, NULL::bigint FROM charging_sessions WHERE id = $1`
	return r.getCandidate(ctx, "charging_sessions", query, id)
}

func (r *Repo) getCandidate(ctx context.Context, table, query string, id int64) (*SessionCandidate, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", table)
	defer span.End()

	var c SessionCandidate
	err := r.query.QueryRow(ctx, query, id).Scan(&c.ID, &c.VehicleID, &c.StartedAt, &c.EndedAt, &c.DurationS)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: get %s candidate %d: %w", table, id, err)
	}
	return &c, nil
}

// ---------------------------------------------------------------------------
// Evidence reads
// ---------------------------------------------------------------------------

// ChargeStateObservations returns the durable charge-state change feed for a
// vehicle in (after, until], oldest first, capped at `limit` rows.
//
// `fields` is supplied by the caller (canonically DetailedChargeState +
// ChargeState) so this repo never encodes charge-state semantics; the caller
// classifies each value with enums.IsCharging. DetailedChargeState is a
// change feed — Tesla only re-emits on transition — so the row count in any
// realistic window is small.
func (r *Repo) ChargeStateObservations(ctx context.Context, vehicleID int64, fields []string, after, until time.Time, limit int) ([]Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if len(fields) == 0 || !until.After(after) || limit <= 0 {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "signal_log", tracing.VehicleID(vehicleID))
	defer span.End()

	const query = `
		SELECT ts, field, str_value
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field = ANY($2)
		  AND ts > $3
		  AND ts <= $4
		  AND str_value IS NOT NULL
		ORDER BY ts ASC
		LIMIT $5`
	rows, err := r.query.Query(ctx, query, vehicleID, fields, after, until, limit)
	if err != nil {
		return nil, fmt.Errorf("data-repair: charge-state observations for vehicle %d: %w", vehicleID, err)
	}
	defer rows.Close()

	out := make([]Observation, 0, 8)
	for rows.Next() {
		var (
			ts    time.Time
			field string
			value string
		)
		if err := rows.Scan(&ts, &field, &value); err != nil {
			return nil, fmt.Errorf("data-repair: scan charge-state observation: %w", err)
		}
		out = append(out, Observation{
			Ts:     ts,
			Source: systemmodel.SessionRepairSourceSignalLog,
			Field:  field,
			Value:  value,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate charge-state observations: %w", err)
	}
	return out, nil
}

// FirstChargeStateObservation returns the earliest signal_log row in
// (after, until] whose field and canonical string value are explicitly
// allowed by the caller.
func (r *Repo) FirstChargeStateObservation(
	ctx context.Context,
	vehicleID int64,
	fields, values []string,
	after, until time.Time,
) (*Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if len(fields) == 0 || len(values) == 0 || !until.After(after) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "signal_log", tracing.VehicleID(vehicleID))
	defer span.End()

	const query = `
		SELECT ts, field, str_value
		FROM signal_log
		WHERE vehicle_id = $1
		  AND field = ANY($2)
		  AND str_value = ANY($3)
		  AND ts > $4
		  AND ts <= $5
		ORDER BY ts ASC
		LIMIT 1`
	var observation Observation
	err := r.query.QueryRow(ctx, query, vehicleID, fields, values, after, until).
		Scan(&observation.Ts, &observation.Field, &observation.Value)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: first charge-state observation for vehicle %d: %w", vehicleID, err)
	}
	observation.Source = systemmodel.SessionRepairSourceSignalLog
	return &observation, nil
}

// FirstGearObservation returns the earliest drive_telemetry row in
// (after, until] whose gear is one of `gears`, or (nil, nil) when none exists.
//
// Gear routes to drive_telemetry.gear (routing.yaml) and NOT to signal_log,
// so this is the durable Park / Drive evidence.
func (r *Repo) FirstGearObservation(ctx context.Context, vehicleID int64, gears []string, after, until time.Time) (*Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if len(gears) == 0 || !until.After(after) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "drive_telemetry", tracing.VehicleID(vehicleID))
	defer span.End()

	const query = `
		SELECT ts, gear
		FROM drive_telemetry
		WHERE vehicle_id = $1
		  AND gear = ANY($2)
		  AND ts > $3
		  AND ts <= $4
		ORDER BY ts ASC
		LIMIT 1`
	var (
		ts   time.Time
		gear string
	)
	err := r.query.QueryRow(ctx, query, vehicleID, gears, after, until).Scan(&ts, &gear)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: first gear observation for vehicle %d: %w", vehicleID, err)
	}
	return &Observation{
		Ts:     ts,
		Source: systemmodel.SessionRepairSourceDriveTelemetry,
		Field:  "Gear",
		Value:  gear,
	}, nil
}

// LastDrivingObservation returns the newest drive_telemetry row in [from, to]
// that is consistent with the vehicle being in motion — either a driving gear
// or a strictly positive speed. Returns (nil, nil) when the window holds none.
//
// Value is rendered with its unit inline ("D", or "12.4 m/s") so no reader can
// mistake the number for a unitless quantity. speed_mps is SI canonical.
func (r *Repo) LastDrivingObservation(ctx context.Context, vehicleID int64, drivingGears []string, from, to time.Time) (*Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if len(drivingGears) == 0 || to.Before(from) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "drive_telemetry", tracing.VehicleID(vehicleID))
	defer span.End()

	const query = `
		SELECT ts, gear, speed_mps
		FROM drive_telemetry
		WHERE vehicle_id = $1
		  AND ts >= $3
		  AND ts <= $4
		  AND (gear = ANY($2) OR speed_mps > 0)
		ORDER BY ts DESC
		LIMIT 1`
	var (
		ts       time.Time
		gear     *string
		speedMps *float64
	)
	err := r.query.QueryRow(ctx, query, vehicleID, drivingGears, from, to).Scan(&ts, &gear, &speedMps)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: last driving observation for vehicle %d: %w", vehicleID, err)
	}

	obs := Observation{Ts: ts, Source: systemmodel.SessionRepairSourceDriveTelemetry}
	if gear != nil && *gear != "" {
		obs.Field = "Gear"
		obs.Value = *gear
		return &obs, nil
	}
	obs.Field = "VehicleSpeed"
	if speedMps != nil {
		obs.Value = fmt.Sprintf("%.1f m/s", *speedMps)
	}
	return &obs, nil
}

// LastChargingPowerObservation returns the newest charging_telemetry row in
// [from, to] carrying strictly positive AC or DC charging power — durable
// proof the session was still delivering energy at that instant.
func (r *Repo) LastChargingPowerObservation(ctx context.Context, vehicleID int64, from, to time.Time) (*Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if to.Before(from) {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "charging_telemetry", tracing.VehicleID(vehicleID))
	defer span.End()

	const query = `
		SELECT ts, ac_charging_power_w, dc_charging_power_w
		FROM charging_telemetry
		WHERE vehicle_id = $1
		  AND ts >= $2
		  AND ts <= $3
		  AND (COALESCE(ac_charging_power_w, 0) > 0 OR COALESCE(dc_charging_power_w, 0) > 0)
		ORDER BY ts DESC
		LIMIT 1`
	var (
		ts      time.Time
		acPower *float64
		dcPower *float64
	)
	err := r.query.QueryRow(ctx, query, vehicleID, from, to).Scan(&ts, &acPower, &dcPower)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: last charging power observation for vehicle %d: %w", vehicleID, err)
	}

	obs := Observation{Ts: ts, Source: systemmodel.SessionRepairSourceChargingTelemetry}
	if dcPower != nil && *dcPower > 0 {
		obs.Field = "DCChargingPower"
		obs.Value = fmt.Sprintf("%.0f W", *dcPower)
		return &obs, nil
	}
	obs.Field = "ACChargingPower"
	if acPower != nil {
		obs.Value = fmt.Sprintf("%.0f W", *acPower)
	}
	return &obs, nil
}

// FirstChargingSessionAfter returns the earliest charging session for a vehicle
// that starts strictly after `after`, excluding `excludeID`. Returns
// (nil, nil) when none exists.
func (r *Repo) FirstChargingSessionAfter(ctx context.Context, vehicleID int64, after time.Time, excludeID int64) (*Observation, error) {
	const query = `
		SELECT started_at, id
		FROM charging_sessions
		WHERE vehicle_id = $1 AND started_at > $2 AND id <> $3
		ORDER BY started_at ASC
		LIMIT 1`
	return r.firstSessionAfter(ctx, "charging_sessions", query, vehicleID, after, excludeID,
		systemmodel.SessionRepairSourceChargingSessions, "charging_session.started_at")
}

// FirstDriveAfter returns the earliest drive for a vehicle that starts strictly
// after `after`, excluding `excludeID`. Returns (nil, nil) when none exists.
func (r *Repo) FirstDriveAfter(ctx context.Context, vehicleID int64, after time.Time, excludeID int64) (*Observation, error) {
	const query = `
		SELECT started_at, id
		FROM drives
		WHERE vehicle_id = $1 AND started_at > $2 AND id <> $3
		ORDER BY started_at ASC
		LIMIT 1`
	return r.firstSessionAfter(ctx, "drives", query, vehicleID, after, excludeID,
		systemmodel.SessionRepairSourceDrives, "drive.started_at")
}

func (r *Repo) firstSessionAfter(
	ctx context.Context,
	table, query string,
	vehicleID int64,
	after time.Time,
	excludeID int64,
	source systemmodel.SessionRepairEvidenceSource,
	field string,
) (*Observation, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", table, tracing.VehicleID(vehicleID))
	defer span.End()

	var (
		ts time.Time
		id int64
	)
	err := r.query.QueryRow(ctx, query, vehicleID, after, excludeID).Scan(&ts, &id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: first %s after %s for vehicle %d: %w", table, after.Format(time.RFC3339), vehicleID, err)
	}
	return &Observation{
		Ts:     ts,
		Source: source,
		Field:  field,
		Value:  fmt.Sprintf("#%d", id),
	}, nil
}
