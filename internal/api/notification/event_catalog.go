package notification

import (
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	notifdispatch "github.com/ev-dev-labs/teslasync/internal/notification"
)

// EventTypesHandler serves GET /api/v1/notifications/event-types: the
// complete, stable catalog of component-health notification event
// types (system.<component>.<outage|recovery>) a channel can opt in or
// out of via the existing per-channel preference endpoints
// (GET/PUT /api/v1/notifications/{channelID}/preferences).
//
// This is intentionally a static, DB-free handler — the catalog is a Go
// literal in internal/notification.EventCatalog (the single source of
// truth also consumed by the runtime health watchdog in
// internal/app/health_notify.go), so there is nothing to query and
// nothing that can 500. The Channels UI should fetch this once (it
// changes only on a backend deploy) to render one toggle row per
// event_type without hardcoding or guessing the strings, then read/
// write the per-channel enabled state via the existing preferences
// endpoints, defaulting an absent preference row to each entry's
// default_enabled.
func EventTypesHandler(w http.ResponseWriter, r *http.Request) {
	_, span := otel.Tracer("api").Start(r.Context(), "api.notification.event_types")
	defer span.End()

	// Returned as a bare array, matching the sibling
	// GET /notifications/{channelID}/preferences response shape — the
	// frontend already has a fetch-array-of-objects pattern for that
	// endpoint, so this stays consistent rather than introducing a
	// one-off wrapper object.
	httpx.WriteJSON(w, http.StatusOK, notifdispatch.EventCatalog)
}
