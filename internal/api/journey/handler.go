package journey

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/api/waitoracle"
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

// SignalStore is the price/health port. *Store satisfies it.
type SignalStore interface {
	SitePeaks(ctx context.Context, site string) ([]float64, error)
	SitePrice(ctx context.Context, site string) (perKWh float64, samples int, ok bool, err error)
}

// WaitStore is the demand-history port. *waitoracle.Store satisfies it.
type WaitStore interface {
	History(ctx context.Context, site string) (waitoracle.SiteHistory, error)
}

// Handler serves journey sessions + plan versions. Stateless beyond
// constructor inputs; safe for concurrent use.
type Handler struct {
	store   SessionStore
	signals SignalStore
	waits   WaitStore
	now     func() time.Time
}

// NewHandler wires the handler. Panics on nil inputs (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store SessionStore, signals SignalStore, waits WaitStore) *Handler {
	if store == nil || signals == nil || waits == nil {
		panic("journey: nil dependency")
	}
	return &Handler{store: store, signals: signals, waits: waits, now: time.Now}
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
	session, err := h.store.Create(r.Context(), NewSession(req))
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

// maxCandidates bounds the score request: each candidate costs up to
// three history reads, gathered sequentially.
const maxCandidates = 10

type scoreCandidateRequest struct {
	Site   string  `json:"site"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Arrive string  `json:"arrive_at"`
}

type scoreRequest struct {
	Candidates []scoreCandidateRequest `json:"candidates"`
	EnergyWh   float64                 `json:"energy_wh"`
}

type scoreResponse struct {
	SessionID   int64        `json:"session_id"`
	EnergyWh    float64      `json:"energy_wh"`
	Stops       []ScoredStop `json:"stops"`
	Winner      string       `json:"winner"`
	PlanVersion int          `json:"plan_version"`
}

// ScoreStops serves POST /journey/sessions/{id}/score-stops: rank
// caller-nominated candidate stops on predicted wait, realized price,
// stall health, and corridor deviation — then persist the ranking as a
// plan version. Per-candidate gaps degrade (the signal drops out);
// infrastructure failures fail the request.
func (h *Handler) ScoreStops(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req scoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Candidates) == 0 || len(req.Candidates) > maxCandidates {
		httpx.WriteError(w, http.StatusBadRequest, "candidates must hold 1..10 stops")
		return
	}
	if req.EnergyWh <= 0 || req.EnergyWh > 200000 {
		httpx.WriteError(w, http.StatusBadRequest, "energy_wh must be within 0..200000")
		return
	}
	arrivals := make([]time.Time, len(req.Candidates))
	for i, c := range req.Candidates {
		if c.Site == "" {
			httpx.WriteError(w, http.StatusBadRequest, "candidate site must be non-empty")
			return
		}
		if c.Lat < -90 || c.Lat > 90 || c.Lng < -180 || c.Lng > 180 {
			httpx.WriteError(w, http.StatusBadRequest, "candidate lat/lng out of range")
			return
		}
		t, err := time.Parse(time.RFC3339, c.Arrive)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "candidate arrive_at must be RFC3339")
			return
		}
		arrivals[i] = t
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
	if session.OriginLat == nil || session.OriginLng == nil || session.DestLat == nil || session.DestLng == nil {
		httpx.WriteError(w, http.StatusBadRequest, "journey needs origin and destination coordinates to score stops")
		return
	}
	cands := make([]Candidate, len(req.Candidates))
	sigs := make([]Signals, len(req.Candidates))
	for i, c := range req.Candidates {
		cands[i] = Candidate{Site: c.Site, Lat: c.Lat, Lng: c.Lng, ArriveS: arrivals[i].Unix()}
		sig, err := gatherSiteSignals(ctx, h.signals, h.waits, c.Site, arrivals[i])
		if err != nil {
			log.Error().Err(err).Str("site", c.Site).Msg("journey: signals failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read stop signals")
			return
		}
		sigs[i] = sig
	}
	stops := RankStops(*session.OriginLat, *session.OriginLng, *session.DestLat, *session.DestLng, req.EnergyWh, cands, sigs)
	plan, err := json.Marshal(map[string]any{
		"kind": "stop_scores", "energy_wh": req.EnergyWh, "stops": stops,
		"candidates": candidateEcho(cands),
	})
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: plan encode failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	pv, err := h.store.SavePlan(ctx, id, plan, fmt.Sprintf("stop scores (%d candidates)", len(cands)))
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			httpx.WriteError(w, http.StatusNotFound, "journey not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("journey: save plan failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	winner := ""
	if len(stops) > 0 {
		winner = stops[0].Site
	}
	httpx.WriteJSON(w, http.StatusOK, scoreResponse{
		SessionID: id, EnergyWh: req.EnergyWh, Stops: stops,
		Winner: winner, PlanVersion: pv.Version,
	})
}

// gatherSiteSignals reads wait, price, and peak samples for one site.
// Thin history (ErrNoHistory, unpriced, unmetered) yields nils; anything
// else is an infrastructure failure. Shared by initial scoring and
// replans so both rank on identical inputs.
func gatherSiteSignals(ctx context.Context, signals SignalStore, waits WaitStore, site string, arrival time.Time) (Signals, error) {
	var sig Signals
	history, err := waits.History(ctx, site)
	if err != nil && !errors.Is(err, waitoracle.ErrNoHistory) {
		return sig, err
	}
	if err == nil {
		if f, err := waitoracle.Predict(history, arrival); err == nil {
			sig.WaitS = &f.ExpectedS
		} else if !errors.Is(err, waitoracle.ErrNoHistory) {
			return sig, err
		}
	}
	peaks, err := signals.SitePeaks(ctx, site)
	if err != nil {
		return sig, err
	}
	sig.PeakKW = peaks
	if perKWh, _, ok, err := signals.SitePrice(ctx, site); err != nil {
		return sig, err
	} else if ok {
		sig.PerKWh = &perKWh
	}
	sig.Available = sig.WaitS != nil || sig.PerKWh != nil || len(sig.PeakKW) >= 3
	return sig, nil
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

// Compile-time port assertions.
var (
	_ SessionStore = (*Store)(nil)
	_ SignalStore  = (*Store)(nil)
	_ WaitStore    = (*waitoracle.Store)(nil)
)
