package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	backupReadingMaxAge  = 90 * time.Second
	backupReadingMaxSkew = 30 * time.Second
	backupContextMaxAge  = 2 * time.Hour
	backupMeterTolerance = 150
	backupMinimumDrawW   = 1000
)

func evaluateBackupChargingSample(
	reading domain.BackupSiteReading, values map[string]*signal.Value, now time.Time,
	atConfirmedCharger func(float64, float64) bool,
) *domain.BackupChargingSample {
	if reading.SiteID <= 0 || reading.ObservedAt.IsZero() || reading.ObservedAt.After(now) ||
		!now.Before(reading.ObservedAt.Add(backupReadingMaxAge)) || reading.Grid != domain.BackupGridIslanded ||
		!reading.BackupCapable || !finiteBetween(reading.GridPowerW, -backupMeterTolerance, backupMeterTolerance) ||
		!finiteBetween(reading.SolarPowerW, 0, 1_000_000) ||
		!finiteBetween(reading.BatteryPowerW, backupMinimumDrawW, 1_000_000) ||
		!finiteBetween(reading.SiteLoadW, backupMinimumDrawW, 1_000_000) ||
		math.Abs(reading.SiteLoadW-reading.BatteryPowerW-reading.SolarPowerW-reading.GridPowerW) > backupMeterTolerance {
		return nil
	}
	ev, powerAt, liveUntil, charging := backupChargingVehicle(values, now, atConfirmedCharger)
	if !charging || ev > reading.SiteLoadW || absDuration(powerAt.Sub(reading.ObservedAt)) > backupReadingMaxSkew {
		return nil
	}
	// Assume every other load is supplied by the battery first and allow
	// for meter error before attributing any discharge to this vehicle.
	minimum := reading.BatteryPowerW - (reading.SiteLoadW - ev) - backupMeterTolerance
	if minimum < backupMinimumDrawW || minimum < reading.BatteryPowerW/4 {
		return nil
	}
	expires := minTime(reading.ObservedAt.Add(backupReadingMaxAge), liveUntil)
	if !now.Before(expires) {
		return nil
	}
	return &domain.BackupChargingSample{
		ObservedAt: reading.ObservedAt.UTC(), ExpiresAt: expires.UTC(), VehiclePowerW: ev, VehiclePowerAt: powerAt.UTC(),
		MinimumBatteryToLoadW: minimum,
	}
}

func backupChargingVehicle(values map[string]*signal.Value, now time.Time, atConfirmedCharger func(float64, float64) bool) (
	powerW float64, powerAt, liveUntil time.Time, charging bool,
) {
	gear, state, latch := values["Gear"], values["DetailedChargeState"], values["ChargePortLatch"]
	if !boundedEarlyStopObservation(gear, now, backupContextMaxAge) || !boundedEarlyStopObservation(state, now, backupContextMaxAge) ||
		!boundedEarlyStopObservation(latch, now, backupContextMaxAge) ||
		gear.Raw != enums.GearPark {
		return 0, time.Time{}, time.Time{}, false
	}
	stateRaw, _ := state.Raw.(string)
	latchRaw, _ := latch.Raw.(string)
	chargeState, err := protomodel.ParseDetailedChargeStateValue(stateRaw)
	port, latchErr := protomodel.ParseChargePortLatchValue(latchRaw)
	if err != nil || chargeState != protomodel.DetailedChargeStateValue_DetailedChargeStateCharging ||
		latchErr != nil || port != protomodel.ChargePortLatchValue_ChargePortLatchEngaged {
		return 0, time.Time{}, time.Time{}, false
	}
	powerW, powerAt, powered := freshNumeric(values["ACChargingPower"], now, backupMinimumDrawW, 1_000_000)
	latitude, longitude := values["LocationLatitude"], values["LocationLongitude"]
	lat, latOK := earlyStopNumeric(latitude, now, backupContextMaxAge, -90, 90)
	lon, lonOK := earlyStopNumeric(longitude, now, backupContextMaxAge, -180, 180)
	if !powered || !latOK || !lonOK || (lat == 0 && lon == 0) || atConfirmedCharger == nil ||
		absDuration(latitude.Timestamp.Sub(longitude.Timestamp)) > maxLocationSkew {
		return 0, time.Time{}, time.Time{}, false
	}
	locationAt := minTime(latitude.Timestamp, longitude.Timestamp)
	if locationAt.Before(gear.Timestamp.Add(-2*time.Minute)) || !atConfirmedCharger(lat, lon) {
		return 0, time.Time{}, time.Time{}, false
	}
	contextAt := minTime(locationAt, minTime(gear.Timestamp, minTime(state.Timestamp, latch.Timestamp)))
	liveUntil = minTime(contextAt.Add(backupContextMaxAge), powerAt.Add(signal.LiveSignalFreshnessThreshold))
	return powerW, powerAt, liveUntil, now.Before(liveUntil)
}
