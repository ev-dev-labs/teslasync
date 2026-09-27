package visitedlocation

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// visitedLocationRepo is the narrow port the handler depends on. Declaring it
// at the call site lets handler tests inject an in-memory fake without standing
// up a real Postgres pool. *tripdb.VisitedLocationRepo satisfies this interface.
type visitedLocationRepo interface {
	GetAll(ctx context.Context, limit, offset int, from, until time.Time) ([]*geomodel.VisitedLocation, error)
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, from, until time.Time) ([]*geomodel.VisitedLocation, error)
}

// Compile-time guard that the production repo still satisfies the port. A
// method-signature drift fails the build here rather than at runtime.
var _ visitedLocationRepo = (*tripdb.VisitedLocationRepo)(nil)

// Handler serves GET /locations — the read-only visited-location listing,
// optionally scoped by vehicle_id.
type Handler struct {
	repo visitedLocationRepo
}

// NewHandler wires the production repo. Panics on a nil db (fail-fast at
// startup) so a misconfigured router crashes before serving traffic rather
// than nil-dereferencing on the first request.
func NewHandler(db *database.DB) *Handler {
	if db == nil {
		panic("visitedlocation: NewHandler requires non-nil db")
	}
	return newHandler(tripdb.NewVisitedLocationRepo(db))
}

// newHandler injects an arbitrary visitedLocationRepo. Kept unexported so the
// public surface stays db-based while handler tests can supply a fake.
func newHandler(repo visitedLocationRepo) *Handler {
	if repo == nil {
		panic("visitedlocation: newHandler requires non-nil repo")
	}
	return &Handler{repo: repo}
}

// List serves GET /locations. With ?vehicle_id=<id> it scopes to a single
// vehicle; from/to RFC3339 instants bound the underlying drive aggregates.
//
// Results are ranked by visit count and paginated after aggregation.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "locations.list")
	defer span.End()
	limit, offset := apiparams.Pagination(r)
	from, until, err := parseVisitWindow(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	if vehicleIDStr := r.URL.Query().Get("vehicle_id"); vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil || vehicleID <= 0 {
			httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		locs, err := h.repo.GetByVehicle(ctx, vehicleID, limit, offset, from, until)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "visited locations query failed")
			log.Error().Err(err).
				Int64("vehicle_id", vehicleID).
				Int("limit", limit).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("failed to get visited locations by vehicle")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, nonNilLocations(locs))
		return
	}

	locs, err := h.repo.GetAll(ctx, limit, offset, from, until)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "visited locations query failed")
		log.Error().Err(err).
			Int("limit", limit).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to get visited locations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, nonNilLocations(locs))
}

func parseVisitWindow(r *http.Request) (time.Time, time.Time, error) {
	q := r.URL.Query()
	if !q.Has("from") && !q.Has("to") {
		return time.Time{}, time.Time{}, nil
	}
	if q.Get("from") == "" || q.Get("to") == "" {
		return time.Time{}, time.Time{}, fmt.Errorf("from and to must be provided together")
	}
	from, err := time.Parse(time.RFC3339Nano, q.Get("from"))
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("from must be an RFC3339 instant")
	}
	until, err := time.Parse(time.RFC3339Nano, q.Get("to"))
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("to must be an RFC3339 exclusive instant")
	}
	if !until.After(from) || until.Sub(from) >= 50*365*24*time.Hour {
		return time.Time{}, time.Time{}, fmt.Errorf("time range must be ordered and at most 50 years")
	}
	return from, until, nil
}

// nonNilLocations guarantees a non-nil slice so the JSON body encodes as []
// rather than null. The frontend list rendering iterates the response array
// directly, and a null payload would throw a runtime error.
func nonNilLocations(locs []*geomodel.VisitedLocation) []*geomodel.VisitedLocation {
	if locs == nil {
		return make([]*geomodel.VisitedLocation, 0)
	}
	return locs
}
