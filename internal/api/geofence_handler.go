package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func validateGeofence(g *models.Geofence) error {
	if g.Latitude < -90 || g.Latitude > 90 {
		return fmt.Errorf("latitude must be between -90 and 90")
	}
	if g.Longitude < -180 || g.Longitude > 180 {
		return fmt.Errorf("longitude must be between -180 and 180")
	}
	if g.Radius > 100000 {
		return fmt.Errorf("radius must be 100km or less")
	}
	if len(g.Name) > 200 {
		return fmt.Errorf("name must be 200 characters or less")
	}
	return nil
}

// GeofenceHandler handles geofence CRUD.
type GeofenceHandler struct {
	geofenceRepo *database.GeofenceRepo
}

func NewGeofenceHandler(db *database.DB) *GeofenceHandler {
	return &GeofenceHandler{geofenceRepo: database.NewGeofenceRepo(db)}
}

func (h *GeofenceHandler) List(w http.ResponseWriter, r *http.Request) {
	geofences, err := h.geofenceRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list geofences")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to list geofences"))
		return
	}
	writeJSON(w, http.StatusOK, geofences)
}

func (h *GeofenceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var g models.Geofence
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	if g.Name == "" || g.Radius <= 0 {
		writeAppError(w, r, ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(&g); err != nil {
		writeAppError(w, r, ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Create(r.Context(), &g); err != nil {
		log.Error().Err(err).Msg("failed to create geofence")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to create geofence"))
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

func (h *GeofenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "geofenceID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	g, err := h.geofenceRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get geofence")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to get geofence"))
		return
	}
	if g == nil {
		writeAppError(w, r, ErrGeofenceNotFound)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (h *GeofenceHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "geofenceID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	var g models.Geofence
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	g.ID = id

	if g.Name == "" || g.Radius <= 0 {
		writeAppError(w, r, ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(&g); err != nil {
		writeAppError(w, r, ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Update(r.Context(), &g); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update geofence")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to update geofence"))
		return
	}
	writeJSON(w, http.StatusOK, g)
}

func (h *GeofenceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "geofenceID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	if err := h.geofenceRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete geofence")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to delete geofence"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
