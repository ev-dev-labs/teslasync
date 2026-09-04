package teslaphysics

import (
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const silentLabel = "counter silent"

func movingGear(gear string) bool {
	g := normalizeGear(gear)
	return g == enums.GearDrive || g == enums.GearReverse
}

func isMoving(sample MotionSample) bool {
	if !movingGear(sample.Gear) {
		return false
	}
	if sample.SpeedMps == nil {
		return false
	}
	return *sample.SpeedMps > movingSpeedMps
}

// BuildSilentReport finds trip-meter silence while the car is moving.
// Null FSD is unknown, never a zero and never a disengagement.
func BuildSilentReport(driveID, vehicleID int64, samples []MotionSample) SilentReport {
	out := SilentReport{
		DriveID:   driveID,
		VehicleID: vehicleID,
		Intervals: make([]SilentInterval, 0),
		Honesty:   silentHonesty,
	}
	ordered := append([]MotionSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})
	sawFSD := false
	var (
		openStart *MotionSample
		last      *MotionSample
	)
	closeOpen := func(end MotionSample) {
		if openStart == nil {
			return
		}
		interval := SilentInterval{
			StartedAt:    openStart.At.UTC(),
			EndedAt:      end.At.UTC(),
			DurationS:    durationSeconds(openStart.At, end.At),
			Gear:         normalizeGear(openStart.Gear),
			FSDDistanceM: openStart.FSDDistanceM,
			Label:        silentLabel,
		}
		if interval.DurationS > 0 {
			out.Intervals = append(out.Intervals, interval)
		}
		openStart = nil
	}
	for i := range ordered {
		sample := ordered[i]
		if sample.FSDDistanceM != nil {
			sawFSD = true
		}
		if last == nil {
			last = &ordered[i]
			continue
		}
		moving := isMoving(sample) && isMoving(*last)
		fsdPresent := sample.FSDDistanceM != nil && last.FSDDistanceM != nil
		silent := moving && fsdPresent && *sample.FSDDistanceM == *last.FSDDistanceM
		if silent {
			if openStart == nil {
				copied := *last
				openStart = &copied
			}
		} else {
			closeOpen(sample)
		}
		last = &ordered[i]
	}
	if openStart != nil && last != nil {
		closeOpen(*last)
	}
	out.Unknown = !sawFSD
	return out
}

func motionSamplesFromTimeline(rows []signal.TimelineRow) []MotionSample {
	out := make([]MotionSample, 0, len(rows))
	for _, row := range rows {
		out = append(out, MotionSample{
			At:           row.Timestamp.UTC(),
			Gear:         fieldString(row.Fields, "gear"),
			SpeedMps:     fieldFloat(row.Fields, "speed"),
			FSDDistanceM: fieldFloat(row.Fields, "fsd_distance_m"),
		})
	}
	return out
}
