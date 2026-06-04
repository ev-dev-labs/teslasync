// Package notification owns the /notifications/* HTTP surface — channel
// CRUD, channel test delivery, inbox bulk operations, webhook signature
// preview/test, and scheduled notifications.
//
// This package owns three handler types, all wired from the parent router:
//
//   - Handler: channel CRUD, /channels test delivery, inbox bulk
//     (mark-read/archive/delete), unread-count, stats. Owns the legacy
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
