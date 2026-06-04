// Package sleep serves GET /api/v1/analytics/sleep, deriving sleep
// efficiency analytics from FSM transitions while preserving the legacy
// sentry-drain response keys until per-park drain reconstruction returns.
//
// Layer: handler
package sleep
