// Package webvitals owns the public Web Vitals ingest endpoint that accepts
// Core Web Vitals batches from the SPA and records bounded Prometheus metrics.
//
// It keeps browser-side performance telemetry isolated from the parent API
// router while preserving the anonymous, rate-limited POST /api/v1/web-vitals
// surface.
//
// Layer: handler
package webvitals
