package teslaphysics

import (
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func chargeStateOf(sample ChargeSample) string {
	if s := normalizeChargeState(sample.DetailedChargeState); s != "" {
		return s
	}
	return normalizeChargeState(sample.ChargeState)
}

func isDCCharge(samples []ChargeSample, sessionChargerType string) (bool, string) {
	if t := strings.TrimSpace(sessionChargerType); t != "" &&
		!strings.EqualFold(t, "unknown") &&
		!strings.EqualFold(t, "<invalid>") &&
		!strings.EqualFold(t, "none") &&
		!strings.EqualFold(t, "ac") {
		return true, t
	}
	for _, sample := range samples {
		if sample.FastChargerPresent != nil && *sample.FastChargerPresent {
			if sample.FastChargerType != "" {
				return true, sample.FastChargerType
			}
			return true, "DC"
		}
		if t := strings.TrimSpace(sample.FastChargerType); t != "" &&
			!strings.EqualFold(t, "unknown") &&
			!strings.EqualFold(t, "<invalid>") &&
			!strings.EqualFold(t, "none") {
			return true, t
		}
	}
	return false, sessionChargerType
}

func scheduledModeActive(mode string) bool {
	m := strings.ToLower(strings.TrimSpace(mode))
	if m == "" || m == "off" || m == "scheduledchargingmodeoff" {
		return false
	}
	return strings.Contains(m, "start") ||
		strings.Contains(m, "depart") ||
		m == "on" ||
		strings.Contains(m, "scheduled")
}

// BuildChargePhysics folds charge-state samples into a Tesla charge story.
func BuildChargePhysics(
	sessionID, vehicleID int64,
	startedAt time.Time,
	endedAt *time.Time,
	chargerType string,
	samples []ChargeSample,
	now time.Time,
) ChargePhysics {
	end := now.UTC()
	if endedAt != nil && !endedAt.IsZero() {
		end = endedAt.UTC()
	}
	start := startedAt.UTC()
	ordered := append([]ChargeSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})

	story := foldChargePhases(start, end, ordered)
	physics := ChargePhysics{
		SessionID: sessionID,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   endedAt,
		Story:     story,
		Etiquette: SuperchargerEtiquette{Honesty: etiquetteHonesty},
		Schedule:  ScheduleTruth{Honesty: scheduleHonesty, Unknown: true},
		Honesty:   chargeHonesty,
	}
	physics.AtLimitStillPluggedS = atLimitStillPlugged(story)
	physics.Etiquette = buildEtiquette(story, ordered, chargerType)
	physics.Schedule = buildScheduleTruth(story, ordered)
	return physics
}

func foldChargePhases(start, end time.Time, samples []ChargeSample) []ChargePhase {
	phases := make([]ChargePhase, 0)
	var current string
	phaseStart := start
	for _, sample := range samples {
		at := sample.At.UTC()
		if at.Before(start) {
			if s := chargeStateOf(sample); s != "" {
				current = s
				phaseStart = start
			}
			continue
		}
		if at.After(end) {
			break
		}
		state := chargeStateOf(sample)
		if state == "" {
			continue
		}
		if current == "" {
			current = state
			phaseStart = start
			if at.After(start) {
				phaseStart = at
			}
			continue
		}
		if state == current {
			continue
		}
		phases = append(phases, closePhase(current, phaseStart, at))
		current = state
		phaseStart = at
	}
	if current != "" {
		closed := closePhase(current, phaseStart, end)
		if end.After(phaseStart) {
			phases = append(phases, closed)
		} else if current == enums.ChargeStateDisconnected {
			closed.DurationS = 0
			closed.EndedAt = &end
			phases = append(phases, closed)
		}
	}
	if len(phases) == 0 {
		return []ChargePhase{}
	}
	return phases
}

