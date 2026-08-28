package vehicle

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

// Handler handles vehicle-related HTTP requests.
// Business logic (state assembly, Tesla sync) is delegated to
// VehicleService; the handler focuses on HTTP concerns.
//
// state is the signal-log-backed cold-path reader (ADR-002)
// used by Positions to derive a chart-mode timeline of GPS samples by
// forward-folding the change feed; every emission becomes a row, even
// when the projected fields are unchanged from the previous emission.
type Handler struct {
	vehicleSvc  *service.VehicleService
	vehicleRepo vehicleListFetcher
	teslaClient *tesla.Client
	telemetry   TelemetrySource
	state       signal.StateReader
}

type vehicleListFetcher interface {
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
	GetPage(ctx context.Context, limit, offset int) ([]*vehiclemodel.Vehicle, error)
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

type stateFreshness string

const (
	stateFreshnessFresh   stateFreshness = "fresh"
	stateFreshnessStale   stateFreshness = "stale"
	stateFreshnessUnknown stateFreshness = "unknown"
)

type currentStateResponse struct {
	State      *vehiclemodel.VehicleState `json:"state"`
	Live       bool                       `json:"live"`
	DataSource string                     `json:"data_source"`
	// ObservedAt/Freshness describe the live stream's newest real observation.
	// VerifiedFields separately identifies state values backed by non-synthetic
	// live signals, so durable fallbacks never inherit that stream freshness.
	ObservedAt     *time.Time     `json:"observed_at,omitempty"`
	Freshness      stateFreshness `json:"freshness"`
	VerifiedFields []string       `json:"verified_fields"`
	AsOf           *time.Time     `json:"as_of,omitempty"`
}

// vehiclePositionMappings projects the signal_log change feed into the
// Position JSON shape consumed by the frontend. Field names match the
// legacy Position model JSON tags so the wire contract is unchanged.
//
// The codec uses LocationLatitude / LocationLongitude (compound
// flatten — see codec/flatten.go); Elevation is intentionally absent
// because Tesla Fleet Telemetry does not emit it.
var vehiclePositionMappings = []signal.FieldMapping{
	{Signal: "LocationLatitude", Field: "latitude"},
	{Signal: "LocationLongitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
}

func NewHandler(vehicleSvc *service.VehicleService, tc *tesla.Client, state signal.StateReader) *Handler {
	return &Handler{
		vehicleSvc:  vehicleSvc,
		vehicleRepo: vehicleSvc.VehicleRepo(),
		teslaClient: tc,
		state:       state,
	}
}

// SetTelemetrySource wires the telemetry source for streaming-aware state resolution.
func (h *Handler) SetTelemetrySource(ts TelemetrySource) {
	h.telemetry = ts
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.vehicles.list")
	defer span.End()

	repo := h.vehicleRepo
	if repo == nil {
		repo = h.vehicleSvc.VehicleRepo()
	}
	query := r.URL.Query()
	_, hasLimit := query["limit"]
	_, hasOffset := query["offset"]

	var (
		vehicles []*vehiclemodel.Vehicle
		err      error
	)
	if hasLimit || hasOffset {
		limit, offset := apiparams.Pagination(r)
		vehicles, err = repo.GetPage(ctx, limit, offset)
		if err == nil {
			apiparams.SetPaginationHeaders(w, limit, offset, len(vehicles))
		}
	} else {
		// Preserve the historical array contract for existing fleet consumers:
		// an omitted pagination query means the complete vehicle list.
		vehicles, err = repo.GetAll(ctx)
	}
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to list vehicles")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list vehicles"))
		return
	}
	if vehicles == nil {
		vehicles = []*vehiclemodel.Vehicle{}
	}
	httpx.WriteJSON(w, http.StatusOK, vehicles)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleSvc.VehicleRepo().GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get vehicle")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to get vehicle"))
		return
	}
	if vehicle == nil {
		apperror.Write(w, r, apperror.ErrVehicleNotFound)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, vehicle)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	if err := h.vehicleSvc.VehicleRepo().Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete vehicle")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to delete vehicle"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SyncFromTesla(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "vehicle.sync_from_tesla")
	defer span.End()

	if suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(ctx); suspended {
		apperror.Write(w, r, apperror.ErrTeslaAPISuspended)
		return
	}
	if !h.teslaClient.HasValidToken() {
		apperror.Write(w, r, apperror.ErrTeslaNotConnected)
		return
	}

	synced, err := h.vehicleSvc.SyncFromTesla(ctx, h.teslaClient)
	if err != nil {
		log.Error().Err(err).Msg("failed to sync vehicles from Tesla")
		tracing.EndSpan(span, err)
		apperror.Write(w, r, apperror.ErrTeslaAPIUnavailable.WithMessage("failed to list vehicles from Tesla API"))
		return
	}
	span.SetAttributes(attribute.Int("tesla.vehicles_synced", len(synced)))

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"synced":   len(synced),
		"vehicles": synced,
	})
}

