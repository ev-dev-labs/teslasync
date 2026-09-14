package journey

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Checkpoint is one trail snapshot.
type Checkpoint struct {
	ID         int64     `json:"id"`
	SessionID  int64     `json:"session_id"`
	RecordedAt time.Time `json:"recorded_at"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	SocPct     *float64  `json:"soc_pct"`
	OdometerM  *float64  `json:"odometer_m"`
}

// NewCheckpoint carries the append fields. RecordedAt defaults to now
// when zero.
type NewCheckpoint struct {
	RecordedAt time.Time
	Lat        float64
	Lng        float64
	SocPct     *float64
	OdometerM  *float64
}

// AppendCheckpoint inserts one trail point. Retried posts with the
// same recorded_at return the existing row (idempotent companion
// retry), matched on the unique key rather than error strings.
func (s *Store) AppendCheckpoint(ctx context.Context, sessionID int64, in NewCheckpoint) (*Checkpoint, error) {
	if in.RecordedAt.IsZero() {
		in.RecordedAt = time.Now().UTC()
	}
	cp := &Checkpoint{}
	err := s.db.Pool.QueryRow(ctx, `
		INSERT INTO journey_checkpoints (session_id, recorded_at, lat, lng, soc_pct, odometer_m)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (session_id, recorded_at) DO NOTHING
		RETURNING id, session_id, recorded_at, lat, lng, soc_pct, odometer_m`,
		sessionID, in.RecordedAt, in.Lat, in.Lng, in.SocPct, in.OdometerM,
	).Scan(&cp.ID, &cp.SessionID, &cp.RecordedAt, &cp.Lat, &cp.Lng, &cp.SocPct, &cp.OdometerM)
	if errors.Is(err, pgx.ErrNoRows) {
		// DO NOTHING yields no row on conflict: fetch the winner.
		if err := s.db.Pool.QueryRow(ctx, `
			SELECT id, session_id, recorded_at, lat, lng, soc_pct, odometer_m
			FROM journey_checkpoints WHERE session_id = $1 AND recorded_at = $2`,
			sessionID, in.RecordedAt,
		).Scan(&cp.ID, &cp.SessionID, &cp.RecordedAt, &cp.Lat, &cp.Lng, &cp.SocPct, &cp.OdometerM); err != nil {
			return nil, fmt.Errorf("journey: checkpoint conflict read: %w", err)
		}
		return cp, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journey: append checkpoint: %w", err)
	}
	return cp, nil
}

// LatestCheckpoint returns the newest trail point, or nil.
func (s *Store) LatestCheckpoint(ctx context.Context, sessionID int64) (*Checkpoint, error) {
	cp := &Checkpoint{}
	err := s.db.Pool.QueryRow(ctx, `
		SELECT id, session_id, recorded_at, lat, lng, soc_pct, odometer_m
		FROM journey_checkpoints WHERE session_id = $1
		ORDER BY recorded_at DESC LIMIT 1`, sessionID,
	).Scan(&cp.ID, &cp.SessionID, &cp.RecordedAt, &cp.Lat, &cp.Lng, &cp.SocPct, &cp.OdometerM)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("journey: latest checkpoint: %w", err)
	}
	return cp, nil
}

// Trail returns the newest points, newest first. Limit clamped 1..100.
func (s *Store) Trail(ctx context.Context, sessionID int64, limit int) ([]*Checkpoint, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT id, session_id, recorded_at, lat, lng, soc_pct, odometer_m
		FROM journey_checkpoints WHERE session_id = $1
		ORDER BY recorded_at DESC LIMIT $2`, sessionID, limit)
	if err != nil {
		return nil, fmt.Errorf("journey: trail: %w", err)
	}
	defer rows.Close()
	out := []*Checkpoint{}
	for rows.Next() {
		cp := &Checkpoint{}
		if err := rows.Scan(&cp.ID, &cp.SessionID, &cp.RecordedAt, &cp.Lat, &cp.Lng, &cp.SocPct, &cp.OdometerM); err != nil {
			return nil, fmt.Errorf("journey: scan checkpoint: %w", err)
		}
		out = append(out, cp)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("journey: trail: %w", err)
	}
	return out, nil
}

// VehicleEfficiency returns the 90-day Wh/km mean for trip-capable
// drives. Kept in parity with tripplanner.vehicleEfficiency (same
// predicates and 50..500 guard) so both surfaces plan from the same
// number; ok=false falls back to the shared default.
func (s *Store) VehicleEfficiency(ctx context.Context, vehicleID int64) (eff float64, ok bool, err error) {
	var v *float64
	err = s.db.Pool.QueryRow(ctx, `
		SELECT CASE
		WHEN SUM(distance_m) > 0 THEN
			SUM(COALESCE(energy_used_wh, 0)) * 1000.0
			/ SUM(distance_m)
		END
		FROM drives
		WHERE vehicle_id = $1 AND distance_m > 1609
		  AND energy_used_wh > 0
		  AND start_soc_pct > end_soc_pct
		  AND started_at > NOW() - INTERVAL '90 days'`, vehicleID).Scan(&v)
	if err != nil {
		return 0, false, fmt.Errorf("journey: efficiency: %w", err)
	}
	if v == nil || *v <= 50 || *v > 500 {
		return 0, false, nil
	}
	return *v, true, nil
}
