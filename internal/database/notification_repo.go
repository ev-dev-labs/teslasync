package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

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
	now := time.Now().UTC()
	if err := r.db.Pool.QueryRow(ctx,
		`INSERT INTO notification_channels (name, kind, enabled, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		ch.Name, ch.Type, ch.Enabled, now,
	).Scan(&ch.ID); err != nil {
		return fmt.Errorf("insert channel: %w", err)
	}
	ch.CreatedAt = now
	ch.UpdatedAt = now
	if err := r.upsertChannelConfig(ctx, ch); err != nil {
		return fmt.Errorf("insert channel config: %w", err)
	}
	return nil
}

func (r *NotificationRepo) UpdateChannel(ctx context.Context, ch *models.NotificationChannel) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_channels SET name=$1, kind=$2, enabled=$3, updated_at=$4 WHERE id=$5`,
		ch.Name, ch.Type, ch.Enabled, time.Now().UTC(), ch.ID,
	)
	if err != nil {
		return fmt.Errorf("update channel: %w", err)
	}
	if err := r.upsertChannelConfig(ctx, ch); err != nil {
		return fmt.Errorf("update channel config: %w", err)
	}
	return nil
}

func (r *NotificationRepo) DeleteChannel(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM notification_channels WHERE id=$1`, id)
	return err
}

func (r *NotificationRepo) GetChannel(ctx context.Context, id int64) (*models.NotificationChannel, error) {
	ch := &models.NotificationChannel{}
	err := r.db.Pool.QueryRow(ctx,
		`SELECT id, name, kind, enabled, created_at, updated_at FROM notification_channels WHERE id=$1`, id,
	).Scan(&ch.ID, &ch.Name, &ch.Type, &ch.Enabled, &ch.CreatedAt, &ch.UpdatedAt)
	if err != nil {
		return nil, err
	}
	ch.Config, err = r.loadChannelConfig(ctx, ch.ID, ch.Type)
	if err != nil {
		return nil, fmt.Errorf("load channel config: %w", err)
	}
	return ch, nil
}

func (r *NotificationRepo) GetAllChannels(ctx context.Context) ([]*models.NotificationChannel, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, name, kind, enabled, created_at, updated_at FROM notification_channels ORDER BY created_at DESC LIMIT 1000`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []*models.NotificationChannel
	for rows.Next() {
		ch := &models.NotificationChannel{}
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.Enabled, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, ch)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, ch := range channels {
		ch.Config, err = r.loadChannelConfig(ctx, ch.ID, ch.Type)
		if err != nil {
			return nil, fmt.Errorf("load config for channel %d: %w", ch.ID, err)
		}
	}
	return channels, nil
}

