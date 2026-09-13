package tripplanner

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Arrival-confidence verdicts.
const (
	confidenceComfortable = "comfortable"
	confidenceTight       = "tight"
	confidenceChargeNow   = "charge_now"
)

type confidenceRequest struct {
	CurrentSOC         float64 `json:"current_soc"`
	BatteryCapacityKWh float64 `json:"battery_capacity_kwh"`
	RemainingKm        float64 `json:"remaining_km"`
	EfficiencyWhKm     float64 `json:"efficiency_wh_km"`
	EfficiencyFactor   float64 `json:"efficiency_factor"`
	MinArrivalSOC      float64 `json:"min_arrival_soc"`
}

type confidenceResponse struct {
	ArrivalSOC      float64 `json:"arrival_soc"`
	UsableKWh       float64 `json:"usable_kwh"`
	NeededKWh       float64 `json:"needed_kwh"`
	MarginKWh       float64 `json:"margin_kwh"`
	ChargeNeededKWh float64 `json:"charge_needed_kwh"`
	Verdict         string  `json:"verdict"`
	Explanation     string  `json:"explanation"`
}

// ComputeConfidence is the pure en-route arrival math: given the current
// SOC and remaining distance, will the car make it above the arrival floor?
// EfficiencyFactor scales consumption (>1 in cold/headwind); defaults apply
// when the caller omits capacity, efficiency, or the arrival floor.
func ComputeConfidence(req confidenceRequest) (confidenceResponse, error) {
	if req.CurrentSOC <= 0 || req.CurrentSOC > 100 {
		return confidenceResponse{}, fmt.Errorf("current_soc must be 0..100")
	}
	if req.RemainingKm <= 0 {
		return confidenceResponse{}, fmt.Errorf("remaining_km must be positive")
	}
	capacity := req.BatteryCapacityKWh
	if capacity <= 0 {
		capacity = defaultBatteryCapacityKWh
	}
	eff := req.EfficiencyWhKm
	if eff <= 0 {
		eff = defaultEfficiencyWhKm
	}
	factor := req.EfficiencyFactor
	if factor <= 0 {
		factor = 1.0
	}
	minArrival := req.MinArrivalSOC
	if minArrival < 0 {
		minArrival = 10
	}

	usable := req.CurrentSOC / 100 * capacity
	needed := req.RemainingKm * eff * factor / 1000
	arrivalKWh := usable - needed
	arrivalSOC := arrivalKWh / capacity * 100
	margin := arrivalKWh - minArrival/100*capacity

	rep := confidenceResponse{
		ArrivalSOC: round1(arrivalSOC),
		UsableKWh:  round1(usable),
		NeededKWh:  round1(needed),
		MarginKWh:  round1(margin),
	}
	switch {
	case arrivalSOC >= minArrival+10:
		rep.Verdict = confidenceComfortable
		rep.Explanation = fmt.Sprintf(
			"You'll arrive with ~%.0f%% — %.1f kWh above your %.0f%% floor. Drive normally.",
			math.Max(arrivalSOC, 0), math.Max(margin, 0), minArrival)
	case arrivalSOC >= minArrival:
		rep.Verdict = confidenceTight
		rep.Explanation = fmt.Sprintf(
			"Tight: ~%.0f%% at arrival with only %.1f kWh of margin. Ease off above 110 km/h and skip the detour.",
			math.Max(arrivalSOC, 0), math.Max(margin, 0))
	default:
		rep.Verdict = confidenceChargeNow
		short := minArrival/100*capacity - arrivalKWh
		rep.ChargeNeededKWh = round1(math.Max(short, 0))
		rep.Explanation = fmt.Sprintf(
			"You won't make it — projected arrival is ~%.0f%%. Add at least %.1f kWh (about %d Supercharger minutes) before continuing.",
			arrivalSOC, rep.ChargeNeededKWh, int(math.Ceil(rep.ChargeNeededKWh/chargerPowerKW*60)))
	}
	return rep, nil
}

// Confidence handles POST /trip-planner/confidence.
func (h *TripPlannerHandler) Confidence(w http.ResponseWriter, r *http.Request) {
	var req confidenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	rep, err := ComputeConfidence(req)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rep)
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }
