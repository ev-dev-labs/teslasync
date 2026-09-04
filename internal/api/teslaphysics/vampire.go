package teslaphysics

import (
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	vampireKindCompletePlugged = "complete_plugged"
	vampireKindUnplugged       = "unplugged"
)

func vampireKindFor(chargeState string) string {
	switch chargeState {
	case enums.ChargeStateComplete:
		return vampireKindCompletePlugged
	case enums.ChargeStateDisconnected, "":
		return vampireKindUnplugged
	default:
		return ""
	}
}

// BuildVampireSplit splits parked drain into at-limit-plugged versus unplugged.
func BuildVampireSplit(vehicleID int64, samples []VampireSample) VampireSplit {
	out := VampireSplit{
		VehicleID:       vehicleID,
		CompletePlugged: make([]VampireWindow, 0),
		Unplugged:       make([]VampireWindow, 0),
		Honesty:         vampireHonesty,
	}
	ordered := append([]VampireSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})

	var (
		openKind   string
		openStart  VampireSample
		parkSince  *VampireSample
		confirmed  bool
		lastCharge string
		lastSOC    *float64
	)
	closeOpen := func(at VampireSample) {
		if openKind == "" {
			return
		}
		window := VampireWindow{
			Kind:          openKind,
			StartedAt:     openStart.At.UTC(),
			EndedAt:       at.At.UTC(),
			DurationS:     durationSeconds(openStart.At, at.At),
			StartSocPct:   openStart.BatteryPct,
			EndSocPct:     lastSOC,
			ParkConfirmed: confirmed,
		}
		if openStart.BatteryPct != nil && lastSOC != nil {
			drop := *openStart.BatteryPct - *lastSOC
			if drop > 0 {
				window.DrainPct = floatPtr(drop)
			}
		}
		if window.DurationS <= 0 {
			openKind = ""
			return
		}
		if openKind == vampireKindCompletePlugged {
			out.CompletePlugged = append(out.CompletePlugged, window)
		} else {
			out.Unplugged = append(out.Unplugged, window)
		}
		openKind = ""
	}

	for _, sample := range ordered {
		gear := normalizeGear(sample.Gear)
		if sample.ChargeState != "" {
			lastCharge = normalizeChargeState(sample.ChargeState)
		}
		if sample.BatteryPct != nil {
			lastSOC = sample.BatteryPct
		}
		if gear == enums.GearPark {
			if parkSince == nil {
				copied := sample
				parkSince = &copied
				confirmed = false
			}
			if !confirmed && !sample.At.Before(parkSince.At.Add(parkConfirmDuration)) {
				confirmed = true
			}
			kind := vampireKindFor(lastCharge)
			if kind == "" {
				closeOpen(sample)
				continue
			}
			if openKind == "" {
				openKind = kind
				openStart = sample
				openStart.BatteryPct = lastSOC
				continue
			}
			if openKind != kind {
				closeOpen(sample)
				openKind = kind
				openStart = sample
				openStart.BatteryPct = lastSOC
			}
			continue
		}
		if openKind != "" {
			closeOpen(sample)
		}
		parkSince = nil
		confirmed = false
	}
	if openKind != "" && len(ordered) > 0 {
		closeOpen(ordered[len(ordered)-1])
	}
	out.CompletePluggedPct = sumDrain(out.CompletePlugged)
	out.UnpluggedPct = sumDrain(out.Unplugged)
	return out
}

func sumDrain(windows []VampireWindow) *float64 {
	var total float64
	found := false
	for _, window := range windows {
		if window.DrainPct == nil {
			continue
		}
		found = true
		total += *window.DrainPct
	}
	if !found {
		return nil
	}
	return floatPtr(total)
}

func vampireSamplesFromTimeline(rows []signal.TimelineRow) []VampireSample {
	out := make([]VampireSample, 0, len(rows))
	for _, row := range rows {
		out = append(out, VampireSample{
			At:          row.Timestamp.UTC(),
			Gear:        fieldString(row.Fields, "gear"),
			ChargeState: fieldString(row.Fields, "detailed_charge_state", "charge_state"),
			BatteryPct:  fieldFloat(row.Fields, "battery_level"),
		})
	}
	return out
}
