package physics

import (
	"testing"
	"time"
)

func TestLatchReleaseIsNotUnplug(t *testing.T) {
	at := time.Now()
	samples := []Sample{
		{At: at, DetailedChargeState: "Complete", ChargePortLatch: "Engaged"},
		{At: at.Add(time.Second), DetailedChargeState: "Complete", ChargePortLatch: "Disengaged"},
	}
	ledger := Solve(Window{Start: at, End: at.Add(time.Second), Kind: "charge", Samples: samples, Params: DefaultParams()})
	if ledger.Charge.Unplugged {
		t.Fatal("latch release is not disconnect")
	}
}

func TestIncompleteLedgerCannotReconcile(t *testing.T) {
	at := time.Now()
	samples := driveSamples(at, 3, time.Second, 20, 8000)
	ledger := Solve(Window{Start: at, End: at.Add(time.Hour), Kind: "drive", Samples: samples, Params: DefaultParams(), SessionEnergyWh: fp(8000)})
	if ledger.Drive.UnexplainedKnown || ledger.Drive.UnexplainedWh != nil || ledger.Drive.ReconcileWh != nil {
		t.Fatal("partial telemetry cannot produce full-window residual/reconciliation")
	}
}

func TestRangeIncludesFirstObservation(t *testing.T) {
	at := time.Now()
	samples := []Sample{
		{At: at, EnergyRemainingWh: fp(40000), OdometerM: fp(1000)},
		{At: at.Add(time.Minute), EnergyRemainingWh: fp(40100), OdometerM: fp(1000)},
	}
	ledger := Solve(Window{Start: at, End: at.Add(time.Minute), Kind: "charge", Samples: samples, Params: DefaultParams()})
	if ledger.Charge.EnergyAddedWh == nil || *ledger.Charge.EnergyAddedWh != 100 {
		t.Fatal("lost first energy endpoint")
	}
}
