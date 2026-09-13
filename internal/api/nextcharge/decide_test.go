package nextcharge

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/chargeautopilot"
)

func testProfile() chargeautopilot.Profile {
	p := chargeautopilot.DefaultProfile(1)
	p.Enabled = true
	return p
}

func TestDecideEnoughAtTarget(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	d := Decide(Input{Profile: testProfile(), CurrentSOC: 85, Now: now})
	if d.Verdict != VerdictEnough {
		t.Fatalf("verdict = %s, want %s", d.Verdict, VerdictEnough)
	}
	if d.KWhNeeded != 0 {
		t.Fatalf("kwh_needed = %v, want 0", d.KWhNeeded)
	}
}

func TestDecideWaitOffPeakWhenSavingsClear(t *testing.T) {
	// 18:00 winter weekday is on-peak for pge-ev2a; ready-by 07:30 leaves
	// overnight off-peak. Savings versus charging now must clear $0.50.
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	d := Decide(Input{Profile: testProfile(), CurrentSOC: 50, Now: now})
	if d.Verdict != VerdictWait {
		t.Fatalf("verdict = %s reason=%s savings=%v, want wait", d.Verdict, d.Reason, ptrVal(d.HomeSavings))
	}
	if d.HomeWaitStart == nil {
		t.Fatal("expected home_wait_start")
	}
	if ptrVal(d.HomeSavings) < minWaitSavingsUSD {
		t.Fatalf("savings = %v, want >= %.2f", ptrVal(d.HomeSavings), minWaitSavingsUSD)
	}
}

func TestDecideSuperchargerWhenHomeCannotFinish(t *testing.T) {
	now := time.Date(2026, 1, 15, 7, 0, 0, 0, time.UTC)
	p := testProfile()
	p.ReadyBy = "07:30"
	q := &Quote{Site: "Everett, WA", AvgPerKWh: 0.47}
	d := Decide(Input{Profile: p, CurrentSOC: 20, Now: now, Quote: q})
	if d.Verdict != VerdictSupercharger {
		t.Fatalf("verdict = %s reason=%s, want supercharger", d.Verdict, d.Reason)
	}
	if d.ReasonKey != ReasonSuperchargerFaster {
		t.Fatalf("reason_key = %s, want %s", d.ReasonKey, ReasonSuperchargerFaster)
	}
	if d.SuperchargerSite == nil || *d.SuperchargerSite != "Everett, WA" {
		t.Fatalf("site = %v", d.SuperchargerSite)
	}
}

func TestDecideSkipDCWhenHomeNowCheaper(t *testing.T) {
	// Overnight off-peak: best window is now (or soon), Supercharger at
	// billed $0.47/kWh is a premium versus home TOU.
	now := time.Date(2026, 1, 15, 2, 0, 0, 0, time.UTC)
	q := &Quote{Site: "Everett, WA", AvgPerKWh: 0.47}
	d := Decide(Input{Profile: testProfile(), CurrentSOC: 50, Now: now, Quote: q})
	if d.Verdict != VerdictSkipDC {
		t.Fatalf("verdict = %s reason=%s now=%v sc=%v, want skip_dc",
			d.Verdict, d.Reason, ptrVal(d.HomeNowCost), ptrVal(d.SuperchargerCost))
	}
}

func TestDecideChargeHomeNowWithoutQuote(t *testing.T) {
	now := time.Date(2026, 1, 15, 2, 0, 0, 0, time.UTC)
	d := Decide(Input{Profile: testProfile(), CurrentSOC: 50, Now: now})
	if d.Verdict != VerdictChargeHomeNow {
		t.Fatalf("verdict = %s reason=%s, want charge_home_now", d.Verdict, d.Reason)
	}
}

func TestDecideSuperchargerCheaperThanHome(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	q := &Quote{Site: "Promo site", AvgPerKWh: 0.01}
	d := Decide(Input{Profile: testProfile(), CurrentSOC: 50, Now: now, Quote: q})
	if d.Verdict != VerdictSupercharger {
		t.Fatalf("verdict = %s reason=%s, want supercharger", d.Verdict, d.Reason)
	}
	if d.ReasonKey != ReasonSuperchargerCheaper {
		t.Fatalf("reason_key = %s, want %s", d.ReasonKey, ReasonSuperchargerCheaper)
	}
}

func ptrVal(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
