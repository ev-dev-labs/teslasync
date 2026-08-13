package geofence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// =============================================================================
// repo_rates.go — time-versioned electricity-rate CRUD for the
// charging-place pricing feature (migration
// 000228_geofence_charging_place_pricing).
//
// geofence_rates is the ONE normalized, effective-dated source of truth for a
// place's rate history: there is deliberately no separate mutable
// "current rate" column on geofences. "The current rate" is simply whichever
// row's half-open [effective_from, effective_to) interval contains the
// query instant. Non-overlap per geofence is enforced by the
// database (a GIST exclusion constraint), not just application code, so a
// concurrent double-write can never silently corrupt history.
// =============================================================================

// ErrRateConflict is returned when creating/replacing a rate would overlap
// an existing interval for the same geofence — mapped from the underlying
// PostgreSQL exclusion-constraint violation (SQLSTATE 23P01).
var ErrRateConflict = errors.New("geofence rate interval conflicts with an existing rate")

// ErrRateNotFound is returned when a rate id does not exist for the given
// (or any) geofence.
var ErrRateNotFound = errors.New("geofence rate not found")

// ErrRateInUse is returned when a rate is already referenced by one or more
// charging sessions. Historical tariff provenance is immutable once used.
var ErrRateInUse = errors.New("geofence rate is referenced by charging sessions")

// ErrRateImmutable is returned when deleting a rate that has already become
// effective. Only unused future schedules may be cancelled.
var ErrRateImmutable = errors.New("effective geofence rates are immutable")

// ErrGeofenceNotFound is returned by mutation-only methods (MarkReviewed,
// Archive, Unarchive) that have nothing else to return when the targeted
// geofence id does not exist.
var ErrGeofenceNotFound = errors.New("geofence not found")

// classifyRateConflict maps a PostgreSQL exclusion/unique-violation error
// into ErrRateConflict, mirroring the classifyPGError pattern used by
// internal/database/fleetops for the same class of problem.
func classifyRateConflict(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23P01", "23505":
			return fmt.Errorf("%w: %v", ErrRateConflict, err)
		}
	}
	return err
}

const geofenceRateColumns = `id, geofence_id, rate_per_wh, currency, effective_from, effective_to, created_at`

func scanGeofenceRate(row pgx.Row) (*systemmodel.GeofenceRate, error) {
	gr := &systemmodel.GeofenceRate{}
	err := row.Scan(&gr.ID, &gr.GeofenceID, &gr.RatePerWh, &gr.Currency, &gr.EffectiveFrom, &gr.EffectiveTo, &gr.CreatedAt)
	if err != nil {
		return nil, err
	}
	return gr, nil
}

