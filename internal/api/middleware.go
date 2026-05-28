package api

// Cross-cutting HTTP middleware (Metrics, Logger, Recovery, Tracing,
// SecurityHeaders, Prometheus) and their helpers were carved out to
// internal/api/middleware in R2.0d (commit pending). Auth-related
// middleware (apikey/forward_auth/sudo), ErrorTrackingMiddleware,
// APICallLogMiddleware, and userPrefsMiddleware remain here for now —
// see internal/api/middleware/doc.go for the scope rationale.
