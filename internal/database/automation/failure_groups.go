package automation

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	"github.com/jackc/pgx/v5"
)

func (r *AutomationHistoryRepo) ListFailureGroups(ctx context.Context, vehicleID *int64, now time.Time, limit int) ([]actioncenter.AutomationFailureGroup, error) {
	if limit <= 0 {
		return nil, nil
	}
	// The engine records one history row per run. Retries and the number of
	// failed action steps must not increase the run count.
	const query = `
		WITH ordered AS (
			SELECT h.id, h.automation_id, a.name, h.vehicle_id, h.completed_at,
				row_number() OVER runs AS ordinal,
				count(*) FILTER (WHERE h.status NOT IN ('failed','partial')) OVER runs AS resolved
			FROM automation_history h
			JOIN automations a ON a.id=h.automation_id AND a.enabled
			WHERE h.automation_revision = a.updated_at
			  AND h.completed_at BETWEEN $1 AND $2 AND h.completed_at >= h.triggered_at
			  AND h.status IN ('failed','partial','success','skipped','cancelled')
			WINDOW runs AS (PARTITION BY h.automation_id ORDER BY h.completed_at DESC,h.id DESC
			                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
		), groups AS (
			SELECT automation_id,count(*) AS failure_count,min(completed_at) AS first_ended_at
			FROM ordered WHERE resolved=0 GROUP BY automation_id HAVING count(*)>=2
		)
		SELECT o.automation_id,o.name,o.id,o.vehicle_id,g.failure_count,g.first_ended_at,o.completed_at
		FROM groups g JOIN ordered o ON o.automation_id=g.automation_id AND o.ordinal=1
		LEFT JOIN vehicles v ON v.id=o.vehicle_id AND v.archived_at IS NULL
		WHERE ($3::bigint IS NULL OR o.vehicle_id=$3) AND (o.vehicle_id IS NULL OR v.id IS NOT NULL)
		ORDER BY o.completed_at DESC,o.id DESC LIMIT $4`
	rows, err := r.db.Pool.Query(ctx, query, now.Add(-actioncenter.AutomationFailureWindow), now, vehicleID, min(limit, 16))
	if err != nil {
		return nil, fmt.Errorf("list repeated automation outcomes: %w", err)
	}
	groups, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (actioncenter.AutomationFailureGroup, error) {
		var group actioncenter.AutomationFailureGroup
		err := row.Scan(&group.AutomationID, &group.Name, &group.HistoryID, &group.VehicleID,
			&group.FailureCount, &group.FirstEndedAt, &group.LastEndedAt)
		return group, err
	})
	if err != nil {
		return nil, fmt.Errorf("scan repeated automation outcomes: %w", err)
	}
	return groups, nil
}
