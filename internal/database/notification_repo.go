package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// NotificationRepo provides notification channel and log data access.
type NotificationRepo struct {
	db *DB
}

func NewNotificationRepo(db *DB) *NotificationRepo {
	return &NotificationRepo{db: db}
}

// --- Channels ---

func (r *NotificationRepo) CreateChannel(ctx context.Context, ch *models.NotificationChannel) error {
	cfgJSON, err := json.Marshal(ch.Config)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO notification_channels (name, type, config, enabled, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
		ch.Name, ch.Type, cfgJSON, ch.Enabled, now,
	).Scan(&ch.ID)
}

func (r *NotificationRepo) UpdateChannel(ctx context.Context, ch *models.NotificationChannel) error {
	cfgJSON, err := json.Marshal(ch.Config)
	if err != nil {
		return err
	}
	_, err = r.db.Pool.Exec(ctx,
		`UPDATE notification_channels SET name=$1, type=$2, config=$3, enabled=$4, updated_at=$5 WHERE id=$6`,
		ch.Name, ch.Type, cfgJSON, ch.Enabled, time.Now().UTC(), ch.ID,
	)
	return err
}

func (r *NotificationRepo) DeleteChannel(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM notification_channels WHERE id=$1`, id)
	return err
}

func (r *NotificationRepo) GetChannel(ctx context.Context, id int64) (*models.NotificationChannel, error) {
	ch := &models.NotificationChannel{}
	var cfgJSON []byte
	err := r.db.Pool.QueryRow(ctx,
		`SELECT id, name, type, config, enabled, created_at, updated_at FROM notification_channels WHERE id=$1`, id,
	).Scan(&ch.ID, &ch.Name, &ch.Type, &cfgJSON, &ch.Enabled, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, err
	}
	ch.Config = make(map[string]string)
	if err := json.Unmarshal(cfgJSON, &ch.Config); err != nil {
		return nil, fmt.Errorf("unmarshalling config: %w", err)
	}
	return ch, nil
}

func (r *NotificationRepo) GetAllChannels(ctx context.Context) ([]*models.NotificationChannel, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, name, type, config, enabled, created_at, updated_at FROM notification_channels ORDER BY created_at DESC LIMIT 1000`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []*models.NotificationChannel
	for rows.Next() {
		ch := &models.NotificationChannel{}
		var cfgJSON []byte
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.Type, &cfgJSON, &ch.Enabled, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, err
		}
		ch.Config = make(map[string]string)
		if err := json.Unmarshal(cfgJSON, &ch.Config); err != nil {
			return nil, fmt.Errorf("unmarshalling config: %w", err)
		}
		channels = append(channels, ch)
	}
	return channels, rows.Err()
}

func (r *NotificationRepo) ToggleChannel(ctx context.Context, id int64, enabled bool) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_channels SET enabled=$1, updated_at=$2 WHERE id=$3`,
		enabled, time.Now().UTC(), id,
	)
	return err
}

// --- Logs ---

func (r *NotificationRepo) CreateLog(ctx context.Context, l *models.NotificationLog) error {
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO notification_logs (channel_id, alert_id, title, message, status, error, created_at, sent_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		l.ChannelID, l.AlertID, l.Title, l.Message, l.Status, l.Error, time.Now().UTC(), l.SentAt,
	).Scan(&l.ID)
}

func (r *NotificationRepo) GetLogs(ctx context.Context, limit, offset int) ([]*models.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, channel_id, alert_id, title, message, status, error, created_at, sent_at
		 FROM notification_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.NotificationLog
	for rows.Next() {
		l := &models.NotificationLog{}
		if err := rows.Scan(&l.ID, &l.ChannelID, &l.AlertID, &l.Title, &l.Message, &l.Status, &l.Error, &l.CreatedAt, &l.SentAt); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

func (r *NotificationRepo) GetLogsByChannel(ctx context.Context, channelID int64, limit int) ([]*models.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, channel_id, alert_id, title, message, status, error, created_at, sent_at
		 FROM notification_logs WHERE channel_id=$1 ORDER BY created_at DESC LIMIT $2`, channelID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.NotificationLog
	for rows.Next() {
		l := &models.NotificationLog{}
		if err := rows.Scan(&l.ID, &l.ChannelID, &l.AlertID, &l.Title, &l.Message, &l.Status, &l.Error, &l.CreatedAt, &l.SentAt); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

func (r *NotificationRepo) GetStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	var total, sent, failed, pending, channels, enabled int64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM notification_logs),
			(SELECT COUNT(*) FROM notification_logs WHERE status='sent'),
			(SELECT COUNT(*) FROM notification_logs WHERE status='failed'),
			(SELECT COUNT(*) FROM notification_logs WHERE status='pending'),
			(SELECT COUNT(*) FROM notification_channels),
			(SELECT COUNT(*) FROM notification_channels WHERE enabled=true)
	`).Scan(&total, &sent, &failed, &pending, &channels, &enabled)
	if err != nil {
		return nil, err
	}

	stats["total_sent"] = total
	stats["sent"] = sent
	stats["failed"] = failed
	stats["pending"] = pending
	stats["total_channels"] = channels
	stats["enabled_channels"] = enabled

	return stats, nil
}

// --- Chatbot ---

type ChatRepo struct {
	db *DB
}

func NewChatRepo(db *DB) *ChatRepo {
	return &ChatRepo{db: db}
}

func (r *ChatRepo) SaveMessage(ctx context.Context, m *models.ChatMessage) error {
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO chatbot_messages (session_id, role, content, created_at)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		m.SessionID, m.Role, m.Content, time.Now().UTC(),
	).Scan(&m.ID)
}

func (r *ChatRepo) GetHistory(ctx context.Context, sessionID string, limit int) ([]*models.ChatMessage, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, session_id, role, content, created_at FROM chatbot_messages
		 WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2`, sessionID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []*models.ChatMessage
	for rows.Next() {
		m := &models.ChatMessage{}
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

func (r *ChatRepo) GetSessions(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT DISTINCT session_id FROM chatbot_messages ORDER BY session_id DESC LIMIT $1`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}
