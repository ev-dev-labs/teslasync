// Package api provides the HTTP handler layer for TeslaSync.
//
// It uses go-chi/v5 for routing and includes middleware for CORS,
// rate limiting (httprate), security headers, request ID tracking,
// structured logging (zerolog), and panic recovery. Over 27 handler
// types cover vehicles, drives, charging sessions, energy analytics,
// battery health, alerts, notifications, geofences, chatbot, tire
// pressure, software updates, vampire drain, mileage, trips,
// vehicle state timeline, data export, and real-time SSE streaming
// via EventHub. All routes are mounted under /api/v1.
//
// Layer: handler
//
// FROZEN per ADR-009 (.github/ARCHITECTURE.md, phase-47/06):
//   - No new .go files may be added to this directory.
//   - Existing files may be edited (bug fixes, dependency updates).
//   - New endpoints belong in internal/handler/v1.
//   - Test files (_test.go) for existing sources remain permitted —
//     tests must live in the same Go package as the code under test.
//
// Migration of these 223 files to internal/handler/v1 is tracked under
// phase-48+ and is explicitly out of scope of phase-47.
package api
