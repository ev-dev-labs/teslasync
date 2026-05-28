package pinned

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
)

// pinnedRepo is the slice of *dbadmin.PinnedRepo the handler depends on.
// Keeping it as an interface lets the unit tests drop in an in-memory fake
// without standing up a real Postgres pool.
type pinnedRepo interface {
	List(ctx context.Context, f dbadmin.PinnedListFilter) ([]*dashboardmodel.PinnedItem, error)
	GetByID(ctx context.Context, id int64) (*dashboardmodel.PinnedItem, error)
	Create(ctx context.Context, p *dashboardmodel.PinnedItem) error
	UpdatePosition(ctx context.Context, id int64, position int) error
	Delete(ctx context.Context, id int64) error
}

// Handler exposes per-user "pin" CRUD across vehicles, widgets,
// alert rules, geofences, automations, etc. (Phase 40 / Prompt 48).
//
// The handler is intentionally agnostic about WHAT is being pinned — it
// only validates the type enum and item_id shape. The owning surface
// (frontend) is responsible for resolving item_id back to a real entity
// before rendering. Stale pins (pin to a deleted vehicle) render as a
// silently dropped row in the list.
type Handler struct {
	repo pinnedRepo
}

// NewHandler wires the production pinned repository.
func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: dbadmin.NewPinnedRepo(db)}
}

// maxPinnedBodyBytes caps each request body. Pins are tiny (item_id ≤ 200,
// context ≤ 200) so 4 KB is generous.
const maxPinnedBodyBytes = 4 << 10

// pinnedCreateRequest is the wire shape for POST.
type pinnedCreateRequest struct {
	ItemType string  `json:"item_type"`
	ItemID   string  `json:"item_id"`
	Context  *string `json:"context,omitempty"`
}

// pinnedUpdateRequest is the wire shape for PATCH. Only `position` is
// supported today — pin scope (item_type / item_id / context) is
// immutable so the unique constraint guarantee can never be violated by
// an in-place edit.
type pinnedUpdateRequest struct {
	Position *int `json:"position,omitempty"`
}

// List returns the current user's pins for the requested item_type. The
// frontend calls this once per surface (vehicles, widgets, alerts, etc.)
// to know which rows to float to the top.
//
//	GET /api/v1/pinned?type=vehicle
//	GET /api/v1/pinned?type=widget&context=glance
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	itemType, ok := parsePinnedItemType(r.URL.Query().Get("type"))
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "type is required and must be a valid item type")
		return
	}

	filter := dbadmin.PinnedListFilter{
		ItemType: itemType,
	}
	if r.URL.Query().Has("context") {
		ctx := r.URL.Query().Get("context")
		if len(ctx) > 200 {
			httpx.WriteError(w, http.StatusBadRequest, "context must be 200 characters or fewer")
			return
		}
		filter.Context = &ctx
	}

	rows, err := h.repo.List(r.Context(), filter)
	if err != nil {
		log.Error().Err(err).Msg("pinned_items list failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list pinned items")
		return
	}
	if rows == nil {
		rows = []*dashboardmodel.PinnedItem{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// Create inserts a new pin at position 0, shifting every other pin in the
// same (user, type, context) bucket down by one. Returns 409 when the same
// item is already pinned in the same bucket so the frontend can refetch
// rather than show a phantom toast.
//
//	POST /api/v1/pinned
//	body: { "item_type": "vehicle", "item_id": "42" }
//	body: { "item_type": "widget", "item_id": "battery", "context": "glance" }
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	body, readErr := readPinnedBody(r)
	if readErr != nil {
		httpx.WriteError(w, readErr.status, readErr.msg)
		return
	}

	var req pinnedCreateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	itemType, ok := parsePinnedItemType(req.ItemType)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "item_type is required and must be a valid item type")
		return
	}

	itemID := strings.TrimSpace(req.ItemID)
	if itemID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "item_id is required")
		return
	}
	if len(itemID) > 200 {
		httpx.WriteError(w, http.StatusBadRequest, "item_id must be 200 characters or fewer")
		return
	}

	var contextVal *string
	if req.Context != nil {
		c := strings.TrimSpace(*req.Context)
		if len(c) > 200 {
			httpx.WriteError(w, http.StatusBadRequest, "context must be 200 characters or fewer")
			return
		}
		if c != "" {
			contextVal = &c
		}
	}

	row := &dashboardmodel.PinnedItem{
		ItemType: itemType,
		ItemID:   itemID,
		Context:  contextVal,
	}
	if err := h.repo.Create(r.Context(), row); err != nil {
		if errors.Is(err, dbadmin.ErrPinnedAlreadyExists) {
			httpx.WriteError(w, http.StatusConflict, "item already pinned")
			return
		}
		log.Error().Err(err).Msg("pinned_items create failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create pin")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, row)
}

// Update changes the absolute display position of a single pin. The
// frontend drag handler owns the ordering and is expected to issue one
// PATCH per moved item.
//
//	PATCH /api/v1/pinned/{id}
//	body: { "position": 2 }
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid pin id")
		return
	}

	body, readErr := readPinnedBody(r)
	if readErr != nil {
		httpx.WriteError(w, readErr.status, readErr.msg)
		return
	}

	var req pinnedUpdateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Position == nil {
		httpx.WriteError(w, http.StatusBadRequest, "position is required")
		return
	}
	if *req.Position < 0 {
		httpx.WriteError(w, http.StatusBadRequest, "position must be zero or positive")
		return
	}

	if err := h.repo.UpdatePosition(r.Context(), id, *req.Position); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "pin not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("pinned_items update failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update pin")
		return
	}

	updated, err := h.repo.GetByID(r.Context(), id)
	if err != nil || updated == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to reload pin")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// Delete removes a pin by id.
//
//	DELETE /api/v1/pinned/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid pin id")
		return
	}

	if delErr := h.repo.Delete(r.Context(), id); delErr != nil {
		if errors.Is(delErr, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "pin not found")
			return
		}
		log.Error().Err(delErr).Int64("id", id).Msg("pinned_items delete failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete pin")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ─────────────────────────────────────────────────────────────────

type pinnedBodyError struct {
	status int
	msg    string
}

func readPinnedBody(r *http.Request) ([]byte, *pinnedBodyError) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxPinnedBodyBytes+1))
	if err != nil {
		return nil, &pinnedBodyError{http.StatusBadRequest, "failed to read request body"}
	}
	if len(body) > maxPinnedBodyBytes {
		return nil, &pinnedBodyError{http.StatusRequestEntityTooLarge, "pin payload exceeds 4 KB limit"}
	}
	return body, nil
}

// parsePinnedItemType validates the supplied type string against the
// closed enum on `dashboardmodel.PinnedItemType`. Returns the typed value on
// success.
func parsePinnedItemType(raw string) (dashboardmodel.PinnedItemType, bool) {
	t := dashboardmodel.PinnedItemType(strings.TrimSpace(raw))
	if !t.Valid() {
		return "", false
	}
	return t, true
}