func closePhase(state string, start, end time.Time) ChargePhase {
	ended := end.UTC()
	phase := ChargePhase{
		State:     state,
		StartedAt: start.UTC(),
		EndedAt:   &ended,
		DurationS: durationSeconds(start, end),
		AtLimit:   state == enums.ChargeStateComplete,
	}
	return phase
}

func atLimitStillPlugged(story []ChargePhase) *float64 {
	var total float64
	found := false
	for _, phase := range story {
		if phase.State != enums.ChargeStateComplete {
			continue
		}
		found = true
		total += phase.DurationS
	}
	if !found {
		return nil
	}
	return floatPtr(total)
}

func buildEtiquette(story []ChargePhase, samples []ChargeSample, chargerType string) SuperchargerEtiquette {
	out := SuperchargerEtiquette{Honesty: etiquetteHonesty}
	dc, label := isDCCharge(samples, chargerType)
	out.ChargerType = label
	if !dc {
		return out
	}
	out.Applicable = true
	var completeAt *time.Time
	for _, phase := range story {
		if phase.State == enums.ChargeStateComplete && completeAt == nil {
			t := phase.StartedAt
			completeAt = &t
		}
		if completeAt != nil && phase.State == enums.ChargeStateDisconnected {
			unplug := phase.StartedAt
			out.CompleteAt = completeAt
			out.UnplugAt = &unplug
			out.DwellS = floatPtr(durationSeconds(*completeAt, unplug))
			return out
		}
	}
	if completeAt != nil {
		out.CompleteAt = completeAt
	}
	return out
}

func buildScheduleTruth(story []ChargePhase, samples []ChargeSample) ScheduleTruth {
	out := ScheduleTruth{Honesty: scheduleHonesty, Unknown: true}
	var mode string
	var scheduledStart *time.Time
	for _, sample := range samples {
		if sample.ScheduledMode != "" {
			mode = sample.ScheduledMode
		}
		if sample.ScheduledStart != nil {
			scheduledStart = sample.ScheduledStart
		}
	}
	if mode != "" {
		out.ScheduledMode = stringPtr(mode)
	}
	out.ScheduledStartAt = scheduledStart
	if !scheduledModeActive(mode) {
		return out
	}

	var stoppedAt *time.Time
	var resumedAt *time.Time
	for _, phase := range story {
		if phase.State == enums.ChargeStateStopped && stoppedAt == nil {
			t := phase.StartedAt
			stoppedAt = &t
		}
		if stoppedAt != nil && phase.State == enums.ChargeStateCharging && resumedAt == nil {
			t := phase.StartedAt
			resumedAt = &t
		}
	}
	out.StoppedAt = stoppedAt
	out.ChargingResumedAt = resumedAt
	if stoppedAt == nil || resumedAt == nil {
		return out
	}
	out.Unknown = false
	if scheduledStart == nil {
		out.Unknown = true
		return out
	}
	waited := !resumedAt.Before(*scheduledStart)
	anyway := resumedAt.Before(*scheduledStart)
	out.WaitedForSchedule = &waited
	out.ChargedAnyway = &anyway
	return out
}

func chargeSamplesFromTimeline(rows []signal.TimelineRow) []ChargeSample {
	out := make([]ChargeSample, 0, len(rows))
	for _, row := range rows {
		sample := ChargeSample{
			At:                  row.Timestamp.UTC(),
			DetailedChargeState: fieldString(row.Fields, "detailed_charge_state"),
			ChargeState:         fieldString(row.Fields, "charge_state"),
			FastChargerPresent:  fieldBool(row.Fields, "fast_charger_present"),
			FastChargerType:     fieldString(row.Fields, "fast_charger_type"),
			ScheduledMode:       fieldString(row.Fields, "scheduled_charging_mode"),
			BatteryPct:          fieldFloat(row.Fields, "battery_level"),
		}
		if start := parseScheduledStart(row.Fields["scheduled_charging_start"], row.Timestamp); start != nil {
			sample.ScheduledStart = start
		}
		out = append(out, sample)
	}
	return out
}
