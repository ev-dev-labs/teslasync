package api

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// geofenceCreateRequest is the wire shape accepted by Create/Update.
//
// The web client posts circle geometry (`latitude`, `longitude`, `radius` in
// meters) plus optional alert/enabled flags that the current schema does not
// persist. Legacy callers that already produce polygon WKT may post
// `polygon_wkt` directly. Whichever geometry is present wins; circle takes
// precedence when both are supplied.
type geofenceCreateRequest struct {
	Name       string                   `json:"name"`
	PolygonWKT string                   `json:"polygon_wkt"`
	Category   *models.GeofenceCategory `json:"category"`

	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Radius    *float64 `json:"radius"`
}

// geofenceCircleSegments controls the smoothness of the synthesized
// polygon. 32 segments keeps the WKT compact while staying visually round
// at typical city-block radii.
const geofenceCircleSegments = 32

// circleToPolygonWKT approximates a geodetic circle with a regular N-gon.
// Coordinates are emitted in WKT order: `POLYGON((lon lat, ..., lon lat))`,
// closing on the first vertex per the OGC spec.
func circleToPolygonWKT(latDeg, lonDeg, radiusMeters float64, segments int) string {
	if segments < 3 {
		segments = 3
	}
	const metersPerDegLat = 111_320.0
	latRad := latDeg * math.Pi / 180.0
	metersPerDegLon := metersPerDegLat * math.Cos(latRad)
	if metersPerDegLon < 1 {
		// At the poles longitude collapses; clamp so we never divide by ~0.
		metersPerDegLon = 1
	}
	dLat := radiusMeters / metersPerDegLat
	dLon := radiusMeters / metersPerDegLon

	var b strings.Builder
	b.WriteString("POLYGON((")
	for i := 0; i < segments; i++ {
		theta := 2 * math.Pi * float64(i) / float64(segments)
		lon := lonDeg + dLon*math.Sin(theta)
		lat := latDeg + dLat*math.Cos(theta)
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%.7f %.7f", lon, lat)
	}
	// Close the ring by repeating the first vertex.
	lonClose := lonDeg + dLon*math.Sin(0)
	latClose := latDeg + dLat*math.Cos(0)
	fmt.Fprintf(&b, ",%.7f %.7f", lonClose, latClose)
	b.WriteString("))")
	return b.String()
}

// decodeGeofenceWriteBody unmarshals the request and resolves whichever
// geometry the client supplied into a populated *models.Geofence.
//
// Validation that depends on the resolved geometry (centroid bounds, radius
// limits) is delegated to validateGeofence() so Create and Update share one
// rule set.
func decodeGeofenceWriteBody(body io.Reader) (*models.Geofence, error) {
	var req geofenceCreateRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return nil, fmt.Errorf("decode geofence body: %w", err)
	}

	g := &models.Geofence{
		Name:       strings.TrimSpace(req.Name),
		PolygonWKT: strings.TrimSpace(req.PolygonWKT),
		Category:   req.Category,
	}

	if req.Latitude != nil && req.Longitude != nil && req.Radius != nil {
		g.PolygonWKT = circleToPolygonWKT(*req.Latitude, *req.Longitude, *req.Radius, geofenceCircleSegments)
	}

	return g, nil
}

func validateGeofence(g *models.Geofence) error {
	if g.Latitude() < -90 || g.Latitude() > 90 {
		return fmt.Errorf("latitude must be between -90 and 90")
	}
	if g.Longitude() < -180 || g.Longitude() > 180 {
		return fmt.Errorf("longitude must be between -180 and 180")
	}
	if g.Radius() > 100000 {
		return fmt.Errorf("radius must be 100km or less")
	}
	if len(g.Name) > 200 {
		return fmt.Errorf("name must be 200 characters or less")
	}
	return nil
}

// GeofenceHandler handles geofence CRUD.
type GeofenceHandler struct {
	db           *database.DB
	geofenceRepo *database.GeofenceRepo
	// bulkOverride lets tests substitute the bulk store without standing
	// up a real *database.GeofenceRepo. Always nil in production.
	bulkOverride geofenceBulkStore
}

func NewGeofenceHandler(db *database.DB) *GeofenceHandler {
	return &GeofenceHandler{db: db, geofenceRepo: database.NewGeofenceRepo(db)}
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
	g, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	if g.Name == "" || g.Radius() <= 0 {
		writeAppError(w, r, ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(g); err != nil {
		writeAppError(w, r, ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Create(r.Context(), g); err != nil {
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

	g, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	g.ID = id

	if g.Name == "" || g.Radius() <= 0 {
		writeAppError(w, r, ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(g); err != nil {
		writeAppError(w, r, ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Update(r.Context(), g); err != nil {
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
