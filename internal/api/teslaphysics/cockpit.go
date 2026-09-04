package teslaphysics

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// BuildCockpit projects live Tesla physics fields.
func BuildCockpit(vehicleID int64, state signal.State, parkSamples []ParkSample, now time.Time) Cockpit {
	if parkSamples == nil {
		parkSamples = []ParkSample{liveParkSample(state, now)}
	}
	out := Cockpit{
		VehicleID:           vehicleID,
		Gear:                normalizeGear(fieldString(state, "Gear")),
		ChargeState:         normalizeChargeState(fieldString(state, "ChargeState")),
		DetailedChargeState: normalizeChargeState(fieldString(state, "DetailedChargeState")),
		ChargePortLatch:     fieldString(state, "ChargePortLatch"),
		ChargePortDoorOpen:  fieldBool(state, "ChargePortDoorOpen"),
		BatteryLevelPct:     fieldFloat(state, "BatteryLevel"),
		EnergyRemainingWh:   fieldFloat(state, "EnergyRemaining"),
		PackCurrentA:        fieldFloat(state, "PackCurrent"),
		PackVoltageV:        fieldFloat(state, "PackVoltage"),
		FSDDistanceM:        fieldFloat(state, "SelfDrivingMilesSinceReset"),
		DrivingDistanceM:    fieldFloat(state, "MilesSinceReset"),
		SpeedMps:            fieldFloat(state, "VehicleSpeed"),
		SentryMode:          fieldString(state, "SentryMode"),
		ValetMode:           fieldBool(state, "ValetModeEnabled"),
		ServiceMode:         fieldBool(state, "ServiceMode"),
		Park:                BuildParkTruth(parkSamples, now),
		Honesty:             cockpitHonesty,
	}
	return out
}
