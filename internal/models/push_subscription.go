package models

import "time"

// PushSubscription represents one row of the push_subscriptions table
// (migration 000165, Phase 40 / Prompt 52).
//
// The wire shape mirrors the JSON returned by PushSubscription.toJSON()
// in the browser, with two TeslaSync-specific additions:
//   - UserAgent (captured from the request header at subscribe time so
//     the per-device list can show "Chrome 124 on macOS" rather than just
//     a 200-character endpoint URL).
//   - LastUsedAt (touched on every successful push delivery).
//
// JSON tags are snake_case to match the Go API convention; the frontend
// camelCaseKeys transform produces matching camelCase keys (user_agent →
// userAgent, etc.) so consumers can pick either naming convention.
type PushSubscription struct {
	ID         int64      `json:"id" db:"id"`
	UserID     *int64     `json:"user_id,omitempty" db:"user_id"`
	Endpoint   string     `json:"endpoint" db:"endpoint"`
	P256DH     string     `json:"p256dh" db:"p256dh"`
	Auth       string     `json:"auth" db:"auth"`
	UserAgent  *string    `json:"user_agent,omitempty" db:"user_agent"`
	CreatedAt  time.Time  `json:"created_at" db:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty" db:"last_used_at"`
}
