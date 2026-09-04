package teslaphysics

import (
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const heartbeatLabel = "FSD trip meter — not an engagement flag"

// BuildHeartbeat labels live SelfDrivingMilesSinceReset as a trip meter.
// LastTickAt is the last observed increase, never "now" merely because a value exists.
func BuildHeartbeat(vehicleID int64, state signal.State, samples []MotionSample, now time.Time) Heartbeat {
	out := Heartbeat{
		VehicleID:       vehicleID,
		Label:           heartbeatLabel,
		Honesty:         heartbeatHonesty,
		Gear:            normalizeGear(fieldString(state, "Gear")),
		SpeedMps:        fieldFloat(state, "VehicleSpeed"),
		ValetMode:       fieldBool(state, "ValetModeEnabled"),
		ServiceMode:     fieldBool(state, "ServiceMode"),
		FirmwareVersion: fieldString(state, "Version"),
	}
	out.FSDDistanceM = fieldFloat(state, "SelfDrivingMilesSinceReset")
	out.DrivingDistanceM = fieldFloat(state, "MilesSinceReset")
	out.LastTickAt = lastFSDTickAt(append(samples, liveMotionSample(state, now)))
	return out
}

func lastFSDTickAt(samples []MotionSample) *time.Time {
	ordered := append([]MotionSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})
	var prev *float64
	var tick *time.Time
	for _, sample := range ordered {
		if sample.FSDDistanceM == nil {
			continue
		}
		if prev != nil && *sample.FSDDistanceM > *prev+1e-6 {
			at := sample.At.UTC()
			tick = &at
		}
		v := *sample.FSDDistanceM
		prev = &v
	}
	return tick
}

func liveMotionSample(state signal.State, at time.Time) MotionSample {
	return MotionSample{
		At:           at.UTC(),
		Gear:         fieldString(state, "Gear"),
		SpeedMps:     fieldFloat(state, "VehicleSpeed"),
		FSDDistanceM: fieldFloat(state, "SelfDrivingMilesSinceReset"),
	}
}
