package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// ChargingHandler handles charging session HTTP requests.
//
// Phase-39 migration (ADR-002): the legacy *database.SignalLogReader has been
// replaced with the canonical signal.StateReader. Live-charge enrichment now
// reads start-of-session and current state via StateReader.State, and the
// telemetry chart is built from StateReader.Timeline (chart mode — empty
// CollapseBy so every change-feed emission becomes a row). The chargingRepo
// is held behind the chargingByIDFetcher interface so handler tests can
// inject a fake without standing up a real pgx pool.
type ChargingHandler struct {
	db                *database.DB
	chargingRepo      *database.ChargingRepo
	charging          chargingByIDFetcher
	state             signal.StateReader
	live              signal.LiveStateReader
	forwardAuthHeader string
	// bulkOverride lets tests substitute the bulk store without standing up a
	// real *database.ChargingRepo. Always nil in production.
	bulkOverride chargingBulkStore
}

// chargingByIDFetcher is the narrow interface needed by the migrated handlers
// to fetch a single charging session header. It is satisfied by
// *database.ChargingRepo and declared at the call site so tests can
// substitute an in-memory fake.
type chargingByIDFetcher interface {
	GetByID(ctx context.Context, id int64) (*models.ChargingSession, error)
}

func NewChargingHandler(db *database.DB, state signal.StateReader, live signal.LiveStateReader) *ChargingHandler {
	repo := database.NewChargingRepo(db)
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
// AC/DC power is merged into a canonical "power_kw" by the
// TelemetryReadings handler post-processing.
var chargeTelemetryFieldMappings = []signal.FieldMapping{
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "ChargerVoltage", Field: "voltage"},
	{Signal: "ChargerActualCurrent", Field: "current_amps"},
	{Signal: "ACChargingPower", Field: "power_kw"},
	{Signal: "DCChargingPower", Field: "dc_power_kw"},
	{Signal: "ACChargingEnergyIn", Field: "energy_added"},
	{Signal: "ChargeRateMilePerHour", Field: "charge_rate"},
	{Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "ModuleTempMax", Field: "battery_temp"},
}

func (h *ChargingHandler) ListByVehicle(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id query parameter required")
		return
	}

	vehicleID, err := parseInt64(vehicleIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := pagination(r)
	startTime, endTime := parseDateRange(r)
	sessions, err := h.chargingRepo.GetByVehicle(r.Context(), vehicleID, limit, offset, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("failed to list charging sessions")
		writeError(w, http.StatusInternalServerError, "failed to list charging sessions")
		return
	}
	// Guarantee a JSON array response (`[]`) instead of `null` when there
	// are no sessions; the SPA charging hooks crash on null when calling
	// `.map`/`.length` and prefer the canonical empty-array shape.
	if sessions == nil {
		sessions = []*models.ChargingSession{}
	}
	writeJSON(w, http.StatusOK, sessions)
}

func (h *ChargingHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.charging.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	live := false
	if session.IsActive() {
		live = true
		if err := h.enrichLiveCharge(ctx, session, time.Now().UTC()); err != nil {
			log.Error().Err(err).Int64("sessionID", id).Msg("failed to enrich live charging session")
			writeError(w, http.StatusInternalServerError, "failed to load live charging state")
			return
		}
	}

	writeJSON(w, http.StatusOK, chargingSessionResponse(session, live))
}

