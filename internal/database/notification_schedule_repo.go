package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// NotificationScheduleRepo manages notification schedules.
type NotificationScheduleRepo struct {
	db *DB
}

func NewNotificationScheduleRepo(db *DB) *NotificationScheduleRepo {
	return &NotificationScheduleRepo{db: db}
}

func (r *NotificationScheduleRepo) Create(ctx context.Context, s *models.NotificationSchedule) error {
	query := `INSERT INTO notification_schedules (channel_id, title, message, cron_expr, scheduled_at, next_run_at, enabled)
		VALUES ($1, $2, $3, $4, $5, COALESCE($5, NOW()), $6) RETURNING id, created_at`
	return r.db.Pool.QueryRow(ctx, query,
		s.ChannelID, s.Title, s.Message, s.CronExpr, s.ScheduledAt, s.Enabled,
	).Scan(&s.ID, &s.CreatedAt)
}

func (r *NotificationScheduleRepo) List(ctx context.Context) ([]*models.NotificationSchedule, error) {
	query := `SELECT id, channel_id, title, message, cron_expr, scheduled_at, last_run_at, next_run_at, enabled, created_at, updated_at
		FROM notification_schedules ORDER BY created_at DESC`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.NotificationSchedule
	for rows.Next() {
		s := &models.NotificationSchedule{}
		if err := rows.Scan(&s.ID, &s.ChannelID, &s.Title, &s.Message, &s.CronExpr,
			&s.ScheduledAt, &s.LastRunAt, &s.NextRunAt, &s.Enabled, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, nil
}

func (r *NotificationScheduleRepo) GetDue(ctx context.Context) ([]*models.NotificationSchedule, error) {
	query := `SELECT id, channel_id, title, message, cron_expr, scheduled_at, last_run_at, next_run_at, enabled, created_at, updated_at
		FROM notification_schedules WHERE enabled = true AND next_run_at <= $1 ORDER BY next_run_at`
	rows, err := r.db.Pool.Query(ctx, query, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.NotificationSchedule
	for rows.Next() {
		s := &models.NotificationSchedule{}
		if err := rows.Scan(&s.ID, &s.ChannelID, &s.Title, &s.Message, &s.CronExpr,
			&s.ScheduledAt, &s.LastRunAt, &s.NextRunAt, &s.Enabled, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, nil
}

func (r *NotificationScheduleRepo) MarkRun(ctx context.Context, id int64, nextRun *time.Time) error {
	now := time.Now().UTC()
	if nextRun != nil {
		_, err := r.db.Pool.Exec(ctx,
			`UPDATE notification_schedules SET last_run_at = $1, next_run_at = $2, updated_at = $1 WHERE id = $3`,
			now, nextRun, id)
		return err
	}
	// One-time schedule — disable after run
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_schedules SET last_run_at = $1, enabled = false, updated_at = $1 WHERE id = $2`,
		now, id)
	return err
}

func (r *NotificationScheduleRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM notification_schedules WHERE id = $1`, id)
	return err
}

// NotificationPreferenceRepo manages per-event notification preferences.
type NotificationPreferenceRepo struct {
	db *DB
}

func NewNotificationPreferenceRepo(db *DB) *NotificationPreferenceRepo {
	return &NotificationPreferenceRepo{db: db}
}

func (r *NotificationPreferenceRepo) GetByChannel(ctx context.Context, channelID int64) ([]*models.NotificationPreference, error) {
	query := `SELECT id, channel_id, event_type, enabled, created_at
		FROM notification_preferences WHERE channel_id = $1 ORDER BY event_type`
	rows, err := r.db.Pool.Query(ctx, query, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.NotificationPreference
	for rows.Next() {
		p := &models.NotificationPreference{}
		if err := rows.Scan(&p.ID, &p.ChannelID, &p.EventType, &p.Enabled, &p.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, nil
}

func (r *NotificationPreferenceRepo) Upsert(ctx context.Context, channelID int64, eventType string, enabled bool) error {
	query := `INSERT INTO notification_preferences (channel_id, event_type, enabled)
		VALUES ($1, $2, $3)
		ON CONFLICT (channel_id, event_type) DO UPDATE SET enabled = EXCLUDED.enabled`
	_, err := r.db.Pool.Exec(ctx, query, channelID, eventType, enabled)
	return err
}

func (r *NotificationPreferenceRepo) IsEnabled(ctx context.Context, channelID int64, eventType string) bool {
	var enabled bool
	err := r.db.Pool.QueryRow(ctx,
		`SELECT enabled FROM notification_preferences WHERE channel_id = $1 AND event_type = $2`,
		channelID, eventType).Scan(&enabled)
	if err != nil {
		return true // default to enabled if no preference set
	}
	return enabled
}

// NotificationMetricRepo tracks delivery analytics.
type NotificationMetricRepo struct {
	db *DB
}

func NewNotificationMetricRepo(db *DB) *NotificationMetricRepo {
	return &NotificationMetricRepo{db: db}
}

func (r *NotificationMetricRepo) Record(ctx context.Context, channelID int64, success bool, latencyMs int) error {
	sent, failed := 0, 0
	if success {
		sent = 1
	} else {
		failed = 1
	}
	query := `INSERT INTO notification_metrics (channel_id, date, total_sent, total_failed, avg_latency_ms)
		VALUES ($1, CURRENT_DATE, $2, $3, $4)
		ON CONFLICT (channel_id, date) DO UPDATE SET
			total_sent = notification_metrics.total_sent + EXCLUDED.total_sent,
			total_failed = notification_metrics.total_failed + EXCLUDED.total_failed,
			avg_latency_ms = (notification_metrics.avg_latency_ms * (notification_metrics.total_sent + notification_metrics.total_failed) + EXCLUDED.avg_latency_ms)
				/ (notification_metrics.total_sent + notification_metrics.total_failed + 1)`
	_, err := r.db.Pool.Exec(ctx, query, channelID, sent, failed, latencyMs)
	return err
}

func (r *NotificationMetricRepo) GetByChannel(ctx context.Context, channelID int64, days int) ([]*models.NotificationMetric, error) {
	query := `SELECT id, channel_id, date, total_sent, total_failed, avg_latency_ms
		FROM notification_metrics WHERE channel_id = $1 AND date >= CURRENT_DATE - $2::INTEGER
		ORDER BY date DESC`
	rows, err := r.db.Pool.Query(ctx, query, channelID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.NotificationMetric
	for rows.Next() {
		m := &models.NotificationMetric{}
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.Date, &m.TotalSent, &m.TotalFailed, &m.AvgLatencyMs); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func (r *NotificationMetricRepo) GetSummary(ctx context.Context, days int) (map[string]interface{}, error) {
	query := `SELECT
		COALESCE(SUM(total_sent), 0) as total_sent,
		COALESCE(SUM(total_failed), 0) as total_failed,
		COALESCE(AVG(avg_latency_ms), 0) as avg_latency,
		COUNT(DISTINCT channel_id) as active_channels
		FROM notification_metrics WHERE date >= CURRENT_DATE - $1::INTEGER`
	var totalSent, totalFailed, activeChannels int64
	var avgLatency float64
	err := r.db.Pool.QueryRow(ctx, query, days).Scan(&totalSent, &totalFailed, &avgLatency, &activeChannels)
	if err != nil {
		return nil, err
	}
	deliveryRate := float64(0)
	if totalSent+totalFailed > 0 {
		deliveryRate = float64(totalSent) / float64(totalSent+totalFailed) * 100
	}
	return map[string]interface{}{
		"total_sent":      totalSent,
		"total_failed":    totalFailed,
		"delivery_rate":   deliveryRate,
		"avg_latency_ms":  avgLatency,
		"active_channels": activeChannels,
		"period_days":     days,
	}, nil
}
