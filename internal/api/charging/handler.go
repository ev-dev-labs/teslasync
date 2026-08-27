package charging

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

// ChargingHandler handles charging session HTTP requests.
//
// The legacy *signaldb.SignalLogReader has been
// replaced with the canonical signal.StateReader (ADR-002). Live-charge enrichment now
// reads start-of-session and current state via StateReader.State, and the
// telemetry chart is built from StateReader.Timeline (chart mode — empty
// CollapseBy so every change-feed emission becomes a row). The chargingRepo
// is held behind the chargingByIDFetcher interface so handler tests can
// inject a fake without standing up a real pgx pool.
type ChargingHandler struct {
	db                *database.DB
	chargingRepo      *chargingdb.ChargingRepo
	charging          chargingByIDFetcher
	state             signal.StateReader
	live              signal.LiveStateReader
	forwardAuthHeader string
	// bulkOverride lets tests substitute the bulk store without standing up a
	// real *chargingdb.ChargingRepo. Always nil in production.
	bulkOverride chargingBulkStore
}

// chargingByIDFetcher is the narrow interface needed by the migrated handlers
// to fetch a single charging session header. It is satisfied by
// *chargingdb.ChargingRepo and declared at the call site so tests can
// substitute an in-memory fake.
type chargingByIDFetcher interface {
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
}

func NewChargingHandler(db *database.DB, state signal.StateReader, live signal.LiveStateReader) *ChargingHandler {
	repo := chargingdb.NewChargingRepo(db)
	return &ChargingHandler{
		db:           db,
		chargingRepo: repo,
		charging:     repo,
		state:        state,
		live:         live,
	}
}

// WithForwardAuthHeader wires the auth header used to attribute audit log
// entries written by the bulk endpoints. When unset, audit rows still record
// IP/User-Agent but Actor is empty (dev mode behaviour).
func (h *ChargingHandler) WithForwardAuthHeader(name string) *ChargingHandler {
	h.forwardAuthHeader = name
	return h
}

// chargeTelemetryFieldMappings projects the signal_log change feed into the
// legacy ChargeTelemetryReading JSON shape. Field names match the old
// pivot-mapping signal/field pairs so the wire contract is unchanged.
// AC/DC power is merged into the existing "power_kw" chart field by the
// TelemetryReadings handler post-processing.
var chargeTelemetryFieldMappings = []signal.FieldMapping{
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ChargerVoltage", Field: "voltage"},
	{Signal: "ChargerActualCurrent", Field: "current_amps"},
	{Signal: "ACChargingPower", Field: "power_kw"},
	{Signal: "DCChargingPower", Field: "dc_power_w"},
	{Signal: "ACChargingEnergyIn", Field: "energy_added"},
	{Signal: "DCChargingEnergyIn", Field: "dc_energy_wh"},
	{Signal: "ChargeRateMilePerHour", Field: "range_added_meters_per_hour"},
	{Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "ModuleTempMax", Field: "battery_temp"},
}

func (h *ChargingHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.charging.list")
	defer span.End()

	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		span.RecordError(fmt.Errorf("vehicle_id query parameter required"))
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}

	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		span.RecordError(fmt.Errorf("invalid vehicle_id"))
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := apiparams.Pagination(r)
	startTime, endTime := apiparams.ParseDateRange(r)
	sessions, err := h.chargingRepo.GetByVehicle(ctx, vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Int64("vehicle_id", vehicleID).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to list charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charging sessions")
		return
	}
	// Guarantee a JSON array response (`[]`) instead of `null` when there
	// are no sessions; the SPA charging hooks crash on null when calling
	// `.map`/`.length` and prefer the canonical empty-array shape.
	if sessions == nil {
		sessions = []*chargingmodel.ChargingSession{}
	}
	apiparams.SetPaginationHeaders(w, limit, offset, len(sessions))
	httpx.WriteJSON(w, http.StatusOK, sessions)
}

func (h *ChargingHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "sessionID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.charging.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	live := false
	if session.IsActive() {
		live = true
		if err := h.enrichLiveCharge(ctx, session, time.Now().UTC()); err != nil {
			log.Error().Err(err).Int64("sessionID", id).Msg("failed to enrich live charging session")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load live charging state")
			return
		}
	}

	httpx.WriteJSON(w, http.StatusOK, chargingSessionResponse(session, live))
}

// chargingSessionResponse builds the JSON response map for a charging session,
// including the live indicator. This preserves the original JSON field names
// from the ChargingSession model while adding the extra "live" field.
func chargingSessionResponse(s *chargingmodel.ChargingSession, live bool) map[string]interface{} {
	return map[string]interface{}{
		"id":                    s.ID,
		"vehicle_id":            s.VehicleID,
		"started_at":            s.StartedAt,
		"ended_at":              s.EndedAt,
		"start_soc_pct":         s.StartSocPct,
		"end_soc_pct":           s.EndSocPct,
		"delta_soc_pct":         s.DeltaSocPct,
		"start_odometer_m":      s.StartOdometerM,
		"end_odometer_m":        s.EndOdometerM,
		"start_lat":             s.StartLat,
		"start_lng":             s.StartLng,
		"start_place":           s.StartPlace,
		"total_energy_added_wh": s.TotalEnergyAddedWh,
		"peak_power_w":          s.PeakPowerW,
		"avg_power_w":           s.AvgPowerW,
		"cost_decimal":          s.CostDecimal,
		"cost_currency":         s.CostCurrency,
		"charger_type":          s.ChargerType,
		"cable_type":            s.CableType,
		"live":                  live,
	}
}

