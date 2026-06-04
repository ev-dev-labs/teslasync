// Package notification holds repository types for the notification aggregate:
// NotificationRepo (logs, history, stats, grouping), NotificationChannelRepo
// (channel config + webhook secrets), NotificationScheduleRepo +
// NotificationPreferenceRepo + NotificationMetricRepo (delivery scheduling
// + per-user preferences + metric counters), PushSubscriptionsRepo (web-push
// device endpoints), and the ChatRepo helper for AI chatbot session storage.
//
// Callers import this package as `dbnotif` to disambiguate from
// internal/notification (runtime
// notification service) and internal/notifier (legacy notifier facade).
//
// Quiet-hours repo stays in PARENT internal/database because
// settings_serializer.go (parent file) needs the QuietHoursInput type
// inline; pulling quiet_hours out would create a parent → child import
// cycle. When a parent peer file references a candidate subpackage
// symbol, choose either to leave the symbol in parent or to move the
// parent peer too. We chose to keep it here for cohesion.
//
// Layer: adapter
package notification
