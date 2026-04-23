package models

// This file defines a typed string enum for the notification_channel_kind
// Postgres ENUM so callers cannot pass arbitrary strings. Values mirror the
// ENUM declared in migrations/_baseline_source/19-notification-channels.sql
// (see also .github/prompts/db-refactor/phase-3-schema/19-create-notification-channels.prompt.md).
//
// ADR-001: typed-by-default — no jsonb config blob; per-kind typed config
// children (notification_channel_discord, _slack, _telegram, _email,
// _webhook, _ntfy, _pushover) are joined off the parent notification_channels
// row using kind as the discriminator.
// ADR-002 (closed vocabulary): adding a new channel kind requires a
// coordinated migration (ALTER TYPE … ADD VALUE plus a new typed child
// table) and an update here.
// ADR-004 (class-table-inheritance): kind selects exactly one
// notification_channel_<kind> child table.

// NotificationChannelKind enumerates the members of the
// notification_channel_kind Postgres ENUM. Each value selects exactly one
// notification_channel_<kind> CTI child table.
type NotificationChannelKind string

const (
	// ChannelDiscord corresponds to the notification_channel_discord
	// child table (Discord webhook URL + optional username/avatar).
	ChannelDiscord NotificationChannelKind = "discord"

	// ChannelSlack corresponds to the notification_channel_slack
	// child table (Slack incoming webhook URL + optional channel/username).
	ChannelSlack NotificationChannelKind = "slack"

	// ChannelTelegram corresponds to the notification_channel_telegram
	// child table (bot token + chat ID).
	ChannelTelegram NotificationChannelKind = "telegram"

	// ChannelEmail corresponds to the notification_channel_email child
	// table (SMTP host/port/credentials + from/to addresses).
	ChannelEmail NotificationChannelKind = "email"

	// ChannelWebhook corresponds to the notification_channel_webhook
	// child table (generic HTTP webhook with method + bearer token).
	ChannelWebhook NotificationChannelKind = "webhook"

	// ChannelNtfy corresponds to the notification_channel_ntfy child
	// table (ntfy.sh server URL + topic + optional auth).
	ChannelNtfy NotificationChannelKind = "ntfy"

	// ChannelPushover corresponds to the notification_channel_pushover
	// child table (Pushover user + app token).
	ChannelPushover NotificationChannelKind = "pushover"
)

// Valid reports whether k is one of the allowed members of the
// notification_channel_kind ENUM. Keep this exhaustive switch in sync with
// the schema; the compiler does not enforce ENUM membership.
func (k NotificationChannelKind) Valid() bool {
	switch k {
	case ChannelDiscord,
		ChannelSlack,
		ChannelTelegram,
		ChannelEmail,
		ChannelWebhook,
		ChannelNtfy,
		ChannelPushover:
		return true
	}
	return false
}

// String returns the wire/DB representation of k. Implementing fmt.Stringer
// keeps log output and error messages aligned with the Postgres ENUM label.
func (k NotificationChannelKind) String() string { return string(k) }
