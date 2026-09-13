package charging

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// measuredDCSummer is the narrow aggregate the variance endpoint needs.
// *chargingdb.ChargingRepo satisfies it; tests inject a fake.
type measuredDCSummer interface {
	SumMeasuredDC(ctx context.Context, vehicleID int64) (chargingdb.MeasuredDCTotals, error)
}

// invoicedTotalsReader pulls the Tesla-side invoice aggregate.
// *tesladb.TeslaChargingHistoryRepo (already held as teslaBillFinder)
// does not expose it, so the handler resolves it via this interface.
type invoicedTotalsReader interface {
	GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingHistorySummary, error)
}

// BillVarianceReport reconciles pack-side measured DC totals against
// Tesla cabinet-side invoices. Positive deltas mean Tesla metered more
// than the pack received (cabinet loss + idle/congestion/tax).
type BillVarianceReport struct {
	VehicleID        int64   `json:"vehicle_id"`
	MeasuredSessions int     `json:"measured_sessions"`
	MeasuredEnergyWh float64 `json:"measured_energy_wh"`
	MeasuredCost     float64 `json:"measured_cost"`
	InvoicedSessions int     `json:"invoiced_sessions"`
	InvoicedEnergyWh float64 `json:"invoiced_energy_wh"`
	InvoicedCost     float64 `json:"invoiced_cost"`
	EnergyDeltaWh    float64 `json:"energy_delta_wh"`
	EnergyDeltaPct   float64 `json:"energy_delta_pct"`
	CostDelta        float64 `json:"cost_delta"`
	CostDeltaPct     float64 `json:"cost_delta_pct"`
	CabinetLossPct   float64 `json:"cabinet_loss_pct"`
	Verdict          string  `json:"verdict"`
	Explanation      string  `json:"explanation"`
}

const (
	billVerdictReconciled = "reconciled"
	billVerdictReview     = "review"
	billVerdictMissing    = "missing_data"
)

// ComputeBillVariance is the pure reconciliation math. invoiced may be nil
// (no invoices on file) — the report then degrades to missing_data instead
// of fabricating a comparison.
func ComputeBillVariance(vehicleID int64, measured chargingdb.MeasuredDCTotals, invoiced *teslamodel.TeslaChargingHistorySummary) BillVarianceReport {
	rep := BillVarianceReport{
		VehicleID:        vehicleID,
		MeasuredSessions: measured.Sessions,
		MeasuredEnergyWh: round2(measured.EnergyWh),
		MeasuredCost:     round2(measured.Cost),
	}
	if invoiced == nil || invoiced.TotalSessions == 0 {
		rep.Verdict = billVerdictMissing
		rep.Explanation = "No Tesla invoices on file — sync Tesla charging history to reconcile measured sessions against billed totals."
		return rep
	}
	invWh := deref(invoiced.TotalWh)
	invCost := deref(invoiced.TotalSpend)
	rep.InvoicedSessions = invoiced.TotalSessions
	rep.InvoicedEnergyWh = round2(invWh)
	rep.InvoicedCost = round2(invCost)
	rep.EnergyDeltaWh = round2(invWh - measured.EnergyWh)
	rep.CostDelta = round2(invCost - measured.Cost)
	if measured.EnergyWh > 0 {
		rep.EnergyDeltaPct = round2((invWh - measured.EnergyWh) / measured.EnergyWh * 100)
	}
	if measured.Cost > 0 {
		rep.CostDeltaPct = round2((invCost - measured.Cost) / measured.Cost * 100)
	}
	// Cabinet loss = invoiced energy the pack never saw, as a share of the
	// invoice. Clamped at zero: a negative value means measurement noise,
	// not negative physics.
	rep.CabinetLossPct = 0
	if invWh > 0 && invWh > measured.EnergyWh {
		rep.CabinetLossPct = round2((invWh - measured.EnergyWh) / invWh * 100)
	}

	switch {
	case math.Abs(rep.EnergyDeltaPct) <= 8 && math.Abs(rep.CostDeltaPct) <= 10:
		rep.Verdict = billVerdictReconciled
		rep.Explanation = fmt.Sprintf(
			"Measured and billed DC charging agree within %.1f%% energy / %.1f%% cost across %d sessions — cabinet loss of %.1f%% is normal Supercharger overhead.",
			math.Abs(rep.EnergyDeltaPct), math.Abs(rep.CostDeltaPct), measured.Sessions, rep.CabinetLossPct,
		)
	default:
		rep.Verdict = billVerdictReview
		rep.Explanation = fmt.Sprintf(
			"Billed energy differs from measured by %.1f%% (%s Wh) and cost by %.1f%% (%s). Check idle/congestion fees, missing invoices, or unmatched sessions.",
			rep.EnergyDeltaPct, fmtSigned(rep.EnergyDeltaWh), rep.CostDeltaPct, fmtSigned(rep.CostDelta),
		)
	}
	return rep
}

// BillVariance serves GET /charging/bill-variance?vehicle_id=....
func (h *ChargingHandler) BillVariance(w http.ResponseWriter, r *http.Request) {
	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}

	ctx := r.Context()
	var summer measuredDCSummer
	var invoicedReader invoicedTotalsReader
	var vin string
	if h.varianceOverride != nil {
		summer = h.varianceOverride.measured
		invoicedReader = h.varianceOverride.invoiced
		vin = h.varianceOverride.vin
	} else {
		summer = h.chargingRepo
		if h.vehicles != nil {
			if v, verr := h.vehicles.GetByID(ctx, vehicleID); verr == nil && v != nil {
				vin = v.VIN
			}
		}
		invoicedReader, _ = h.teslaBills.(invoicedTotalsReader)
	}

	measured, err := summer.SumMeasuredDC(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("charging.bill-variance: measured totals failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load measured totals")
		return
	}

	// Invoices are keyed by VIN. A vehicle without a VIN (or with no
	// synced history) degrades to missing_data, not an error.
	var invoiced *teslamodel.TeslaChargingHistorySummary
	if vin != "" && invoicedReader != nil {
		if sum, serr := invoicedReader.GetSummary(ctx, vin); serr != nil {
			log.Warn().Err(serr).Int64("vehicle_id", vehicleID).Msg("charging.bill-variance: invoice summary failed")
		} else {
			invoiced = sum
		}
	}

	httpx.WriteJSON(w, http.StatusOK, ComputeBillVariance(vehicleID, measured, invoiced))
}

func deref(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func fmtSigned(f float64) string {
	if f < 0 {
		return fmt.Sprintf("-%.2f", -f)
	}
	return fmt.Sprintf("+%.2f", f)
}
