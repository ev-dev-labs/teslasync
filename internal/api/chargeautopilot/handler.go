package chargeautopilot

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Handler serves the Autopilot profile, preview, and savings endpoints.
//
// Stateless beyond its constructor inputs; safe for concurrent use.
type Handler struct {
	profiles ProfileStore
	savings  SavingsReader
	now      func() time.Time
}

// NewHandler wires the handler. Panics on nil stores (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(profiles ProfileStore, savings SavingsReader) *Handler {
	if profiles == nil || savings == nil {
		panic("chargeautopilot: nil store")
	}
	return &Handler{profiles: profiles, savings: savings, now: time.Now}
}

func vehicleIDFromQuery(r *http.Request) (int64, error) {
	s := r.URL.Query().Get("vehicle_id")
	if s == "" {
		return 0, errMissingVehicle
	}
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, errMissingVehicle
	}
	return id, nil
}

type vehicleErr string

func (e vehicleErr) Error() string { return string(e) }

const errMissingVehicle = vehicleErr("vehicle_id must be a positive integer")

// GetProfile serves GET /charge-autopilot/profile?vehicle_id=.
func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDFromQuery(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := h.profiles.Get(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("autopilot: profile read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read autopilot profile")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

// UpsertProfile serves PUT /charge-autopilot/profile.
func (h *Handler) UpsertProfile(w http.ResponseWriter, r *http.Request) {
	var p Profile
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := ValidateProfile(p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.profiles.Upsert(r.Context(), &p); err != nil {
		log.Error().Err(err).Int64("vehicle_id", p.VehicleID).Msg("autopilot: profile write failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save autopilot profile")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, &p)
}

type previewRequest struct {
	VehicleID  int64 `json:"vehicle_id"`
	CurrentSOC int   `json:"current_soc"`
}

// Preview serves POST /charge-autopilot/preview: the next automatic run
// for the stored profile. Current SOC is caller-supplied so the endpoint
// stays free of signal-store coupling.
func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	var req previewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	if req.CurrentSOC < 0 || req.CurrentSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "current_soc must be 0..100")
		return
	}
	p, err := h.profiles.Get(r.Context(), req.VehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("autopilot: profile read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read autopilot profile")
		return
	}
	res, err := Preview(PreviewInput{Profile: *p, CurrentSOC: req.CurrentSOC, Now: h.now()})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

type savingsResponse struct {
	TotalSavings float64 `json:"total_savings"`
	Runs         int64   `json:"runs"`
}

// Savings serves GET /charge-autopilot/savings?vehicle_id=.
func (h *Handler) Savings(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := vehicleIDFromQuery(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	total, runs, err := h.savings.TotalSavings(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("autopilot: savings read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read autopilot savings")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, savingsResponse{TotalSavings: total, Runs: runs})
}
