// Package sysauthmode serves GET /api/v1/system/auth-mode, the
// deployment auth-mode contract consumed by the SPA session monitor.
//
// The endpoint is intentionally reachable in both open mode and
// forward-auth mode so the frontend can discover the configured subject
// header, current subject (when present), provider hint, and capability
// matrix without hard-coding proxy details.
//
// Layer: handler
package sysauthmode
