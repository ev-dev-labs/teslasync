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

// driveDetailHandler wraps the legacy *DriveHandler with a signal.StateReader
// for the migrated Get / Positions / TelemetryReadings paths (ADR-002,
// phase-39). Embedding preserves the listing / stats / score routes
// (drive_handler_listing.go) and the WithRedisCache fluent setter
// (drive_handler.go) via Go method promotion, so those files do not need to
// change in this prompt. The state field is the cold-path StateReader used
// by the three migrated handlers; the drives field is a narrow interface
// over driveRepo.GetByID so handler tests can inject a fake without
// reaching into the database layer.
type driveDetailHandler struct {
	*DriveHandler
	state  signal.StateReader
	drives driveByIDFetcher
}

// driveByIDFetcher is the narrow interface needed by the migrated handlers
// to fetch a single drive header. It is satisfied by *database.DriveRepo and
// declared at the call site so tests can substitute an in-memory fake.
type driveByIDFetcher interface {
	GetByID(ctx context.Context, id int64) (*models.Drive, error)
}

// NewDriveDetail constructs the migrated drive handler. It internally
// composes the legacy *DriveHandler (so listing / stats / score routes still
// resolve via promotion) and wires the cold-path StateReader. See ADR-002.
func NewDriveDetail(db *database.DB, state signal.StateReader) *driveDetailHandler {
	base := NewDriveHandler(db)
	return &driveDetailHandler{
		DriveHandler: base,
		state:        state,
		drives:       base.driveRepo,
	}
}

// driveTelemetryFieldMappings projects the signal_log change feed into the
// legacy DriveTelemetryReading JSON shape. Field names match the legacy
// JSON tags so the wire contract is unchanged.
//
// NOTE: per-row "power" is NOT mapped from a Tesla signal — Fleet Telemetry
// does not emit PackPower. Power is computed from PackVoltage × PackCurrent
// by derivePowerKw() AFTER projection. See enrichLiveDrive (same formula).
var driveTelemetryFieldMappings = []signal.FieldMapping{
	{Signal: "VehicleSpeed", Field: "speed"},
	{Signal: "PackCurrent", Field: "pack_current"},
	{Signal: "PackVoltage", Field: "pack_voltage"},
	{Signal: "BatteryLevel", Field: "battery_level"},
	{Signal: "Soc", Field: "soc"},
	{Signal: "Odometer", Field: "odometer"},
	{Signal: "IdealBatteryRange", Field: "ideal_range"},
	{Signal: "RatedRange", Field: "rated_range"},
	{Signal: "EstBatteryRange", Field: "est_range"},
	{Signal: "Elevation", Field: "elevation"},
	{Signal: "InsideTemp", Field: "inside_temp"},
	{Signal: "OutsideTemp", Field: "outside_temp"},
	{Signal: "HvacLeftTemperatureRequest", Field: "driver_temp"},
	{Signal: "HvacRightTemperatureRequest", Field: "passenger_temp"},
	{Signal: "HvacFanStatus", Field: "fan_status"},
	{Signal: "TpmsPressureFl", Field: "tire_pressure_fl"},
	{Signal: "TpmsPressureFr", Field: "tire_pressure_fr"},
	{Signal: "TpmsPressureRl", Field: "tire_pressure_rl"},
	{Signal: "TpmsPressureRr", Field: "tire_pressure_rr"},
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
}

// derivePowerKw populates a "power" field on each telemetry row by
// computing PackVoltage × PackCurrent / 1000.0 (kW). Rows without both
// pack_voltage and pack_current are left untouched. Sign is preserved so
// downstream chart consumers can distinguish drive (+) from regen (−).
//
// This mirrors the formula used by enrichLiveDrive() for live drive
// AvgPowerKw and by signalPowerKW() in telemetry_sessions_signal_helpers.go
// — Tesla Fleet Telemetry does not emit a per-row PackPower signal.
func derivePowerKw(rows []map[string]interface{}) {
	for _, row := range rows {
		v, vOk := toFloatOk(row["pack_voltage"])
		c, cOk := toFloatOk(row["pack_current"])
		if vOk && cOk {
			row["power"] = safeFloat(v * c / 1000.0)
		}
	}
}

// drivePositionFieldMappings projects the signal_log change feed into the
// legacy Position model JSON tags so the frontend contract is unchanged.
var drivePositionFieldMappings = []signal.FieldMapping{
	{Signal: "Latitude", Field: "latitude"},
	{Signal: "Longitude", Field: "longitude"},
	{Signal: "GpsHeading", Field: "heading"},
	{Signal: "VehicleSpeed", Field: "speed_mph"},
	{Signal: "Elevation", Field: "elevation_m"},
}

// timelineRowsToFlat converts ordered TimelineRows into the legacy
// []map[string]interface{} flat-pivot shape ({"ts": ts, "<field>": value, ...})
// that the drive endpoints emit. The output preserves StateReader's
// chronological order; downstream callers that need newest-first or
// alias-renaming (created_at, id, speed) layer that on top.
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

