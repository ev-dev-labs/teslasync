package benchmark

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
	"github.com/jackc/pgx/v5"
)

var ErrPrivacyBudgetExhausted = errors.New("privacy benchmark epsilon budget exhausted")

type txRunner func(context.Context, func(database.DBTX) error) error

// Repo persists consent, clipped contributions, DP releases and ledger rows.
type Repo struct {
	q      database.DBTX
	withTx txRunner
}

func NewRepo(db *database.DB) *Repo {
	if db == nil || db.Pool == nil {
		panic("benchmark.NewRepo: db and db.Pool must not be nil")
	}
	return &Repo{
		q: db.Pool,
		withTx: func(ctx context.Context, fn func(database.DBTX) error) error {
			return db.WithTx(ctx, func(tx pgx.Tx) error { return fn(tx) })
		},
	}
}

const consentColumns = `id, subject, vehicle_id, status, epsilon_budget,
	opted_in_at, revoked_at, updated_at`

func scanConsent(row pgx.Row) (*models.PrivacyBenchmarkConsent, error) {
	var c models.PrivacyBenchmarkConsent
	if err := row.Scan(
		&c.ID, &c.Subject, &c.VehicleID, &c.Status, &c.EpsilonBudget,
		&c.OptedInAt, &c.RevokedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repo) GetConsent(ctx context.Context, subject string, vehicleID int64) (*models.PrivacyBenchmarkConsent, error) {
	c, err := scanConsent(r.q.QueryRow(ctx, `
		SELECT `+consentColumns+`
		FROM privacy_benchmark_consents
		WHERE subject = $1 AND vehicle_id = $2`, subject, vehicleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("benchmark consent get: %w", err)
	}
	return c, nil
}

func (r *Repo) UpsertConsent(ctx context.Context, subject string, vehicleID int64, now time.Time) (*models.PrivacyBenchmarkConsent, error) {
	c, err := scanConsent(r.q.QueryRow(ctx, `
		INSERT INTO privacy_benchmark_consents
			(subject, vehicle_id, status, opted_in_at, revoked_at, updated_at)
		VALUES ($1, $2, 'active', $3, NULL, $3)
		ON CONFLICT (subject, vehicle_id) DO UPDATE
		SET status = 'active',
		    opted_in_at = EXCLUDED.opted_in_at,
		    revoked_at = NULL,
		    updated_at = EXCLUDED.updated_at
		RETURNING `+consentColumns, subject, vehicleID, now.UTC()))
	if err != nil {
		return nil, fmt.Errorf("benchmark consent upsert: %w", err)
	}
	return c, nil
}

// RevokeAndDeleteClippedData stops future use and removes the subject's
// per-vehicle clipped contribution rows. DP releases and ledger rows remain:
// released aggregate statistics cannot be "unpublished", and retaining the
// ledger prevents revoke/re-opt-in from resetting lifetime epsilon spend.
func (r *Repo) RevokeAndDeleteClippedData(ctx context.Context, subject string, vehicleID int64, now time.Time) (bool, error) {
	found := false
	err := r.withTx(ctx, func(tx database.DBTX) error {
		var consentID int64
		err := tx.QueryRow(ctx, `
			UPDATE privacy_benchmark_consents
			SET status = 'revoked', revoked_at = $3, updated_at = $3
			WHERE subject = $1 AND vehicle_id = $2
			RETURNING id`, subject, vehicleID, now.UTC()).Scan(&consentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("revoke consent: %w", err)
		}
		found = true
		if _, err := tx.Exec(ctx,
			`DELETE FROM privacy_benchmark_contributions WHERE consent_id = $1`,
			consentID,
		); err != nil {
			return fmt.Errorf("delete clipped contributions: %w", err)
		}
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("benchmark revoke: %w", err)
	}
	return found, nil
}

func (r *Repo) EpsilonSpent(ctx context.Context, consentID int64) (float64, error) {
	var spent float64
	if err := r.q.QueryRow(ctx, `
		SELECT COALESCE(SUM(epsilon_spent), 0)
		FROM privacy_benchmark_privacy_ledger
		WHERE consent_id = $1`, consentID).Scan(&spent); err != nil {
		return 0, fmt.Errorf("benchmark epsilon spent: %w", err)
	}
	return spent, nil
}

// Candidate contains only the transient identity inputs needed to derive a
// coarse cohort. Model and VIN are read in memory and are never persisted in
// benchmark tables or returned by the API.
type Candidate struct {
	ConsentID     int64
	VehicleID     int64
	EpsilonBudget float64
	Model         *string
	VIN           string
}

func (r *Repo) CandidateForSubject(ctx context.Context, subject string, vehicleID int64) (*Candidate, error) {
	var c Candidate
	err := r.q.QueryRow(ctx, `
		SELECT c.id, c.vehicle_id, c.epsilon_budget, v.model, v.vin
		FROM privacy_benchmark_consents c
		JOIN vehicles v ON v.id = c.vehicle_id
		WHERE c.subject = $1 AND c.vehicle_id = $2 AND c.status = 'active'`,
		subject, vehicleID,
	).Scan(&c.ConsentID, &c.VehicleID, &c.EpsilonBudget, &c.Model, &c.VIN)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("benchmark candidate get: %w", err)
	}
	return &c, nil
}

func (r *Repo) ListActiveCandidates(ctx context.Context) ([]Candidate, error) {
	rows, err := r.q.Query(ctx, `
		SELECT c.id, c.vehicle_id, c.epsilon_budget, v.model, v.vin
		FROM privacy_benchmark_consents c
		JOIN vehicles v ON v.id = c.vehicle_id
		WHERE c.status = 'active'
		ORDER BY c.id
		LIMIT $1`, 1000)
	if err != nil {
		return nil, fmt.Errorf("benchmark candidates query: %w", err)
	}
	defer rows.Close()

	out := make([]Candidate, 0)
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ConsentID, &c.VehicleID, &c.EpsilonBudget, &c.Model, &c.VIN); err != nil {
			return nil, fmt.Errorf("benchmark candidate scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("benchmark candidate rows: %w", err)
	}
	return out, nil
}
