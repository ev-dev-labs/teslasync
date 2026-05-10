package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// MotorHandler serves motor / drive-inverter / powertrain endpoints backed
// by the signal-log change feed via signal.StateReader (ADR-002 /
// phase-39).
//
// Phase-39 migration: the legacy *database.SignalLogReader (the old pivot
// + snapshot helpers) has been replaced with the canonical
// signal.StateReader.
//
// Drive-inverter signals (DiTorqueActualF/R, DiAxleSpeedF/R, DiStatorTempF/R,
// DiInverterTF/R, DiHeatsinkTF/R, DiVBatF/R, DiStateF/R, Gear, …) emit at
// very different cadences while the car is driving, parking, or charging.
// The drive-state signals (DiStateF/R, Gear) in particular re-emit only on
// transition — for a parked car they may not re-emit for hours. Under the
// legacy raw-pivot implementation, every chart row whose bucket did not
// contain a fresh DiStateF emission rendered state_front as NULL, leaving
// the powertrain chart with empty cells across long stable runs. With
// StateReader.Timeline forward-folding (chart mode — empty CollapseBy so
// every change-feed emission becomes one row), every row carries the
// most-recently-observed value of every projected signal, fixing the
// carry-forward gap end-to-end.
type MotorHandler struct {
	state signal.StateReader
	live  signal.LiveStateReader
}

// Signal → JSON field mappings for motor / powertrain timeline + state
// projection. Field names match the frontend MotorSnapshot interface in
// web/src/api/types.ts (snake_case; the frontend camelCaseKeys transform
// produces matching camelCase keys on the wire).
var motorMappings = []signal.FieldMapping{
	{Signal: "DiMotorCurrentF", Field: "motor_current_front"},
	{Signal: "DiMotorCurrentR", Field: "motor_current_rear"},
	{Signal: "DiTorqueActualF", Field: "torque_nm_front"},
	{Signal: "DiTorqueActualR", Field: "torque_nm_rear"},
	{Signal: "DiTorquemotor", Field: "di_torque"},
	{Signal: "DiAxleSpeedF", Field: "motor_rpm_front"},
	{Signal: "DiAxleSpeedR", Field: "motor_rpm_rear"},
	{Signal: "DiStatorTempF", Field: "motor_temp_c_front"},
	{Signal: "DiStatorTempR", Field: "motor_temp_c_rear"},
	{Signal: "DiHeatsinkTF", Field: "heatsink_temp_front"},
	{Signal: "DiHeatsinkTR", Field: "heatsink_temp_rear"},
	{Signal: "DiInverterTF", Field: "inverter_temp_c"},
	{Signal: "DiInverterTR", Field: "inverter_temp_rear"},
	{Signal: "DiStateF", Field: "state_front"},
	{Signal: "DiStateR", Field: "state_rear"},
	{Signal: "DiVBatF", Field: "vbat_front"},
	{Signal: "DiVBatR", Field: "vbat_rear"},
	{Signal: "Gear", Field: "shift_state"},
}

// asFloat64 best-effort coerces a projected motorMappings value (typed
// as `interface{}` because signal.SignalValue is `any`) into a float64
// suitable for arithmetic. Returns (0, false) for any value that is
// nil, missing, or of an unexpected non-numeric type. The codec emits
// the powertrain numeric signals as float32 / float64 / int / int64 /
// json.Number depending on the upstream payload shape, so we cover the
// common numeric types and reject everything else (booleans, strings,
// enums) explicitly so a stray non-numeric value never silently
// contributes to derived motor power as 0.
func asFloat64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case nil:
		return 0, false
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}

