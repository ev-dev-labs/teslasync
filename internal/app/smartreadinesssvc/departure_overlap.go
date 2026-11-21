package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func validDepartureWindow(window *domain.DepartureWindow, departure time.Time) bool {
	const limit = 7 * 24 * time.Hour
	return window == nil || (!window.StartsAt.Before(departure.Add(-limit)) &&
		!window.EndsAt.After(departure.Add(limit)) && window.StartsAt.Before(window.EndsAt))
}

func evaluateDepartureWindow(plan Plan, values map[string]*signal.Value, now time.Time) Decision {
	if reason := readinessWindowReason(plan, now); reason != "" {
		return Decision{Reason: reason}
	}
	overlap, observedAt, ok := departureOverlap(plan, values, now)
	expiresAt := minTime(observedAt.Add(signal.LiveSignalFreshnessThreshold), plan.DepartureAt.Add(-minimumRemedyTime))
	if !ok || !now.Before(expiresAt) {
		return Decision{Reason: ReasonUnknownState}
	}
	return Decision{Reason: ReasonEligible, Kind: domain.DecisionDepartureOverlap,
		DepartureOverlap: &overlap, ObservedAt: observedAt.UTC(), ExpiresAt: expiresAt.UTC()}
}

func departureOverlap(plan Plan, values map[string]*signal.Value, now time.Time) (domain.DepartureOverlap, time.Time, bool) {
	gear := values["Gear"]
	if !freshObservation(gear, now) || gear.Raw != enums.GearPark {
		return domain.DepartureOverlap{}, time.Time{}, false
	}
	for _, entry := range [...]struct {
		kind   domain.OverlapKind
		window *domain.DepartureWindow
	}{
		{domain.OverlapService, plan.ServiceAppointment},
		{domain.OverlapSoftware, plan.SoftwareInstall},
	} {
		if w := entry.window; w != nil && validDepartureWindow(w, plan.DepartureAt) &&
			!plan.DepartureAt.Before(w.StartsAt) && plan.DepartureAt.Before(w.EndsAt) {
			return domain.DepartureOverlap{
				Kind: entry.kind, StartsAt: w.StartsAt.UTC(), EndsAt: w.EndsAt.UTC(),
			}, gear.Timestamp, true
		}
	}
	return domain.DepartureOverlap{}, time.Time{}, false
}
