package journey

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// SessionStore is the session/plan port. *Store satisfies it.
type SessionStore interface {
	Create(ctx context.Context, in NewSession) (*Session, error)
	Get(ctx context.Context, id int64) (*Session, error)
	List(ctx context.Context, vehicleID int64, status string, limit int) ([]*Session, error)
	ActiveForVehicle(ctx context.Context, vehicleID int64) (*Session, error)
	SetStatus(ctx context.Context, id int64, from, to string) (*Session, error)
	SavePlan(ctx context.Context, sessionID int64, plan json.RawMessage, note string) (*PlanVersion, error)
	ListPlans(ctx context.Context, sessionID int64) ([]*PlanVersion, error)
}

// Handler serves journey sessions + plan versions. Stateless beyond
// constructor inputs; safe for concurrent use.
type Handler struct {
	store SessionStore
}

// NewHandler wires the handler. Panics on nil input (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store SessionStore) *Handler {
	if store == nil {
		panic("journey: nil dependency")
	}
	return &Handler{store: store}
}

type createRequest struct {
	VehicleID  int64    `json:"vehicle_id"`
	Name       string   `json:"name"`
	OriginName string   `json:"origin_name"`
	OriginLat  *float64 `json:"origin_lat"`
	OriginLng  *float64 `json:"origin_lng"`
	DestName   string   `json:"dest_name"`
	DestLat    *float64 `json:"dest_lat"`
	DestLng    *float64 `json:"dest_lng"`
}

// Create serves POST /journey/sessions: plan a new trip.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	if len(req.Name) == 0 || len(req.Name) > 200 {
		httpx.WriteError(w, http.StatusBadRequest, "name must be 1..200 characters")
		return
	}
	if len(req.OriginName) > 300 || len(req.DestName) > 300 {
		httpx.WriteError(w, http.StatusBadRequest, "origin/dest names must be at most 300 characters")
		return
	}
	if !validCoord(req.OriginLat, req.OriginLng) || !validCoord(req.DestLat, req.DestLng) {
		httpx.WriteError(w, http.StatusBadRequest, "lat must be -90..90 and lng -180..180")
		return
	}
	session, err := h.store.Create(r.Context(), NewSession{
		VehicleID: req.VehicleID, Name: req.Name,
		OriginName: req.OriginName, OriginLat: req.OriginLat, OriginLng: req.OriginLng,
		DestName: req.DestName, DestLat: req.DestLat, DestLng: req.DestLng,
	})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("journey: create failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create journey")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, session)
}

func validCoord(lat, lng *float64) bool {
	if lat != nil && (*lat < -90 || *lat > 90) {
		return false
	}
	if lng != nil && (*lng < -180 || *lng > 180) {
		return false
	}
	return true
}

// List serves GET /journey/sessions?vehicle_id=&status=&limit=.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !ValidStatus(status) {
		httpx.WriteError(w, http.StatusBadRequest, "unknown status filter")
		return
	}
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = clampListLimit(n)
		}
	}
	sessions, err := h.store.List(r.Context(), vehicleID, status, limit)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("journey: list failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list journeys")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sessions)
}

type getResponse struct {
	Session *Session       `json:"session"`
	Plans   []*PlanVersion `json:"plans"`
	Next    []string       `json:"next_statuses"`
}

// Get serves GET /journey/sessions/{id}: the session, its plan history,
// and the currently reachable statuses (drives the UI action set).
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	session, err := h.store.Get(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "journey not found")
		return
	}
	plans, err := h.store.ListPlans(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: plans read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey plans")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, getResponse{Session: session, Plans: plans, Next: NextStatuses(session.Status)})
}

// transition serves POST /journey/sessions/{id}/start|pause|resume|
// complete|abort. Starting is rejected with 409 while another session
// for the vehicle is active.
func (h *Handler) transition(to string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := sessionIDParam(r)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		ctx := r.Context()
		session, err := h.store.Get(ctx, id)
		if err != nil {
			log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
			return
		}
		if session == nil {
			httpx.WriteError(w, http.StatusNotFound, "journey not found")
			return
		}
		if err := Transition(session.Status, to); err != nil {
			httpx.WriteError(w, http.StatusConflict, err.Error())
			return
		}
		if to == StatusActive {
			if active, err := h.store.ActiveForVehicle(ctx, session.VehicleID); err != nil {
				log.Error().Err(err).Int64("id", id).Msg("journey: active lookup failed")
				httpx.WriteError(w, http.StatusInternalServerError, "failed to start journey")
				return
			} else if active != nil && active.ID != session.ID {
				httpx.WriteError(w, http.StatusConflict, "another journey is already active for this vehicle")
				return
			}
		}
		updated, err := h.store.SetStatus(ctx, id, session.Status, to)
		if err != nil {
			if errors.Is(err, ErrConflict) {
				httpx.WriteError(w, http.StatusConflict, "journey moved concurrently; refresh and retry")
				return
			}
			var terr *TransitionError
			if errors.As(err, &terr) {
				httpx.WriteError(w, http.StatusConflict, terr.Error())
				return
			}
			log.Error().Err(err).Int64("id", id).Msg("journey: transition failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to update journey")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, updated)
	}
}

// Start serves POST /journey/sessions/{id}/start.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) { h.transition(StatusActive)(w, r) }

// Pause serves POST /journey/sessions/{id}/pause.
func (h *Handler) Pause(w http.ResponseWriter, r *http.Request) { h.transition(StatusPaused)(w, r) }

// Resume serves POST /journey/sessions/{id}/resume.
func (h *Handler) Resume(w http.ResponseWriter, r *http.Request) { h.transition(StatusActive)(w, r) }

// Complete serves POST /journey/sessions/{id}/complete.
func (h *Handler) Complete(w http.ResponseWriter, r *http.Request) {
	h.transition(StatusCompleted)(w, r)
}

// Abort serves POST /journey/sessions/{id}/abort.
func (h *Handler) Abort(w http.ResponseWriter, r *http.Request) { h.transition(StatusAborted)(w, r) }

type savePlanRequest struct {
	Plan json.RawMessage `json:"plan"`
	Note string          `json:"note"`
}

// SavePlan serves POST /journey/sessions/{id}/plans: append a version.
func (h *Handler) SavePlan(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req savePlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Note) > 500 {
		httpx.WriteError(w, http.StatusBadRequest, "note must be at most 500 characters")
		return
	}
	if len(req.Plan) > 0 && !json.Valid(req.Plan) {
		httpx.WriteError(w, http.StatusBadRequest, "plan must be valid JSON")
		return
	}
	pv, err := h.store.SavePlan(r.Context(), id, req.Plan, req.Note)
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			httpx.WriteError(w, http.StatusNotFound, "journey not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("journey: save plan failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, pv)
}

func clampListLimit(n int) int {
	if n <= 0 {
		return 20
	}
	if n > 100 {
		return 100
	}
	return n
}

func sessionIDParam(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errBadSessionID
	}
	return id, nil
}

func vehicleIDParam(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errBadVehicleID
	}
	return id, nil
}

type paramError string

func (e paramError) Error() string { return string(e) }

const (
	errBadSessionID = paramError("session id must be a positive integer")
	errBadVehicleID = paramError("vehicle_id must be a positive integer")
)

// Compile-time port assertion.
var _ SessionStore = (*Store)(nil)
