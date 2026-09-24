package alert

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

type EventCooldownRepo struct{ db *database.DB }

func NewEventCooldownRepo(db *database.DB) *EventCooldownRepo { return &EventCooldownRepo{db: db} }

func (r *EventCooldownRepo) Claim(ctx context.Context, ruleID int64, subject string, now time.Time, cooldownMin int) (bool, error) {
	var firedAt time.Time
	err := r.db.Pool.QueryRow(ctx, `INSERT INTO event_alert_cooldown(rule_id,subject,fired_at)
		VALUES ($1,$2,$3) ON CONFLICT (rule_id,subject) DO UPDATE SET fired_at=EXCLUDED.fired_at
		WHERE event_alert_cooldown.fired_at <= EXCLUDED.fired_at - ($4 * interval '1 minute')
		RETURNING fired_at`, ruleID, subject, now, cooldownMin).Scan(&firedAt)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim event alert rule %d: %w", ruleID, err)
	}
	return true, nil
}
