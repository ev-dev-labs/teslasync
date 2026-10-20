package app

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	apialertmsg "github.com/ev-dev-labs/teslasync/internal/api/alertmsg"
)

// NewAlertMessagePreviewHandler composes the read-only preview endpoint without
// exposing API construction to callers outside the composition root. A nil clock
// uses the handler's normal current-time behavior.
func NewAlertMessagePreviewHandler(settings alertmsg.SettingsReader, clock func() time.Time) http.Handler {
	handler := apialertmsg.NewAlertMessageHandler(settings).WithClock(clock)
	return http.HandlerFunc(handler.MessagePreview)
}
