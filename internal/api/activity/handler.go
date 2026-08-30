// Package activity serves the unified vehicle operations-intelligence
// timeline: GET /api/v1/activity. Read-only — the endpoint composes rows
// from existing domain tables (drives, charging_sessions,
// notification_logs, software_updates, chart_annotations) and never
// writes anything.
package activity

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbactivity "github.com/ev-dev-labs/teslasync/internal/database/activity"
	activitymodel "github.com/ev-dev-labs/teslasync/internal/models/activity"
	"github.com/rs/zerolog/log"
)

// activityRepository is the minimal repo surface Handler needs. Defined as
// an interface so handler tests can supply an in-memory fake without a
// live Postgres pool — mirrors the port pattern used by the sibling
// chartannotation / softwareupdate handlers.
type activityRepository interface {
	List(ctx context.Context, f dbactivity.Filters) ([]activitymodel.Item, int64, error)
}

// Handler serves the unified activity timeline.
type Handler struct {
	repo activityRepository
}

// NewHandler builds an activity Handler backed by the given database pool.
func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: dbactivity.NewRepo(db)}
}

// List serves GET /api/v1/activity.
//
// Query params:
//
//	vehicle_id  optional positive int64 — scope to one vehicle.
//	start, end  optional RFC3339 timestamp or YYYY-MM-DD date — inclusive window.
//	kind        optional, repeatable and/or comma-separated. One or more of:
//	            drive, charging, alert, software_update, annotation.
//	            Omitted = all kinds.
//	limit       optional, default 50, max 500.
//	offset      optional, default 0.
//
// Response envelope: {items, total, limit, offset, generated_at}. `items`
// is always a JSON array (never null), ordered occurred_at DESC with a
// stable (source_table, source_id) tie-breaker.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.activity.list")
	defer span.End()

	q := r.URL.Query()

	var vehicleID *int64
	if raw := strings.TrimSpace(q.Get("vehicle_id")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			span.RecordError(errors.New("invalid vehicle_id"))
			writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
			return
		}
		vehicleID = &v
	}

	startTime, endTime := apiparams.ParseDateRange(r)
	if raw := strings.TrimSpace(q.Get("start")); raw != "" && startTime.IsZero() {
		span.RecordError(errors.New("invalid start"))
		writeError(w, http.StatusBadRequest, "start must be an RFC3339 timestamp or YYYY-MM-DD date")
		return
	}
	if raw := strings.TrimSpace(q.Get("end")); raw != "" && endTime.IsZero() {
		span.RecordError(errors.New("invalid end"))
		writeError(w, http.StatusBadRequest, "end must be an RFC3339 timestamp or YYYY-MM-DD date")
		return
	}
	if !startTime.IsZero() && !endTime.IsZero() && startTime.After(endTime) {
		span.RecordError(errors.New("invalid date range"))
		writeError(w, http.StatusBadRequest, "start must be before end")
		return
	}

	kinds, err := parseKinds(q["kind"])
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	limit, offset, err := parsePagination(q.Get("limit"), q.Get("offset"))
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	items, total, err := h.repo.List(ctx, dbactivity.Filters{
		VehicleID: vehicleID,
		Start:     startTime,
		End:       endTime,
		Kinds:     kinds,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("activity.list: failed to query activity timeline")
		writeError(w, http.StatusInternalServerError, "failed to list activity")
		return
	}
	if items == nil {
		items = []activitymodel.Item{}
	}

	writeJSON(w, http.StatusOK, activitymodel.ListResponse{
		Items:       items,
		Total:       total,
		Limit:       limit,
		Offset:      offset,
		GeneratedAt: time.Now().UTC(),
	})
}

// parseKinds accepts repeated ?kind=drive&kind=alert and/or comma-separated
// ?kind=drive,alert forms, de-duplicates, and rejects anything outside
// activitymodel.AllKinds so a typo 400s instead of silently matching zero
// rows.
func parseKinds(raw []string) ([]activitymodel.Kind, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	seen := make(map[activitymodel.Kind]struct{})
	var kinds []activitymodel.Kind
	for _, value := range raw {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			k, ok := activitymodel.ParseKind(part)
			if !ok {
				return nil, invalidKindError(part)
			}
			if _, exists := seen[k]; exists {
				continue
			}
			seen[k] = struct{}{}
			kinds = append(kinds, k)
		}
	}
	return kinds, nil
}

type invalidKindError string

func (e invalidKindError) Error() string {
	return "kind must be one of drive, charging, alert, software_update, annotation"
}

func parsePagination(rawLimit, rawOffset string) (int, int, error) {
	limit := 50
	if raw := strings.TrimSpace(rawLimit); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 || parsed > 500 {
			return 0, 0, errors.New("limit must be an integer between 1 and 500")
		}
		limit = parsed
	}

	offset := 0
	if raw := strings.TrimSpace(rawOffset); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			return 0, 0, errors.New("offset must be a non-negative integer")
		}
		offset = parsed
	}
	return limit, offset, nil
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}
