package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SignalCatalogHandler exposes the cold-path signal_catalog registry and
// the signal_observations tall hypertable as read-only HTTP endpoints
// (ADR-002 hot/cold split + ADR-009 onboarding ritual).
type SignalCatalogHandler struct {
	catalogRepo     *database.SignalCatalogRepo
	observationRepo *database.SignalObservationRepo
}

// NewSignalCatalogHandler constructs a handler bound to db.
func NewSignalCatalogHandler(db *database.DB) *SignalCatalogHandler {
	return &SignalCatalogHandler{
		catalogRepo:     database.NewSignalCatalogRepo(db),
		observationRepo: database.NewSignalObservationRepo(db),
	}
}

// signalCatalogResponse mirrors the frontend's SignalCatalogEntry
// (web/src/types/signals.ts). value_type is the SignalDataKind narrowed
// to the three frontend variants ('numeric'|'text'|'bool'); 'compound'
// surfaces as 'numeric' since the frontend has no dedicated case.
type signalCatalogResponse struct {
	Name         string  `json:"name"`
	ValueType    string  `json:"value_type"`
	SourceModule string  `json:"source_module"`
	Unit         *string `json:"unit"`
	Description  *string `json:"description"`
	FirstSeenAt  string  `json:"first_seen_at"`
	LastSeenAt   string  `json:"last_seen_at"`
}

func mapDataKindToValueType(k *models.SignalDataKind) string {
	if k == nil {
		return "numeric"
	}
	switch *k {
	case models.SignalDataKindBoolean:
		return "bool"
	case models.SignalDataKindText:
		return "text"
	}
	return "numeric"
}

// deriveSourceModule picks a stable category label for the catalog UI.
// Hot signals carry their typed_table; cold signals fall back to the
// storage_tier so the catalog page never groups everything as "Uncategorized".
func deriveSourceModule(e models.SignalCatalog) string {
	if e.TypedTable != nil && *e.TypedTable != "" {
		return *e.TypedTable
	}
	if e.StorageTier != "" {
		return string(e.StorageTier)
	}
	return ""
}

// ListCatalog handles GET /api/v1/signals/catalog and returns every known
// signal in the registry. Used by the dashboard's SignalCatalogWidget.
func (h *SignalCatalogHandler) ListCatalog(w http.ResponseWriter, r *http.Request) {
	entries, err := h.catalogRepo.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list signal catalog")
		writeError(w, http.StatusInternalServerError, "failed to list signal catalog")
		return
	}
	out := make([]signalCatalogResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, signalCatalogResponse{
			Name:         e.Name,
			ValueType:    mapDataKindToValueType(e.DataKind),
			SourceModule: deriveSourceModule(e),
			Unit:         e.Unit,
			Description:  e.Notes,
			FirstSeenAt:  e.FirstSeenAt.UTC().Format(time.RFC3339),
			LastSeenAt:   e.LastSeenAt.UTC().Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ListObservations handles GET /api/v1/signals/observations.
//
// Query params:
//   - vehicle_id (required): int64
//   - signal_name (optional): when set, narrows to one signal name
//   - since / until (optional, RFC3339): time window (default: last 24h)
//   - limit (optional): cap, 1..1000, default 100
//
// Used by SignalLogWidget, SignalCatalogWidget, PowersharePage, and the
// driving-dynamics components.
func (h *SignalCatalogHandler) ListObservations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	vehicleID, _ := strconv.ParseInt(q.Get("vehicle_id"), 10, 64)
	if vehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	now := time.Now().UTC()
	since := now.Add(-24 * time.Hour)
	until := now
	if s := q.Get("since"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			since = t
		}
	}
	if u := q.Get("until"); u != "" {
		if t, err := time.Parse(time.RFC3339, u); err == nil {
			until = t
		}
	}

	signalName := q.Get("signal_name")

	var (
		obs []models.SignalObservation
		err error
	)
	if signalName != "" {
		obs, err = h.observationRepo.ListByName(r.Context(), vehicleID, signalName, since, until, limit)
	} else {
		obs, err = h.observationRepo.ListByVehicle(r.Context(), vehicleID, since, until, limit)
	}
	if err != nil {
		log.Error().Err(err).Msg("failed to list signal observations")
		writeError(w, http.StatusInternalServerError, "failed to list signal observations")
		return
	}
	if obs == nil {
		obs = []models.SignalObservation{}
	}
	writeJSON(w, http.StatusOK, obs)
}
