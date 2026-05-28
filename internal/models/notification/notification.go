package notification

import "time"

// NotificationChannel represents a configured notification delivery channel.
type NotificationChannel struct {
	ID        int64             `json:"id" db:"id"`
	Name      string            `json:"name" db:"name"`
	Type      string            `json:"type" db:"kind"` // discord, email, slack, telegram, webhook, ntfy, pushover
	Config    map[string]string `json:"config" db:"-"`  // populated from per-kind child tables, not a DB column
	Enabled   bool              `json:"enabled" db:"enabled"`
	CreatedAt time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt time.Time         `json:"updated_at" db:"updated_at"`
}

// NotificationLog records a notification delivery attempt.
//
// ReadAt / ArchivedAt (Phase 40 / Prompt 29) drive the inbox UX on
// /notifications: NULL means "unread" / "still in the inbox", a non-nil
// timestamp records when the user (or an auto-mark policy) flipped the bit.
//
// Severity (Phase-46 / Prompt 19) is the wire severity the dispatcher
// saw when the row was enqueued. NULL on legacy rows captured before
// the quiet-hours migration. Used by the replay loop to re-evaluate a
// deferred row against active DND windows.
//
// AcknowledgedAt / AcknowledgedBy / AcknowledgementNote (Phase-46 / Prompt 20)
// carry the latest acknowledgement state of the alert this row represents.
// NULL means "not yet acknowledged"; a non-nil AcknowledgedAt records when,
// by whom, and (optionally) why. Cleared by /alerts/{id}/reopen. The
// per-acknowledgement audit timeline lives in notification_log_events.
type NotificationLog struct {
	ID                  int64      `json:"id" db:"id"`
	ChannelID           int64      `json:"channel_id" db:"channel_id"`
	AlertID             *int64     `json:"alert_id,omitempty" db:"alert_id"`
	Title               string     `json:"title" db:"title"`
	Message             string     `json:"message" db:"message"`
	Status              string     `json:"status" db:"status"` // pending, sent, failed, deferred_dnd
	Severity            string     `json:"severity,omitempty" db:"severity"`
	Error               string     `json:"error,omitempty" db:"error"`
	ScheduledAt         *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	LatencyMs           *int       `json:"latency_ms,omitempty" db:"latency_ms"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	SentAt              *time.Time `json:"sent_at,omitempty" db:"sent_at"`
	ReadAt              *time.Time `json:"read_at,omitempty" db:"read_at"`
	ArchivedAt          *time.Time `json:"archived_at,omitempty" db:"archived_at"`
	AcknowledgedAt      *time.Time `json:"acknowledged_at,omitempty" db:"acknowledged_at"`
	AcknowledgedBy      *string    `json:"acknowledged_by,omitempty" db:"acknowledged_by"`
	AcknowledgementNote *string    `json:"acknowledgement_note,omitempty" db:"acknowledgement_note"`
}

// NotificationSchedule represents a scheduled or recurring notification.
type NotificationSchedule struct {
	ID          int64      `json:"id" db:"id"`
	ChannelID   int64      `json:"channel_id" db:"channel_id"`
	Title       string     `json:"title" db:"title"`
	Message     string     `json:"message" db:"message"`
	CronExpr    *string    `json:"cron_expr,omitempty" db:"cron_expr"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty" db:"scheduled_at"`
	LastRunAt   *time.Time `json:"last_run_at,omitempty" db:"last_run_at"`
	NextRunAt   *time.Time `json:"next_run_at,omitempty" db:"next_run_at"`
	Enabled     bool       `json:"enabled" db:"enabled"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
}

// NotificationPreference controls which event types trigger a channel.
type NotificationPreference struct {
	ID        int64     `json:"id" db:"id"`
	ChannelID int64     `json:"channel_id" db:"channel_id"`
	EventType string    `json:"event_type" db:"event_type"`
	Enabled   bool      `json:"enabled" db:"enabled"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// NotificationMetric tracks daily delivery metrics per channel.
type NotificationMetric struct {
	ID           int64     `json:"id" db:"id"`
	ChannelID    int64     `json:"channel_id" db:"channel_id"`
	Date         time.Time `json:"date" db:"date"`
	TotalSent    int       `json:"total_sent" db:"total_sent"`
	TotalFailed  int       `json:"total_failed" db:"total_failed"`
	AvgLatencyMs int       `json:"avg_latency_ms" db:"avg_latency_ms"`
}
