package teslabudget

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/jackc/pgx/v5"
)

type Repo struct {
	db     database.DBTX
	policy tesla.BudgetPolicy
}

func New(db database.DBTX, policy tesla.BudgetPolicy) *Repo {
	return &Repo{
		db:     db,
		policy: policy,
	}
}

func (r *Repo) Reserve(ctx context.Context, charge tesla.BudgetCharge) (tesla.BudgetSnapshot, error) {
	if r == nil || r.db == nil {
		return tesla.BudgetSnapshot{}, errors.New("Tesla API budget repository is not initialized")
	}
	if err := charge.Validate(); err != nil {
		return r.emptySnapshot(), err
	}
	if !r.policy.Enabled() {
		return r.emptySnapshot(), nil
	}

	backgroundRequests := int64(1)
	backgroundCost := charge.EstimatedCostMicroUSD
	if charge.UsesCommandReserve {
		backgroundRequests = 0
		backgroundCost = 0
	}

	category := string(charge.Category)
	snapshot := r.emptySnapshot()
	var reserved bool
	err := r.db.QueryRow(ctx, `
		WITH budget_period AS (
			SELECT (NOW() AT TIME ZONE 'UTC')::date AS budget_date
		),
		reservation AS (
			INSERT INTO tesla_api_budget_usage (
				budget_date,
				total_requests,
				estimated_cost_microusd,
				background_requests,
				background_cost_microusd,
				vehicle_data_requests,
				wake_up_requests,
				command_requests,
				vehicle_specs_requests,
				other_requests,
				updated_at
			)
			SELECT
				budget_period.budget_date,
				1,
				$1::bigint,
				$2::bigint,
				$3::bigint,
				CASE WHEN $4::text = 'vehicle_data' THEN 1 ELSE 0 END,
				CASE WHEN $4::text = 'wake_up' THEN 1 ELSE 0 END,
				CASE WHEN $4::text = 'command' THEN 1 ELSE 0 END,
				CASE WHEN $4::text = 'vehicle_specs' THEN 1 ELSE 0 END,
				CASE WHEN $4::text = 'other' THEN 1 ELSE 0 END,
				NOW()
			FROM budget_period
			WHERE $1::bigint <= $5::bigint AND $3::bigint <= $6::bigint
			ON CONFLICT (budget_date) DO UPDATE SET
				total_requests = tesla_api_budget_usage.total_requests + 1,
				estimated_cost_microusd = tesla_api_budget_usage.estimated_cost_microusd + EXCLUDED.estimated_cost_microusd,
				background_requests = tesla_api_budget_usage.background_requests + EXCLUDED.background_requests,
				background_cost_microusd = tesla_api_budget_usage.background_cost_microusd + EXCLUDED.background_cost_microusd,
				vehicle_data_requests = tesla_api_budget_usage.vehicle_data_requests + EXCLUDED.vehicle_data_requests,
				wake_up_requests = tesla_api_budget_usage.wake_up_requests + EXCLUDED.wake_up_requests,
				command_requests = tesla_api_budget_usage.command_requests + EXCLUDED.command_requests,
				vehicle_specs_requests = tesla_api_budget_usage.vehicle_specs_requests + EXCLUDED.vehicle_specs_requests,
				other_requests = tesla_api_budget_usage.other_requests + EXCLUDED.other_requests,
				updated_at = NOW()
			WHERE
				tesla_api_budget_usage.estimated_cost_microusd + EXCLUDED.estimated_cost_microusd <= $5::bigint
				AND (
					EXCLUDED.background_cost_microusd = 0
					OR tesla_api_budget_usage.background_cost_microusd + EXCLUDED.background_cost_microusd <= $6::bigint
				)
			RETURNING
				budget_date,
				total_requests,
				estimated_cost_microusd,
				background_requests,
				background_cost_microusd,
				vehicle_data_requests,
				wake_up_requests,
				command_requests,
				vehicle_specs_requests,
				other_requests
		)
		SELECT
			budget_date,
			total_requests,
			estimated_cost_microusd,
			background_requests,
			background_cost_microusd,
			vehicle_data_requests,
			wake_up_requests,
			command_requests,
			vehicle_specs_requests,
			other_requests,
			TRUE AS reserved
		FROM reservation
		UNION ALL
		SELECT
			budget_period.budget_date,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			0::bigint,
			FALSE AS reserved
		FROM budget_period
		WHERE NOT EXISTS (SELECT 1 FROM reservation)`,
		charge.EstimatedCostMicroUSD,
		backgroundRequests,
		backgroundCost,
		category,
		r.policy.DailyLimitMicroUSD,
		r.policy.BackgroundLimitMicroUSD(),
	).Scan(
		&snapshot.PeriodStart,
		&snapshot.TotalRequests,
		&snapshot.EstimatedCostMicroUSD,
		&snapshot.BackgroundRequests,
		&snapshot.BackgroundCostMicroUSD,
		&snapshot.VehicleDataRequests,
		&snapshot.WakeUpRequests,
		&snapshot.CommandRequests,
		&snapshot.VehicleSpecsRequests,
		&snapshot.OtherRequests,
		&reserved,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return tesla.BudgetSnapshot{}, fmt.Errorf("reserve Tesla API budget returned no decision row: %w", err)
	}
	if err != nil {
		return tesla.BudgetSnapshot{}, fmt.Errorf("reserve Tesla API budget: %w", err)
	}
	if !reserved {
		current, snapshotErr := r.snapshotForPeriod(ctx, snapshot.PeriodStart)
		if snapshotErr != nil {
			return tesla.BudgetSnapshot{}, fmt.Errorf("read rejected Tesla API budget period: %w", snapshotErr)
		}
		return current, &tesla.BudgetExceededError{Category: charge.Category, Snapshot: current}
	}
	r.completeSnapshot(&snapshot)
	return snapshot, nil
}

