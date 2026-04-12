package queries

// Notification SQL queries.
const (
	GetNotificationByID = `
		SELECT id, user_id, type, title, body, fsm_state, channel,
		       failed_reason, retry_count, created_at, sent_at
		FROM notifications
		WHERE id = $1`

	GetNotificationsByUserID = `
		SELECT id, user_id, type, title, body, fsm_state, channel,
		       failed_reason, retry_count, created_at, sent_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY created_at DESC`

	GetPendingNotifications = `
		SELECT id, user_id, type, title, body, fsm_state, channel,
		       failed_reason, retry_count, created_at, sent_at
		FROM notifications
		WHERE fsm_state = 'pending'
		ORDER BY created_at ASC
		LIMIT $1`

	GetNotificationByIDForUpdate = `
		SELECT id, user_id, type, title, body, fsm_state, channel,
		       failed_reason, retry_count, created_at, sent_at
		FROM notifications
		WHERE id = $1
		FOR UPDATE`

	UpsertNotification = `
		INSERT INTO notifications (
			id, user_id, type, title, body, fsm_state, channel,
			failed_reason, retry_count, created_at, sent_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO UPDATE SET
			fsm_state = EXCLUDED.fsm_state,
			failed_reason = EXCLUDED.failed_reason,
			retry_count = EXCLUDED.retry_count,
			sent_at = EXCLUDED.sent_at`
)
