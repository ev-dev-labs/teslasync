package api

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ChargingHandler handles charging session HTTP requests.
type ChargingHandler struct {
	chargingRepo    *database.ChargingRepo
	signalLogReader *database.SignalLogReader
	redisCache      *signal.RedisSignalCache
}

func NewChargingHandler(db *database.DB) *ChargingHandler {
	return &ChargingHandler{
		chargingRepo:    database.NewChargingRepo(db),
		signalLogReader: database.NewSignalLogReader(db),
	}
}

// WithRedisCache sets the Redis signal cache for computing live in-progress charge values.
func (h *ChargingHandler) WithRedisCache(cache *signal.RedisSignalCache) *ChargingHandler {
	h.redisCache = cache
	return h
}

// Charge telemetry signal → JSON field mappings (field names match the old
// ChargeTelemetryReading JSON tags so the frontend contract is unchanged).
var chargeTelemetryMappings = []database.PivotMapping{
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
	writeJSON(w, http.StatusOK, sessions)
}

func (h *ChargingHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, id)
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
		h.enrichLiveCharge(ctx, session, time.Now().UTC())
	}

	writeJSON(w, http.StatusOK, chargingSessionResponse(session, live))
}

// chargingSessionResponse builds the JSON response map for a charging session,
// including the live indicator. This preserves the original JSON field names
// from the ChargingSession model while adding the extra "live" field.
func chargingSessionResponse(s *models.ChargingSession, live bool) map[string]interface{} {
	return map[string]interface{}{
		"id":                  s.ID,
		"vehicle_id":          s.VehicleID,
		"start_ts":            s.StartTs,
		"end_ts":              s.EndTs,
		"duration_min":        s.DurationMin,
		"start_battery_pct":   s.StartBatteryPct,
		"end_battery_pct":     s.EndBatteryPct,
		"energy_added_kwh":    s.EnergyAddedKwh,
		"miles_added":         s.MilesAdded,
		"charger_type":        s.ChargerType,
		"charger_location":    s.ChargerLocation,
		"charger_power_kw_max": s.ChargerPowerKwMax,
		"charger_power_kw_avg": s.ChargerPowerKwAvg,
		"cost":                s.Cost,
		"cost_currency":       s.CostCurrency,
		"ended_status":        s.EndedStatus,
		"created_at":          s.CreatedAt,
		"updated_at":          s.UpdatedAt,
		"live":                live,
	}
}

// enrichLiveCharge computes live values for an in-progress charging session by
// reading start-of-charge state from signal_log and current state from Redis
// (with signal_log fallback). The session struct is mutated in place.
func (h *ChargingHandler) enrichLiveCharge(ctx context.Context, session *models.ChargingSession, now time.Time) {
	startSnap, err := h.signalLogReader.SnapshotAt(ctx, session.VehicleID, session.StartTs)
	if err != nil {
		log.Warn().Err(err).Int64("sessionID", session.ID).Msg("live charge: failed to get start snapshot")
		startSnap = map[string]interface{}{}
	}

	currentSnap := h.currentSignals(ctx, session.VehicleID)

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
}

// currentSignals returns the latest signal values for a vehicle, preferring
// Redis (sub-ms) with signal_log SnapshotAt(now) as fallback.
func (h *ChargingHandler) currentSignals(ctx context.Context, vehicleID int64) map[string]interface{} {
	if h.redisCache != nil {
		snap, err := h.redisCache.GetAll(ctx, vehicleID)
		if err == nil && snap != nil {
			return snap
		}
		log.Debug().Err(err).Int64("vehicleID", vehicleID).Msg("live charge: Redis unavailable, falling back to signal_log")
	}
	snap, err := h.signalLogReader.SnapshotAt(ctx, vehicleID, time.Now().UTC())
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("live charge: failed to get current snapshot from signal_log")
		return map[string]interface{}{}
	}
	return snap
}

func (h *ChargingHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	sessionID, err := urlParamInt64(r, "sessionID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid session ID")
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, sessionID)
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

	rows, err := h.signalLogReader.SignalTracePivotFlat(ctx,
		session.VehicleID, chargeTelemetryMappings, session.StartTs, endTs)
	if err != nil {
		log.Error().Err(err).Int64("sessionID", sessionID).Msg("failed to get charge telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	if rows == nil {
		rows = []map[string]interface{}{}
	}
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


