package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	solarSampleMaxAge    = 90 * time.Second
	solarSampleMaxGap    = 2 * time.Minute
	solarSampleMinSpan   = 3 * time.Minute
	solarSampleWindow    = 8 * time.Minute
	solarReserveMaxAge   = 15 * time.Minute
	solarMinimumExportW  = 1400
	solarBackupMarginPct = 5
)

// EvaluateSolarSurplus uses a bounded chronological series from the explicitly
// linked energy site, never a forecast or a single momentary export reading.
func EvaluateSolarSurplus(
	reserve domain.SolarBackupReserve, readings []domain.SolarSurplusObservation, values map[string]*signal.Value,
	now time.Time, atLinkedCharger func(float64, float64) bool,
) *domain.SolarSurplusDecision {
	if reserve.SiteID <= 0 || !finiteBetween(reserve.Percent, 0, 100) || reserve.ObservedAt.After(now) ||
		!now.Before(reserve.ObservedAt.Add(solarReserveMaxAge)) || len(readings) < 3 {
		return nil
	}
	first, latest := readings[0], readings[len(readings)-1]
	if first.ObservedAt.Before(now.Add(-solarSampleWindow)) || latest.ObservedAt.After(now) ||
		!now.Before(latest.ObservedAt.Add(solarSampleMaxAge)) || latest.ObservedAt.Sub(first.ObservedAt) < solarSampleMinSpan {
		return nil
	}
	minimumExport := math.Inf(1)
	var previous time.Time
	for _, sample := range readings {
		if !previous.IsZero() && (!sample.ObservedAt.After(previous) || sample.ObservedAt.Sub(previous) > solarSampleMaxGap) {
			return nil
		}
		previous = sample.ObservedAt
		if sample.SiteID != reserve.SiteID || !sample.GridConnected || sample.StormMode ||
			!finiteBetween(sample.BatteryPct, reserve.Percent+solarBackupMarginPct, 100) ||
			!finiteBetween(sample.BatteryPowerW, -1_000_000, 100) ||
			!finiteBetween(sample.SolarPowerW, 0, 1_000_000) ||
			!finiteBetween(sample.GridPowerW, -1_000_000, 0) {
			return nil
		}
		// Net export can include battery discharge. Do not count it as solar.
		solarExport := math.Min(sample.SolarPowerW, -sample.GridPowerW-math.Max(sample.BatteryPowerW, 0))
		if solarExport < solarMinimumExportW {
			return nil
		}
		minimumExport = math.Min(minimumExport, solarExport)
	}

	battery, limit, observedAt, eligible := solarChargingVehicle(values, now, atLinkedCharger)
	if !eligible {
		return nil
	}
	expiresAt := minTime(observedAt.Add(signal.LiveSignalFreshnessThreshold), latest.ObservedAt.Add(solarSampleMaxAge))
	expiresAt = minTime(expiresAt, reserve.ObservedAt.Add(solarReserveMaxAge))
	if !now.Before(expiresAt) {
		return nil
	}
	return &domain.SolarSurplusDecision{
		SiteID: reserve.SiteID, MinimumExportW: minimumExport, BatteryPct: battery, ChargeLimitPct: limit,
		BackupPct: latest.BatteryPct, ReservePct: reserve.Percent, SampleCount: len(readings),
		SampleStart: first.ObservedAt.UTC(), ObservedAt: minTime(observedAt, latest.ObservedAt).UTC(), ExpiresAt: expiresAt.UTC(),
	}
}

func solarChargingVehicle(values map[string]*signal.Value, now time.Time, atLinkedCharger func(float64, float64) bool) (
	battery, limit float64, observedAt time.Time, eligible bool,
) {
	for _, field := range []string{"BatteryLevel", "ChargeLimitSoc", "Gear", "DetailedChargeState", "ChargePortLatch"} {
		value := values[field]
		if !freshObservation(value, now) {
			return 0, 0, time.Time{}, false
		}
		if observedAt.IsZero() || value.Timestamp.Before(observedAt) {
			observedAt = value.Timestamp
		}
	}
	battery, batteryOK := signal.Float64(values["BatteryLevel"].Raw)
	limit, limitOK := signal.Float64(values["ChargeLimitSoc"].Raw)
	if !batteryOK || !limitOK || !finiteBetween(limit, 0, 100) || !finiteBetween(battery, 0, limit-3) ||
		values["Gear"].Raw != enums.GearPark || values["DetailedChargeState"].Raw != "Stopped" ||
		values["ChargePortLatch"].Raw != "Engaged" {
		return 0, 0, time.Time{}, false
	}
	latitude, longitude, locationAt, located := freshLocation(values, now)
	if !located || (latitude == 0 && longitude == 0) || atLinkedCharger == nil || !atLinkedCharger(latitude, longitude) {
		return 0, 0, time.Time{}, false
	}
	return battery, limit, minTime(observedAt, locationAt), true
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
