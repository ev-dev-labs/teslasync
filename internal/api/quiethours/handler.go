package quiethours

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Per-user notification quiet-hours and DND CRUD endpoints.
//
// Endpoints (mounted under /api/v1/notifications/quiet-hours by router.go):
//   GET    /                  list windows owned by the caller
//   POST   /                  create a new window
//   PATCH  /{id}              partial update of a window
//   DELETE /{id}              remove a window
//
// Identity is derived from the configured ForwardAuth header. In open-mode
// installs (no ForwardAuth configured) the actor resolves to the empty
// string, which is still a valid scope key — the windows act as the
// install-wide DND policy.

// quietHoursStore is the narrow read/write surface the handler depends
// on. Production = *quiethoursdb.QuietHoursRepo; tests provide an in-memory
// fake that exercises the same validation rules.
type quietHoursStore interface {
	ListByUser(ctx context.Context, userID string) ([]*models.QuietHoursWindow, error)
	Get(ctx context.Context, userID string, id int64) (*models.QuietHoursWindow, error)
	Insert(ctx context.Context, userID string, in settingsdb.QuietHoursInput) (*models.QuietHoursWindow, error)
	Update(ctx context.Context, userID string, id int64, in settingsdb.QuietHoursInput) (*models.QuietHoursWindow, error)
	Delete(ctx context.Context, userID string, id int64) error
}

// Handler serves /notifications/quiet-hours endpoints.
type Handler struct {
	store    quietHoursStore
	authHdr  string
	bodyMaxB int64
}

// NewHandler wires the handler against the shared repo. The ForwardAuth
// header drives per-user scoping.
func NewHandler(store quietHoursStore, cfg *config.Config) *Handler {
	h := &Handler{store: store, bodyMaxB: 4 * 1024}
	if cfg != nil {
		h.authHdr = cfg.Auth.ForwardAuthHeader
	}
	return h
}

// quietHoursPayload is the JSON contract for POST and PATCH. All fields
// optional; the repo applies defaults on Insert and partial-update on
// Update.
type quietHoursPayload struct {
	Enabled          *bool     `json:"enabled,omitempty"`
	StartLocal       *string   `json:"start_local,omitempty"`
	EndLocal         *string   `json:"end_local,omitempty"`
	Timezone         *string   `json:"timezone,omitempty"`
	Weekdays         *int      `json:"weekdays,omitempty"`
	BypassSeverities *[]string `json:"bypass_severities,omitempty"`
}

func (p *quietHoursPayload) toInput() settingsdb.QuietHoursInput {
	return settingsdb.QuietHoursInput{
		Enabled:          p.Enabled,
		StartLocal:       p.StartLocal,
		EndLocal:         p.EndLocal,
		Timezone:         p.Timezone,
		Weekdays:         p.Weekdays,
		BypassSeverities: p.BypassSeverities,
	}
}

// List handles GET /quiet-hours.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	rows, err := h.store.ListByUser(r.Context(), user)
	if err != nil {
		log.Error().Err(err).Msg("quiet_hours: list failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list quiet hours")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"windows": rows,
	})
}

// Create handles POST /quiet-hours.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, h.bodyMaxB)
	var p quietHoursPayload
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	row, err := h.store.Insert(r.Context(), user, p.toInput())
	if err != nil {
		writeQuietHoursError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, row)
}

// Patch handles PATCH /quiet-hours/{id}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	id, ok := h.parseID(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, h.bodyMaxB)
	var p quietHoursPayload
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	row, err := h.store.Update(r.Context(), user, id, p.toInput())
	if err != nil {
		writeQuietHoursError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, row)
}

// Delete handles DELETE /quiet-hours/{id}.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	id, ok := h.parseID(w, r)
	if !ok {
		return
	}
	user := actorFromRequest(r, h.authHdr)
	if err := h.store.Delete(r.Context(), user, id); err != nil {
		writeQuietHoursError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid quiet-hours id")
		return 0, false
	}
	return id, true
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

// writeQuietHoursError maps repo sentinel errors onto HTTP statuses.
func writeQuietHoursError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, quiethoursdb.ErrQuietHoursNotFound):
		httpx.WriteError(w, http.StatusNotFound, "quiet-hours window not found")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidTime):
		httpx.WriteError(w, http.StatusBadRequest, "start_local/end_local must be HH:MM (24h)")
	case errors.Is(err, quiethoursdb.ErrQuietHoursEqualTime):
		httpx.WriteError(w, http.StatusBadRequest, "start_local must differ from end_local")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidTimezone):
		httpx.WriteError(w, http.StatusBadRequest, "timezone must be a valid IANA name")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidWeekdays):
		httpx.WriteError(w, http.StatusBadRequest, "weekdays must be 0..127")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidSeverity):
		httpx.WriteError(w, http.StatusBadRequest, "bypass_severities allowed values are info|warn|critical")
	default:
		log.Error().Err(err).Msg("quiet_hours: handler error")
		httpx.WriteError(w, http.StatusInternalServerError, "quiet-hours operation failed")
	}
}