func (h *Handler) Positions(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	limit, _ := apiparams.Pagination(r)
	// Default to last 30 days so the Live Map shows the latest known location
	// even when the vehicle has been offline for a while. The page already
	// surfaces freshness via the `Xs ago` indicator and `LiveStaleDataBanner`,
	// so showing a stale-but-real position is better than an empty map.
	// Allow `?days=N` (1..365) to override the window when callers need a
	// shorter or longer reach.
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if d, perr := strconv.Atoi(v); perr == nil && d >= 1 && d <= 365 {
			days = d
		}
	}
	from := time.Now().AddDate(0, 0, -days)
	to := time.Now()

	// Chart mode: empty CollapseBy so every change-feed emission becomes a
	// row, preserving the legacy flat-pivot semantics consumed by the
	// frontend map/timeline.
	timelineRows, err := h.state.Timeline(r.Context(),
		id, vehiclePositionMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to get positions from signal_log")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to get positions"))
		return
	}

	rows := make([]map[string]interface{}, 0, len(timelineRows))
	for _, tr := range timelineRows {
		row := make(map[string]interface{}, len(tr.Fields)+4)
		for k, v := range tr.Fields {
			row[k] = v
		}
		row["ts"] = tr.Timestamp
		rows = append(rows, row)
	}

	// Reverse to newest-first (Timeline returns ascending by ts)
	for i, j := 0, len(rows)-1; i < j; i, j = i+1, j-1 {
		rows[i], rows[j] = rows[j], rows[i]
	}
	// Apply limit after reversal so we keep the most recent positions
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	// Alias ts→created_at and speed_mph→speed for frontend PositionRecord
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			row["id"] = fmt.Sprintf("%v", ts)
		}
		if v, ok := row["speed_mph"]; ok {
			row["speed"] = v
		}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