func (r *Repo) Snapshot(ctx context.Context) (tesla.BudgetSnapshot, error) {
	if r == nil || r.db == nil {
		return tesla.BudgetSnapshot{}, errors.New("Tesla API budget repository is not initialized")
	}

	snapshot := r.emptySnapshot()
	err := r.db.QueryRow(ctx, `
		SELECT
			d.budget_date,
			COALESCE(u.total_requests, 0),
			COALESCE(u.estimated_cost_microusd, 0),
			COALESCE(u.background_requests, 0),
			COALESCE(u.background_cost_microusd, 0),
			COALESCE(u.vehicle_data_requests, 0),
			COALESCE(u.wake_up_requests, 0),
			COALESCE(u.command_requests, 0),
			COALESCE(u.vehicle_specs_requests, 0),
			COALESCE(u.other_requests, 0)
		FROM (
			SELECT (NOW() AT TIME ZONE 'UTC')::date AS budget_date
		) AS d
		LEFT JOIN tesla_api_budget_usage AS u USING (budget_date)`,
	).Scan(
		&snapshot.PeriodStart,
		&snapshot.TotalRequests,
		&snapshot.EstimatedCostMicroUSD,
		&snapshot.BackgroundRequests,
		&snapshot.BackgroundCostMicroUSD,
		&snapshot.VehicleDataRequests,
		&snapshot.WakeUpRequests,
		&snapshot.CommandRequests,
		&snapshot.VehicleSpecsRequests,
		&snapshot.OtherRequests,
	)
	if err != nil {
		return tesla.BudgetSnapshot{}, fmt.Errorf("read Tesla API budget: %w", err)
	}
	r.completeSnapshot(&snapshot)
	return snapshot, nil
}

func (r *Repo) snapshotForPeriod(ctx context.Context, periodStart time.Time) (tesla.BudgetSnapshot, error) {
	snapshot := r.emptySnapshot()
	err := r.db.QueryRow(ctx, `
		SELECT
			d.budget_date,
			COALESCE(u.total_requests, 0),
			COALESCE(u.estimated_cost_microusd, 0),
			COALESCE(u.background_requests, 0),
			COALESCE(u.background_cost_microusd, 0),
			COALESCE(u.vehicle_data_requests, 0),
			COALESCE(u.wake_up_requests, 0),
			COALESCE(u.command_requests, 0),
			COALESCE(u.vehicle_specs_requests, 0),
			COALESCE(u.other_requests, 0)
		FROM (
			SELECT $1::date AS budget_date
		) AS d
		LEFT JOIN tesla_api_budget_usage AS u USING (budget_date)`,
		periodStart,
	).Scan(
		&snapshot.PeriodStart,
		&snapshot.TotalRequests,
		&snapshot.EstimatedCostMicroUSD,
		&snapshot.BackgroundRequests,
		&snapshot.BackgroundCostMicroUSD,
		&snapshot.VehicleDataRequests,
		&snapshot.WakeUpRequests,
		&snapshot.CommandRequests,
		&snapshot.VehicleSpecsRequests,
		&snapshot.OtherRequests,
	)
	if err != nil {
		return tesla.BudgetSnapshot{}, fmt.Errorf("read Tesla API budget period %s: %w", periodStart.Format(time.DateOnly), err)
	}
	r.completeSnapshot(&snapshot)
	return snapshot, nil
}

func (r *Repo) emptySnapshot() tesla.BudgetSnapshot {
	now := time.Now().UTC()
	periodStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return tesla.BudgetSnapshot{
		PeriodStart:            periodStart,
		ResetAt:                periodStart.Add(24 * time.Hour),
		DailyLimitMicroUSD:     r.policy.DailyLimitMicroUSD,
		CommandReserveMicroUSD: r.policy.CommandReserveMicroUSD,
	}
}

func (r *Repo) completeSnapshot(snapshot *tesla.BudgetSnapshot) {
	snapshot.PeriodStart = time.Date(
		snapshot.PeriodStart.Year(),
		snapshot.PeriodStart.Month(),
		snapshot.PeriodStart.Day(),
		0, 0, 0, 0, time.UTC,
	)
	snapshot.ResetAt = snapshot.PeriodStart.Add(24 * time.Hour)
	snapshot.DailyLimitMicroUSD = r.policy.DailyLimitMicroUSD
	snapshot.CommandReserveMicroUSD = r.policy.CommandReserveMicroUSD
}
