package driveaddressrepair

import (
	"testing"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

func strPtr(s string) *string   { return &s }
func f64Ptr(v float64) *float64 { return &v }

func suspectDrive() *drivemodel.Drive {
	addr := "19720 Bothell Everett Highway, Bothell"
	return &drivemodel.Drive{
		StartAddress: strPtr(addr), EndAddress: strPtr(addr),
		StartLat: f64Ptr(47.8060), StartLon: f64Ptr(-122.2050),
		EndLat: f64Ptr(47.6740), EndLon: f64Ptr(-122.1215),
	}
}

func TestPlanEndAddressRepair(t *testing.T) {
	if got, write := PlanEndAddressRepair(suspectDrive(), "1 Microsoft Way, Redmond", true); !write || got != "1 Microsoft Way, Redmond" {
		t.Errorf("plan = %q, %v; want end-coordinate label written", got, write)
	}
	if _, write := PlanEndAddressRepair(suspectDrive(), "", false); write {
		t.Error("failed lookup must never write (never copy the start address)")
	}
	rt := suspectDrive()
	rt.EndLat, rt.EndLon = f64Ptr(47.8061), f64Ptr(-122.2050)
	if _, write := PlanEndAddressRepair(rt, "Somewhere Else", true); write {
		t.Error("genuine round trip must never be touched")
	}
}
