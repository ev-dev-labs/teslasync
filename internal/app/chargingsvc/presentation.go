package chargingsvc

import (
	"math"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// ApplySessionFacts enriches a response copy; estimates are not written back
// into historical sessions or mistaken for a pinned historical tariff.
func ApplySessionFacts(session *chargingmodel.ChargingSession, facts charging.SessionFacts) {
	evidence := facts.Charger
	if session.ChargerType != nil {
		evidence.RecordedType = *session.ChargerType
	}
	if session.PeakPowerW != nil {
		evidence.PeakPowerW = math.Max(evidence.PeakPowerW, *session.PeakPowerW)
	}
	if session.AvgPowerW != nil {
		evidence.AveragePowerW = math.Max(evidence.AveragePowerW, *session.AvgPowerW)
	}
	if session.EndedAt != nil && session.TotalEnergyAddedWh != nil && !session.StartedAt.IsZero() {
		hours := session.EndedAt.Sub(session.StartedAt).Hours()
		if hours > 0 && finite(*session.TotalEnergyAddedWh) {
			evidence.AveragePowerW = math.Max(evidence.AveragePowerW, *session.TotalEnergyAddedWh/hours)
		}
	}
	kind := charging.ClassifyCharger(evidence)
	if kind != "AC" && (facts.InvoiceCost != nil || facts.InvoiceEnergyWh != nil || facts.InvoiceSite != "") {
		kind = "Supercharger"
	}
	session.ChargerType = nil
	if kind != "" {
		session.ChargerType = &kind
	}
	source := ""
	if session.CostSource != nil {
		source = *session.CostSource
	}
	if source == "manual" || source == "tesla_actual" ||
		(session.CostDecimal != nil && (source == "" || source == "unknown")) {
		return
	}
	if kind == "Supercharger" && facts.InvoiceCost != nil && facts.InvoiceCurrency != nil &&
		*facts.InvoiceCurrency != "" {
		session.CostDecimal = facts.InvoiceCost
		session.CostCurrency = facts.InvoiceCurrency
		source = "tesla_actual"
		session.CostSource = &source
		return
	}
	if session.CostDecimal != nil || session.TotalEnergyAddedWh == nil ||
		facts.DefaultRatePerWh <= 0 || !finite(facts.DefaultRatePerWh) {
		return
	}
	energyWh := *session.TotalEnergyAddedWh
	if energyWh < 0 || !finite(energyWh) {
		return
	}
	cost := math.Round(energyWh*facts.DefaultRatePerWh*1e6) / 1e6
	if !finite(cost) {
		return
	}
	session.CostDecimal = &cost
	source = "default_estimate"
	session.CostSource = &source
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}
