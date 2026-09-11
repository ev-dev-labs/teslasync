package tempimpact

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Shift verdicts for the efficiency detective.
const (
	shiftStable         = "stable"
	shiftColderWeather  = "colder_weather"
	shiftWarmerDriving  = "warmer_driving"
	shiftDrivingPattern = "driving_pattern"
	shiftInsufficient   = "insufficient_data"
)

// EfficiencyShift is the GET /analytics/temperature-impact/shift response:
// latest-month vs prior-month efficiency with temperature attribution.
type EfficiencyShift struct {
	LatestMonth      string  `json:"latest_month"`
	PriorMonth       string  `json:"prior_month"`
	LatestEfficiency float64 `json:"latest_efficiency"`
	PriorEfficiency  float64 `json:"prior_efficiency"`
	EfficiencyDelta  float64 `json:"efficiency_delta_pct"`
	LatestTemp       float64 `json:"latest_temp_c"`
	PriorTemp        float64 `json:"prior_temp_c"`
	TempDelta        float64 `json:"temp_delta_c"`
	TempSensitivity  float64 `json:"temp_sensitivity_per_c"`
	TempAttributed   float64 `json:"temp_attributed_pct"`
	ResidualPct      float64 `json:"residual_pct"`
	Verdict          string  `json:"verdict"`
	Explanation      string  `json:"explanation"`
}

// AnalyzeShift compares the two most recent qualifying months (drive_count
// >= 3) and attributes the efficiency move to temperature via the
// least-squares slope of the qualifying series. Efficiency here is
// battery-%/100km (lower is better); deltas are signed accordingly.
func AnalyzeShift(months []monthlyTempTrend) EfficiencyShift {
	qualified := months[:0:0]
	for _, m := range months {
		if m.DriveCount >= 3 {
			qualified = append(qualified, m)
		}
	}
	if len(qualified) < 2 {
		return EfficiencyShift{Verdict: shiftInsufficient,
			Explanation: "Need at least two months with 3+ drives each to diagnose an efficiency shift."}
	}
	prior, latest := qualified[len(qualified)-2], qualified[len(qualified)-1]

	rep := EfficiencyShift{
		LatestMonth: latest.Month, PriorMonth: prior.Month,
		LatestEfficiency: round2(latest.AvgEfficiency), PriorEfficiency: round2(prior.AvgEfficiency),
		LatestTemp: round1(latest.AvgTemp), PriorTemp: round1(prior.AvgTemp),
	}
	rep.TempDelta = round1(latest.AvgTemp - prior.AvgTemp)
	if prior.AvgEfficiency != 0 {
		// Negative delta = improvement (fewer %/100km).
		rep.EfficiencyDelta = round2((latest.AvgEfficiency - prior.AvgEfficiency) / math.Abs(prior.AvgEfficiency) * 100)
	}

	slope := tempSlope(qualified)
	rep.TempSensitivity = round2(slope)
	// slope is %/100km per °C; convert the explained move into percent of
	// the prior baseline so it compares directly with EfficiencyDelta.
	if prior.AvgEfficiency != 0 {
		rep.TempAttributed = round2(slope * (latest.AvgTemp - prior.AvgTemp) / math.Abs(prior.AvgEfficiency) * 100)
	}
	rep.ResidualPct = round2(rep.EfficiencyDelta - rep.TempAttributed)

	delta, attr := rep.EfficiencyDelta, rep.TempAttributed
	switch {
	case math.Abs(delta) < 5:
		rep.Verdict = shiftStable
		rep.Explanation = fmt.Sprintf(
			"Efficiency is stable (%+.1f%% month over month) — no diagnosis needed.", delta)
	case delta > 0 && attr > 0 && math.Abs(attr) >= math.Abs(delta)*0.6:
		rep.Verdict = shiftColderWeather
		rep.Explanation = fmt.Sprintf(
			"Efficiency worsened %+.1f%% and colder weather explains about %.1f%% of it (%.1f°C drop × %.2f%%/100km per °C). Battery heating and denser air are the likely drivers — not your driving.",
			delta, math.Abs(attr), math.Abs(rep.TempDelta), math.Abs(slope))
	case delta < 0 && attr < 0 && math.Abs(attr) >= math.Abs(delta)*0.6:
		rep.Verdict = shiftWarmerDriving
		rep.Explanation = fmt.Sprintf(
			"Efficiency improved %+.1f%%, mostly warmer weather (+%.1f°C). Enjoy it — and bank the number as your fair-weather baseline.",
			delta, rep.TempDelta)
	default:
		rep.Verdict = shiftDrivingPattern
		rep.Explanation = fmt.Sprintf(
			"Efficiency moved %+.1f%% but temperature explains only %.1f%% of it. Check tire pressure, shorter trips, higher speeds, or roof loads before blaming the weather.",
			delta, attr)
	}
	return rep
}

// tempSlope fits efficiency (%/100km) on temperature (°C) by least squares.
// A negative slope means warmer months use less battery per 100km.
func tempSlope(months []monthlyTempTrend) float64 {
	var sx, sy, sxx, sxy float64
	n := float64(len(months))
	for _, m := range months {
		sx += m.AvgTemp
		sy += m.AvgEfficiency
		sxx += m.AvgTemp * m.AvgTemp
		sxy += m.AvgTemp * m.AvgEfficiency
	}
	denom := n*sxx - sx*sx
	if denom == 0 {
		return 0
	}
	return (n*sxy - sx*sy) / denom
}

// Shift serves GET /analytics/temperature-impact/shift?vehicle_id=....
func (h *Handler) Shift(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := parseVehicleID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()
	trend, err := h.repo.MonthlyTrend(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query monthly trend")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query monthly trend")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, AnalyzeShift(trend))
}