// stateToSignalMap converts a signal.State (named map type) into the bare
// map[string]interface{} expected by signalFloat and other helpers in this
// package.
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

func (h *driveDetailHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()

	drive, err := h.drives.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	live := false
	endTs := time.Now().UTC()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	} else {
		// In-progress drive — compute live values from signal snapshots.
		live = true
		if err := h.enrichLiveDrive(ctx, drive, endTs); err != nil {
			log.Error().Err(err).Int64("driveID", id).Msg("failed to enrich live drive")
			writeError(w, http.StatusInternalServerError, "failed to load live drive state")
			return
		}
	}

	// Telemetry: chart mode (empty CollapseBy) so every change-feed emission
	// becomes a row, preserving the legacy flat-pivot semantics consumed by
	// frontend chart components.
	telemetryRows, err := h.state.Timeline(ctx,
		drive.VehicleID, driveTelemetryFieldMappings, drive.StartTs, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("driveID", id).Msg("failed to get drive telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to load drive telemetry")
		return
	}
	telemetry := timelineRowsToFlat(telemetryRows)
	// Rename "ts" → "created_at" to match the old DriveTelemetryReading JSON shape.
	for _, row := range telemetry {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	// Derive per-row power (kW) from PackVoltage × PackCurrent. Tesla Fleet
	// Telemetry does not emit a PackPower signal, so the Power Profile chart
	// would render a flat line at 0 without this step.
	derivePowerKw(telemetry)

	// Positions: chart mode (empty CollapseBy).
	positionRows, err := h.state.Timeline(ctx,
		drive.VehicleID, drivePositionFieldMappings, drive.StartTs, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("driveID", id).Msg("failed to get drive positions from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to load drive positions")
		return
	}
	positions := timelineRowsToFlat(positionRows)
	aliasPositionFields(positions)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":                 drive.ID,
		"vehicle_id":         drive.VehicleID,
		"start_ts":           drive.StartTs,
		"end_ts":             drive.EndTs,
		"duration_min":       drive.DurationMin,
		"distance_mi":        drive.DistanceMi,
		"start_address":      drive.StartAddress,
		"end_address":        drive.EndAddress,
		"start_lat":          drive.StartLat,
		"start_lon":          drive.StartLon,
		"end_lat":            drive.EndLat,
		"end_lon":            drive.EndLon,
		"start_battery_pct":  drive.StartBatteryPct,
		"end_battery_pct":    drive.EndBatteryPct,
		"energy_used_kwh":    drive.EnergyUsedKwh,
		"regen_kwh":          drive.RegenKwh,
		"avg_speed_mph":      drive.AvgSpeedMph,
		"max_speed_mph":      drive.MaxSpeedMph,
		"avg_power_kw":       drive.AvgPowerKw,
		"outside_temp_avg_c": drive.OutsideTempAvgC,
		"inside_temp_avg_c":  drive.InsideTempAvgC,
		"score":              drive.Score,
		"ended_status":       drive.EndedStatus,
		"created_at":         drive.CreatedAt,
		"live":               live,
		"telemetry":          telemetry,
		"positions":          positions,
	})
}

// enrichLiveDrive computes live values for an in-progress drive by reading
// start-of-drive state from signal_log via StateReader.State(drive.StartTs)
// and current state from Redis (with StateReader.State(now) as fallback).
// The drive struct is mutated in place. Returns an error if the start
// snapshot lookup fails — the caller should respond 500 because the live
// derivation depends on it (distance/battery deltas need a baseline).
func (h *driveDetailHandler) enrichLiveDrive(ctx context.Context, drive *models.Drive, now time.Time) error {
	startState, err := h.state.State(ctx, drive.VehicleID, drive.StartTs)
	if err != nil {
		return fmt.Errorf("start snapshot at %s: %w", drive.StartTs.Format(time.RFC3339Nano), err)
	}
	startSnap := stateToSignalMap(startState)

	currentSnap := h.currentSignals(ctx, drive.VehicleID)

	// Duration — always computable from wall clock.
	durationMin := now.Sub(drive.StartTs).Minutes()
	drive.DurationMin = safeFloat(durationMin)

	// Distance from odometer delta.
	startOdo, startOdoOk := signalFloat(startSnap, "Odometer")
	currentOdo, currentOdoOk := signalFloat(currentSnap, "Odometer")
	if startOdoOk && currentOdoOk && currentOdo > startOdo {
		drive.DistanceMi = safeFloat(currentOdo - startOdo)
	}

	// Battery levels.
	if startBat, ok := signalFloat(startSnap, "BatteryLevel"); ok {
		v := int16(startBat)
		drive.StartBatteryPct = &v
	}
	if currentBat, ok := signalFloat(currentSnap, "BatteryLevel"); ok {
		v := int16(currentBat)
		drive.EndBatteryPct = &v
	}

	// Average speed (distance / hours).
	if drive.DistanceMi > 0 && durationMin > 0 {
		avgSpeed := safeFloat(drive.DistanceMi / (durationMin / 60.0))
		drive.AvgSpeedMph = &avgSpeed
	}

	// Current speed as max (best approximation during live drive).
	if currentSpeed, ok := signalFloat(currentSnap, "VehicleSpeed"); ok {
		if drive.MaxSpeedMph == nil || currentSpeed > *drive.MaxSpeedMph {
			v := safeFloat(currentSpeed)
			drive.MaxSpeedMph = &v
		}
	}

	// Current position as end position.
	if lat, ok := signalFloat(currentSnap, "Latitude"); ok {
		drive.EndLat = &lat
	}
	if lon, ok := signalFloat(currentSnap, "Longitude"); ok {
		drive.EndLon = &lon
	}

	// Power.
	if voltage, vOk := signalFloat(currentSnap, "PackVoltage"); vOk {
		if current, cOk := signalFloat(currentSnap, "PackCurrent"); cOk {
			power := safeFloat(voltage * current / 1000.0)
			drive.AvgPowerKw = &power
		}
	}

	// Temps.
	if outside, ok := signalFloat(currentSnap, "OutsideTemp"); ok {
		drive.OutsideTempAvgC = &outside
	}
	if inside, ok := signalFloat(currentSnap, "InsideTemp"); ok {
		drive.InsideTempAvgC = &inside
	}
	return nil
}

