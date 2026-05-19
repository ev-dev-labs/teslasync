package api

import (
	"net/http"
	"strings"
)

// isVehiclePhotoUploadPath returns true when the request is the
// vehicle photo upload endpoint (POST /api/v1/vehicles/{id}/photo).
// Used by the global body-limit middleware to bypass the 1 MB cap
// for photo uploads — a wrapped http.MaxBytesReader can't be
// loosened later, so the bypass MUST happen at the global layer.
func isVehiclePhotoUploadPath(method, path string) bool {
	if method != http.MethodPost {
		return false
	}
	const prefix = "/api/v1/vehicles/"
	if !strings.HasPrefix(path, prefix) {
		return false
	}
	rest := path[len(prefix):]
	idx := strings.Index(rest, "/")
	if idx <= 0 {
		return false
	}
	tail := rest[idx:]
	// Accept exactly /photo (no trailing slash, no sub-path) so
	// future endpoints under /vehicles/{id}/photo/X don't
	// inherit the 12 MB limit.
	return tail == "/photo"
}