// enrichLiveCharge computes live values for an in-progress charging session
// by reading start-of-charge state from signal_log via StateReader.State and
// current state from Redis (with StateReader.State(now) as fallback). The
// session struct is mutated in place. Returns an error when either snapshot
// lookup fails — the caller should respond 500 because the live derivation
// depends on both baselines (battery / energy deltas need the start sample,
// current power / battery readings need the now sample).
func (h *ChargingHandler) enrichLiveCharge(ctx context.Context, session *chargingmodel.ChargingSession, now time.Time) error {
	startState, err := h.state.State(ctx, session.VehicleID, session.StartedAt)
	if err != nil {
		return fmt.Errorf("start snapshot at %s: %w", session.StartedAt.Format(time.RFC3339Nano), err)
	}
	startSnap := stateToSignalMap(startState)

	currentSnap, err := h.currentSignals(ctx, session.VehicleID)
	if err != nil {
		return fmt.Errorf("current snapshot: %w", err)
	}

	if startBat, ok := signalFloat(startSnap, "BatteryLevel"); ok {
		v := startBat
		session.StartSocPct = &v
	}
	if currentBat, ok := signalFloat(currentSnap, "BatteryLevel"); ok {
		v := currentBat
		session.EndSocPct = &v
		if session.StartSocPct != nil {
			delta := v - *session.StartSocPct
			session.DeltaSocPct = &delta
		}
	}

	for _, field := range []string{"DCChargingEnergyIn", "ACChargingEnergyIn"} {
		startEnergy, startOK := signalFloat(startSnap, field)
		currentEnergy, currentOK := signalFloat(currentSnap, field)
		if startOK && currentOK && currentEnergy > startEnergy {
			delta := safeFloat(currentEnergy - startEnergy)
			session.TotalEnergyAddedWh = &delta
			break
		}
	}

	if power, ok := signalFloat(currentSnap, "DCChargingPower"); ok && power > 0 {
		v := safeFloat(power)
		session.PeakPowerW = &v
	} else if power, ok := signalFloat(currentSnap, "ACChargingPower"); ok {
		v := safeFloat(power)
		session.PeakPowerW = &v
	}
	return nil
}

// currentSignals returns the latest signal values for a vehicle via the
// LiveStateReader boundary (L1 in-process Store + L2 Redis HSET, with
// signal_log fallback for keys not present in either layer). A reader
// transport failure propagates so the Get handler can respond 500 instead
// of silently degrading to wrong live numbers (an empty current snapshot
// would zero-out battery / power without signaling the failure).
func (h *ChargingHandler) currentSignals(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	state, err := h.live.LiveState(ctx, vehicleID)
	if err != nil {
		return nil, err
	}
	return stateToSignalMap(state), nil
}

func (h *ChargingHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	sessionID, err := apiparams.URLParamInt64(r, "sessionID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.charging.GetByID(ctx, sessionID)
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charging session for telemetry")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	endTs := time.Now().UTC()
	if session.EndedAt != nil {
		endTs = *session.EndedAt
	}

	// Chart mode (empty CollapseBy): every change-feed emission becomes a
	// row, preserving the legacy flat-pivot semantics consumed by the
	// charging-session telemetry chart on the frontend.
	timelineRows, err := h.state.Timeline(ctx,
		session.VehicleID, chargeTelemetryFieldMappings, session.StartedAt, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charge telemetry from signal_log")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	// The signal change feed is canonical W/Wh. Preserve this endpoint's
	// established legacy chart contract (power_kw / energy_added in kW/kWh)
	// strictly at the HTTP boundary; session summaries remain Wh/W.
	for _, row := range rows {
		acPowerW, acPowerOK := signal.Float64(row["power_kw"])
		dcPowerW, dcPowerOK := signal.Float64(row["dc_power_w"])
		if dcPowerOK && dcPowerW > 0 {
			row["power_kw"] = safeFloat(dcPowerW / 1000.0)
		} else if acPowerOK {
			row["power_kw"] = safeFloat(acPowerW / 1000.0)
		}

		acEnergyWh, acEnergyOK := signal.Float64(row["energy_added"])
		dcEnergyWh, dcEnergyOK := signal.Float64(row["dc_energy_wh"])
		if dcEnergyOK && dcEnergyWh > 0 {
			row["energy_added"] = safeFloat(dcEnergyWh / 1000.0)
		} else if acEnergyOK {
			row["energy_added"] = safeFloat(acEnergyWh / 1000.0)
		}
		delete(row, "dc_power_w")
		delete(row, "dc_energy_wh")
	}
	// Rename "ts" → "created_at" to match old ChargeTelemetryReading JSON shape
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return signal.Float64(v)
		}
	}
	return 0, false
}

func stateToSignalMap(s signal.State) map[string]interface{} {
	if s == nil {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(s))
	for k, v := range s {
		out[k] = v
	}
	return out
}

func timelineRowsToFlat(rows []signal.TimelineRow) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, tr := range rows {
		row := make(map[string]interface{}, len(tr.Fields)+1)
		for k, v := range tr.Fields {
			row[k] = v
		}
		row["ts"] = tr.Timestamp
		out = append(out, row)
	}
	return out
}