// CreateRate inserts a new rate version for a geofence.
//
// If the geofence currently has an open interval (effective_to IS NULL), and
// the new rate is also open-ended, the old interval is auto-closed
// (effective_to := new.EffectiveFrom) in the same transaction — this is the
// primary "add a new version, the old one silently ends where the new one
// begins" business flow (e.g. $0.10/kWh before 2026-08-27, $0.12/kWh from
// then on) and produces adjacent, non-overlapping half-open intervals so the
// exclusion constraint never trips for this common case.
//
// A bounded interval never auto-closes an existing open rate. If it overlaps
// one, the database rejects it rather than silently truncating the current
// rate and leaving a pricing gap after the bounded interval ends.
//
// Any other overlap (e.g. a backdated insert into the middle of history) is
// rejected by the database's GIST exclusion constraint and surfaced as
// ErrRateConflict — arbitrary
// insert-in-the-middle-and-cascade-shift is intentionally not supported.
func (r *GeofenceRepo) CreateRate(ctx context.Context, gr *systemmodel.GeofenceRate) error {
	if err := validateGeofenceRate(gr); err != nil {
		return err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("geofence rates create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if gr.EffectiveTo == nil {
		const closeOpenSQL = `
UPDATE geofence_rates
   SET effective_to = $2
 WHERE geofence_id = $1
   AND effective_to IS NULL
   AND effective_from < $2`
		if _, err := tx.Exec(ctx, closeOpenSQL, gr.GeofenceID, gr.EffectiveFrom); err != nil {
			return fmt.Errorf("geofence rates create close-open: %w", err)
		}
	}

	const insertSQL = `
INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at`
	if err := tx.QueryRow(ctx, insertSQL, gr.GeofenceID, gr.RatePerWh, gr.Currency, gr.EffectiveFrom, gr.EffectiveTo).
		Scan(&gr.ID, &gr.CreatedAt); err != nil {
		return classifyRateConflict(fmt.Errorf("geofence rates create insert: %w", err))
	}

	now := time.Now().UTC()
	if gr.IsActiveAt(now) {
		if err := applyCreatedCurrentRateToSessions(ctx, tx, gr); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("geofence rates create commit: %w", err)
	}
	return nil
}

// applyCreatedCurrentRateToSessions applies a newly-created rate to eligible,
// completed sessions already attributed to the place. Sessions inside the
// rate's interval receive authoritative geofence_tariff provenance. Older
// sessions not covered by any configured interval receive today's rate as a
// default_estimate, preserving the ability to replace it later with explicit
// historical pricing. Both updates share CreateRate's transaction.
func applyCreatedCurrentRateToSessions(ctx context.Context, tx pgx.Tx, gr *systemmodel.GeofenceRate) error {
	const applyExact = `
UPDATE charging_sessions
   SET cost_decimal  = ROUND(total_energy_added_wh::numeric * $3::numeric, 6),
       cost_currency = $4,
       rate_id       = $2,
       cost_source   = 'geofence_tariff'
 WHERE geofence_id = $1
   AND ended_at IS NOT NULL
   AND total_energy_added_wh IS NOT NULL
   AND started_at >= $5
   AND ($6::timestamptz IS NULL OR started_at < $6)
   AND (
       cost_source = 'default_estimate'
       OR (cost_source IS NULL AND cost_decimal IS NULL)
       OR (cost_source = 'unknown' AND cost_decimal IS NULL)
       OR (cost_source = 'geofence_tariff' AND rate_id = $2)
   )`
	if _, err := tx.Exec(
		ctx,
		applyExact,
		gr.GeofenceID,
		gr.ID,
		gr.RatePerWh,
		gr.Currency,
		gr.EffectiveFrom,
		gr.EffectiveTo,
	); err != nil {
		return fmt.Errorf("geofence rates create apply exact sessions: %w", err)
	}

	const applyUncovered = `
UPDATE charging_sessions AS cs
   SET cost_decimal  = ROUND(cs.total_energy_added_wh::numeric * $3::numeric, 6),
       cost_currency = $4,
       rate_id       = $2,
       cost_source   = 'default_estimate'
 WHERE cs.geofence_id = $1
   AND cs.ended_at IS NOT NULL
   AND cs.total_energy_added_wh IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
         FROM geofence_rates AS historical
        WHERE historical.geofence_id = cs.geofence_id
          AND historical.effective_from <= cs.started_at
          AND (historical.effective_to IS NULL OR historical.effective_to > cs.started_at)
   )
   AND (
       (cs.cost_source IS NULL AND cs.cost_decimal IS NULL)
       OR (cs.cost_source = 'unknown' AND cs.cost_decimal IS NULL)
       OR (
           cs.cost_source = 'default_estimate'
           AND (cs.rate_id IS NULL OR cs.rate_id = $2)
       )
   )`
	if _, err := tx.Exec(ctx, applyUncovered, gr.GeofenceID, gr.ID, gr.RatePerWh, gr.Currency); err != nil {
		return fmt.Errorf("geofence rates create apply current estimate: %w", err)
	}
	return nil
}

// validateGeofenceRate applies the non-negotiable rate-integrity checks
// (non-negative finite rate, ISO-4217-shaped currency, well-formed interval)
// at the repository boundary so every write path — handler-driven create,
// discovery enrichment, future import — gets the same guarantees regardless
// of caller.
func validateGeofenceRate(gr *systemmodel.GeofenceRate) error {
	if gr == nil {
		return fmt.Errorf("geofence rate: nil")
	}
	if gr.GeofenceID <= 0 {
		return fmt.Errorf("geofence rate: geofence_id required")
	}
	if math.IsNaN(gr.RatePerWh) || math.IsInf(gr.RatePerWh, 0) ||
		gr.RatePerWh < 0 || gr.RatePerWh >= 1_000_000 {
		return fmt.Errorf("geofence rate: rate_per_wh must be finite and between 0 (inclusive) and 1000000 (exclusive)")
	}
	if len(gr.Currency) != 3 {
		return fmt.Errorf("geofence rate: currency must be a 3-letter ISO 4217 code")
	}
	for _, c := range gr.Currency {
		if c < 'A' || c > 'Z' {
			return fmt.Errorf("geofence rate: currency must be uppercase ISO 4217 (got %q)", gr.Currency)
		}
	}
	if gr.EffectiveFrom.IsZero() {
		return fmt.Errorf("geofence rate: effective_from required")
	}
	if gr.EffectiveTo != nil && !gr.EffectiveTo.After(gr.EffectiveFrom) {
		return fmt.Errorf("geofence rate: effective_to must be after effective_from")
	}
	return nil
}

// ListRates returns every rate version for a geofence, newest
// effective_from first — the shape the rate-history UI panel renders
// directly.
func (r *GeofenceRepo) ListRates(ctx context.Context, geofenceID int64) ([]*systemmodel.GeofenceRate, error) {
	query := `SELECT ` + geofenceRateColumns + ` FROM geofence_rates WHERE geofence_id=$1 ORDER BY effective_from DESC`
	rows, err := r.pool.Query(ctx, query, geofenceID)
	if err != nil {
		return nil, fmt.Errorf("geofence rates list query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.GeofenceRate
	for rows.Next() {
		gr, err := scanGeofenceRate(rows)
		if err != nil {
			return nil, fmt.Errorf("geofence rates list scan: %w", err)
		}
		out = append(out, gr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence rates list iter: %w", err)
	}
	return out, nil
}

// GetRateByID fetches a single rate version, scoped to a geofence so a
// caller can never accidentally address another place's rate by guessing an
// id. Returns (nil, nil) when not found.
func (r *GeofenceRepo) GetRateByID(ctx context.Context, geofenceID, rateID int64) (*systemmodel.GeofenceRate, error) {
	query := `SELECT ` + geofenceRateColumns + ` FROM geofence_rates WHERE id=$1 AND geofence_id=$2`
	gr, err := scanGeofenceRate(r.pool.QueryRow(ctx, query, rateID, geofenceID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("geofence rates get %d: %w", rateID, err)
	}
	return gr, nil
}

// GetActiveRateAt returns the rate version whose half-open interval
// contains instant `at` for the given geofence, or (nil, nil) when no rate
// has been configured for that instant. Normal pricing resolves with the
// charging session's started_at so historical rates remain stable. The
// legacy startup backfill performs a second lookup at "now" only when the
// first lookup finds no historical interval, and records that fallback as
// default_estimate rather than authoritative geofence_tariff provenance.
func (r *GeofenceRepo) GetActiveRateAt(ctx context.Context, geofenceID int64, at time.Time) (*systemmodel.GeofenceRate, error) {
	query := `SELECT ` + geofenceRateColumns + ` FROM geofence_rates
WHERE geofence_id=$1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2)
ORDER BY effective_from DESC
LIMIT 1`
	gr, err := scanGeofenceRate(r.pool.QueryRow(ctx, query, geofenceID, at))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("geofence rates get_active_at: %w", err)
	}
	return gr, nil
}

// ListActiveRatesNow returns the currently-active rate for every geofence
// that has one configured — i.e. the row whose half-open interval contains
// this instant, which (thanks to the no-overlap exclusion constraint) is
// never more than one row per geofence, and is NOT always the row with
// effective_to IS NULL (a geofence with a future-dated rate already queued
// has its "now-active" row closed at that future effective_from). This
// powers the Charging Places list/summary view's "current rate" column in
// one query instead of one round trip per place.
func (r *GeofenceRepo) ListActiveRatesNow(ctx context.Context) ([]*systemmodel.GeofenceRate, error) {
	query := `SELECT ` + geofenceRateColumns + ` FROM geofence_rates
WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
ORDER BY geofence_id`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("geofence rates list_active_now query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.GeofenceRate
	for rows.Next() {
		gr, err := scanGeofenceRate(rows)
		if err != nil {
			return nil, fmt.Errorf("geofence rates list_active_now scan: %w", err)
		}
		out = append(out, gr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence rates list_active_now iter: %w", err)
	}
	return out, nil
}

// DeleteRate cancels an unused future rate schedule. Once a rate has become
// effective or is referenced by any charging session it is immutable.
//
// Cancelling a future rate also extends its immediately preceding adjacent
// interval through the cancelled interval, so removing a scheduled change
// cannot leave a silent pricing gap.
func (r *GeofenceRepo) DeleteRate(ctx context.Context, geofenceID, rateID int64) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("geofence rates delete begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const loadSQL = `
SELECT ` + geofenceRateColumns + `, effective_from > now()
FROM geofence_rates
WHERE id=$1 AND geofence_id=$2
FOR UPDATE`
	rate := &systemmodel.GeofenceRate{}
	var future bool
	err = tx.QueryRow(ctx, loadSQL, rateID, geofenceID).Scan(
		&rate.ID, &rate.GeofenceID, &rate.RatePerWh, &rate.Currency,
		&rate.EffectiveFrom, &rate.EffectiveTo, &rate.CreatedAt, &future,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRateNotFound
	}
	if err != nil {
		return fmt.Errorf("geofence rates delete load %d: %w", rateID, err)
	}
	if !future {
		return ErrRateImmutable
	}

	var inUse bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM charging_sessions WHERE rate_id=$1)`,
		rateID,
	).Scan(&inUse); err != nil {
		return fmt.Errorf("geofence rates delete usage check %d: %w", rateID, err)
	}
	if inUse {
		return ErrRateInUse
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM geofence_rates WHERE id=$1 AND geofence_id=$2`,
		rateID, geofenceID,
	); err != nil {
		return fmt.Errorf("geofence rates delete %d: %w", rateID, err)
	}

	// Restore continuity by extending the adjacent predecessor through the
	// cancelled interval. If no predecessor exists, the place simply remains
	// unpriced until the next configured interval.
	if _, err := tx.Exec(ctx, `
UPDATE geofence_rates
   SET effective_to = $3
 WHERE geofence_id = $1
   AND effective_to = $2`,
		geofenceID, rate.EffectiveFrom, rate.EffectiveTo,
	); err != nil {
		return fmt.Errorf("geofence rates delete restore predecessor %d: %w", rateID, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("geofence rates delete commit: %w", err)
	}
	return nil
}
