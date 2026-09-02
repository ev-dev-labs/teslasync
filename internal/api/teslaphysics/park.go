package teslaphysics

import (
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// BuildParkTruth gates Sentry / overheat / preconditioning on confirmed Park.
func BuildParkTruth(samples []ParkSample, now time.Time) ParkTruth {
	out := ParkTruth{
		Rejected: make([]string, 0),
		Honesty:  parkHonesty,
	}
	ordered := append([]ParkSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})
	if len(ordered) == 0 {
		return out
	}

	var parkSince *time.Time
	latest := ordered[len(ordered)-1]
	out.Gear = normalizeGear(latest.Gear)
	out.SentryReported = latest.Sentry
	out.CabinOverheatReported = latest.CabinOverheat
	out.PreconditioningReported = latest.Preconditioning
	out.NeutralRolling = out.Gear == enums.GearNeutral

	for _, sample := range ordered {
		gear := normalizeGear(sample.Gear)
		if gear == enums.GearPark {
			if parkSince == nil {
				at := sample.At.UTC()
				parkSince = &at
			}
			continue
		}
		parkSince = nil
	}

	if out.Gear == enums.GearPark && parkSince != nil {
		if !now.Before(parkSince.Add(parkConfirmDuration)) &&
			!latest.At.Before(parkSince.Add(parkConfirmDuration)) {
			out.ConfirmedPark = true
			out.ParkConfirmedAt = parkSince
		}
	}

	count := func(reported bool, counted *bool, label string) {
		if !reported {
			return
		}
		if out.ConfirmedPark {
			*counted = true
			return
		}
		out.Rejected = append(out.Rejected, label+" not counted — not confirmed Park")
	}
	count(out.SentryReported, &out.SentryCounted, "Sentry")
	count(out.CabinOverheatReported, &out.CabinOverheatCounted, "Cabin overheat")
	count(out.PreconditioningReported, &out.PreconditioningCounted, "Preconditioning")
	if out.NeutralRolling {
		out.Rejected = append(out.Rejected, "Neutral is rolling, not parked")
	}
	return out
}

func parkSamplesFromTimeline(rows []signal.TimelineRow) []ParkSample {
	out := make([]ParkSample, 0, len(rows))
	for _, row := range rows {
		sentry := false
		if b := fieldBool(row.Fields, "sentry_mode"); b != nil {
			sentry = *b
		} else if s := fieldString(row.Fields, "sentry_mode"); s != "" && s != enums.SentryOff {
			sentry = true
		}
		hvac := fieldString(row.Fields, "hvac_power")
		overheat := fieldString(row.Fields, "cabin_overheat_mode")
		out = append(out, ParkSample{
			At:              row.Timestamp.UTC(),
			Gear:            fieldString(row.Fields, "gear"),
			Sentry:          sentry,
			CabinOverheat:   overheat != "" && overheat != enums.CabinOverheatOff,
			Preconditioning: hvac == enums.HvacPrecondition,
		})
	}
	return out
}

func liveParkSample(state signal.State, at time.Time) ParkSample {
	sentry := false
	if b := fieldBool(state, "SentryMode"); b != nil {
		sentry = *b
	} else if s := fieldString(state, "SentryMode"); s != "" && s != enums.SentryOff {
		sentry = true
	}
	overheat := fieldString(state, "CabinOverheatProtectionMode")
	hvac := fieldString(state, "HvacPower")
	return ParkSample{
		At:              at,
		Gear:            fieldString(state, "Gear"),
		Sentry:          sentry,
		CabinOverheat:   overheat != "" && overheat != enums.CabinOverheatOff,
		Preconditioning: hvac == enums.HvacPrecondition,
	}
}