// currentSignals returns the latest signal values for a vehicle, preferring
// Redis (sub-ms) with StateReader.State(time.Now()) as fallback. A failed
// fallback degrades to an empty map rather than blocking the live-drive
// derivation; the caller treats missing signals as "no current sample".
func (h *driveDetailHandler) currentSignals(ctx context.Context, vehicleID int64) map[string]interface{} {
	if h.redisCache != nil {
		snap, err := h.redisCache.GetAll(ctx, vehicleID)
		if err == nil && snap != nil {
			return snap
		}
		log.Debug().Err(err).Int64("vehicleID", vehicleID).Msg("live drive: Redis unavailable, falling back to signal_log")
	}
	state, err := h.state.State(ctx, vehicleID, time.Now().UTC())
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("live drive: failed to get current snapshot from signal_log")
		return map[string]interface{}{}
	}
	return stateToSignalMap(state)
}

// aliasPositionFields rewrites the raw signal_log column names produced by
// drivePositionFieldMappings into the legacy frontend Position contract:
//
//	ts        → created_at   (frontend reads p.created_at as the timestamp)
//	speed_mph → speed         (frontend speed chart reads p.speed)
//
// Used by both the embedded `positions` array in Get() and the standalone
// /drives/{id}/positions endpoint so the two stay in lock-step. Without this
// alias, TripReplay's duration formatter blows up to "NaN:NaN" because the
// frontend can't find a parseable timestamp on each position row.
func aliasPositionFields(rows []map[string]interface{}) {
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
		if v, ok := row["speed_mph"]; ok {
			row["speed"] = v
			delete(row, "speed_mph")
		}
	}
}

func (h *driveDetailHandler) Positions(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	drive, err := h.drives.GetByID(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("id", driveID).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	endTs := time.Now()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	}

	rowsTL, err := h.state.Timeline(r.Context(),
		drive.VehicleID, drivePositionFieldMappings, drive.StartTs, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("failed to get drive positions from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get positions")
		return
	}
	rows := timelineRowsToFlat(rowsTL)
	aliasPositionFields(rows)
	// Standalone Positions endpoint also exposes a stable per-row id used by
	// some legacy frontend list helpers. Keep that here so the embedded array
	// in Get() stays narrowly typed (chart consumers don't need an id).
	for _, row := range rows {
		if ts, ok := row["created_at"]; ok {
			row["id"] = fmt.Sprintf("%v", ts)
		}
	}
	writeJSON(w, http.StatusOK, rows)
}

func (h *driveDetailHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
	driveID, err := urlParamInt64(r, "driveID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	drive, err := h.drives.GetByID(r.Context(), driveID)
	if err != nil {
		log.Error().Err(err).Int64("id", driveID).Msg("failed to get drive for telemetry")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	endTs := time.Now()
	if drive.EndTs != nil {
		endTs = *drive.EndTs
	}

	rowsTL, err := h.state.Timeline(r.Context(),
		drive.VehicleID, driveTelemetryFieldMappings, drive.StartTs, endTs, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("failed to get telemetry from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get telemetry")
		return
	}
	rows := timelineRowsToFlat(rowsTL)
	// Rename "ts" → "created_at" to match the old DriveTelemetryReading JSON shape.
	for _, row := range rows {
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
			delete(row, "ts")
		}
	}
	// Derive per-row power (kW) — see derivePowerKw doc comment for rationale.
	derivePowerKw(rows)
	writeJSON(w, http.StatusOK, rows)
}
