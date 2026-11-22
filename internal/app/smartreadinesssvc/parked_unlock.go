package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	parkedUnlockGrace = 5 * time.Minute
	parkedUnlockAge   = 30 * time.Minute
)

var parkedUnlockFields = [...]string{"Gear", "Locked", "LocationLatitude", "LocationLongitude"}

func parkedUnlockRisk(values map[string]*signal.Value, rows []signal.TimelineRow, parkAt, after, now time.Time,
	contains func(float64, float64) bool,
) (*domain.ParkedUnlockRisk, domain.ParkedUnlockReason) {
	first := maxClosureTime(parkAt, after)
	if contains == nil || parkAt.IsZero() || first.After(now) || now.Sub(parkAt) >= parkedUnlockAge {
		return nil, domain.UnlockUnknown
	}
	gear, lock := values["Gear"], values["Locked"]
	if !freshObservation(gear, now) || gear.Raw != enums.GearPark || !freshObservation(lock, now) {
		return nil, domain.UnlockUnknown
	}
	locked, ok := lock.Raw.(bool)
	if !ok {
		return nil, domain.UnlockUnknown
	}
	if locked {
		return nil, domain.UnlockLocked
	}
	lat, lon, locationAt, known := freshLocation(values, now)
	if !known || (lat == 0 && lon == 0) ||
		!values["LocationLatitude"].Timestamp.Equal(values["LocationLongitude"].Timestamp) {
		return nil, domain.UnlockUnknown
	}
	if !contains(lat, lon) {
		return nil, domain.UnlockOutsidePlace
	}
	lastLive := minTime(minTime(gear.Timestamp, lock.Timestamp), locationAt)
	if lastLive.Before(first) {
		return nil, domain.UnlockUnknown
	}
	var since, last time.Time
	var lastSeen time.Time
	for _, row := range rows {
		if row.Timestamp.Before(first) || row.Timestamp.After(now) {
			continue
		}
		if row.Timestamp.Before(lastSeen) ||
			(row.ObservedAt["Gear"].Equal(row.Timestamp) && row.Fields["Gear"] != enums.GearPark) {
			return nil, domain.UnlockUnknown
		}
		lastSeen = row.Timestamp
		complete, compatible := unlockObservation(row, now, contains)
		switch {
		case !compatible:
			since, last = time.Time{}, time.Time{}
		case !complete:
			continue
		case row.Timestamp.After(lastLive):
			return nil, domain.UnlockUnknown
		default:
			if last.IsZero() || row.Timestamp.Sub(last) >= signal.LiveSignalFreshnessThreshold {
				since = row.Timestamp
			}
			last = row.Timestamp
		}
	}
	expires := minTime(lastLive.Add(signal.LiveSignalFreshnessThreshold), parkAt.Add(parkedUnlockAge))
	if since.IsZero() || last.Sub(since) < parkedUnlockGrace || !recentClosureEvidence(last, lastLive) || !expires.After(now) {
		return nil, domain.UnlockGrace
	}
	return &domain.ParkedUnlockRisk{ParkedAt: parkAt, UnlockedSince: since, LastObserved: last,
		ActionUntil: expires}, domain.UnlockAtRisk
}

func unlockObservation(row signal.TimelineRow, now time.Time, contains func(float64, float64) bool) (complete, compatible bool) {
	if row.ReceivedAt == nil || row.ReceivedAt.After(now) ||
		absDuration(row.ReceivedAt.Sub(row.Timestamp)) > signal.LiveSignalFreshnessThreshold {
		return false, false
	}
	gear := row.ObservedAt["Gear"].Equal(row.Timestamp)
	lock := row.ObservedAt["Locked"].Equal(row.Timestamp)
	latitude := row.ObservedAt["LocationLatitude"].Equal(row.Timestamp)
	longitude := row.ObservedAt["LocationLongitude"].Equal(row.Timestamp)
	if (gear && row.Fields["Gear"] != enums.GearPark) || (lock && row.Fields["Locked"] != false) || latitude != longitude {
		return false, false
	}
	if !latitude {
		return false, true
	}
	lat, latOK := signal.Float64(row.Fields["LocationLatitude"])
	lon, lonOK := signal.Float64(row.Fields["LocationLongitude"])
	validLocation := latOK && lonOK && (lat != 0 || lon != 0) && finiteBetween(lat, -90, 90) &&
		finiteBetween(lon, -180, 180) && contains(lat, lon)
	return gear && lock && validLocation, validLocation
}
