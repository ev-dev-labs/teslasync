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
// meters) plus alert/enabled flags. Legacy callers that already produce
// polygon WKT may post `polygon_wkt` directly. Whichever geometry is present
// wins; circle takes precedence when both are supplied.
//
// `*bool` for the alert flags lets Update distinguish "field omitted" from
// "field set to false" — required for the merge-style PUT the toggle row
// switches and the modal both rely on.
//
// Both camelCase (web-client `toGeofencePayload`) and snake_case (curl /
// import bundles) are accepted: Go's encoding/json is case-insensitive
// across `_` boundaries (`alertOnEntry` does NOT match `alert_on_entry`)
// so we declare an alias field for each flag and let
// coalesceGeofenceRequestSpellings merge them after decode. camelCase wins
// on conflict because that's the documented client contract.
type geofenceCreateRequest struct {
	Name       string                   `json:"name"`
	PolygonWKT string                   `json:"polygon_wkt"`
	Category   *models.GeofenceCategory `json:"category"`

	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Radius    *float64 `json:"radius"`

	// Canonical (web-client) spellings.
	Enabled      *bool `json:"enabled"`
	AlertOnEntry *bool `json:"alertOnEntry"`
	AlertOnExit  *bool `json:"alertOnExit"`

	// snake_case aliases — populated by curl/scripts/import bundles.
	// Coalesced into the canonical fields by
	// coalesceGeofenceRequestSpellings(). NOT read directly anywhere else.
	AlertOnEntrySnake *bool `json:"alert_on_entry"`
	AlertOnExitSnake  *bool `json:"alert_on_exit"`
}

// coalesceGeofenceRequestSpellings copies snake_case alias fields into the
// canonical camelCase fields when the canonical field is nil. camelCase
// wins on conflict — see geofenceCreateRequest doc.
func coalesceGeofenceRequestSpellings(req *geofenceCreateRequest) {
	if req.AlertOnEntry == nil && req.AlertOnEntrySnake != nil {
		req.AlertOnEntry = req.AlertOnEntrySnake
	}
	if req.AlertOnExit == nil && req.AlertOnExitSnake != nil {
		req.AlertOnExit = req.AlertOnExitSnake
	}
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
// Returns the populated Geofence AND the raw decoded request so the caller
// (Update) can detect field presence on `*bool` toggles for merge semantics.
//
// Validation that depends on the resolved geometry (centroid bounds, radius
// limits) is delegated to validateGeofence() so Create and Update share one
// rule set.
func decodeGeofenceWriteBody(body io.Reader) (*models.Geofence, *geofenceCreateRequest, error) {
	var req geofenceCreateRequest
	if err := json.NewDecoder(body).Decode(&req); err != nil {
		return nil, nil, fmt.Errorf("decode geofence body: %w", err)
	}
	coalesceGeofenceRequestSpellings(&req)

	g := &models.Geofence{
		Name:       strings.TrimSpace(req.Name),
		PolygonWKT: strings.TrimSpace(req.PolygonWKT),
		Category:   req.Category,
	}
	if req.Enabled != nil {
		g.Enabled = *req.Enabled
	}
	if req.AlertOnEntry != nil {
		g.AlertOnEntry = *req.AlertOnEntry
	}
	if req.AlertOnExit != nil {
		g.AlertOnExit = *req.AlertOnExit
	}

	if req.Latitude != nil && req.Longitude != nil && req.Radius != nil {
		g.PolygonWKT = circleToPolygonWKT(*req.Latitude, *req.Longitude, *req.Radius, geofenceCircleSegments)
	}

	return g, &req, nil
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
	g, _, err := decodeGeofenceWriteBody(r.Body)
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

// Update applies a merge-style PUT: load the row, then overlay the fields
// the client supplied. This lets the toggle row send `{enabled: true}` and
// the rename input send `{name: "..."}` without each callsite having to
// re-send the polygon, category, and alert flags.
//
// Field-presence detection:
//   - String fields (Name, PolygonWKT) — empty string means "not supplied".
//     The web modal always sends a non-empty Name + a synthesized polygon
//     so this is safe in practice.
//   - Category (*GeofenceCategory pointer) — nil means "not supplied".
//     Trade-off: the client cannot null Category via PUT (rare op).
//   - Enabled / AlertOnEntry / AlertOnExit (*bool) — nil from the raw
//     request means "not supplied"; a non-nil pointer (true OR false)
//     overlays the existing row. This is the whole point of the bug fix.
func (h *GeofenceHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "geofenceID")
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid geofence ID"))
		return
	}

	patch, raw, err := decodeGeofenceWriteBody(r.Body)
	if err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}

	existing, err := h.geofenceRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to load geofence for update")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to load geofence"))
		return
	}
	if existing == nil {
		writeAppError(w, r, ErrGeofenceNotFound)
		return
	}

	merged := *existing
	if patch.Name != "" {
		merged.Name = patch.Name
	}
	if patch.PolygonWKT != "" {
		merged.PolygonWKT = patch.PolygonWKT
	}
	if patch.Category != nil {
		merged.Category = patch.Category
	}
	if raw.Enabled != nil {
		merged.Enabled = *raw.Enabled
	}
	if raw.AlertOnEntry != nil {
		merged.AlertOnEntry = *raw.AlertOnEntry
	}
	if raw.AlertOnExit != nil {
		merged.AlertOnExit = *raw.AlertOnExit
	}
	merged.ID = id

	if merged.Name == "" || merged.Radius() <= 0 {
		writeAppError(w, r, ErrMissingField.WithMessage("name and positive radius required"))
		return
	}
	if err := validateGeofence(&merged); err != nil {
		writeAppError(w, r, ErrGeofenceInvalidCoords.WithMessage(err.Error()))
		return
	}

	if err := h.geofenceRepo.Update(r.Context(), &merged); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update geofence")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to update geofence"))
		return
	}
	writeJSON(w, http.StatusOK, &merged)
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
