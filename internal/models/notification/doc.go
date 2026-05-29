// Package notification hosts persistence + transport DTOs for the
// notification-delivery bounded context: configured channels (discord/
// email/slack/telegram/webhook/ntfy/pushover), per-attempt delivery log
// rows (with inbox + acknowledgement state), schedules (cron + one-shot),
// per-event-type preferences, and per-channel daily metrics.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models. Recommended caller alias when importing alongside
// other models subpackages (per ADR-011 §3):
// `notificationmodel "internal/models/notification"`.
//
// Note: NotificationLogEvent (acknowledgement audit timeline) lives in
// internal/models/alert because its rows reference alert_rules and ship
// with the alert subsystem.
package notification
