// Package notification holds repository types for the notification aggregate:
// NotificationRepo (logs, history, stats, grouping), NotificationChannelRepo
// (channel config + webhook secrets), NotificationScheduleRepo +
// NotificationPreferenceRepo + NotificationMetricRepo (delivery scheduling
// + per-user preferences + metric counters), PushSubscriptionsRepo (web-push
// device endpoints), and the ChatRepo helper for AI chatbot session storage.
//
// Carved from internal/database in Phase R4.6 per ADR-011. Callers import
// as `dbnotif` to disambiguate from internal/notification (runtime
// notification service) and internal/notifier (legacy notifier facade).
//
// Quiet-hours repo stays in PARENT internal/database because
// settings_serializer.go (parent file) needs the QuietHoursInput type
// inline; pulling quiet_hours out would create a parent → child import
// cycle. Lesson #26: when a parent peer file references a candidate
// subpackage symbol, choose: (a) leave the symbol in parent, (b) carve
// the parent peer file too. We chose (a) here for cohesion.
//
// Layer: adapter (database)
package notification