// injectDerivedMotorPower derives `power_kw` and `regen_kw` from the
// per-motor DC voltage × current pairs that motorMappings projects
// from the drive-inverter signal feed (DiVBatF/R, DiMotorCurrentF/R)
// and writes them into row in-place.
//
// Why this lives in the API layer
// -------------------------------
// Tesla Fleet Telemetry does not emit a "motor power" or "regen
// power" signal — the on-vehicle drive inverters report DC bus
// voltage and motor current per axle (front + rear on dual-motor
// trims; just one of the pair on RWD/single-motor trims). Power is
// the product. The legacy motor_snapshots table never had a
// power_kw column either; the historical UI computed it client-side
// from the same V × I product. After the Phase-39 motor_snapshots →
// signal_log rewrite, no layer was deriving power, so the
// "Motor Power Over Time" chart and the SpeedGearPanel power figure
// rendered as permanently empty / "—" even when V and I were
// flowing at ~1 Hz through the per-field MQTT pipeline. Computing
// here keeps the derivation in ONE place (used by both Latest and
// List) and matches the documented MotorSnapshot contract in
// web/src/api/types.ts which already declares power_kw + regen_kw
// as derived-SI fields.
//
// Sign convention and physical interpretation
// -------------------------------------------
//   - DiVBat{F,R} is the DC-link voltage at each drive inverter (V).
//   - DiMotorCurrent{F,R} is the inverter-side current (A). Tesla's
//     inverter convention is signed: positive when the inverter
//     draws from the pack (driving), negative when it sources back
//     to the pack (regen). We treat any negative product as regen
//     and any positive product as drive — when the convention turns
//     out to be magnitude-only on a particular firmware, regen will
//     always read 0 but power_kw will still be the correct
//     magnitude of motor draw.
//   - power_kw = max(0, sum_W) / 1000 (the area-chart's "drive" series).
//   - regen_kw = max(0, -sum_W) / 1000 (the area-chart's "regen" series).
//
// Missing-input policy
// --------------------
// A motor's V × I pair is only included in the sum when BOTH the
// voltage AND the current are present and numeric. Either side
// missing causes that motor to be skipped — we do NOT silently
// substitute 0, because "missing telemetry" and "true zero motor
// draw" are very different physical states and conflating them
// would corrupt computeMotorStats() (avgPower / peakPower /
// peakRegen on the helpers.ts side). When NEITHER motor has a
// complete pair, the derived keys are left out of the row entirely
// — the chart's `s.power_kw ?? null` then plots a true gap rather
// than a misleading zero.
func injectDerivedMotorPower(row map[string]interface{}) {
	if row == nil {
		return
	}
	totalW := 0.0
	have := false

	if v, okV := asFloat64(row["vbat_front"]); okV {
		if i, okI := asFloat64(row["motor_current_front"]); okI {
			totalW += v * i
			have = true
		}
	}
	if v, okV := asFloat64(row["vbat_rear"]); okV {
		if i, okI := asFloat64(row["motor_current_rear"]); okI {
			totalW += v * i
			have = true
		}
	}

	if !have {
		return
	}
	if totalW >= 0 {
		row["power_kw"] = totalW / 1000.0
		row["regen_kw"] = 0.0
	} else {
		row["power_kw"] = 0.0
		row["regen_kw"] = -totalW / 1000.0
	}
}

func NewMotorHandler(state signal.StateReader, live signal.LiveStateReader) *MotorHandler {
	return &MotorHandler{state: state, live: live}
}

// List returns motor / powertrain history from the signal-log change feed
// via StateReader.Timeline in CHART MODE (empty CollapseBy). Each emission
// becomes one row; forward-folding ensures the rarely-emitted drive-state
// signals (DiStateF/R, Gear) and the slowly-changing inverter-temperature
// signals carry their most-recent values across rows where they did not
// re-emit.
func (h *MotorHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	from := time.Now().AddDate(0, 0, -7)
	to := time.Now()
	if start, end := parseDateRange(r); !start.IsZero() {
		from = start
		if !end.IsZero() {
			to = end
		}
	}

	timelineRows, err := h.state.Timeline(r.Context(),
		vehicleID, motorMappings, from, to, signal.TimelineOptions{})
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get motor data from signal_log")
		writeError(w, http.StatusInternalServerError, "failed to get motor data")
		return
	}
	rows := timelineRowsToFlat(timelineRows)
	for i, row := range rows {
		injectDerivedMotorPower(row)
		if ts, ok := row["ts"]; ok {
			row["created_at"] = ts
		}
		row["id"] = i + 1
	}
	writeJSON(w, http.StatusOK, rows)
}

// Latest returns the most recent motor / powertrain values, derived from
// the forward-folded signal-log state at time.Now() via StateReader.State.
// Every motorMappings entry whose Signal is present in State is projected
// under its mapped Field name; absent signals are omitted.
func (h *MotorHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	snap, err := h.live.LiveState(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to get latest motor data")
		writeError(w, http.StatusInternalServerError, "failed to get latest motor data")
		return
	}

	result := make(map[string]interface{})
	for _, m := range motorMappings {
		if v, ok := snap[m.Signal]; ok {
			result[m.Field] = v
		}
	}
	injectDerivedMotorPower(result)
	writeJSON(w, http.StatusOK, result)
}
