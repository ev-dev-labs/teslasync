package models

// NotificationChannelDiscord mirrors the post-migration schema for the
// notification_channel_discord table, which holds Discord-specific settings
// for a notification channel. The webhook_url column is encrypted at rest by
// internal/crypto and stored as ciphertext text.
type NotificationChannelDiscord struct {
	ChannelID  int64   `db:"channel_id" json:"channel_id"`
	WebhookURL string  `db:"webhook_url" json:"webhook_url"`
	Username   *string `db:"username" json:"username,omitempty"`
	AvatarURL  *string `db:"avatar_url" json:"avatar_url,omitempty"`
}
