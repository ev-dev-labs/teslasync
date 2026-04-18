package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHistoryRepo provides automation execution history data access.
type AutomationHistoryRepo struct {
	db *DB
}

func NewAutomationHistoryRepo(db *DB) *AutomationHistoryRepo {
	return &AutomationHistoryRepo{db: db}
}

const automationHistoryColumns = `id, automation_id, automation_name, vehicle_id,
	triggered_at, completed_at, duration_ms,
	trigger_type, trigger_snapshot,
	conditions_met, conditions_snapshot,
	actions_executed, actions_total, actions_succeeded, actions_failed,
	status, error, fsm_state, created_at`

func scanAutomationHistory(row pgx.Row) (*models.AutomationHistory, error) {
	h := &models.AutomationHistory{}
	err := row.Scan(
		&h.ID, &h.AutomationID, &h.AutomationName, &h.VehicleID,
		&h.TriggeredAt, &h.CompletedAt, &h.DurationMs,
		&h.TriggerType, &h.TriggerSnapshot,
		&h.ConditionsMet, &h.ConditionsSnapshot,
		&h.ActionsExecuted, &h.ActionsTotal, &h.ActionsSucceeded, &h.ActionsFailed,
		&h.Status, &h.Error, &h.FSMState, &h.CreatedAt,
	)
	return h, err
}

func (r *AutomationHistoryRepo) Create(ctx context.Context, h *models.AutomationHistory) error {
	query := `INSERT INTO automation_history (
		automation_id, automation_name, vehicle_id,
		triggered_at, trigger_type, trigger_snapshot,
		conditions_met, conditions_snapshot,
		actions_executed, actions_total, actions_succeeded, actions_failed,
		status, error, fsm_state
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
	RETURNING id, created_at`
	return r.db.Pool.QueryRow(ctx, query,
		h.AutomationID, h.AutomationName, h.VehicleID,
		h.TriggeredAt, h.TriggerType, h.TriggerSnapshot,
		h.ConditionsMet, h.ConditionsSnapshot,
		h.ActionsExecuted, h.ActionsTotal, h.ActionsSucceeded, h.ActionsFailed,
		h.Status, h.Error, h.FSMState,
	).Scan(&h.ID, &h.CreatedAt)
}

// Complete updates an execution record with final status and timing.
func (r *AutomationHistoryRepo) Complete(ctx context.Context, id int64, status string, errMsg *string, durationMs int) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE automation_history SET status=$2, error=$3, duration_ms=$4, completed_at=$5 WHERE id=$1`,
		id, status, errMsg, durationMs, now)
	if err != nil {
		return fmt.Errorf("complete automation history %d: %w", id, err)
	}
	return nil
}

func (r *AutomationHistoryRepo) GetByAutomation(ctx context.Context, automationID int64, limit, offset int) ([]*models.AutomationHistory, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := fmt.Sprintf(`SELECT %s FROM automation_history WHERE automation_id = $1 ORDER BY triggered_at DESC LIMIT $2 OFFSET $3`, automationHistoryColumns)
	rows, err := r.db.Pool.Query(ctx, query, automationID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("get history by automation: %w", err)
	}
	defer rows.Close()

	var results []*models.AutomationHistory
	for rows.Next() {
		h := &models.AutomationHistory{}
		if err := rows.Scan(
			&h.ID, &h.AutomationID, &h.AutomationName, &h.VehicleID,
			&h.TriggeredAt, &h.CompletedAt, &h.DurationMs,
			&h.TriggerType, &h.TriggerSnapshot,
			&h.ConditionsMet, &h.ConditionsSnapshot,
			&h.ActionsExecuted, &h.ActionsTotal, &h.ActionsSucceeded, &h.ActionsFailed,
			&h.Status, &h.Error, &h.FSMState, &h.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation history: %w", err)
		}
		results = append(results, h)
	}
	return results, rows.Err()
}

// CountSinceByAutomation returns the number of executions for a given automation
// since the specified time, counting only rows that consumed execution budget
// (running, success, partial, failed — not skipped or cancelled).
func (r *AutomationHistoryRepo) CountSinceByAutomation(ctx context.Context, automationID int64, since time.Time) (int, error) {
	var count int
	err := r.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM automation_history
		 WHERE automation_id = $1
		   AND triggered_at >= $2
		   AND status IN ('running', 'success', 'partial', 'failed')`,
		automationID, since).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count executions for automation %d since %v: %w", automationID, since, err)
	}
	return count, nil
}

func (r *AutomationHistoryRepo) GetRecent(ctx context.Context, limit int) ([]*models.AutomationHistory, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := fmt.Sprintf(`SELECT %s FROM automation_history ORDER BY triggered_at DESC LIMIT $1`, automationHistoryColumns)
	rows, err := r.db.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("get recent automation history: %w", err)
	}
	defer rows.Close()

	var results []*models.AutomationHistory
	for rows.Next() {
		h := &models.AutomationHistory{}
		if err := rows.Scan(
			&h.ID, &h.AutomationID, &h.AutomationName, &h.VehicleID,
			&h.TriggeredAt, &h.CompletedAt, &h.DurationMs,
			&h.TriggerType, &h.TriggerSnapshot,
			&h.ConditionsMet, &h.ConditionsSnapshot,
			&h.ActionsExecuted, &h.ActionsTotal, &h.ActionsSucceeded, &h.ActionsFailed,
			&h.Status, &h.Error, &h.FSMState, &h.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan automation history: %w", err)
		}
		results = append(results, h)
	}
	return results, rows.Err()
}
