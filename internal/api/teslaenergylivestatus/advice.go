package teslaenergylivestatus

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// Charge-advice verdicts.
const (
	adviceChargeNow  = "charge_now"
	adviceChargeSoon = "charge_soon"
	adviceWait       = "wait"
	adviceNoData     = "no_data"
)

const (
	// minChargeW is the practical floor for useful car charging (~6A @ 240V).
	minChargeW = 1400.0
	// soonChargeW is the surplus band worth waiting/watching (~2A+ @ 240V).
	soonChargeW = 500.0
	// chargerVoltageV converts surplus watts into a solar-matched amp target.
	chargerVoltageV = 240.0
	// maxAdviceAmps caps the recommendation at a common home-charging ceiling.
	maxAdviceAmps = 48
)

// ChargeAdvice is the GET .../charge-advice response: whether surplus solar
// is available for car charging and the solar-matched amp target.
//
// Sign conventions (canonical, shared with the power-flow UI):
// battery_power < 0 means the Powerwall is charging (a load);
// grid_power < 0 means exporting to the grid.
type ChargeAdvice struct {
	Verdict         string  `json:"verdict"`
	SurplusW        float64 `json:"surplus_w"`
	SolarW          float64 `json:"solar_w"`
	HomeW           float64 `json:"home_w"`
	BatteryChargeW  float64 `json:"battery_charge_w"`
	RecommendedAmps int     `json:"recommended_amps"`
	SnapshotAgeS    int64   `json:"snapshot_age_s"`
	Explanation     string  `json:"explanation"`
}

// AdviseCharge is the pure surplus computation over a live-status snapshot.
// A nil snapshot degrades to no_data. nowSecs pins snapshot age for tests.
func AdviseCharge(snap *teslamodel.TeslaEnergyLiveStatus, nowSecs int64) ChargeAdvice {
	if snap == nil {
		return ChargeAdvice{Verdict: adviceNoData,
			Explanation: "No energy snapshot yet — refresh live status to get solar charging advice."}
	}
	solar := deref(snap.SolarPower)
	home := deref(snap.LoadPower)
	// Only charging Powerwall flow counts as committed load; a discharging
	// pack is stored energy, conservatively excluded from "free" surplus.
	battCharge := math.Max(-deref(snap.BatteryPower), 0)
	surplus := math.Max(solar-home-battCharge, 0)

	age := nowSecs - snap.Timestamp.Unix()
	if age < 0 {
		age = 0
	}
	rep := ChargeAdvice{
		SurplusW:       round0(surplus),
		SolarW:         round0(solar),
		HomeW:          round0(home),
		BatteryChargeW: round0(battCharge),
		SnapshotAgeS:   age,
	}
	rep.RecommendedAmps = int(math.Min(surplus/chargerVoltageV, maxAdviceAmps))

	switch {
	case surplus >= minChargeW:
		rep.Verdict = adviceChargeNow
		rep.Explanation = fmt.Sprintf(
			"%.1f kW of surplus solar is available — charge the car at ~%dA to soak it up instead of exporting it.",
			surplus/1000, rep.RecommendedAmps)
	case surplus >= soonChargeW:
		rep.Verdict = adviceChargeSoon
		rep.Explanation = fmt.Sprintf(
			"Only %.1f kW surplus right now — worth a low-amp top-up, or wait for midday sun.", surplus/1000)
	default:
		rep.Verdict = adviceWait
		if solar <= 0 {
			rep.Explanation = "No solar production right now — overnight charging should follow the cheap-rate window, not the sun."
		} else {
			rep.Explanation = fmt.Sprintf(
				"Home load (%.1f kW) is eating the %.1f kW of solar — no free surplus for the car yet.", home/1000, solar/1000)
		}
	}
	return rep
}

// ChargeAdvice serves GET /tesla/energy-sites/{siteID}/charge-advice.
func (h *Handler) ChargeAdvice(w http.ResponseWriter, r *http.Request) {
	siteID, err := apiparams.URLParamInt64(r, "siteID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid site_id")
		return
	}
	status, err := h.repo.GetLatest(r.Context(), siteID)
	if err != nil {
		log.Error().Err(err).Int64("site_id", siteID).Msg("failed to get latest energy live status")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query live status")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, AdviseCharge(status, time.Now().Unix()))
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func round0(f float64) float64 { return math.Round(f) }
