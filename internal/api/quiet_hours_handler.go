package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// Phase-46 / Prompt 19 — per-user notification quiet-hours / DND CRUD.
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

// QuietHoursHandler serves /notifications/quiet-hours endpoints.
type QuietHoursHandler struct {
	store    quietHoursStore
	authHdr  string
	bodyMaxB int64
}

// NewQuietHoursHandler wires the handler against the shared repo. The
// ForwardAuth header drives per-user scoping.
func NewQuietHoursHandler(store quietHoursStore, cfg *config.Config) *QuietHoursHandler {
	h := &QuietHoursHandler{store: store, bodyMaxB: 4 * 1024}
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
func (h *QuietHoursHandler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	rows, err := h.store.ListByUser(r.Context(), user)
	if err != nil {
		log.Error().Err(err).Msg("quiet_hours: list failed")
		writeError(w, http.StatusInternalServerError, "failed to list quiet hours")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"windows": rows,
	})
}

// Create handles POST /quiet-hours.
func (h *QuietHoursHandler) Create(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, h.bodyMaxB)
	var p quietHoursPayload
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		writeError(w, http.StatusBadRequest, "invalid payload")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	row, err := h.store.Insert(r.Context(), user, p.toInput())
	if err != nil {
		writeQuietHoursError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

// Patch handles PATCH /quiet-hours/{id}.
func (h *QuietHoursHandler) Patch(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
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
		writeError(w, http.StatusBadRequest, "invalid payload")
		return
	}
	user := actorFromRequest(r, h.authHdr)
	row, err := h.store.Update(r.Context(), user, id, p.toInput())
	if err != nil {
		writeQuietHoursError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// Delete handles DELETE /quiet-hours/{id}.
func (h *QuietHoursHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "quiet-hours store unavailable")
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

func (h *QuietHoursHandler) parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := strings.TrimSpace(chi.URLParam(r, "id"))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid quiet-hours id")
		return 0, false
	}
	return id, true
}

// writeQuietHoursError maps repo sentinel errors onto HTTP statuses.
func writeQuietHoursError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, quiethoursdb.ErrQuietHoursNotFound):
		writeError(w, http.StatusNotFound, "quiet-hours window not found")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidTime):
		writeError(w, http.StatusBadRequest, "start_local/end_local must be HH:MM (24h)")
	case errors.Is(err, quiethoursdb.ErrQuietHoursEqualTime):
		writeError(w, http.StatusBadRequest, "start_local must differ from end_local")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidTimezone):
		writeError(w, http.StatusBadRequest, "timezone must be a valid IANA name")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidWeekdays):
		writeError(w, http.StatusBadRequest, "weekdays must be 0..127")
	case errors.Is(err, quiethoursdb.ErrQuietHoursInvalidSeverity):
		writeError(w, http.StatusBadRequest, "bypass_severities allowed values are info|warn|critical")
	default:
		log.Error().Err(err).Msg("quiet_hours: handler error")
		writeError(w, http.StatusInternalServerError, "quiet-hours operation failed")
	}
}
