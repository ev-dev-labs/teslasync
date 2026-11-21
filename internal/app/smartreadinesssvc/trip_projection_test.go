package smartreadinesssvc

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestTripLegsProjectBothDirectionsAndSuppressResolvedShortfall(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 25,
		ReturnUseLowPct: 20, ReturnUseHighPct: 30,
	}
	setTripUseFromLegs(&plan)
	atSite := func(float64, float64) bool { return true }
	decision := Evaluate(plan, values, now, atSite)
	if decision.Reason != ReasonEligible || decision.TripProjection == nil ||
		decision.TripProjection.DestinationLowPct != 20 || decision.TripProjection.DestinationHighPct != 25 ||
		decision.ArrivalLowPct != 0 || decision.ArrivalHighPct != 5 {
		t.Fatalf("outbound and return decision = %+v", decision)
	}
	added := 20.0
	plan.TripLegs.DestinationChargePct = &added
	if got := Evaluate(plan, values, now, atSite); got.Reason != ReasonEnoughCharge {
		t.Fatalf("planned destination charge did not resolve the estimated shortfall: %+v", got)
	}
	estimate := EstimateLatestStart(plan, values, now, atSite)
	if estimate.TripProjection == nil || estimate.TripProjection.ReturnLowPct == nil ||
		*estimate.TripProjection.ReturnLowPct != 10 || estimate.TripProjection.ReturnHighPct == nil ||
		*estimate.TripProjection.ReturnHighPct != 25 || estimate.ObservedAt == nil || estimate.ExpiresAt == nil {
		t.Fatalf("conditional return projection = %+v", estimate)
	}
	values["BatteryLevel"].Timestamp = now.Add(-3 * time.Minute)
	if stale := EstimateLatestStart(plan, values, now, atSite); stale.TripProjection != nil {
		t.Fatalf("stale battery exposed a trip projection: %+v", stale)
	}
}

func TestTripLegsRequireReachingDestinationBeforePlannedCharging(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	added := 90.0
	plan.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 60, OutboundUseHighPct: 65,
		ReturnUseLowPct: 15, ReturnUseHighPct: 20, DestinationChargePct: &added,
	}
	setTripUseFromLegs(&plan)
	got := Evaluate(plan, values, now, func(float64, float64) bool { return true })
	if got.Reason != ReasonEligible || got.TripProjection == nil || got.TripProjection.DestinationHighPct != 0 ||
		got.TripProjection.DestinationReachability != "unreachable" ||
		got.TripProjection.ReturnReachability != "unknown" || got.TripProjection.ReturnHighPct != nil {
		t.Fatalf("destination charging hid an unreachable outbound leg: %+v", got)
	}
	plan.TripLegs.ReturnUseHighPct = 90
	setTripUseFromLegs(&plan)
	estimate := EstimateLatestStart(plan, values, now, nil)
	if estimate.Status != domain.LatestStartUnachievable {
		t.Fatalf("return leg exceeding full battery and reserve = %+v", estimate)
	}
}

func TestTripLegsOfferReviewWhenOptimisticReturnExceedsFullBattery(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	added := 100.0
	plan.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 25,
		ReturnUseLowPct: 90, ReturnUseHighPct: 95, DestinationChargePct: &added,
	}
	setTripUseFromLegs(&plan)
	for _, state := range []string{"Disconnected", "Charging"} {
		values["DetailedChargeState"].Raw = state
		got := Evaluate(plan, values, now, func(float64, float64) bool { return true })
		if got.Reason != ReasonEligible || got.Kind != domain.DecisionTripReview ||
			got.TripProjection == nil || got.TripProjection.ReturnReachability != "estimated_reachable" {
			t.Fatalf("%s: impossible reserve should offer a stop review: %+v", state, got)
		}
	}
}

func TestLatestStartRejectsInconsistentTripLegs(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 25,
		ReturnUseLowPct: 20, ReturnUseHighPct: 30,
	}
	got := EstimateLatestStart(plan, values, now, nil)
	if got.Status != domain.LatestStartUnavailable || got.TripProjection != nil {
		t.Fatalf("inconsistent leg totals exposed an estimate: %+v", got)
	}
}

func TestTripLegsDriveLatestStartAndRejectInvalidInput(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	added := 20.0
	plan.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 25,
		ReturnUseLowPct: 20, ReturnUseHighPct: 30, DestinationChargePct: &added,
	}
	plan.TripUseLowPct, plan.TripUseHighPct = 1, 2
	service := New(&stubRepository{}, &stubLive{}, &stubSites{}, WithClock(func() time.Time { return now }))
	saved, err := service.SavePlan(context.Background(), "subject-a", plan)
	if err != nil || saved.TripUseLowPct != 40 || saved.TripUseHighPct != 55 {
		t.Fatalf("normalized trip range = %+v, %v", saved, err)
	}
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
	estimate := EstimateLatestStart(*saved, values, now, func(float64, float64) bool { return true })
	if estimate.Status != domain.LatestStartEstimate || estimate.RequiredLowPct != 0 ||
		estimate.RequiredHighPct != 10 {
		t.Fatalf("destination-aware latest start = %+v", estimate)
	}
	invalid := *saved
	invalid.TripLegs = &domain.TripLegs{
		OutboundUseLowPct: 20, OutboundUseHighPct: 10,
		ReturnUseLowPct: 10, ReturnUseHighPct: 20,
	}
	if _, err := service.SavePlan(context.Background(), "subject-a", invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("inverted leg range error = %v", err)
	}
	invalid.TripLegs.OutboundUseHighPct = math.NaN()
	if _, err := service.SavePlan(context.Background(), "subject-a", invalid); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("nonfinite leg range error = %v", err)
	}
}