// chargingSessionResponse builds the JSON response map for a charging session,
// including the live indicator. This preserves the original JSON field names
// from the ChargingSession model while adding the extra "live" field.
func chargingSessionResponse(s *models.ChargingSession, live bool) map[string]interface{} {
	return map[string]interface{}{
		"id":                   s.ID,
		"vehicle_id":           s.VehicleID,
		"start_ts":             s.StartTs,
		"end_ts":               s.EndTs,
		"duration_min":         s.DurationMin,
		"start_battery_pct":    s.StartBatteryPct,
		"end_battery_pct":      s.EndBatteryPct,
		"energy_added_kwh":     s.EnergyAddedKwh,
		"miles_added":          s.MilesAdded,
		"charger_type":         s.ChargerType,
		"charger_location":     s.ChargerLocation,
		"charger_power_kw_max": s.ChargerPowerKwMax,
		"charger_power_kw_avg": s.ChargerPowerKwAvg,
		"cost":                 s.Cost,
		"cost_currency":        s.CostCurrency,
		"ended_status":         s.EndedStatus,
		"created_at":           s.CreatedAt,
		"updated_at":           s.UpdatedAt,
		"live":                 live,
	}
}

// enrichLiveCharge computes live values for an in-progress charging session
// by reading start-of-charge state from signal_log via StateReader.State and
// current state from Redis (with StateReader.State(now) as fallback). The
// session struct is mutated in place. Returns an error when either snapshot
// lookup fails — the caller should respond 500 because the live derivation
// depends on both baselines (battery / energy deltas need the start sample,
// current power / battery readings need the now sample).
func (h *ChargingHandler) enrichLiveCharge(ctx context.Context, session *models.ChargingSession, now time.Time) error {
	startState, err := h.state.State(ctx, session.VehicleID, session.StartTs)
	if err != nil {
		return fmt.Errorf("start snapshot at %s: %w", session.StartTs.Format(time.RFC3339Nano), err)
	}
	startSnap := stateToSignalMap(startState)

	currentSnap, err := h.currentSignals(ctx, session.VehicleID)
	if err != nil {
		return fmt.Errorf("current snapshot: %w", err)
	}

	// Duration from wall clock
	durationMin := now.Sub(session.StartTs).Minutes()
	session.DurationMin = &durationMin

	// Battery levels
	if startBat, ok := signalFloat(startSnap, "BatteryLevel"); ok {
		v := int16(startBat)
		session.StartBatteryPct = &v
	}
	if currentBat, ok := signalFloat(currentSnap, "BatteryLevel"); ok {
		v := int16(currentBat)
		session.EndBatteryPct = &v
	}

	// Energy added from ACChargingEnergyIn delta
	startEnergy, startOk := signalFloat(startSnap, "ACChargingEnergyIn")
	currentEnergy, currentOk := signalFloat(currentSnap, "ACChargingEnergyIn")
	if startOk && currentOk && currentEnergy > startEnergy {
		delta := safeFloat(currentEnergy - startEnergy)
		session.EnergyAddedKwh = &delta
	}

	// Current charging power
	if power, ok := signalFloat(currentSnap, "ACChargingPower"); ok {
		v := safeFloat(power)
		session.ChargerPowerKwMax = &v
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
	sessionID, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.charging.GetByID(ctx, sessionID)
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charging session for telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	endTs := time.Now().UTC()
	if session.EndTs != nil {
		endTs = *session.EndTs
	}

	// Chart mode (empty CollapseBy): every change-feed emission becomes a
	// row, preserving the legacy flat-pivot semantics consumed by the
	// charging-session telemetry chart on the frontend.
	timelineRows, err := h.state.Timeline(ctx,
		session.VehicleID, chargeTelemetryFieldMappings, session.StartTs, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charge telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	// Merge AC/DC power into a canonical power_kw field.
	// DC fast-charging sessions report DCChargingPower, not ACChargingPower.
	// Per ADR-002: if neither is present, leave power_kw as nil (not zero).
	for _, row := range rows {
		ac, acOk := toFloatOk(row["power_kw"])
		dc, dcOk := toFloatOk(row["dc_power_kw"])
		if dcOk && dc > 0 {
			row["power_kw"] = dc
		} else if !acOk || ac == 0 {
			// Neither AC nor DC has a positive value — leave power_kw as-is (nil)
		}
		delete(row, "dc_power_kw")
	}
	// Rename "ts" → "created_at" to match old ChargeTelemetryReading JSON shape
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	writeJSON(w, http.StatusOK, rows)
}
