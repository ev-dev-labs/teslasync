package notification

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	chatbotmodel "github.com/ev-dev-labs/teslasync/internal/models/chatbot"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// deriveNotificationLogGroupKey builds the deterministic group identifier
// used to thread repeated deliveries of the same alert rule + severity
// into a single inbox row.
//
// Returns nil — meaning "ungrouped singleton" — whenever either piece
// of identifying information is missing. That covers:
//
//   - test sends and ad-hoc notifications (no alert_id).
//   - legacy rows that pre-date the severity column.
//
// The hash input format is "<alert_id>|<severity>" with severity
// lower-cased and whitespace-trimmed so accidental case differences
// can't shard a group. The output is the lower-hex sha256 digest so it
// fits comfortably in a 64-byte text column.
func deriveNotificationLogGroupKey(alertID *int64, severity string) *string {
	if alertID == nil {
		return nil
	}
	sev := strings.ToLower(strings.TrimSpace(severity))
	if sev == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(strconv.FormatInt(*alertID, 10) + "|" + sev))
	out := hex.EncodeToString(sum[:])
	return &out
}

// IsValidNotificationGroupKey returns true when s looks like a value that
// could plausibly have been produced by deriveNotificationLogGroupKey
// (lower-hex, exactly 64 chars). The handler uses this to validate the
// `group_key` query / body parameter before reaching the database — a
// malformed key can never match a real row, so failing fast keeps bad
// input from inflating the query plan cache or surfacing as a 500.
func IsValidNotificationGroupKey(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
		case c >= 'a' && c <= 'f':
		default:
			return false
		}
	}
	return true
}

// NotificationRepo provides notification channel and log data access.
type NotificationRepo struct {
	db *database.DB
}

func NewNotificationRepo(db *database.DB) *NotificationRepo {
	return &NotificationRepo{db: db}
}

// --- Channels ---