// upsertChannelConfig inserts or updates the per-kind CTI child table row
// for the given channel, keyed off Config map entries.
func (r *NotificationRepo) upsertChannelConfig(ctx context.Context, ch *models.NotificationChannel) error {
	if ch.Config == nil || len(ch.Config) == 0 {
		return nil
	}
	cfg := ch.Config
	switch ch.Type {
	case "discord":
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_discord (channel_id, webhook_url, username, avatar_url)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (channel_id) DO UPDATE SET webhook_url=$2, username=$3, avatar_url=$4`,
			ch.ID, cfg["webhook_url"], nilIfEmpty(cfg["username"]), nilIfEmpty(cfg["avatar_url"]),
		)
		return err
	case "slack":
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_slack (channel_id, webhook_url, channel, username)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (channel_id) DO UPDATE SET webhook_url=$2, channel=$3, username=$4`,
			ch.ID, cfg["webhook_url"], nilIfEmpty(cfg["channel"]), nilIfEmpty(cfg["username"]),
		)
		return err
	case "telegram":
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_telegram (channel_id, bot_token, chat_id)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (channel_id) DO UPDATE SET bot_token=$2, chat_id=$3`,
			ch.ID, cfg["bot_token"], cfg["chat_id"],
		)
		return err
	case "email":
		port := 587
		if p := cfg["smtp_port"]; p != "" {
			if _, err := fmt.Sscanf(p, "%d", &port); err != nil {
				port = 587
			}
		}
		useTLS := cfg["use_tls"] != "false"
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_email
			   (channel_id, smtp_host, smtp_port, smtp_username, smtp_password, from_address, to_addresses, use_tls)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (channel_id) DO UPDATE SET
			   smtp_host=$2, smtp_port=$3, smtp_username=$4, smtp_password=$5,
			   from_address=$6, to_addresses=$7, use_tls=$8`,
			ch.ID, cfg["smtp_host"], port,
			nilIfEmpty(cfg["smtp_username"]), nilIfEmpty(cfg["smtp_password"]),
			cfg["from_address"], cfg["to_addresses"], useTLS,
		)
		return err
	case "webhook":
		method := cfg["http_method"]
		if method == "" {
			method = cfg["method"]
		}
		if method == "" {
			method = "POST"
		}
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_webhook (channel_id, url, http_method, bearer_token)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (channel_id) DO UPDATE SET url=$2, http_method=$3, bearer_token=$4`,
			ch.ID, cfg["url"], method, nilIfEmpty(cfg["bearer_token"]),
		)
		return err
	case "ntfy":
		serverURL := cfg["server_url"]
		if serverURL == "" {
			serverURL = "https://ntfy.sh"
		}
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_ntfy (channel_id, server_url, topic, auth_token)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (channel_id) DO UPDATE SET server_url=$2, topic=$3, auth_token=$4`,
			ch.ID, serverURL, cfg["topic"], nilIfEmpty(cfg["auth_token"]),
		)
		return err
	case "pushover":
		_, err := r.db.Pool.Exec(ctx,
			`INSERT INTO notification_channel_pushover (channel_id, user_key, api_token)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (channel_id) DO UPDATE SET user_key=$2, api_token=$3`,
			ch.ID, cfg["user_key"], cfg["api_token"],
		)
		return err
	}
	return nil
}

