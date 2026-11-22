package smartreadinesssvc

import (
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

func stopSessionMatchesPlace(stop domain.ReviewedStop, row domain.SitePerformanceSession) bool {
	if row.StartLatitude == nil || row.StartLongitude == nil ||
		!finiteBetween(*row.StartLatitude, -90, 90) || !finiteBetween(*row.StartLongitude, -180, 180) ||
		(*row.StartLatitude == 0 && *row.StartLongitude == 0) {
		return false
	}
	return drivemodel.HaversineMeters(stop.Location.Latitude, stop.Location.Longitude,
		*row.StartLatitude, *row.StartLongitude) <= stop.RadiusM
}

func estimateStopHistory(
	stop domain.ReviewedStop, sessions []domain.SitePerformanceSession, now, arrival time.Time, fromPct, toPct, capacityWh float64,
) (domain.StopHistoryEstimate, bool) {
	zone := stopTimeZone(stop.TimeZone)
	if zone == nil {
		return domain.StopHistoryEstimate{}, false
	}
	localArrival := arrival.In(zone)
	historicalWaits := make(map[string]int64)
	from := now.Add(stopResultTTL - stopHistoryAge)
	for _, wait := range stop.Waits {
		if wait.ArrivedAt.Before(from) || wait.ArrivedAt.After(now) {
			continue
		}
		local := wait.ArrivedAt.In(zone)
		delta := local.Hour()*60 + local.Minute() - localArrival.Hour()*60 - localArrival.Minute()
		if local.Weekday() == localArrival.Weekday() && delta >= -120 && delta <= 120 {
			day := local.Format(time.DateOnly)
			historicalWaits[day] = max(historicalWaits[day], wait.WaitS)
		}
	}
	if len(historicalWaits) < minStopWaitSamples {
		return domain.StopHistoryEstimate{}, false
	}

	type connector struct{ charger, cable string }
	type history struct {
		days       map[string]bool
		minPowerW  float64
		previousAt time.Time
	}
	groups := make(map[connector]history)
	for _, session := range sessions {
		if session.StartedAt.Before(from) || session.StartSocPct > fromPct || session.EndSocPct < toPct {
			continue
		}
		meterW := elapsedSessionPowerW(session, now)
		if meterW <= 0 {
			continue
		}
		key := connector{charger: session.Charger, cable: session.Cable}
		evidence, ok := groups[key]
		if !ok {
			evidence = history{days: make(map[string]bool), minPowerW: meterW, previousAt: now}
		}
		day := session.StartedAt.In(zone).Format(time.DateOnly)
		if evidence.days[day] || session.EndedAt.After(evidence.previousAt) {
			continue
		}
		evidence.days[day] = true
		evidence.previousAt = session.StartedAt
		gainW := (session.EndSocPct - session.StartSocPct) / 100 * capacityWh / session.EndedAt.Sub(session.StartedAt).Hours()
		evidence.minPowerW = min(evidence.minPowerW, meterW, gainW)
		groups[key] = evidence
	}
	var result domain.StopHistoryEstimate
	for _, group := range groups {
		if len(group.days) < minStopChargeSamples {
			continue
		}
		if result.ChargeSampleCount > 0 {
			return domain.StopHistoryEstimate{}, false
		}
		result.ChargeSampleCount = len(group.days)
		result.ConservativePackPowerW = group.minPowerW / 1.25
	}
	if result.ChargeSampleCount == 0 {
		return domain.StopHistoryEstimate{}, false
	}
	waits := make([]int64, 0, len(historicalWaits))
	for _, wait := range historicalWaits {
		waits = append(waits, wait)
	}
	slices.Sort(waits)
	result.WaitSampleCount = len(waits)
	result.ExpectedWaitS = float64(waits[len(waits)/2]+waits[(len(waits)-1)/2]) / 2
	return result, true
}
