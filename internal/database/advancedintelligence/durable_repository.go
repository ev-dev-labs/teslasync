package advancedintelligence

import (
	"context"
	"errors"
	"fmt"
	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/advancedintelligence"
	"github.com/jackc/pgx/v5"
	"math"
)

type txRunner func(context.Context, func(database.DBTX) error) error

type DurableRepository struct {
	q      database.DBTX
	withTx txRunner
}

func NewDurableRepository(db *database.DB) *DurableRepository {
	if db == nil || db.Pool == nil {
		panic("advancedintelligence.NewDurableRepository: db and db.Pool must not be nil")
	}
	return &DurableRepository{
		q: db.Pool,
		withTx: func(ctx context.Context, fn func(database.DBTX) error) error {
			return db.WithTx(ctx, func(tx pgx.Tx) error { return fn(tx) })
		},
	}
}

const modelCardColumns = `id, subject, vehicle_id, model_name, model_version,
	task, version, epsilon_budget, epsilon_spent, round_count,
	latest_sample_count, latest_metric_wh_per_m, latest_status, created_at, updated_at`

func scanModelCard(row pgx.Row) (*port.FederatedModelCardRecord, error) {
	var card port.FederatedModelCardRecord
	if err := row.Scan(
		&card.ID,
		&card.Subject,
		&card.VehicleID,
		&card.ModelName,
		&card.ModelVersion,
		&card.Task,
		&card.Version,
		&card.EpsilonBudget,
		&card.EpsilonSpent,
		&card.RoundCount,
		&card.LatestSampleCount,
		&card.LatestMetricWhPerM,
		&card.LatestStatus,
		&card.CreatedAt,
		&card.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &card, nil
}

func scanRound(row pgx.Row) (*port.FederatedRoundRecord, error) {
	var round port.FederatedRoundRecord
	if err := row.Scan(
		&round.ID,
		&round.ModelCardID,
		&round.RoundNumber,
		&round.RequestedEpsilon,
		&round.EpsilonSpent,
		&round.SampleCount,
		&round.LocalMetricWhPerM,
		&round.ClippedUpdatePct,
		&round.Status,
		&round.StartedAt,
		&round.CompletedAt,
	); err != nil {
		return nil, err
	}
	return &round, nil
}

func (r *DurableRepository) ListModelCards(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) ([]port.FederatedModelCardRecord, int, float64, float64, error) {
	const query = `
		SELECT ` + modelCardColumns + `, COUNT(*) OVER()::int,
		       COALESCE(SUM(epsilon_budget) OVER(), 0),
		       COALESCE(SUM(epsilon_spent) OVER(), 0)
		FROM advanced_federated_model_cards
		WHERE subject = $1 AND vehicle_id = $2
		ORDER BY updated_at DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list federated model cards: %w", err)
	}
	defer rows.Close()

	items := make([]port.FederatedModelCardRecord, 0)
	total := 0
	totalBudget := 0.0
	totalSpent := 0.0
	for rows.Next() {
		var item port.FederatedModelCardRecord
		if err := rows.Scan(
			&item.ID,
			&item.Subject,
			&item.VehicleID,
			&item.ModelName,
			&item.ModelVersion,
			&item.Task,
			&item.Version,
			&item.EpsilonBudget,
			&item.EpsilonSpent,
			&item.RoundCount,
			&item.LatestSampleCount,
			&item.LatestMetricWhPerM,
			&item.LatestStatus,
			&item.CreatedAt,
			&item.UpdatedAt,
			&total,
			&totalBudget,
			&totalSpent,
		); err != nil {
			return nil, 0, 0, 0, fmt.Errorf("scan federated model card: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("iterate federated model cards: %w", err)
	}
	return items, total, totalBudget, totalSpent, nil
}

func (r *DurableRepository) CreateRound(
	ctx context.Context,
	params port.CreateRoundParams,
) (*port.FederatedModelCardRecord, *port.FederatedRoundRecord, error) {
	var resultCard *port.FederatedModelCardRecord
	var resultRound *port.FederatedRoundRecord
	err := r.withTx(ctx, func(tx database.DBTX) error {
		created := false
		card, err := scanModelCard(tx.QueryRow(ctx, `
			SELECT `+modelCardColumns+`
			FROM advanced_federated_model_cards
			WHERE subject = $1 AND vehicle_id = $2
			  AND model_name = $3 AND model_version = $4
			FOR UPDATE`,
			params.Subject,
			params.VehicleID,
			params.ModelName,
			params.ModelVersion,
		))
		if errors.Is(err, pgx.ErrNoRows) {
			if params.ExpectedVersion != 0 {
				return port.ErrConflict
			}
			card, err = scanModelCard(tx.QueryRow(ctx, `
				INSERT INTO advanced_federated_model_cards (
					subject, vehicle_id, model_name, model_version, task,
					version, epsilon_budget, epsilon_spent, round_count,
					created_at, updated_at
				)
				VALUES ($1, $2, $3, $4, $5, 1, $6, 0, 0, $7, $7)
				ON CONFLICT (subject, vehicle_id, model_name, model_version) DO NOTHING
				RETURNING `+modelCardColumns,
				params.Subject,
				params.VehicleID,
				params.ModelName,
				params.ModelVersion,
				params.Task,
				params.EpsilonBudget,
				params.Now.UTC(),
			))
			if errors.Is(err, pgx.ErrNoRows) {
				return port.ErrConflict
			}
			if err != nil {
				return fmt.Errorf("insert federated model card: %w", err)
			}
			created = true
		} else if err != nil {
			return fmt.Errorf("lock federated model card: %w", err)
		} else {
			if card.Version != params.ExpectedVersion ||
				card.Task != params.Task ||
				math.Abs(card.EpsilonBudget-params.EpsilonBudget) > 1e-9 {
				return port.ErrConflict
			}
		}

		epsilonSpent := 0.0
		if params.Status == "completed" {
			epsilonSpent = params.Epsilon
		}
		if card.EpsilonSpent+epsilonSpent > card.EpsilonBudget+1e-9 {
			return port.ErrPrivacyBudgetExhausted
		}

		versionIncrement := 1
		if created {
			versionIncrement = 0
		}
		card, err = scanModelCard(tx.QueryRow(ctx, `
			UPDATE advanced_federated_model_cards
			SET version = version + $11,
			    epsilon_spent = epsilon_spent + $6,
			    round_count = round_count + 1,
			    latest_sample_count = $7,
			    latest_metric_wh_per_m = $8,
			    latest_status = $9,
			    updated_at = $10
			WHERE subject = $1 AND vehicle_id = $2
			  AND model_name = $3 AND model_version = $4
			  AND version = $5
			RETURNING `+modelCardColumns,
			params.Subject,
			params.VehicleID,
			params.ModelName,
			params.ModelVersion,
			card.Version,
			epsilonSpent,
			params.SampleCount,
			params.LocalMetricWhPerM,
			params.Status,
			params.Now.UTC(),
			versionIncrement,
		))
		if errors.Is(err, pgx.ErrNoRows) {
			return port.ErrConflict
		}
		if err != nil {
			return fmt.Errorf("update federated model card: %w", err)
		}

		round, err := scanRound(tx.QueryRow(ctx, `
			INSERT INTO advanced_federated_rounds (
				model_card_id, round_number, requested_epsilon, epsilon_spent,
				sample_count, local_metric_wh_per_m, clipped_update_pct,
				status, started_at, completed_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $8)
			RETURNING id, model_card_id, round_number, requested_epsilon,
			          epsilon_spent, sample_count, local_metric_wh_per_m,
			          clipped_update_pct, status, started_at, completed_at`,
			card.ID,
			card.RoundCount,
			params.Epsilon,
			epsilonSpent,
			params.SampleCount,
			params.LocalMetricWhPerM,
			params.Status,
			params.Now.UTC(),
		))
		if err != nil {
			return fmt.Errorf("insert federated round: %w", err)
		}
		resultCard = card
		resultRound = round
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create federated round: %w", err)
	}
	return resultCard, resultRound, nil
}

const experimentColumns = `id, subject, vehicle_id, intervention_kind, metric,
	baseline_start, baseline_end, treatment_start, treatment_end, state,
	version, created_at, updated_at`

const resultColumns = `experiment_id, baseline_sample_count, treatment_sample_count,
	confounder_coverage_pct, baseline_energy_wh_per_m, treatment_energy_wh_per_m,
	effect_energy_wh_per_m, baseline_success_pct, treatment_success_pct,
	effect_success_pct, baseline_speed_mps, treatment_speed_mps,
	effect_speed_mps, estimated_at`

func scanExperiment(row pgx.Row) (*port.CausalExperimentRecord, error) {
	var experiment port.CausalExperimentRecord
	if err := row.Scan(
		&experiment.ID,
		&experiment.Subject,
		&experiment.VehicleID,
		&experiment.InterventionKind,
		&experiment.Metric,
		&experiment.BaselineStart,
		&experiment.BaselineEnd,
		&experiment.TreatmentStart,
		&experiment.TreatmentEnd,
		&experiment.State,
		&experiment.Version,
		&experiment.CreatedAt,
		&experiment.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &experiment, nil
}

func scanResult(row pgx.Row) (*port.CausalResultRecord, error) {
	var result port.CausalResultRecord
	if err := row.Scan(
		&result.ExperimentID,
		&result.BaselineSampleCount,
		&result.TreatmentSampleCount,
		&result.ConfounderCoveragePct,
		&result.BaselineEnergyWhPerM,
		&result.TreatmentEnergyWhPerM,
		&result.EffectEnergyWhPerM,
		&result.BaselineSuccessPct,
		&result.TreatmentSuccessPct,
		&result.EffectSuccessPct,
		&result.BaselineSpeedMps,
		&result.TreatmentSpeedMps,
		&result.EffectSpeedMps,
		&result.EstimatedAt,
	); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *DurableRepository) ListExperiments(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) ([]port.CausalExperimentRecord, []port.CausalResultRecord, int, error) {
	const query = `
		SELECT
			e.id, e.subject, e.vehicle_id, e.intervention_kind, e.metric,
			e.baseline_start, e.baseline_end, e.treatment_start, e.treatment_end,
			e.state, e.version, e.created_at, e.updated_at,
			r.experiment_id, r.baseline_sample_count, r.treatment_sample_count,
			r.confounder_coverage_pct, r.baseline_energy_wh_per_m,
			r.treatment_energy_wh_per_m, r.effect_energy_wh_per_m,
			r.baseline_success_pct, r.treatment_success_pct, r.effect_success_pct,
			r.baseline_speed_mps, r.treatment_speed_mps, r.effect_speed_mps,
			r.estimated_at,
			COUNT(*) OVER()::int
		FROM advanced_causal_experiments e
		JOIN advanced_causal_results r ON r.experiment_id = e.id
		WHERE e.subject = $1 AND e.vehicle_id = $2
		ORDER BY e.created_at DESC, e.id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.q.Query(ctx, query, subject, vehicleID, limit, offset)
	if err != nil {
		return nil, nil, 0, fmt.Errorf("list causal experiments: %w", err)
	}
	defer rows.Close()

	experiments := make([]port.CausalExperimentRecord, 0)
	results := make([]port.CausalResultRecord, 0)
	total := 0
	for rows.Next() {
		var experiment port.CausalExperimentRecord
		var result port.CausalResultRecord
		if err := rows.Scan(
			&experiment.ID,
			&experiment.Subject,
			&experiment.VehicleID,
			&experiment.InterventionKind,
			&experiment.Metric,
			&experiment.BaselineStart,
			&experiment.BaselineEnd,
			&experiment.TreatmentStart,
			&experiment.TreatmentEnd,
			&experiment.State,
			&experiment.Version,
			&experiment.CreatedAt,
			&experiment.UpdatedAt,
			&result.ExperimentID,
			&result.BaselineSampleCount,
			&result.TreatmentSampleCount,
			&result.ConfounderCoveragePct,
			&result.BaselineEnergyWhPerM,
			&result.TreatmentEnergyWhPerM,
			&result.EffectEnergyWhPerM,
			&result.BaselineSuccessPct,
			&result.TreatmentSuccessPct,
			&result.EffectSuccessPct,
			&result.BaselineSpeedMps,
			&result.TreatmentSpeedMps,
			&result.EffectSpeedMps,
			&result.EstimatedAt,
			&total,
		); err != nil {
			return nil, nil, 0, fmt.Errorf("scan causal experiment: %w", err)
		}
		experiments = append(experiments, experiment)
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, 0, fmt.Errorf("iterate causal experiments: %w", err)
	}
	return experiments, results, total, nil
}

func (r *DurableRepository) CreateExperiment(
	ctx context.Context,
	params port.CreateExperimentParams,
) (*port.CausalExperimentRecord, *port.CausalResultRecord, error) {
	var resultExperiment *port.CausalExperimentRecord
	var resultRecord *port.CausalResultRecord
	err := r.withTx(ctx, func(tx database.DBTX) error {
		experiment, err := scanExperiment(tx.QueryRow(ctx, `
			INSERT INTO advanced_causal_experiments (
				subject, vehicle_id, intervention_kind, metric,
				baseline_start, baseline_end, treatment_start, treatment_end,
				state, version, created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)
			RETURNING `+experimentColumns,
			params.Subject,
			params.Experiment.VehicleID,
			params.Experiment.InterventionKind,
			params.Experiment.Metric,
			params.Experiment.BaselineStart.UTC(),
			params.Experiment.BaselineEnd.UTC(),
			params.Experiment.TreatmentStart.UTC(),
			params.Experiment.TreatmentEnd.UTC(),
			params.Experiment.State,
			params.Experiment.CreatedAt.UTC(),
		))
		if err != nil {
			return fmt.Errorf("insert causal experiment: %w", err)
		}
		params.Result.ExperimentID = experiment.ID
		result, err := scanResult(tx.QueryRow(ctx, `
			INSERT INTO advanced_causal_results (
				experiment_id, baseline_sample_count, treatment_sample_count,
				confounder_coverage_pct, baseline_energy_wh_per_m,
				treatment_energy_wh_per_m, effect_energy_wh_per_m,
				baseline_success_pct, treatment_success_pct, effect_success_pct,
				baseline_speed_mps, treatment_speed_mps, effect_speed_mps,
				estimated_at
			)
			VALUES (
				$1, $2, $3, $4, $5, $6, $7,
				$8, $9, $10, $11, $12, $13, $14
			)
			RETURNING `+resultColumns,
			params.Result.ExperimentID,
			params.Result.BaselineSampleCount,
			params.Result.TreatmentSampleCount,
			params.Result.ConfounderCoveragePct,
			params.Result.BaselineEnergyWhPerM,
			params.Result.TreatmentEnergyWhPerM,
			params.Result.EffectEnergyWhPerM,
			params.Result.BaselineSuccessPct,
			params.Result.TreatmentSuccessPct,
			params.Result.EffectSuccessPct,
			params.Result.BaselineSpeedMps,
			params.Result.TreatmentSpeedMps,
			params.Result.EffectSpeedMps,
			params.Result.EstimatedAt.UTC(),
		))
		if err != nil {
			return fmt.Errorf("insert causal result: %w", err)
		}
		resultExperiment = experiment
		resultRecord = result
		return nil
	})
	if err != nil {
		return nil, nil, fmt.Errorf("create causal experiment: %w", err)
	}
	return resultExperiment, resultRecord, nil
}
