// Package drive provides per-drive diagnostics that explain why a drive ended.
//
// Queries are split by concern so handlers can degrade independently:
//
//  1. The fsm_transitions in a window centered on the drive's end_ts.
//     The drive-end FSM transition + any neighboring transitions
//     (gear→P, ignition off, speed→0) explain the trigger.
//  2. The signal_log values for ignition/gear/speed/odometer in a
//     ±60s window around end_ts so the operator can correlate the
//     transition with the raw signal stream.
//  3. The Drive row itself for end_ts + ended_status.
//
// Why not roll all three into one SQL query: the joins would require
// time-bucketed UNION, and any partial failure (e.g. signal_log
// hypertable temporarily unavailable) would empty the whole result.
// Splitting them lets the handler degrade gracefully.

package drive

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DriveDiagnosticTransition is a thin projection of fsm_transitions
// for the drive-end diagnostic. We don't reuse FSMTransitionRecord
// because we want to expose details_text (already-marshaled JSON) so
// the SPA can render it without re-parsing.
type DriveDiagnosticTransition struct {
	ID          int64     `json:"id"`
	TS          time.Time `json:"ts"`
	FSMName     string    `json:"fsm_name"`
	FromState   string    `json:"from_state"`
	ToState     string    `json:"to_state"`
	Trigger     string    `json:"trigger,omitempty"`
	DetailsJSON string    `json:"details_json,omitempty"`
}

// DriveDiagnosticSignal is a thin projection of signal_log around
// end_ts. value is rendered as text for display so the SPA doesn't
// have to walk multiple typed columns.
type DriveDiagnosticSignal struct {
	TS    time.Time `json:"ts"`
	Field string    `json:"field"`
	Value string    `json:"value"`
}

// DriveDiagnosticRepo serves the per-drive diagnostic queries.
type DriveDiagnosticRepo struct {
	pool *pgxpool.Pool
}

// NewDriveDiagnosticRepo constructs a repo bound to pool.
func NewDriveDiagnosticRepo(pool *pgxpool.Pool) *DriveDiagnosticRepo {
	if pool == nil {
		panic("database: NewDriveDiagnosticRepo: pool is nil")
	}
	return &DriveDiagnosticRepo{pool: pool}
}

// TransitionsAround returns fsm_transitions for vehicleID in
// [ts-window, ts+window]. Ordered by ts ASC.
func (r *DriveDiagnosticRepo) TransitionsAround(ctx context.Context, vehicleID int64, ts time.Time, window time.Duration) ([]DriveDiagnosticTransition, error) {
	if r == nil || r.pool == nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.TransitionsAround: nil repo or pool")
	}
	if vehicleID <= 0 {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.TransitionsAround: vehicle_id must be > 0")
	}
	if window <= 0 {
		window = 60 * time.Second
	}
	from := ts.Add(-window)
	to := ts.Add(window)

	rows, err := r.pool.Query(ctx, `
		SELECT id, ts, fsm_name,
		       COALESCE(from_state, '') AS from_state,
		       to_state,
		       COALESCE(trigger, '')     AS trigger,
		       COALESCE(details::text, '') AS details_json
		  FROM fsm_transitions
		 WHERE vehicle_id = $1
		   AND ts BETWEEN $2 AND $3
		 ORDER BY ts ASC, id ASC
		 LIMIT 500
	`, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.TransitionsAround: query: %w", err)
	}
	defer rows.Close()

	out := make([]DriveDiagnosticTransition, 0, 16)
	for rows.Next() {
		var rec DriveDiagnosticTransition
		if err := rows.Scan(&rec.ID, &rec.TS, &rec.FSMName, &rec.FromState, &rec.ToState, &rec.Trigger, &rec.DetailsJSON); err != nil {
			return nil, fmt.Errorf("database: DriveDiagnosticRepo.TransitionsAround: scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.TransitionsAround: rows: %w", err)
	}
	return out, nil
}

// SignalsAround returns signal_log rows for vehicleID in
// [ts-window, ts+window] restricted to the fields whitelist (typical:
// Gear, VehicleSpeed, BatteryLevel, Odometer). Value is rendered via
// the populated typed column per row's value_kind.
func (r *DriveDiagnosticRepo) SignalsAround(ctx context.Context, vehicleID int64, ts time.Time, window time.Duration, fields []string) ([]DriveDiagnosticSignal, error) {
	if r == nil || r.pool == nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.SignalsAround: nil repo or pool")
	}
	if vehicleID <= 0 {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.SignalsAround: vehicle_id must be > 0")
	}
	if window <= 0 {
		window = 60 * time.Second
	}
	if len(fields) == 0 {
		return nil, nil // empty whitelist → empty result, by design
	}
	from := ts.Add(-window)
	to := ts.Add(window)

	rows, err := r.pool.Query(ctx, `
		SELECT
		    ts,
		    field,
		    value_kind,
		    str_value,
		    bool_value,
		    int_value,
		    float_value,
		    time_value
		  FROM signal_log
		 WHERE vehicle_id = $1
		   AND ts BETWEEN $2 AND $3
		   AND field = ANY($4::text[])
		 ORDER BY ts ASC, field ASC
		 LIMIT 5000
	`, vehicleID, from, to, fields)
	if err != nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.SignalsAround: query: %w", err)
	}
	defer rows.Close()

	out := make([]DriveDiagnosticSignal, 0, 128)
	for rows.Next() {
		var (
			rec        DriveDiagnosticSignal
			valueKind  int16
			strValue   *string
			boolValue  *bool
			intValue   *int64
			floatValue *float64
			timeValue  *time.Time
		)
		if err := rows.Scan(&rec.TS, &rec.Field, &valueKind, &strValue, &boolValue, &intValue, &floatValue, &timeValue); err != nil {
			return nil, fmt.Errorf("database: DriveDiagnosticRepo.SignalsAround: scan: %w", err)
		}
		rec.Value = renderTypedValue(valueKind, strValue, boolValue, intValue, floatValue, timeValue)
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: DriveDiagnosticRepo.SignalsAround: rows: %w", err)
	}
	return out, nil
}

// renderTypedValue picks the populated typed column according to
// value_kind and stringifies it. Returns "" when no column was
// populated — surfaced as an empty value in the response so the SPA
// can render "—" without inventing data.
func renderTypedValue(kind int16, s *string, b *bool, i *int64, f *float64, t *time.Time) string {
	switch kind {
	case 1: // string
		if s != nil {
			return *s
		}
	case 2: // bool
		if b != nil {
			if *b {
				return "true"
			}
			return "false"
		}
	case 3, 4: // int
		if i != nil {
			return fmt.Sprintf("%d", *i)
		}
	case 5, 6: // float
		if f != nil {
			return fmt.Sprintf("%g", *f)
		}
	case 7: // enum (stored as string)
		if s != nil {
			return *s
		}
	case 9: // time
		if t != nil {
			return t.UTC().Format(time.RFC3339Nano)
		}
	}
	return ""
}
