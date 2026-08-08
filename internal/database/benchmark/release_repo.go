package benchmark

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
	"github.com/jackc/pgx/v5"
)

type ReleaseKey struct {
	PeriodStart       time.Time
	PeriodEnd         time.Time
	ModelFamily       string
	ModelYearBucket   int16
	SourceVersionHash []byte
	MechanismVersion  int16
}

type CreateReleaseInput struct {
	Release    models.PrivacyBenchmarkRelease
	Metrics    []models.PrivacyBenchmarkMetric
	Bins       []models.PrivacyBenchmarkReleaseBin
	ConsentIDs []int64
}

const releaseColumns = `id, period_start, period_end, model_family,
	model_year_bucket, source_version_hash, mechanism_version,
	minimum_cohort_size, epsilon_spent, suppressed, suppression_reason, created_at`

func scanRelease(row pgx.Row) (*models.PrivacyBenchmarkRelease, error) {
	var rel models.PrivacyBenchmarkRelease
	if err := row.Scan(
		&rel.ID, &rel.PeriodStart, &rel.PeriodEnd, &rel.ModelFamily,
		&rel.ModelYearBucket, &rel.SourceVersionHash, &rel.MechanismVersion,
		&rel.MinimumCohortSize, &rel.EpsilonSpent, &rel.Suppressed,
		&rel.SuppressionReason, &rel.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &rel, nil
}

func findReleaseOn(ctx context.Context, q database.DBTX, key ReleaseKey) (*models.PrivacyBenchmarkRelease, error) {
	rel, err := scanRelease(q.QueryRow(ctx, `
		SELECT `+releaseColumns+`
		FROM privacy_benchmark_releases
		WHERE period_start = $1
		  AND period_end = $2
		  AND model_family = $3
		  AND model_year_bucket = $4
		  AND source_version_hash = $5
		  AND mechanism_version = $6`,
		key.PeriodStart.UTC(), key.PeriodEnd.UTC(), key.ModelFamily,
		key.ModelYearBucket, key.SourceVersionHash, key.MechanismVersion,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("benchmark release find: %w", err)
	}
	return rel, nil
}

func (r *Repo) FindRelease(ctx context.Context, key ReleaseKey) (*models.PrivacyBenchmarkRelease, error) {
	rel, err := findReleaseOn(ctx, r.q, key)
	if err != nil || rel == nil {
		return rel, err
	}
	if err := r.hydrateRelease(ctx, rel); err != nil {
		return nil, err
	}
	return rel, nil
}

func (r *Repo) CreateRelease(ctx context.Context, in CreateReleaseInput) (*models.PrivacyBenchmarkRelease, bool, error) {
	var releaseID int64
	created := false
	err := r.withTx(ctx, func(tx database.DBTX) error {
		key := ReleaseKey{
			PeriodStart:       in.Release.PeriodStart,
			PeriodEnd:         in.Release.PeriodEnd,
			ModelFamily:       in.Release.ModelFamily,
			ModelYearBucket:   in.Release.ModelYearBucket,
			SourceVersionHash: in.Release.SourceVersionHash,
			MechanismVersion:  in.Release.MechanismVersion,
		}
		existing, err := findReleaseOn(ctx, tx, key)
		if err != nil {
			return err
		}
		if existing != nil {
			releaseID = existing.ID
			return nil
		}

		if in.Release.EpsilonSpent > 0 {
			if err := lockConsents(ctx, tx, in.ConsentIDs); err != nil {
				return err
			}
			// A concurrent request for the same stable release may have
			// committed while this transaction waited for the consent locks.
			// Reuse it before accounting so a refresh cannot be mistaken for a
			// new spend when the first request consumed the last budget.
			existing, err = findReleaseOn(ctx, tx, key)
			if err != nil {
				return err
			}
			if existing != nil {
				releaseID = existing.ID
				return nil
			}
			if err := checkBudget(ctx, tx, in.ConsentIDs, in.Release.EpsilonSpent); err != nil {
				return err
			}
		}

		err = tx.QueryRow(ctx, `
			INSERT INTO privacy_benchmark_releases (
				period_start, period_end, model_family, model_year_bucket,
				source_version_hash, mechanism_version, minimum_cohort_size,
				epsilon_spent, suppressed, suppression_reason
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (
				period_start, period_end, model_family, model_year_bucket,
				source_version_hash, mechanism_version
			) DO NOTHING
			RETURNING id`,
			in.Release.PeriodStart.UTC(), in.Release.PeriodEnd.UTC(),
			in.Release.ModelFamily, in.Release.ModelYearBucket,
			in.Release.SourceVersionHash, in.Release.MechanismVersion,
			in.Release.MinimumCohortSize, in.Release.EpsilonSpent,
			in.Release.Suppressed, in.Release.SuppressionReason,
		).Scan(&releaseID)
		if errors.Is(err, pgx.ErrNoRows) {
			existing, findErr := findReleaseOn(ctx, tx, key)
			if findErr != nil {
				return findErr
			}
			if existing == nil {
				return errors.New("benchmark release conflict row disappeared")
			}
			releaseID = existing.ID
			return nil
		}
		if err != nil {
			return fmt.Errorf("benchmark release insert: %w", err)
		}

		for _, metric := range in.Metrics {
			if _, err := tx.Exec(ctx, `
				INSERT INTO privacy_benchmark_release_metrics (
					release_id, metric_name, unit, lower_bound, upper_bound,
					epsilon_spent, noisy_cohort_size, noisy_mean, noisy_p25,
					noisy_p75, noise_scale, suppressed, quality
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
				releaseID, metric.Name, metric.Unit, metric.LowerBound, metric.UpperBound,
				metric.EpsilonSpent, metric.NoisyCohortSize, metric.NoisyMean,
				metric.NoisyP25, metric.NoisyP75, metric.NoiseScale,
				metric.Suppressed, metric.Quality,
			); err != nil {
				return fmt.Errorf("benchmark release metric insert: %w", err)
			}
		}
		for _, bin := range in.Bins {
			if _, err := tx.Exec(ctx, `
				INSERT INTO privacy_benchmark_release_bins
					(release_id, metric_name, bin_index, noisy_count)
				VALUES ($1, $2, $3, $4)`,
				releaseID, bin.MetricName, bin.BinIndex, bin.NoisyCount,
			); err != nil {
				return fmt.Errorf("benchmark release bin insert: %w", err)
			}
		}
		for _, consentID := range in.ConsentIDs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO privacy_benchmark_release_memberships
					(consent_id, release_id)
				VALUES ($1, $2)`,
				consentID, releaseID,
			); err != nil {
				return fmt.Errorf("benchmark release membership insert: %w", err)
			}
		}
		if in.Release.EpsilonSpent > 0 {
			for _, consentID := range in.ConsentIDs {
				if _, err := tx.Exec(ctx, `
					INSERT INTO privacy_benchmark_privacy_ledger
						(consent_id, release_id, epsilon_spent)
					VALUES ($1, $2, $3)`,
					consentID, releaseID, in.Release.EpsilonSpent,
				); err != nil {
					return fmt.Errorf("benchmark ledger insert: %w", err)
				}
			}
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}

	rel, err := r.GetReleaseByID(ctx, releaseID)
	if err != nil {
		return nil, false, err
	}
	return rel, created, nil
}

func lockConsents(ctx context.Context, tx database.DBTX, consentIDs []int64) error {
	if len(consentIDs) == 0 {
		return errors.New("benchmark consent lock: empty consent set")
	}
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM privacy_benchmark_consents
		WHERE id = ANY($1) AND status = 'active'
		ORDER BY id
		FOR UPDATE`, consentIDs)
	if err != nil {
		return fmt.Errorf("benchmark consent lock: %w", err)
	}
	locked := 0
	for rows.Next() {
		locked++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("benchmark consent lock rows: %w", err)
	}
	if locked != len(consentIDs) {
		return errors.New("benchmark budget check: cohort membership changed")
	}
	return nil
}

func checkBudget(ctx context.Context, tx database.DBTX, consentIDs []int64, spend float64) error {
	if len(consentIDs) == 0 || spend <= 0 || math.IsNaN(spend) || math.IsInf(spend, 0) {
		return errors.New("benchmark budget check: invalid consent set or epsilon")
	}
	rows, err := tx.Query(ctx, `
		SELECT c.id, c.epsilon_budget, COALESCE(SUM(l.epsilon_spent), 0)
		FROM privacy_benchmark_consents c
		LEFT JOIN privacy_benchmark_privacy_ledger l ON l.consent_id = c.id
		WHERE c.id = ANY($1)
		GROUP BY c.id, c.epsilon_budget`, consentIDs)
	if err != nil {
		return fmt.Errorf("benchmark budget query: %w", err)
	}
	defer rows.Close()
	checked := 0
	for rows.Next() {
		var id int64
		var budget, spent float64
		if err := rows.Scan(&id, &budget, &spent); err != nil {
			return fmt.Errorf("benchmark budget scan: %w", err)
		}
		checked++
		if spent+spend > budget+1e-9 {
			return ErrPrivacyBudgetExhausted
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("benchmark budget rows: %w", err)
	}
	if checked != len(consentIDs) {
		return errors.New("benchmark budget check: missing consent")
	}
	return nil
}

func (r *Repo) GetReleaseByID(ctx context.Context, releaseID int64) (*models.PrivacyBenchmarkRelease, error) {
	rel, err := scanRelease(r.q.QueryRow(ctx, `
		SELECT `+releaseColumns+`
		FROM privacy_benchmark_releases
		WHERE id = $1`, releaseID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("benchmark release get: %w", err)
	}
	if err := r.hydrateRelease(ctx, rel); err != nil {
		return nil, err
	}
	return rel, nil
}

func (r *Repo) ListReleases(
	ctx context.Context,
	consentID int64,
	limit, offset int,
) ([]models.PrivacyBenchmarkRelease, error) {
	rows, err := r.q.Query(ctx, `
		SELECT r.id, r.period_start, r.period_end, r.model_family,
			r.model_year_bucket, r.source_version_hash,
			r.mechanism_version, r.minimum_cohort_size,
			r.epsilon_spent, r.suppressed, r.suppression_reason,
			r.created_at
		FROM privacy_benchmark_releases r
		WHERE EXISTS (
			SELECT 1
			FROM privacy_benchmark_release_memberships m
			WHERE m.release_id = r.id AND m.consent_id = $1
		)
		ORDER BY period_end DESC, id DESC
		LIMIT $2 OFFSET $3`, consentID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("benchmark releases query: %w", err)
	}
	defer rows.Close()

	out := make([]models.PrivacyBenchmarkRelease, 0)
	for rows.Next() {
		rel, err := scanRelease(rows)
		if err != nil {
			return nil, fmt.Errorf("benchmark release scan: %w", err)
		}
		out = append(out, *rel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("benchmark release rows: %w", err)
	}
	for i := range out {
		if err := r.hydrateRelease(ctx, &out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *Repo) hydrateRelease(ctx context.Context, rel *models.PrivacyBenchmarkRelease) error {
	rows, err := r.q.Query(ctx, `
		SELECT release_id, metric_name, unit, lower_bound, upper_bound,
			epsilon_spent, noisy_cohort_size, noisy_mean, noisy_p25,
			noisy_p75, noise_scale, suppressed, quality
		FROM privacy_benchmark_release_metrics
		WHERE release_id = $1
		ORDER BY metric_name`, rel.ID)
	if err != nil {
		return fmt.Errorf("benchmark release metrics query: %w", err)
	}
	defer rows.Close()

	rel.Metrics = make([]models.PrivacyBenchmarkMetric, 0, 4)
	for rows.Next() {
		var m models.PrivacyBenchmarkMetric
		if err := rows.Scan(
			&m.ReleaseID, &m.Name, &m.Unit, &m.LowerBound, &m.UpperBound,
			&m.EpsilonSpent, &m.NoisyCohortSize, &m.NoisyMean, &m.NoisyP25,
			&m.NoisyP75, &m.NoiseScale, &m.Suppressed, &m.Quality,
		); err != nil {
			return fmt.Errorf("benchmark release metric scan: %w", err)
		}
		rel.Metrics = append(rel.Metrics, m)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("benchmark release metric rows: %w", err)
	}
	return nil
}

func (r *Repo) ReleaseBins(ctx context.Context, releaseID int64) ([]models.PrivacyBenchmarkReleaseBin, error) {
	rows, err := r.q.Query(ctx, `
		SELECT release_id, metric_name, bin_index, noisy_count
		FROM privacy_benchmark_release_bins
		WHERE release_id = $1
		ORDER BY metric_name, bin_index`, releaseID)
	if err != nil {
		return nil, fmt.Errorf("benchmark release bins query: %w", err)
	}
	defer rows.Close()

	out := make([]models.PrivacyBenchmarkReleaseBin, 0, 40)
	for rows.Next() {
		var bin models.PrivacyBenchmarkReleaseBin
		if err := rows.Scan(&bin.ReleaseID, &bin.MetricName, &bin.BinIndex, &bin.NoisyCount); err != nil {
			return nil, fmt.Errorf("benchmark release bin scan: %w", err)
		}
		out = append(out, bin)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("benchmark release bin rows: %w", err)
	}
	return out, nil
}
