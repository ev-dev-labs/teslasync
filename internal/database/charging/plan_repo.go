package charging

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// ChargePlan represents a scheduled charging optimization plan.
type ChargePlan struct {
	ID             int64      `json:"id" db:"id"`
	VehicleID      int64      `json:"vehicle_id" db:"vehicle_id"`
	TargetSOC      int        `json:"target_soc" db:"target_soc"`
	DepartBy       *time.Time `json:"depart_by,omitempty" db:"depart_by"`
	ScheduledStart time.Time  `json:"scheduled_start" db:"scheduled_start"`
	ScheduledEnd   time.Time  `json:"scheduled_end" db:"scheduled_end"`
	RatePlan       string     `json:"rate_plan" db:"rate_plan"`
	EstimatedKWh   *float64   `json:"estimated_kwh,omitempty" db:"estimated_kwh"`
	EstimatedCost  *float64   `json:"estimated_cost,omitempty" db:"estimated_cost"`
	ChargeNowCost  *float64   `json:"charge_now_cost,omitempty" db:"charge_now_cost"`
	Savings        *float64   `json:"savings,omitempty" db:"savings"`
	Status         string     `json:"status" db:"status"`
	AppliedAt      *time.Time `json:"applied_at,omitempty" db:"applied_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt      time.Time  `json:"created_at" db:"created_at"`
}

// ChargePlanRepo provides data access for the charge_plans table.
type ChargePlanRepo struct {
	db *database.DB
}

// NewChargePlanRepo creates a new ChargePlanRepo.
func NewChargePlanRepo(db *database.DB) *ChargePlanRepo {
	return &ChargePlanRepo{db: db}
}

// Create inserts a new charge plan and sets its ID.
func (r *ChargePlanRepo) Create(ctx context.Context, p *ChargePlan) error {
	query := `
		INSERT INTO charge_plans (
			vehicle_id, target_soc, depart_by, scheduled_start, scheduled_end,
			rate_plan, estimated_kwh, estimated_cost, charge_now_cost, savings, status
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at`
	return r.db.Pool.QueryRow(ctx, query,
		p.VehicleID, p.TargetSOC, p.DepartBy, p.ScheduledStart, p.ScheduledEnd,
		p.RatePlan, p.EstimatedKWh, p.EstimatedCost, p.ChargeNowCost, p.Savings, p.Status,
	).Scan(&p.ID, &p.CreatedAt)
}

// GetByID returns a charge plan by its ID.
func (r *ChargePlanRepo) GetByID(ctx context.Context, id int64) (*ChargePlan, error) {
	p := &ChargePlan{}
	query := `
		SELECT id, vehicle_id, target_soc, depart_by, scheduled_start, scheduled_end,
		       rate_plan, estimated_kwh, estimated_cost, charge_now_cost, savings,
		       status, applied_at, completed_at, created_at
		FROM charge_plans WHERE id = $1`
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&p.ID, &p.VehicleID, &p.TargetSOC, &p.DepartBy, &p.ScheduledStart, &p.ScheduledEnd,
		&p.RatePlan, &p.EstimatedKWh, &p.EstimatedCost, &p.ChargeNowCost, &p.Savings,
		&p.Status, &p.AppliedAt, &p.CompletedAt, &p.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get charge plan %d: %w", id, err)
	}
	return p, nil
}

// ListByVehicle returns charge plans for a vehicle, most recent first.
func (r *ChargePlanRepo) ListByVehicle(ctx context.Context, vehicleID int64, limit, offset int) ([]*ChargePlan, error) {
	query := `
		SELECT id, vehicle_id, target_soc, depart_by, scheduled_start, scheduled_end,
		       rate_plan, estimated_kwh, estimated_cost, charge_now_cost, savings,
		       status, applied_at, completed_at, created_at
		FROM charge_plans
		WHERE vehicle_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list charge plans: %w", err)
	}
	defer rows.Close()

	var plans []*ChargePlan
	for rows.Next() {
		p := &ChargePlan{}
		if err := rows.Scan(
			&p.ID, &p.VehicleID, &p.TargetSOC, &p.DepartBy, &p.ScheduledStart, &p.ScheduledEnd,
			&p.RatePlan, &p.EstimatedKWh, &p.EstimatedCost, &p.ChargeNowCost, &p.Savings,
			&p.Status, &p.AppliedAt, &p.CompletedAt, &p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan charge plan: %w", err)
		}
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

// UpdateStatus updates the status and optional timestamp fields of a charge plan.
func (r *ChargePlanRepo) UpdateStatus(ctx context.Context, id int64, status string, appliedAt, completedAt *time.Time) error {
	query := `
		UPDATE charge_plans
		SET status = $2, applied_at = COALESCE($3, applied_at), completed_at = COALESCE($4, completed_at)
		WHERE id = $1`
	tag, err := r.db.Pool.Exec(ctx, query, id, status, appliedAt, completedAt)
	if err != nil {
		return fmt.Errorf("update charge plan status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("charge plan %d not found", id)
	}
	return nil
}
