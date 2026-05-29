// Layer: app
//
// Package gdprexportsvc serves GDPR data-subject export downloads. It wraps
// internal/dbgdpr.ArtifactRepo so internal/handler/v1's GDPR export handler
// stays thin (TestHandlerV1Thinness).
package gdprexportsvc
