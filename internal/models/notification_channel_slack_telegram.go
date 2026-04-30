package models

// NotificationChannelSlack mirrors the post-migration schema for the
// notification_channel_slack table, which holds Slack-specific settings for a
// notification channel. The webhook_url column is encrypted at rest by
// internal/crypto and stored as ciphertext text.
type NotificationChannelSlack struct {
	ChannelID  int64   `db:"channel_id" json:"channel_id"`
	WebhookURL string  `db:"webhook_url" json:"webhook_url"`
	Channel    *string `db:"channel" json:"channel,omitempty"`
	Username   *string `db:"username" json:"username,omitempty"`
}

// NotificationChannelTelegram mirrors the post-migration schema for the
// notification_channel_telegram table, which holds Telegram-specific settings
// for a notification channel. The bot_token column is encrypted at rest by
// internal/crypto and stored as ciphertext text.
type NotificationChannelTelegram struct {
	ChannelID int64  `db:"channel_id" json:"channel_id"`
	BotToken  string `db:"bot_token" json:"bot_token"`
	ChatID    string `db:"chat_id" json:"chat_id"`
}
