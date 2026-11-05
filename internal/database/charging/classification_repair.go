package charging

import (
	"context"
	"fmt"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

func (r *ChargingRepo) ClassificationRepairBatch(ctx context.Context, afterID int64, limit int) ([]*chargingmodel.ChargingSession, error) {
	if limit < 1 || limit > 1000 || afterID < 0 {
		return nil, fmt.Errorf("invalid classification repair cursor or batch size")
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT `+chargingColumns+`
FROM charging_sessions WHERE ended_at IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("query classification repair batch: %w", err)
	}
	defer rows.Close()
	sessions := make([]*chargingmodel.ChargingSession, 0)
	for rows.Next() {
		session, err := scanChargingSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan classification repair batch: %w", err)
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

// RepairChargerType uses compare-and-swap so a reviewed dry-run never overwrites
// a concurrent correction. NULL remains the persisted unknown classification.
func (r *ChargingRepo) RepairChargerType(ctx context.Context, id int64, previous, next *string) (bool, error) {
	tag, err := r.db.Pool.Exec(ctx, `
UPDATE charging_sessions SET charger_type = $3
WHERE id = $1 AND ended_at IS NOT NULL
  AND charger_type IS NOT DISTINCT FROM $2::text
  AND charger_type IS DISTINCT FROM $3::text`, id, previous, next)
	if err != nil {
		return false, fmt.Errorf("repair charging classification: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}