func (r *NotificationRepo) CreateChannel(ctx context.Context, ch *notificationmodel.NotificationChannel) error {
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

func (r *NotificationRepo) UpdateChannel(ctx context.Context, ch *notificationmodel.NotificationChannel) error {
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

func (r *NotificationRepo) GetChannel(ctx context.Context, id int64) (*notificationmodel.NotificationChannel, error) {
	ch := &notificationmodel.NotificationChannel{}
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

func (r *NotificationRepo) GetAllChannels(ctx context.Context) ([]*notificationmodel.NotificationChannel, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, name, kind, enabled, created_at, updated_at FROM notification_channels ORDER BY created_at DESC LIMIT 1000`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var channels []*notificationmodel.NotificationChannel
	for rows.Next() {
		ch := &notificationmodel.NotificationChannel{}
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
func (r *NotificationRepo) upsertChannelConfig(ctx context.Context, ch *notificationmodel.NotificationChannel) error {
	if len(ch.Config) == 0 {
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

func (r *NotificationRepo) CreateLog(ctx context.Context, l *notificationmodel.NotificationLog) error {
	severity := strings.TrimSpace(strings.ToLower(l.Severity))
	var sevArg any
	if severity == "" {
		sevArg = nil
	} else {
		sevArg = severity
	}
	// Derive the threading key from the same (alert_id, severity) tuple
	// every dispatch path uses. Returns nil for singletons (test sends,
	// NULL severity, etc.) which the inbox-grouping query treats as
	// ungrouped.
	var groupKeyArg any
	if gk := deriveNotificationLogGroupKey(l.AlertID, severity); gk != nil {
		groupKeyArg = *gk
	} else {
		groupKeyArg = nil
	}
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO notification_logs (channel_id, alert_id, title, message, status, severity, error, created_at, sent_at, group_key)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		l.ChannelID, l.AlertID, l.Title, l.Message, l.Status, sevArg, l.Error, time.Now().UTC(), l.SentAt, groupKeyArg,
	).Scan(&l.ID)
}

// ExistsTitleSince reports whether a non-failed notification_logs row with
// this exact title was created at or after since. Used to send the weekly
// FSD digest at most once per vehicle/week without a new column.
func (r *NotificationRepo) ExistsTitleSince(ctx context.Context, title string, since time.Time) (bool, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return false, fmt.Errorf("exists notification title %q: database pool is nil", title)
	}
	var exists bool
	err := r.db.Pool.QueryRow(ctx,
		`SELECT EXISTS(
		     SELECT 1 FROM notification_logs
		      WHERE title = $1
		        AND created_at >= $2
		        AND status IS DISTINCT FROM 'failed'
		 )`,
		title, since.UTC(),
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("exists notification title %q: %w", title, err)
	}
	return exists, nil
}

// MarkLogSent flips a deferred row to status='sent' and stamps the
// supplied delivery timestamp / latency. Used by the quiet-hours
// replay loop in cmd/notification-worker after the original Send call
// succeeds.
func (r *NotificationRepo) MarkLogSent(ctx context.Context, id int64, sentAt time.Time, latencyMs int) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_logs
		 SET status = 'sent', sent_at = $1, error = '', latency_ms = $2
		 WHERE id = $3`,
		sentAt.UTC(), latencyMs, id,
	)
	if err != nil {
		return fmt.Errorf("notification_logs mark_sent: %w", err)
	}
	return nil
}

// MarkLogFailed flips a deferred row to status='failed' with the
// supplied error message when the replay loop exhausts its retries.
func (r *NotificationRepo) MarkLogFailed(ctx context.Context, id int64, errMsg string, latencyMs int) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_logs
		 SET status = 'failed', error = $1, latency_ms = $2
		 WHERE id = $3`,
		errMsg, latencyMs, id,
	)
	if err != nil {
		return fmt.Errorf("notification_logs mark_failed: %w", err)
	}
	return nil
}

// notificationLogColumns is the canonical SELECT list for notification_logs
// rows, matching the field order used by scanNotificationLog. Centralized so
// every read path returns the same shape, including read_at / archived_at,
// severity, and the acknowledgement columns.
//
// IMPORTANT: any change here MUST also be applied to the aliased version used
// by GetLogsFiltered below; both must stay in lockstep with scanNotificationLog
// or one of the read paths will break at runtime.
//
// `severity` and `error` are nullable in the DB but the model uses non-pointer
// `string` fields, so both columns must be COALESCEd to ” to avoid pgx
// "cannot scan NULL into *string" failures on rows with no error message.
const notificationLogColumns = `id, channel_id, alert_id, title, message, status, COALESCE(severity, ''), COALESCE(error, ''), created_at, sent_at, read_at, archived_at, acknowledged_at, acknowledged_by, acknowledgement_note`

func scanNotificationLog(rows pgx.Row, l *notificationmodel.NotificationLog) error {
	return rows.Scan(
		&l.ID, &l.ChannelID, &l.AlertID, &l.Title, &l.Message, &l.Status, &l.Severity, &l.Error,
		&l.CreatedAt, &l.SentAt, &l.ReadAt, &l.ArchivedAt,
		&l.AcknowledgedAt, &l.AcknowledgedBy, &l.AcknowledgementNote,
	)
}

func (r *NotificationRepo) GetLogs(ctx context.Context, limit, offset int) ([]*notificationmodel.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*notificationmodel.NotificationLog
	for rows.Next() {
		l := &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// GetAlertLogs returns only notification events backed by an alert rule.
// Manual channel tests and other ad-hoc notifications have a NULL alert_id
// and are intentionally excluded.
func (r *NotificationRepo) GetAlertLogs(ctx context.Context, limit, offset int) ([]*notificationmodel.NotificationLog, error) {
	if limit <= 0 || limit > 1000 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs
		 WHERE alert_id IS NOT NULL
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("query alert-backed notification logs: %w", err)
	}
	defer rows.Close()

	var logs []*notificationmodel.NotificationLog
	for rows.Next() {
		l := &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, fmt.Errorf("scan alert-backed notification log: %w", err)
		}
		logs = append(logs, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate alert-backed notification logs: %w", err)
	}
	return logs, nil
}

func (r *NotificationRepo) GetLogsByChannel(ctx context.Context, channelID int64, limit int) ([]*notificationmodel.NotificationLog, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs WHERE channel_id=$1 ORDER BY created_at DESC LIMIT $2`, channelID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []*notificationmodel.NotificationLog
	for rows.Next() {
		l := &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// ListDeferred returns every notification_logs row currently held in the
// 'deferred_dnd' state, oldest first. The replay loop in
// cmd/notification-worker walks the result on every tick and tries to
// dispatch each row whose causing window has ended.
func (r *NotificationRepo) ListDeferred(ctx context.Context, limit int) ([]*notificationmodel.NotificationLog, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := r.db.Pool.Query(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs
		 WHERE status = 'deferred_dnd' AND archived_at IS NULL
		 ORDER BY created_at ASC
		 LIMIT $1`, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("notification_logs list_deferred: %w", err)
	}
	defer rows.Close()

	var logs []*notificationmodel.NotificationLog
	for rows.Next() {
		l := &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// via GET /notifications query params. All fields are optional; zero values
// mean "no constraint". The Archived field is a tri-state (nil = both, false
// = inbox only, true = archived only) because the inbox view defaults to the
// non-archived list.
type NotificationLogFilters struct {
	Severities                 []string  // wire severities as stored on alert_rules: info, warn, critical
	IncludeFailedInfoAsWarning bool      // match the /alerts DTO warning floor for failed info deliveries
	VehicleIDs                 []int64   // rule applies to any requested vehicle; unscoped system rows remain visible
	RuleIDs                    []int64   // notification_logs.alert_id (== alert_rules.id)
	From                       time.Time // inclusive lower bound on created_at
	To                         time.Time // inclusive upper bound on created_at
	BeforeCreatedAt            time.Time // keyset cursor: rows strictly before this created_at/id tuple
	BeforeID                   int64
	Read                       *bool  // nil = both, false = unread only, true = read only
	Archived                   *bool  // nil = both, false = inbox only, true = archived only
	Query                      string // ILIKE %query% across title and message
	// GroupKey, when non-empty, restricts the result to rows whose
	// group_key column equals exactly this value. It fetches members of a
	// single threaded group via the existing flat-list endpoint without
	// adding a route.
	GroupKey string
	Limit    int
	Offset   int
}

// notificationLogWhere holds the WHERE clauses + bind values produced
// from a NotificationLogFilters. The same builder is used by both
// GetLogsFiltered and ListGrouped so the two read paths cannot diverge
// on which combinations of filters are supported. needsRuleJoin is true when at least one clause references
// `ar.*` and therefore requires the LEFT JOIN on alert_rules.
type notificationLogWhere struct {
	clauses       []string
	args          []any
	needsRuleJoin bool
}

func buildNotificationLogWhere(f NotificationLogFilters) notificationLogWhere {
	w := notificationLogWhere{
		needsRuleJoin: len(f.Severities) > 0 || len(f.VehicleIDs) > 0,
	}
	addClause := func(clause string, vals ...any) {
		w.clauses = append(w.clauses, clause)
		w.args = append(w.args, vals...)
	}
	ph := func(offset int) string { return fmt.Sprintf("$%d", len(w.args)+offset) }

	if len(f.RuleIDs) > 0 {
		addClause("nl.alert_id = ANY("+ph(1)+")", f.RuleIDs)
	}
	if !f.From.IsZero() {
		addClause("nl.created_at >= "+ph(1), f.From.UTC())
	}
	if !f.To.IsZero() {
		addClause("nl.created_at <= "+ph(1), f.To.UTC())
	}
	if !f.BeforeCreatedAt.IsZero() && f.BeforeID > 0 {
		createdAtPlaceholder := ph(1)
		idPlaceholder := ph(2)
		addClause(
			"(nl.created_at < "+createdAtPlaceholder+
				" OR (nl.created_at = "+createdAtPlaceholder+
				" AND nl.id < "+idPlaceholder+"))",
			f.BeforeCreatedAt.UTC(),
			f.BeforeID,
		)
	}
	if f.Read != nil {
		if *f.Read {
			w.clauses = append(w.clauses, "nl.read_at IS NOT NULL")
		} else {
			w.clauses = append(w.clauses, "nl.read_at IS NULL")
		}
	}
	if f.Archived != nil {
		if *f.Archived {
			w.clauses = append(w.clauses, "nl.archived_at IS NOT NULL")
		} else {
			w.clauses = append(w.clauses, "nl.archived_at IS NULL")
		}
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		pattern := "%" + q + "%"
		// Reuse a single placeholder across both columns to avoid duplicating
		// the bind value.
		w.clauses = append(w.clauses, "(nl.title ILIKE "+ph(1)+" OR nl.message ILIKE "+ph(1)+")")
		w.args = append(w.args, pattern)
	}
	if gk := strings.TrimSpace(f.GroupKey); gk != "" {
		addClause("nl.group_key = "+ph(1), gk)
	}
	if w.needsRuleJoin {
		if len(f.Severities) > 0 {
			if f.IncludeFailedInfoAsWarning {
				addClause(
					"(CASE WHEN nl.status = 'failed' AND COALESCE(ar.severity, 'info') = 'info' THEN 'warn' ELSE COALESCE(ar.severity, 'info') END) = ANY("+ph(1)+")",
					f.Severities,
				)
			} else {
				addClause("ar.severity = ANY("+ph(1)+")", f.Severities)
			}
		}
		if len(f.VehicleIDs) > 0 {
			addClause(
				"(nl.alert_id IS NULL OR ar.id IS NULL OR ar.all_vehicles OR EXISTS ("+
					"SELECT 1 FROM alert_rule_vehicles arv "+
					"WHERE arv.rule_id = ar.id AND arv.vehicle_id = ANY("+ph(1)+")))",
				f.VehicleIDs,
			)
		}
	}
	return w
}

// GetLogsFiltered returns notification_logs matching the supplied filters.
// Severity / vehicle filters are applied via a LEFT JOIN on alert_rules so
// rows with NULL alert_id are still returned when no severity or vehicle
// constraint is set, and are excluded when one is.
func (r *NotificationRepo) GetLogsFiltered(ctx context.Context, f NotificationLogFilters) ([]*notificationmodel.NotificationLog, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	w := buildNotificationLogWhere(f)
	args := w.args
	ph := func(offset int) string { return fmt.Sprintf("$%d", len(args)+offset) }

	const aliasedCols = `nl.id, nl.channel_id, nl.alert_id, nl.title, nl.message, nl.status, COALESCE(nl.severity, ''), COALESCE(nl.error, ''),
		nl.created_at, nl.sent_at, nl.read_at, nl.archived_at,
		nl.acknowledged_at, nl.acknowledged_by, nl.acknowledgement_note`

	query := "SELECT " + aliasedCols + " FROM notification_logs nl"
	if w.needsRuleJoin {
		query += " LEFT JOIN alert_rules ar ON ar.id = nl.alert_id"
	}
	if len(w.clauses) > 0 {
		query += " WHERE " + strings.Join(w.clauses, " AND ")
	}
	query += " ORDER BY nl.created_at DESC, nl.id DESC LIMIT " + ph(1)
	args = append(args, f.Limit)
	query += " OFFSET " + ph(1)
	args = append(args, f.Offset)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query notification logs: %w", err)
	}
	defer rows.Close()

	var logs []*notificationmodel.NotificationLog
	for rows.Next() {
		l := &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(rows, l); err != nil {
			return nil, fmt.Errorf("scan notification log: %w", err)
		}
		logs = append(logs, l)
	}
	return logs, rows.Err()
}

// ListGrouped returns the inbox collapsed into threaded groups where every
// row sharing a non-NULL group_key is bucketed together. Rows whose
// group_key IS NULL are returned as singletons (one bucket per row) so
// the response shape stays uniform — the frontend always sees a flat
// list of groups.
//
// Pagination applies to BUCKETS, not rows: limit=10 returns 10 groups
// regardless of how many member rows each contains. The caller fetches
// member rows separately via GetLogsFiltered with GroupKey set.
//
// Aggregates returned per group:
//
//   - Count       — total members in the FILTERED set.
//   - UnreadCount — members in the filtered set whose read_at IS NULL.
//   - VehicleIDs  — distinct alert_rules.vehicle_id values across the
//     group's members; never nil (empty slice means every member's rule
//     applies to all vehicles, i.e. ar.vehicle_id IS NULL).
//   - Latest      — the most recent member by (created_at DESC, id DESC).
//
// Filter semantics match GetLogsFiltered exactly via the shared
// buildNotificationLogWhere helper; the tie is enforced by routing both
// methods through the same builder rather than duplicating the clause
// list.
func (r *NotificationRepo) ListGrouped(ctx context.Context, f NotificationLogFilters) ([]*notificationmodel.NotificationLogGroup, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 50
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	w := buildNotificationLogWhere(f)
	args := w.args
	ph := func(offset int) string { return fmt.Sprintf("$%d", len(args)+offset) }

	// The CTE buckets rows by COALESCE(group_key, 'singleton:'||id) so
	// NULL-group rows each get their own bucket. We need the alert_rules
	// JOIN unconditionally because vehicle_ids is part of the response
	// shape — overrides the buildNotificationLogWhere flag, which only
	// reflects WHERE-clause needs.
	cte := `WITH agg AS (
  SELECT
    COALESCE(nl.group_key, 'singleton:' || nl.id::text) AS bucket,
    nl.group_key                                        AS group_key,
    MAX(nl.created_at)                                  AS latest_at,
    COUNT(*)::bigint                                    AS total,
    COUNT(*) FILTER (WHERE nl.read_at IS NULL)::bigint  AS unread,
    COALESCE(
      array_remove(array_agg(DISTINCT ar.vehicle_id), NULL),
      ARRAY[]::bigint[]
    )                                                   AS vehicle_ids,
    (array_agg(nl.id ORDER BY nl.created_at DESC, nl.id DESC))[1] AS latest_id
  FROM notification_logs nl
  LEFT JOIN alert_rules ar ON ar.id = nl.alert_id`
	if len(w.clauses) > 0 {
		cte += " WHERE " + strings.Join(w.clauses, " AND ")
	}
	cte += `
  GROUP BY bucket, nl.group_key
  ORDER BY MAX(nl.created_at) DESC
  LIMIT ` + ph(1) + ` OFFSET ` + ph(2) + `
)`
	args = append(args, f.Limit, f.Offset)

	query := cte + `
SELECT
  agg.group_key,
  agg.total,
  agg.unread,
  agg.vehicle_ids,
  nl.id, nl.channel_id, nl.alert_id, nl.title, nl.message, nl.status,
  COALESCE(nl.severity, ''), COALESCE(nl.error, ''),
  nl.created_at, nl.sent_at, nl.read_at, nl.archived_at,
  nl.acknowledged_at, nl.acknowledged_by, nl.acknowledgement_note
FROM agg
JOIN notification_logs nl ON nl.id = agg.latest_id
ORDER BY agg.latest_at DESC, nl.id DESC`

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query notification log groups: %w", err)
	}
	defer rows.Close()

	groups := make([]*notificationmodel.NotificationLogGroup, 0)
	for rows.Next() {
		g := &notificationmodel.NotificationLogGroup{Latest: &notificationmodel.NotificationLog{}}
		var (
			groupKey   *string
			total      int64
			unread     int64
			vehicleIDs []int64
		)
		l := g.Latest
		if err := rows.Scan(
			&groupKey,
			&total,
			&unread,
			&vehicleIDs,
			&l.ID, &l.ChannelID, &l.AlertID, &l.Title, &l.Message, &l.Status, &l.Severity, &l.Error,
			&l.CreatedAt, &l.SentAt, &l.ReadAt, &l.ArchivedAt,
			&l.AcknowledgedAt, &l.AcknowledgedBy, &l.AcknowledgementNote,
		); err != nil {
			return nil, fmt.Errorf("scan notification log group: %w", err)
		}
		g.GroupKey = groupKey
		g.Count = int(total)
		g.UnreadCount = int(unread)
		// Defensive: never propagate a nil slice up — the JSON contract
		// is a non-null array (matches the frontend safeArray helper).
		if vehicleIDs == nil {
			vehicleIDs = []int64{}
		}
		g.VehicleIDs = vehicleIDs
		groups = append(groups, g)
	}
	return groups, rows.Err()
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

// BulkSetReadAll marks every currently-unread, non-archived notification log
// row as read. Powers the "Mark all read" header action so the client doesn't
// have to enumerate every id it has cached (which could be in the thousands
// for power users with many alert rules).
//
// Only flips rows that are still unread — already-read rows are left
// untouched, which keeps the row count returned to the client honest and
// avoids resetting the original read timestamp. Archived rows are skipped
// because the badge contract excludes archived from "unread" anyway.
func (r *NotificationRepo) BulkSetReadAll(ctx context.Context) (int64, error) {
	ct, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_logs
		    SET read_at = $1
		  WHERE read_at IS NULL AND archived_at IS NULL`,
		time.Now().UTC(),
	)
	if err != nil {
		return 0, fmt.Errorf("bulk set read all: %w", err)
	}
	return ct.RowsAffected(), nil
}

// BulkSetReadByGroupKey marks every currently-unread, non-archived row
// whose group_key matches as read. Used by the "Mark group read" action
// on a threaded inbox row so the user doesn't have to expand the group
// and enumerate each member id.
//
// Empty / invalid group_key returns (0, nil) — refusing to dispatch to
// the database with an unbounded match (group_key=” would catch any
// row written before the column existed, which is NOT what the caller
// wants). The handler validates shape via IsValidNotificationGroupKey
// before reaching here; this is a defense-in-depth check.
//
// Idempotent: COALESCE preserves the original read_at on rows that
// were already flipped by an earlier call. Archived rows are skipped
// to match BulkSetReadAll's semantics.
func (r *NotificationRepo) BulkSetReadByGroupKey(ctx context.Context, groupKey string) (int64, error) {
	gk := strings.TrimSpace(groupKey)
	if gk == "" {
		return 0, nil
	}
	ct, err := r.db.Pool.Exec(ctx,
		`UPDATE notification_logs
		    SET read_at = COALESCE(read_at, $1)
		  WHERE group_key = $2
		    AND read_at IS NULL
		    AND archived_at IS NULL`,
		time.Now().UTC(), gk,
	)
	if err != nil {
		return 0, fmt.Errorf("bulk set read by group_key: %w", err)
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

// Acknowledgement and audit timeline.

// GetLog returns a single notification_logs row by id, or nil if no row
// exists. Errors other than "not found" are wrapped and returned.
func (r *NotificationRepo) GetLog(ctx context.Context, id int64) (*notificationmodel.NotificationLog, error) {
	row := r.db.Pool.QueryRow(ctx,
		`SELECT `+notificationLogColumns+`
		 FROM notification_logs WHERE id = $1`, id,
	)
	l := &notificationmodel.NotificationLog{}
	if err := scanNotificationLog(row, l); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("notification_logs get: %w", err)
	}
	return l, nil
}

// AcknowledgeLog flips the ack columns to (NOW, actor, note) iff the row
// exists and is not yet acknowledged, then inserts a matching row into
// notification_log_events. The whole operation runs in one transaction so a
// partial failure cannot leave the row + audit timeline desynced.
//
// Returns:
//   - the post-update row (always reloaded inside the tx so the caller sees
//     either the just-set values or the existing-ack values),
//   - true if a NEW acknowledgement was recorded (ack columns transitioned
//     NULL → set, audit event written), false if the row was already
//     acknowledged (idempotent no-op),
//   - nil error if the row existed; (nil, false, nil) when id is missing so
//     the caller can render a 404.
//
// `note` is stored verbatim; trim whitespace before calling. Pass empty
// string to leave the acknowledgement_note column NULL.
func (r *NotificationRepo) AcknowledgeLog(ctx context.Context, id int64, actor, note string) (*notificationmodel.NotificationLog, bool, error) {
	var (
		updated *notificationmodel.NotificationLog
		newAck  bool
	)
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		// Existence pre-read inside the tx so 404 is reliable even if a
		// concurrent DELETE just removed the row.
		existing := &notificationmodel.NotificationLog{}
		err := scanNotificationLog(
			tx.QueryRow(ctx, `SELECT `+notificationLogColumns+` FROM notification_logs WHERE id = $1`, id),
			existing,
		)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil
			}
			return fmt.Errorf("notification_logs ack pre-read: %w", err)
		}
		if existing.AcknowledgedAt != nil {
			updated = existing
			return nil
		}

		var noteArg any
		if note == "" {
			noteArg = nil
		} else {
			noteArg = note
		}
		var actorArg any
		if actor == "" {
			actorArg = nil
		} else {
			actorArg = actor
		}

		ct, err := tx.Exec(ctx,
			`UPDATE notification_logs
			   SET acknowledged_at = NOW(),
			       acknowledged_by = $2,
			       acknowledgement_note = $3
			 WHERE id = $1 AND acknowledged_at IS NULL`,
			id, actorArg, noteArg,
		)
		if err != nil {
			return fmt.Errorf("notification_logs ack update: %w", err)
		}
		if ct.RowsAffected() == 0 {
			// Lost a race with a concurrent ack; reload to surface the
			// winning state to the caller.
			updated = existing
			return nil
		}

		if _, err := tx.Exec(ctx,
			`INSERT INTO notification_log_events (notification_log_id, actor, kind, note)
			 VALUES ($1, $2, $3, $4)`,
			id, actorArg, alertmodel.NotificationLogEventKindAcknowledged, noteArg,
		); err != nil {
			return fmt.Errorf("notification_log_events ack insert: %w", err)
		}

		updated = &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(
			tx.QueryRow(ctx, `SELECT `+notificationLogColumns+` FROM notification_logs WHERE id = $1`, id),
			updated,
		); err != nil {
			return fmt.Errorf("notification_logs ack reload: %w", err)
		}
		newAck = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return updated, newAck, nil
}

// ReopenLog clears the ack columns iff the row exists and is currently
// acknowledged, then inserts a matching `reopened` event row. Idempotent:
// reopening an already-reopened (or never-acked) row is a no-op that returns
// the row unchanged with reopened=false. (nil, false, nil) signals "not
// found" so the caller can render 404.
func (r *NotificationRepo) ReopenLog(ctx context.Context, id int64, actor string) (*notificationmodel.NotificationLog, bool, error) {
	var (
		updated  *notificationmodel.NotificationLog
		reopened bool
	)
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		existing := &notificationmodel.NotificationLog{}
		err := scanNotificationLog(
			tx.QueryRow(ctx, `SELECT `+notificationLogColumns+` FROM notification_logs WHERE id = $1`, id),
			existing,
		)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil
			}
			return fmt.Errorf("notification_logs reopen pre-read: %w", err)
		}
		if existing.AcknowledgedAt == nil {
			updated = existing
			return nil
		}

		ct, err := tx.Exec(ctx,
			`UPDATE notification_logs
			   SET acknowledged_at = NULL,
			       acknowledged_by = NULL,
			       acknowledgement_note = NULL
			 WHERE id = $1 AND acknowledged_at IS NOT NULL`,
			id,
		)
		if err != nil {
			return fmt.Errorf("notification_logs reopen update: %w", err)
		}
		if ct.RowsAffected() == 0 {
			updated = existing
			return nil
		}

		var actorArg any
		if actor == "" {
			actorArg = nil
		} else {
			actorArg = actor
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO notification_log_events (notification_log_id, actor, kind)
			 VALUES ($1, $2, $3)`,
			id, actorArg, alertmodel.NotificationLogEventKindReopened,
		); err != nil {
			return fmt.Errorf("notification_log_events reopen insert: %w", err)
		}

		updated = &notificationmodel.NotificationLog{}
		if err := scanNotificationLog(
			tx.QueryRow(ctx, `SELECT `+notificationLogColumns+` FROM notification_logs WHERE id = $1`, id),
			updated,
		); err != nil {
			return fmt.Errorf("notification_logs reopen reload: %w", err)
		}
		reopened = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return updated, reopened, nil
}

// CommentOnLog inserts a `commented` audit event without touching the ack
// columns. Returns the inserted event row with its server-assigned id and
// occurred_at. Returns (nil, nil) when the parent notification_logs row is
// missing so the caller can render 404.
func (r *NotificationRepo) CommentOnLog(ctx context.Context, id int64, actor, note string) (*alertmodel.NotificationLogEvent, error) {
	var event *alertmodel.NotificationLogEvent
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM notification_logs WHERE id = $1)`, id,
		).Scan(&exists); err != nil {
			return fmt.Errorf("notification_logs comment pre-read: %w", err)
		}
		if !exists {
			return nil
		}
		var actorArg any
		if actor == "" {
			actorArg = nil
		} else {
			actorArg = actor
		}
		var noteArg any
		if note == "" {
			noteArg = nil
		} else {
			noteArg = note
		}
		ev := &alertmodel.NotificationLogEvent{
			NotificationLogID: id,
			Actor:             nilOrPtr(actor),
			Kind:              alertmodel.NotificationLogEventKindCommented,
			Note:              nilOrPtr(note),
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO notification_log_events (notification_log_id, actor, kind, note)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, occurred_at`,
			id, actorArg, alertmodel.NotificationLogEventKindCommented, noteArg,
		).Scan(&ev.ID, &ev.OccurredAt); err != nil {
			return fmt.Errorf("notification_log_events comment insert: %w", err)
		}
		event = ev
		return nil
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

func nilOrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ListLogEvents returns every persisted notification_log_events row for the
// supplied notification_logs id, oldest first. The synthetic "created" entry
// is reconstructed by the API layer from notification_logs.created_at and is
// NOT returned by this method.
func (r *NotificationRepo) ListLogEvents(ctx context.Context, logID int64) ([]*alertmodel.NotificationLogEvent, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, notification_log_id, occurred_at, actor, kind, note, metadata
		   FROM notification_log_events
		  WHERE notification_log_id = $1
		  ORDER BY occurred_at ASC, id ASC`,
		logID,
	)
	if err != nil {
		return nil, fmt.Errorf("notification_log_events list: %w", err)
	}
	defer rows.Close()
	var events []*alertmodel.NotificationLogEvent
	for rows.Next() {
		ev := &alertmodel.NotificationLogEvent{}
		if err := rows.Scan(
			&ev.ID, &ev.NotificationLogID, &ev.OccurredAt,
			&ev.Actor, &ev.Kind, &ev.Note, &ev.Metadata,
		); err != nil {
			return nil, fmt.Errorf("notification_log_events scan: %w", err)
		}
		events = append(events, ev)
	}
	return events, rows.Err()
}

// --- Chatbot ---

type ChatRepo struct {
	db *database.DB
}

func NewChatRepo(db *database.DB) *ChatRepo {
	return &ChatRepo{db: db}
}

func (r *ChatRepo) SaveMessage(ctx context.Context, m *chatbotmodel.ChatMessage) error {
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO chatbot_messages (session_id, role, content, created_at)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		m.SessionID, m.Role, m.Content, time.Now().UTC(),
	).Scan(&m.ID)
}

func (r *ChatRepo) GetHistory(ctx context.Context, sessionID string, limit int) ([]*chatbotmodel.ChatMessage, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, session_id, role, content, created_at FROM chatbot_messages
		 WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2`, sessionID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []*chatbotmodel.ChatMessage
	for rows.Next() {
		m := &chatbotmodel.ChatMessage{}
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
func (r *ChatRepo) ListSessions(ctx context.Context, limit int) ([]*chatbotmodel.ChatSessionInfo, error) {
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

	var sessions []*chatbotmodel.ChatSessionInfo
	for rows.Next() {
		s := &chatbotmodel.ChatSessionInfo{}
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