// loadChannelConfig reads the per-kind CTI child table and returns its fields
// as a string map, keeping the domain model provider-agnostic.
func (r *NotificationRepo) loadChannelConfig(ctx context.Context, id int64, kind string) (map[string]string, error) {
	cfg := make(map[string]string)
	switch kind {
	case "discord":
		var webhookURL string
		var username, avatarURL *string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT webhook_url, username, avatar_url FROM notification_channel_discord WHERE channel_id=$1`, id,
		).Scan(&webhookURL, &username, &avatarURL)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["webhook_url"] = webhookURL
		if username != nil {
			cfg["username"] = *username
		}
		if avatarURL != nil {
			cfg["avatar_url"] = *avatarURL
		}
	case "slack":
		var webhookURL string
		var channel, username *string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT webhook_url, channel, username FROM notification_channel_slack WHERE channel_id=$1`, id,
		).Scan(&webhookURL, &channel, &username)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["webhook_url"] = webhookURL
		if channel != nil {
			cfg["channel"] = *channel
		}
		if username != nil {
			cfg["username"] = *username
		}
	case "telegram":
		var botToken, chatID string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT bot_token, chat_id FROM notification_channel_telegram WHERE channel_id=$1`, id,
		).Scan(&botToken, &chatID)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["bot_token"] = botToken
		cfg["chat_id"] = chatID
	case "email":
		var smtpHost, fromAddress, toAddresses string
		var smtpPort int
		var smtpUsername, smtpPassword *string
		var useTLS bool
		err := r.db.Pool.QueryRow(ctx,
			`SELECT smtp_host, smtp_port, smtp_username, smtp_password, from_address, to_addresses, use_tls
			 FROM notification_channel_email WHERE channel_id=$1`, id,
		).Scan(&smtpHost, &smtpPort, &smtpUsername, &smtpPassword, &fromAddress, &toAddresses, &useTLS)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["smtp_host"] = smtpHost
		cfg["smtp_port"] = fmt.Sprintf("%d", smtpPort)
		if smtpUsername != nil {
			cfg["smtp_username"] = *smtpUsername
		}
		if smtpPassword != nil {
			cfg["smtp_password"] = *smtpPassword
		}
		cfg["from_address"] = fromAddress
		cfg["to_addresses"] = toAddresses
		cfg["use_tls"] = fmt.Sprintf("%t", useTLS)
	case "webhook":
		var url, httpMethod string
		var bearerToken *string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT url, http_method, bearer_token FROM notification_channel_webhook WHERE channel_id=$1`, id,
		).Scan(&url, &httpMethod, &bearerToken)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["url"] = url
		cfg["http_method"] = httpMethod
		if bearerToken != nil {
			cfg["bearer_token"] = *bearerToken
		}
	case "ntfy":
		var serverURL, topic string
		var authToken *string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT server_url, topic, auth_token FROM notification_channel_ntfy WHERE channel_id=$1`, id,
		).Scan(&serverURL, &topic, &authToken)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["server_url"] = serverURL
		cfg["topic"] = topic
		if authToken != nil {
			cfg["auth_token"] = *authToken
		}
	case "pushover":
		var userKey, apiToken string
		err := r.db.Pool.QueryRow(ctx,
			`SELECT user_key, api_token FROM notification_channel_pushover WHERE channel_id=$1`, id,
		).Scan(&userKey, &apiToken)
		if err == pgx.ErrNoRows {
			return cfg, nil
		}
		if err != nil {
			return nil, err
		}
		cfg["user_key"] = userKey
		cfg["api_token"] = apiToken
	}
	return cfg, nil
}

// nilIfEmpty returns nil if s is empty, otherwise a pointer to s.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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

// notificationLogColumns is the canonical SELECT list for notification_logs
// rows, matching the field order used by scanNotificationLog. Centralized so
// every read path returns the same shape (incl. read_at / archived_at added in
// Phase 40 / Prompt 29).
const notificationLogColumns = `id, channel_id, alert_id, title, message, status, error, created_at, sent_at, read_at, archived_at`

func scanNotificationLog(rows pgx.Row, l *models.NotificationLog) error {
	return rows.Scan(
		&l.ID, &l.ChannelID, &l.AlertID, &l.Title, &l.Message, &l.Status, &l.Error,
		&l.CreatedAt, &l.SentAt, &l.ReadAt, &l.ArchivedAt,
	)
}

func (r *NotificationRepo) GetLogs(ctx context.Context, limit, offset int) ([]*models.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.NotificationLog
	for rows.Next() {
		l := &models.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

func (r *NotificationRepo) GetLogsByChannel(ctx context.Context, channelID int64, limit int) ([]*models.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs WHERE channel_id=$1 ORDER BY created_at DESC LIMIT $2`, channelID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*models.NotificationLog
	for rows.Next() {
		l := &models.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// NotificationLogFilters describes the inbox query the frontend can express
// via GET /notifications query params. All fields are optional; zero values
// mean "no constraint". The Archived field is a tri-state (nil = both, false
// = inbox only, true = archived only) because the inbox view defaults to the
// non-archived list.
type NotificationLogFilters struct {
	Severities []string  // wire severities as stored on alert_rules: info, warn, critical
	VehicleIDs []int64   // join via alert_rules.vehicle_id
	RuleIDs    []int64   // notification_logs.alert_id (== alert_rules.id)
	From       time.Time // inclusive lower bound on created_at
	To         time.Time // inclusive upper bound on created_at
	Read       *bool     // nil = both, false = unread only, true = read only
	Archived   *bool     // nil = both, false = inbox only, true = archived only
	Query      string    // ILIKE %query% across title and message
	Limit      int
	Offset     int
}

// GetLogsFiltered returns notification_logs matching the supplied filters.
// Severity / vehicle filters are applied via a LEFT JOIN on alert_rules so
// rows with NULL alert_id are still returned when no severity or vehicle
// constraint is set, and are excluded when one is.
func (r *NotificationRepo) GetLogsFiltered(ctx context.Context, f NotificationLogFilters) ([]*models.NotificationLog, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	needsRuleJoin := len(f.Severities) > 0 || len(f.VehicleIDs) > 0
	var (
		clauses []string
		args    []any
	)
	addClause := func(clause string, vals ...any) {
		clauses = append(clauses, clause)
		args = append(args, vals...)
	}
	ph := func(offset int) string { return fmt.Sprintf("$%d", len(args)+offset) }

	if len(f.RuleIDs) > 0 {
		addClause("nl.alert_id = ANY("+ph(1)+")", f.RuleIDs)
	}
	if !f.From.IsZero() {
		addClause("nl.created_at >= "+ph(1), f.From.UTC())
	}
	if !f.To.IsZero() {
		addClause("nl.created_at <= "+ph(1), f.To.UTC())
	}
	if f.Read != nil {
		if *f.Read {
			clauses = append(clauses, "nl.read_at IS NOT NULL")
		} else {
			clauses = append(clauses, "nl.read_at IS NULL")
		}
	}
	if f.Archived != nil {
		if *f.Archived {
			clauses = append(clauses, "nl.archived_at IS NOT NULL")
		} else {
			clauses = append(clauses, "nl.archived_at IS NULL")
		}
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		pattern := "%" + q + "%"
		// Reuse a single placeholder across both columns to avoid duplicating
		// the bind value.
		clauses = append(clauses, "(nl.title ILIKE "+ph(1)+" OR nl.message ILIKE "+ph(1)+")")
		args = append(args, pattern)
	}
	if needsRuleJoin {
		if len(f.Severities) > 0 {
			addClause("ar.severity = ANY("+ph(1)+")", f.Severities)
		}
		if len(f.VehicleIDs) > 0 {
			addClause("ar.vehicle_id = ANY("+ph(1)+")", f.VehicleIDs)
		}
	}

	const aliasedCols = `nl.id, nl.channel_id, nl.alert_id, nl.title, nl.message, nl.status, nl.error,
		nl.created_at, nl.sent_at, nl.read_at, nl.archived_at`

	query := "SELECT " + aliasedCols + " FROM notification_logs nl"
	if needsRuleJoin {
		query += " LEFT JOIN alert_rules ar ON ar.id = nl.alert_id"
	}
	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}
	query += " ORDER BY nl.created_at DESC LIMIT " + ph(1)
	args = append(args, f.Limit)
	query += " OFFSET " + ph(1)
	args = append(args, f.Offset)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query notification logs: %w", err)
	}
	defer rows.Close()

	var logs []*models.NotificationLog
	for rows.Next() {
		l := &models.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, fmt.Errorf("scan notification log: %w", err)
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// GetUnreadCount returns the number of non-archived, non-read notification
// log entries — used by the header bell badge.
func (r *NotificationRepo) GetUnreadCount(ctx context.Context) (int64, error) {
	var n int64
	err := r.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM notification_logs WHERE read_at IS NULL AND archived_at IS NULL`,
	).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// BulkSetRead flips read_at for a list of ids. read=true sets read_at=now()
// (idempotent — preserves the original timestamp via COALESCE), read=false
// clears it. Returns the number of rows affected.
func (r *NotificationRepo) BulkSetRead(ctx context.Context, ids []int64, read bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var (
		ct  pgconn.CommandTag
		err error
	)
	if read {
		ct, err = r.db.Pool.Exec(ctx,
			`UPDATE notification_logs SET read_at = COALESCE(read_at, $1) WHERE id = ANY($2)`,
			time.Now().UTC(), ids,
		)
	} else {
		ct, err = r.db.Pool.Exec(ctx,
			`UPDATE notification_logs SET read_at = NULL WHERE id = ANY($1)`, ids,
		)
	}
	if err != nil {
		return 0, fmt.Errorf("bulk set read: %w", err)
	}
	return ct.RowsAffected(), nil
}

// BulkSetArchived flips archived_at for a list of ids. Same semantics as
// BulkSetRead. Archiving an unread row also marks it read so it stops
// counting toward the header badge.
func (r *NotificationRepo) BulkSetArchived(ctx context.Context, ids []int64, archived bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var (
		ct  pgconn.CommandTag
		err error
	)
	if archived {
		now := time.Now().UTC()
		ct, err = r.db.Pool.Exec(ctx,
			`UPDATE notification_logs
			    SET archived_at = COALESCE(archived_at, $1),
			        read_at     = COALESCE(read_at, $1)
			  WHERE id = ANY($2)`,
			now, ids,
		)
	} else {
		ct, err = r.db.Pool.Exec(ctx,
			`UPDATE notification_logs SET archived_at = NULL WHERE id = ANY($1)`, ids,
		)
	}
	if err != nil {
		return 0, fmt.Errorf("bulk set archived: %w", err)
	}
	return ct.RowsAffected(), nil
}

// BulkDelete hard-deletes notification log rows. Intended for admin use only;
// the inbox UX prefers archive over delete.
func (r *NotificationRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	ct, err := r.db.Pool.Exec(ctx,
		`DELETE FROM notification_logs WHERE id = ANY($1)`, ids,
	)
	if err != nil {
		return 0, fmt.Errorf("bulk delete logs: %w", err)
	}
	return ct.RowsAffected(), nil
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

// ListSessions returns rich per-session metadata (title, message count,
// timestamps, first user message preview) used to render the chatbot
// sidebar. Sessions are ordered by last activity (newest first).
//
// The query joins chatbot_messages aggregates against the optional
// chatbot_sessions metadata row (LEFT JOIN — sessions only appear in
// chatbot_sessions when the user has explicitly renamed them).
//
// first_message is the earliest *user* message in the session, used as a
// fallback display title when no explicit title has been set. Limited to
// the first 120 chars to keep the wire payload small.
func (r *ChatRepo) ListSessions(ctx context.Context, limit int) ([]*models.ChatSessionInfo, error) {
	rows, err := r.db.Pool.Query(ctx, `
WITH msg_stats AS (
    SELECT
        session_id,
        COUNT(*)::int        AS message_count,
        MAX(created_at)      AS last_message_at,
        MIN(created_at)      AS created_at
    FROM chatbot_messages
    GROUP BY session_id
), first_user AS (
    SELECT DISTINCT ON (session_id) session_id, content
    FROM chatbot_messages
    WHERE role = 'user'
    ORDER BY session_id, created_at ASC
)
SELECT
    s.session_id,
    cs.title,
    LEFT(fu.content, 120) AS first_message,
    s.message_count,
    s.last_message_at,
    s.created_at
FROM msg_stats s
LEFT JOIN chatbot_sessions cs ON cs.session_id = s.session_id
LEFT JOIN first_user fu ON fu.session_id = s.session_id
ORDER BY s.last_message_at DESC
LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.ChatSessionInfo
	for rows.Next() {
		s := &models.ChatSessionInfo{}
		if err := rows.Scan(&s.ID, &s.Title, &s.FirstMessage, &s.MessageCount, &s.LastMessageAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// RenameSession upserts the title for a session. Passing an empty string
// clears the title (the row stays so other metadata is preserved); the
// frontend falls back to the first user message in that case. Returns
// pgx.ErrNoRows-equivalent semantics — i.e. nil error even when the
// session has no messages — because the metadata row is independent of
// the message history.
func (r *ChatRepo) RenameSession(ctx context.Context, sessionID, title string) error {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		// Clear the title; keep the metadata row so created_at survives.
		_, err := r.db.Pool.Exec(ctx, `
INSERT INTO chatbot_sessions (session_id, title, updated_at)
VALUES ($1, NULL, now())
ON CONFLICT (session_id) DO UPDATE SET title = NULL, updated_at = now()`,
			sessionID)
		return err
	}
	if len([]rune(trimmed)) > 120 {
		trimmed = string([]rune(trimmed)[:120])
	}
	_, err := r.db.Pool.Exec(ctx, `
INSERT INTO chatbot_sessions (session_id, title, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (session_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
		sessionID, trimmed)
	return err
}

// DeleteSession removes both the message history and any sidecar metadata
// for a session. The two tables are not FK-linked (see migration 000166)
// so we issue separate DELETEs inside a transaction to keep them in sync.
func (r *ChatRepo) DeleteSession(ctx context.Context, sessionID string) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // ignored on commit
	if _, err := tx.Exec(ctx, `DELETE FROM chatbot_messages WHERE session_id = $1`, sessionID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM chatbot_sessions WHERE session_id = $1`, sessionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
