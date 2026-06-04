package notification

import (
	"errors"
	"net/http"
)

// isMaxBytesError checks if the error is from http.MaxBytesReader.
// Local copy of the parent api.isMaxBytesError helper — duplicated so the
// subpackage stays free of any dependency on webhook_receiver_handler.go.
func isMaxBytesError(err error) bool {
	var maxErr *http.MaxBytesError
	return errors.As(err, &maxErr)
}

// boolPtr returns a pointer to the supplied bool. Local copy of the parent
// api.boolPtr helper to keep the subpackage independent of
// telemetry_sessions_signal_helpers.go.
func boolPtr(v bool) *bool { return &v }
