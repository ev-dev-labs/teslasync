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
package api
