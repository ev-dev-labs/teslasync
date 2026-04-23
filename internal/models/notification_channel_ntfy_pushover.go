package models

// NotificationChannelNtfy mirrors the post-migration schema for the
// notification_channel_ntfy table, which holds ntfy-specific settings for a
// notification channel. The auth_token column is encrypted at rest by
// internal/crypto and stored as ciphertext text.
type NotificationChannelNtfy struct {
	ChannelID int64   `db:"channel_id" json:"channel_id"`
	ServerURL string  `db:"server_url" json:"server_url"`
	Topic     string  `db:"topic" json:"topic"`
	AuthToken *string `db:"auth_token" json:"auth_token,omitempty"`
}

// NotificationChannelPushover mirrors the post-migration schema for the
// notification_channel_pushover table, which holds Pushover-specific settings
// for a notification channel. Both the user_key and api_token columns are
// encrypted at rest by internal/crypto and stored as ciphertext text.
type NotificationChannelPushover struct {
	ChannelID int64  `db:"channel_id" json:"channel_id"`
	UserKey   string `db:"user_key" json:"user_key"`
	APIToken  string `db:"api_token" json:"api_token"`
}
