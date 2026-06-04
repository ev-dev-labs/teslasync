// Package totp serves per-user TOTP enrollment, verification, backup-code,
// and sudo step-up endpoints under /api/v1/auth/totp.
//
// Wire-shape stability: machine-readable codes such as AUTH_MODE_OPEN,
// TOTP_INVALID, TOTP_RATE_LIMITED, and REAUTH_NOT_CONFIGURED are part of the
// SPA recovery contract and must stay stable across package moves.
//
// Layer: handler
package totp