func (h *Handler) CurrentState(w http.ResponseWriter, r *http.Request) {
	ctx, span := tracing.HandlerSpan(r.Context(), "vehicle.current_state")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}
	span.SetAttributes(attribute.Int64("vehicle.id", id))

	repo := h.vehicleRepo
	if repo == nil {
		repo = h.vehicleSvc.VehicleRepo()
	}
	vehicle, err := repo.GetByID(ctx, id)
	if err != nil || vehicle == nil {
		apperror.Write(w, r, apperror.ErrVehicleNotFound)
		return
	}
	span.SetAttributes(attribute.String("vehicle.vin", vehicle.VIN))

	// Point-in-time time-machine view.
	// When the caller passes a valid `?as_of=` query parameter we
	// reconstruct vehicle state from signal_log at that timestamp
	// instead of returning live signal data. The branch is read-only:
	// no writes to the L1 cache or any other store. Validation lives
	// in signal.ParseAsOf so the bounds and lookback policy stay in
	// one place across every handler that gains the same parameter.
	asOf, hasAsOf, asOfErr := signal.ParseAsOf(r.URL.Query(), time.Now())
	if asOfErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, asOfErr.Error())
		return
	}
	if hasAsOf && h.state != nil {
		snapshot, snapErr := signal.SnapshotAt(ctx, h.state, vehicle.ID, asOf)
		if snapErr != nil {
			log.Error().Err(snapErr).Int64("vehicle_id", vehicle.ID).Time("as_of", asOf).Msg("vehicle current state: snapshot read failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read snapshot")
			return
		}
		// signal.State is map[string]SignalValue (named alias of any) and
		// signal.Store.Hydrate takes map[string]interface{}. The element
		// types are identical at the runtime level but Go disallows the
		// named-to-unnamed conversion without an element copy.
		raw := make(map[string]interface{}, len(snapshot))
		for k, v := range snapshot {
			raw[k] = v
		}
		store := signal.New()
		store.Hydrate(vehicle.ID, raw)
		state := h.vehicleSvc.BuildStateFromSignalStore(store, vehicle)
		httpx.WriteJSON(w, http.StatusOK, currentStateResponse{
			State:          state,
			Live:           false,
			DataSource:     "as_of",
			Freshness:      stateFreshnessUnknown,
			VerifiedFields: []string{},
			AsOf:           &asOf,
		})
		return
	}

	// PRIMARY: Build state from the live signal boundary + DB fallbacks.
	if h.telemetry != nil {
		store := signal.New()
		var hasLiveSignals bool
		var observedAt *time.Time
		freshness := stateFreshnessUnknown
		if liveStore := h.telemetry.GetLiveSignalStore(); liveStore != nil {
			values, err := liveStore.GetAll(ctx, vehicle.ID, signal.LiveSignalReadDistributed)
			if err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("vehicle current state: live signal read failed")
			} else if len(values) > 0 {
				store.HydrateValues(vehicle.ID, values)
				hasLiveSignals = true
				observedAt = latestLiveSignalObservation(values)
				if observedAt != nil {
					freshness = stateFreshnessStale
					if signal.IsLiveSignalFresh(&signal.Value{Timestamp: *observedAt}, time.Now().UTC()) {
						freshness = stateFreshnessFresh
					}
				}
			}
		}
		state, verified := h.vehicleSvc.BuildStateFromSignalStoreWithProvenance(store, vehicle)
		// Enrich with state-since timestamp from vehicle_states table
		if currentState, since, err := h.vehicleSvc.StateRepo().GetCurrentStateSince(ctx, vehicle.ID); err == nil && currentState != "" {
			state.State = currentState
			state.Since = since
			if freshness == stateFreshnessFresh {
				verified["state"] = true
			}
		}
		dataSource := "live_signal_store"
		if !hasLiveSignals {
			dataSource = "db_fallback"
		}
		httpx.WriteJSON(w, http.StatusOK, currentStateResponse{
			State:          state,
			Live:           hasLiveSignals,
			DataSource:     dataSource,
			ObservedAt:     observedAt,
			Freshness:      freshness,
			VerifiedFields: sortedVerifiedFields(verified),
		})
		return
	}

	// SECONDARY: Build state from DB records (fleet telemetry snapshot tables)
	// Only reached when telemetryHandler is nil (no MQTT configured)
	state := h.vehicleSvc.BuildStateFromSignalStore(nil, vehicle)
	if _, since, err := h.vehicleSvc.StateRepo().GetCurrentStateSince(ctx, vehicle.ID); err == nil && since != nil {
		state.Since = since
	}
	httpx.WriteJSON(w, http.StatusOK, currentStateResponse{
		State:          state,
		Live:           false,
		DataSource:     "db_fallback",
		Freshness:      stateFreshnessUnknown,
		VerifiedFields: []string{},
	})
}

func (h *Handler) Wake(w http.ResponseWriter, r *http.Request) {
	if suspended, _ := h.vehicleSvc.SettingsRepo().IsAPISuspended(r.Context()); suspended {
		apperror.Write(w, r, apperror.ErrTeslaAPISuspended)
		return
	}

	id, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid vehicle ID"))
		return
	}

	vehicle, err := h.vehicleSvc.VehicleRepo().GetByID(r.Context(), id)
	if err != nil || vehicle == nil {
		apperror.Write(w, r, apperror.ErrVehicleNotFound)
		return
	}

	if err := h.teslaClient.WakeUp(r.Context(), vehicle.VIN); err != nil {
		log.Error().Err(err).Int64("vehicleID", id).Msg("failed to wake vehicle")
		apperror.Write(w, r, apperror.ErrTeslaAPIUnavailable.WithMessage("failed to wake vehicle"))
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "waking"})
}

// TelemetrySource is the narrow surface Handler needs from the parent's
// *api.TelemetryHandler. Declared as an interface so vehicle subpkg can
// stay independent of the parent. The parent's *TelemetryHandler
// satisfies this via duck-typing.
type TelemetrySource interface {
	GetLiveSignalStore() signal.LiveSignalStore
}

func latestLiveSignalObservation(values map[string]*signal.Value) *time.Time {
	var latest time.Time
	for _, value := range values {
		if !isVerifiedLiveSignal(value) {
			continue
		}
		timestamp := value.Timestamp.UTC()
		if latest.IsZero() || timestamp.After(latest) {
			latest = timestamp
		}
	}
	if latest.IsZero() {
		return nil
	}
	return &latest
}

func isVerifiedLiveSignal(value *signal.Value) bool {
	return value != nil &&
		value.Raw != nil &&
		!value.Timestamp.IsZero() &&
		!value.TimestampSynthetic
}

func sortedVerifiedFields(verified map[string]bool) []string {
	fields := make([]string, 0, len(verified))
	for field, ok := range verified {
		if ok {
			fields = append(fields, field)
		}
	}
	sort.Strings(fields)
	return fields
}
