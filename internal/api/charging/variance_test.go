package charging

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

type fakeMeasuredSummer struct {
	totals chargingdb.MeasuredDCTotals
	err    error
}

func (f *fakeMeasuredSummer) SumMeasuredDC(_ context.Context, _ int64) (chargingdb.MeasuredDCTotals, error) {
	return f.totals, f.err
}

type fakeInvoicedReader struct {
	summary *teslamodel.TeslaChargingHistorySummary
	err     error
}

func (f *fakeInvoicedReader) GetSummary(_ context.Context, _ string) (*teslamodel.TeslaChargingHistorySummary, error) {
	return f.summary, f.err
}

var (
	_ measuredDCSummer     = (*fakeMeasuredSummer)(nil)
	_ invoicedTotalsReader = (*fakeInvoicedReader)(nil)
)

func f64(v float64) *float64 { return &v }

func TestComputeBillVarianceReconciled(t *testing.T) {
	rep := ComputeBillVariance(9,
		chargingdb.MeasuredDCTotals{Sessions: 40, EnergyWh: 100000, Cost: 35},
		&teslamodel.TeslaChargingHistorySummary{TotalSessions: 40, TotalWh: f64(104000), TotalSpend: f64(36.5)},
	)
	if rep.Verdict != billVerdictReconciled {
		t.Fatalf("verdict = %s, want reconciled (%+v)", rep.Verdict, rep)
	}
	if rep.CabinetLossPct <= 0 || rep.CabinetLossPct > 8 {
		t.Fatalf("cabinet loss = %v, want (0, 8]", rep.CabinetLossPct)
	}
}

func TestComputeBillVarianceReview(t *testing.T) {
	rep := ComputeBillVariance(9,
		chargingdb.MeasuredDCTotals{Sessions: 40, EnergyWh: 100000, Cost: 35},
		&teslamodel.TeslaChargingHistorySummary{TotalSessions: 40, TotalWh: f64(130000), TotalSpend: f64(52)},
	)
	if rep.Verdict != billVerdictReview {
		t.Fatalf("verdict = %s, want review", rep.Verdict)
	}
	if rep.Explanation == "" {
		t.Fatal("expected an explanation")
	}
}

func TestComputeBillVarianceMissing(t *testing.T) {
	rep := ComputeBillVariance(9, chargingdb.MeasuredDCTotals{Sessions: 5, EnergyWh: 12000, Cost: 4}, nil)
	if rep.Verdict != billVerdictMissing {
		t.Fatalf("verdict = %s, want missing_data", rep.Verdict)
	}
}

func TestBillVarianceServesReport(t *testing.T) {
	h := &ChargingHandler{varianceOverride: &varianceTestSeam{
		measured: &fakeMeasuredSummer{totals: chargingdb.MeasuredDCTotals{Sessions: 10, EnergyWh: 50000, Cost: 18}},
		invoiced: &fakeInvoicedReader{summary: &teslamodel.TeslaChargingHistorySummary{
			TotalSessions: 10, TotalWh: f64(52000), TotalSpend: f64(19),
		}},
		vin: "VIN1",
	}}
	req := httptest.NewRequest(http.MethodGet, "/bill-variance?vehicle_id=9", nil)
	rec := httptest.NewRecorder()
	h.BillVariance(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var rep BillVarianceReport
	if err := json.NewDecoder(rec.Body).Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep.VehicleID != 9 || rep.Verdict != billVerdictReconciled {
		t.Fatalf("unexpected report: %+v", rep)
	}
}

func TestBillVarianceRejectsMissingVehicle(t *testing.T) {
	h := &ChargingHandler{varianceOverride: &varianceTestSeam{}}
	req := httptest.NewRequest(http.MethodGet, "/bill-variance", nil)
	rec := httptest.NewRecorder()
	h.BillVariance(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestBillVariancePropagatesMeasuredError(t *testing.T) {
	h := &ChargingHandler{varianceOverride: &varianceTestSeam{
		measured: &fakeMeasuredSummer{err: errors.New("db down")},
		vin:      "VIN1",
	}}
	req := httptest.NewRequest(http.MethodGet, "/bill-variance?vehicle_id=9", nil)
	rec := httptest.NewRecorder()
	h.BillVariance(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
