package models

// NotificationChannelEmail mirrors the post-migration schema for the
// notification_channel_email table, which holds SMTP-specific settings for a
// notification channel. The smtp_password column is encrypted at rest by
// internal/crypto and stored as ciphertext text. The to_addresses column is a
// comma-separated list parsed at runtime.
type NotificationChannelEmail struct {
	ChannelID    int64   `db:"channel_id" json:"channel_id"`
	SMTPHost     string  `db:"smtp_host" json:"smtp_host"`
	SMTPPort     int     `db:"smtp_port" json:"smtp_port"`
	SMTPUsername *string `db:"smtp_username" json:"smtp_username,omitempty"`
	SMTPPassword *string `db:"smtp_password" json:"smtp_password,omitempty"`
	FromAddress  string  `db:"from_address" json:"from_address"`
	ToAddresses  string  `db:"to_addresses" json:"to_addresses"`
	UseTLS       bool    `db:"use_tls" json:"use_tls"`
}

// NotificationChannelWebhook mirrors the post-migration schema for the
// notification_channel_webhook table, which holds generic HTTP webhook
// settings for a notification channel. The bearer_token column is encrypted at
// rest by internal/crypto and stored as ciphertext text. The http_method
// column is constrained to one of POST, PUT, or PATCH at the schema level.
type NotificationChannelWebhook struct {
	ChannelID   int64   `db:"channel_id" json:"channel_id"`
	URL         string  `db:"url" json:"url"`
	HTTPMethod  string  `db:"http_method" json:"http_method"`
	BearerToken *string `db:"bearer_token" json:"bearer_token,omitempty"`
}
