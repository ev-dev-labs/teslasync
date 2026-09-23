// Package notification owns the /notifications/* HTTP surface — channel
// CRUD, channel test delivery, inbox bulk operations, bounded historical
// reporting, webhook signature preview/test, and scheduled notifications.
//
// GET /notifications/report takes UTC calendar dates from/to (inclusive),
// defaults to the most recent 30 days including today, and accepts up to
// 3660 days. triggered counts canonical status=triggered event rows, including
// zero-channel and WebPush-only events; deliveries counts only channel attempts.
// by_source, by_type and by_severity count events; by_channel and by_status
// count delivery attempts. Daily counts are UTC and include zero-filled days.
// Rows without trigger_id remain historical deliveries only and are separately
// reported as uncorrelated_deliveries: historical fan-out cannot be inferred.
//
// This package owns three handler types, all wired from the parent router:
//
//   - Handler: channel CRUD, /channels test delivery, inbox bulk
//     (mark-read/archive/delete), unread-count, stats and report. Owns the legacy
//     non-HMAC outbound adapters (sendDiscord/sendSlack/sendTelegram/
//     sendWebhook/sendNtfy/sendPushover/postJSON) routed through
//     notifyOutboundClient + httputil.
//   - ChannelHandler: HMAC-aware webhook test + signature preview.
//     Uses notifier.Send for the signed path.
//   - ScheduleHandler: scheduled notifications, per-channel preferences,
//     and analytics.
//
// # Outbound API call sink
//
// Outbound adapter requests are decorated with an httputil.APICallSink
// that records every call into the api_call_logs table. The sink can be
// swapped at runtime via the parent api package's SetOutboundSink, so
// this subpackage exposes a SinkProvider package-var hook that the
// composition root sets at boot to the parent's currentOutboundSink
// lookup. Default is nil (no sink) so unit tests in this package work
// out-of-the-box with no wiring.
//
// # Layer
//
// Layer: handler
package notification
