// Layer: app
//
// Package gdprexportsvc is the application service for Phase-45's
// GDPR data-subject export download surface. It wraps the
// internal/database.GDPRArtifactRepo so internal/handler/v1's GDPR
// export handler can stay thin (TestHandlerV1Thinness).
package gdprexportsvc
