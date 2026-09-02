package teslaphysics

import (
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// BuildExclusiveReport derives every TeslaSync-only physics view from one frame set.
func BuildExclusiveReport(
	vehicleID int64,
	frames []PhysicsFrame,
	now time.Time,
	mqttConnected *bool,
	drives, charges []SessionBoundary,
	hmacKey []byte,
) ExclusiveReport {
	now = now.UTC()
	ordered := sortFrames(frames)
	from, to := windowOf(ordered, now)
	clocks := BuildThreeClocks(vehicleID, ordered, now)
	tape := BuildLifeTape(vehicleID, ordered, now)
	unknown := BuildUnknownOS(vehicleID, ordered, from, to)
	epochs := BuildFirmwareEpochs(vehicleID, ordered)
	dict := BuildOwnerDictionary(vehicleID, ordered)
	certFrom := now.Add(-maxExclusiveLookback)
	if !from.IsZero() && from.After(certFrom) {
		certFrom = from
	}
	cert := BuildSessionCertificate(vehicleID, now, certFrom, to, drives, charges, hmacKey)
	return ExclusiveReport{
		VehicleID:       vehicleID,
		Clocks:          clocks,
		LifeTape:        tape,
		Contradictions:  BuildContradictionCourt(vehicleID, ordered),
		Meters:          BuildMeterGenealogy(vehicleID, ordered),
		UnknownOS:       unknown,
		CarKeptLiving:   BuildCarKeptLiving(vehicleID, lastFrameTime(ordered), mqttConnected, now),
		Logbook:         BuildTeslaLogbook(vehicleID, drives, charges, ordered),
		FirmwareEpochs:  epochs,
		ChargePortCourt: BuildChargePortCourt(vehicleID, ordered),
		BlackBox:        BuildBlackBox(vehicleID, ordered, tape, now),
		Dictionary:      dict,
		Vault:           BuildPhysicsVault(vehicleID, cert, unknown.UnknownHours, epochs, ordered),
		Modes:           BuildModeLaws(vehicleID, lastFrame(ordered)),
		NervousSystem:   BuildNervousSystem(vehicleID, ordered, now),
		Range:           BuildRangeDisagreement(vehicleID, lastFrame(ordered)),
	}
}

func BuildThreeClocks(vehicleID int64, frames []PhysicsFrame, now time.Time) ThreeClocks {
	out := ThreeClocks{VehicleID: vehicleID, Samples: []ClockReading{}, Honesty: clocksHonesty}
	if len(frames) == 0 {
		out.Latest = &ClockReading{DisplayTime: now.UTC(), Unknown: true}
		return out
	}
	var prev time.Time
	for _, frame := range frames {
		reading := ClockReading{
			EventTime:   frame.At.UTC(),
			DisplayTime: now.UTC(),
			Unknown:     true, // ingest time is not on TimelineRow
		}
		if !prev.IsZero() && frame.At.After(prev) {
			reading.GapS = floatPtr(durationSeconds(prev, frame.At))
		}
		out.Samples = append(out.Samples, reading)
		prev = frame.At
	}
	if len(out.Samples) > 12 {
		out.Samples = out.Samples[len(out.Samples)-12:]
	}
	latest := out.Samples[len(out.Samples)-1]
	if now.After(latest.EventTime) {
		latest.GapS = floatPtr(durationSeconds(latest.EventTime, now))
	}
	out.Latest = &latest
	return out
}

func BuildLifeTape(vehicleID int64, frames []PhysicsFrame, now time.Time) LifeTape {
	out := LifeTape{VehicleID: vehicleID, Segments: []LifeSegment{}, Honesty: lifeTapeHonesty}
	if len(frames) == 0 {
		out.From = now.UTC()
		out.To = now.UTC()
		return out
	}
	out.From = frames[0].At.UTC()
	out.To = now.UTC()
	var parkSince *time.Time
	var current LifeSegment
	flush := func(end time.Time) {
		if current.State == "" {
			return
		}
		current.EndedAt = end.UTC()
		current.DurationS = durationSeconds(current.StartedAt, current.EndedAt)
		out.Segments = append(out.Segments, current)
	}
	for i, frame := range frames {
		at := frame.At.UTC()
		gear := normalizeGear(frame.Gear)
		if gear == enums.GearPark {
			if parkSince == nil {
				copied := at
				parkSince = &copied
			}
		} else {
			parkSince = nil
		}
		confirmed := gear == enums.GearPark && parkSince != nil && !at.Before(parkSince.Add(parkConfirmDuration))
		state := classifyLife(frame, confirmed)
		if i > 0 {
			prev := frames[i-1].At.UTC()
			if at.Sub(prev) > unknownGap {
				flush(prev)
				out.Segments = append(out.Segments, LifeSegment{
					State:     "unknown",
					StartedAt: prev,
					EndedAt:   at,
					DurationS: durationSeconds(prev, at),
				})
				current = LifeSegment{}
			}
		}
		if current.State == "" {
			current = LifeSegment{State: state, StartedAt: at}
			continue
		}
		if state != current.State {
			flush(at)
			current = LifeSegment{State: state, StartedAt: at}
		}
	}
	flush(now.UTC())
	return out
}

func classifyLife(frame PhysicsFrame, parkConfirmed bool) string {
	gear := normalizeGear(frame.Gear)
	charge := normalizeChargeState(frame.ChargeState)
	if gear == "" && charge == "" && frame.SpeedMps == nil {
		return "unknown"
	}
	switch charge {
	case enums.ChargeStateCharging:
		return "charging"
	case enums.ChargeStateComplete:
		return "complete_still_plugged"
	case enums.ChargeStateStarting, enums.ChargeStateStopped, enums.ChargeStateNoPower:
		return "plugged_not_charging"
	}
	switch gear {
	case enums.GearNeutral:
		return "neutral_rolling"
	case enums.GearDrive:
		return "drive"
	case enums.GearReverse:
		return "reverse"
	case enums.GearPark:
		if parkConfirmed {
			return "confirmed_park"
		}
		return "park_unconfirmed"
	}
	if charge == enums.ChargeStateDisconnected {
		return "unplugged"
	}
	return "unknown"
}

func BuildContradictionCourt(vehicleID int64, frames []PhysicsFrame) ContradictionCourt {
	out := ContradictionCourt{VehicleID: vehicleID, Findings: []Contradiction{}, Honesty: contradictionHonesty}
	for _, frame := range frames {
		gear := normalizeGear(frame.Gear)
		charge := normalizeChargeState(frame.ChargeState)
		speed := 0.0
		if frame.SpeedMps != nil {
			speed = *frame.SpeedMps
		}
		if gear == enums.GearPark && speed > movingSpeedMps {
			out.Findings = append(out.Findings, Contradiction{
				At:     frame.At.UTC(),
				Kind:   "park_with_speed",
				Detail: "Gear=P with speed above walking pace",
			})
		}
		if charge == enums.ChargeStateDisconnected && latchEngaged(frame.Latch) {
			out.Findings = append(out.Findings, Contradiction{
				At:     frame.At.UTC(),
				Kind:   "unplugged_latched",
				Detail: "ChargeState=Disconnected while charge-port latch is engaged",
			})
		}
		if charge == enums.ChargeStateDisconnected && packDrawing(frame.PackCurrentA) {
			out.Findings = append(out.Findings, Contradiction{
				At:     frame.At.UTC(),
				Kind:   "unplugged_with_current",
				Detail: "ChargeState=Disconnected while pack current is not quiet",
			})
		}
		if charge == enums.ChargeStateComplete && latchEngaged(frame.Latch) {
			// Expected Tesla language: Complete is at limit, still plugged.
			continue
		}
	}
	return out
}

func BuildMeterGenealogy(vehicleID int64, frames []PhysicsFrame) MeterGenealogy {
	out := MeterGenealogy{VehicleID: vehicleID, Resets: []MeterReset{}, Honesty: meterHonesty}
	if latest := lastFrame(frames); latest != nil {
		out.OdometerM = latest.OdometerM
		out.DrivingDistanceM = latest.DrivingDistanceM
		out.FSDDistanceM = latest.FSDDistanceM
	}
	var prevFSD, prevDrive, prevOdo *float64
	var prevAt time.Time
	var prevFirmware string
	var prevValet, prevService *bool
	for _, frame := range frames {
		out.Resets = appendReset(out.Resets, "fsd", prevFSD, frame.FSDDistanceM, frame, prevAt, prevFirmware, prevValet, prevService)
		out.Resets = appendReset(out.Resets, "driving", prevDrive, frame.DrivingDistanceM, frame, prevAt, prevFirmware, prevValet, prevService)
		out.Resets = appendReset(out.Resets, "odometer", prevOdo, frame.OdometerM, frame, prevAt, prevFirmware, prevValet, prevService)
		if frame.FSDDistanceM != nil {
			prevFSD = frame.FSDDistanceM
		}
		if frame.DrivingDistanceM != nil {
			prevDrive = frame.DrivingDistanceM
		}
		if frame.OdometerM != nil {
			prevOdo = frame.OdometerM
		}
		prevAt = frame.At
		if frame.Firmware != "" {
			prevFirmware = frame.Firmware
		}
		if frame.Valet != nil {
			prevValet = frame.Valet
		}
		if frame.Service != nil {
			prevService = frame.Service
		}
	}
	return out
}

func appendReset(dst []MeterReset, meter string, prev, curr *float64, frame PhysicsFrame, prevAt time.Time, prevFirmware string, prevValet, prevService *bool) []MeterReset {
	if prev == nil || curr == nil {
		return dst
	}
	if *curr >= *prev-1 {
		return dst
	}
	cause := "owner_or_unknown"
	unknown := true
	if prevService != nil && *prevService || frame.Service != nil && *frame.Service {
		cause = "service"
		unknown = false
	} else if prevValet != nil && *prevValet || frame.Valet != nil && *frame.Valet {
		cause = "valet"
		unknown = false
	} else if frame.Firmware != "" && prevFirmware != "" && frame.Firmware != prevFirmware {
		cause = "firmware"
		unknown = false
	} else if !prevAt.IsZero() && frame.At.Sub(prevAt) > unknownGap {
		cause = "gap"
		unknown = true
	}
	return append(dst, MeterReset{
		At:      frame.At.UTC(),
		Meter:   meter,
		FromM:   prev,
		ToM:     curr,
		Cause:   cause,
		Unknown: unknown,
	})
}

func BuildUnknownOS(vehicleID int64, frames []PhysicsFrame, from, to time.Time) UnknownOS {
	out := UnknownOS{VehicleID: vehicleID, Budgets: []UnknownBudget{}, Honesty: unknownOSHonesty}
	if to.Before(from) {
		to = from
	}
	window := to.Sub(from)
	out.WindowHours = window.Hours()
	if len(frames) == 0 {
		out.UnknownHours = floatPtr(out.WindowHours)
		out.Budgets = []UnknownBudget{
			{Kind: "park", Hours: out.WindowHours, Unknown: true},
			{Kind: "charge", Hours: out.WindowHours, Unknown: true},
			{Kind: "fsd", Hours: out.WindowHours, Unknown: true},
			{Kind: "motion", Hours: out.WindowHours, Unknown: true},
		}
		return out
	}
	var covered time.Duration
	var parkKnown, chargeKnown, fsdKnown, motionKnown time.Duration
	for i, frame := range frames {
		end := to
		if i+1 < len(frames) {
			end = frames[i+1].At
		}
		dt := end.Sub(frame.At)
		if dt < 0 {
			continue
		}
		if i+1 < len(frames) && dt > unknownGap {
			dt = 0
		}
		covered += dt
		if normalizeGear(frame.Gear) != "" {
			parkKnown += dt
		}
		if normalizeChargeState(frame.ChargeState) != "" {
			chargeKnown += dt
		}
		if frame.FSDDistanceM != nil {
			fsdKnown += dt
		}
		if frame.SpeedMps != nil || normalizeGear(frame.Gear) == enums.GearDrive || normalizeGear(frame.Gear) == enums.GearReverse {
			motionKnown += dt
		}
	}
	out.SampleHours = floatPtr(covered.Hours())
	unknown := window - covered
	if unknown < 0 {
		unknown = 0
	}
	out.UnknownHours = floatPtr(unknown.Hours())
	budget := func(kind string, known time.Duration) UnknownBudget {
		hours := window.Hours() - known.Hours()
		if hours < 0 {
			hours = 0
		}
		return UnknownBudget{Kind: kind, Hours: hours, Unknown: hours > 0}
	}
	out.Budgets = []UnknownBudget{
		budget("park", parkKnown),
		budget("charge", chargeKnown),
		budget("fsd", fsdKnown),
		budget("motion", motionKnown),
	}
	return out
}

func BuildCarKeptLiving(vehicleID int64, last *time.Time, mqttConnected *bool, now time.Time) CarKeptLiving {
	out := CarKeptLiving{
		VehicleID:                vehicleID,
		LastTelemetryAt:          last,
		MQTTConnected:            mqttConnected,
		ReplayPreservesEventTime: true,
		Notes: []string{
			"Queued MQTT messages that carry the original event time are replayed with that time, not ingest time.",
			"Queue depth is unknown unless the broker reports it. TeslaSync does not invent a count.",
			"A gap with no samples is what the car did that we never received. It stays unknown.",
		},
		Honesty: carKeptLivingHonesty,
	}
	if last != nil && now.After(*last) {
		out.NeverReceivedGapS = floatPtr(durationSeconds(*last, now))
	}
	return out
}

func BuildTeslaLogbook(vehicleID int64, drives, charges []SessionBoundary, frames []PhysicsFrame) TeslaLogbook {
	out := TeslaLogbook{VehicleID: vehicleID, Entries: []LogbookEntry{}, Honesty: logbookHonesty}
	for _, drive := range drives {
		out.Entries = append(out.Entries, LogbookEntry{
			Word:    "Drive",
			At:      drive.StartedAt.UTC(),
			EndedAt: drive.EndedAt,
			Kind:    "drive",
			ID:      drive.ID,
		})
	}
	for _, charge := range charges {
		out.Entries = append(out.Entries, LogbookEntry{
			Word:    "Charging",
			At:      charge.StartedAt.UTC(),
			EndedAt: nil,
			Kind:    "charge",
			ID:      charge.ID,
		})
		if charge.EndedAt != nil {
			out.Entries = append(out.Entries, LogbookEntry{
				Word:    "Disconnected",
				At:      charge.EndedAt.UTC(),
				EndedAt: charge.EndedAt,
				Kind:    "charge",
				ID:      charge.ID,
			})
		}
	}
	sort.SliceStable(out.Entries, func(i, j int) bool {
		return out.Entries[i].At.Before(out.Entries[j].At)
	})
	if len(out.Entries) == 0 && len(frames) > 0 {
		latest := lastFrame(frames)
		word := classifyLife(*latest, normalizeGear(latest.Gear) == enums.GearPark)
		out.Entries = append(out.Entries, LogbookEntry{Word: teslaWord(word), At: latest.At.UTC(), Kind: "live"})
	}
	return out
}

func teslaWord(state string) string {
	switch state {
	case "confirmed_park", "park_unconfirmed":
		return "Park"
	case "neutral_rolling":
		return "Neutral"
	case "drive":
		return "Drive"
	case "reverse":
		return "Reverse"
	case "charging":
		return "Charging"
	case "complete_still_plugged":
		return "Complete"
	case "plugged_not_charging":
		return "Stopped"
	case "unplugged":
		return "Disconnected"
	default:
		return "Unknown"
	}
}

func BuildFirmwareEpochs(vehicleID int64, frames []PhysicsFrame) FirmwareEpochs {
	out := FirmwareEpochs{VehicleID: vehicleID, Epochs: []FirmwareEpoch{}, Honesty: epochHonesty}
	var current FirmwareEpoch
	flush := func(end time.Time) {
		if current.Version == "" && current.StartedAt.IsZero() {
			return
		}
		if current.Version == "" {
			current.Version = "unknown"
		}
		copied := end.UTC()
		current.EndedAt = &copied
		current.Honesty = epochHonesty
		out.Epochs = append(out.Epochs, current)
	}
	for _, frame := range frames {
		version := strings.TrimSpace(frame.Firmware)
		if version == "" {
			version = "unknown"
		}
		if current.Version == "" {
			current = FirmwareEpoch{Version: version, StartedAt: frame.At.UTC(), FSDMeterStartM: frame.FSDDistanceM, FSDMeterEndM: frame.FSDDistanceM}
			continue
		}
		if version != current.Version {
			flush(frame.At)
			current = FirmwareEpoch{Version: version, StartedAt: frame.At.UTC(), FSDMeterStartM: frame.FSDDistanceM, FSDMeterEndM: frame.FSDDistanceM}
			continue
		}
		if frame.FSDDistanceM != nil {
			current.FSDMeterEndM = frame.FSDDistanceM
			if current.FSDMeterStartM == nil {
				current.FSDMeterStartM = frame.FSDDistanceM
			}
		}
	}
	if current.Version != "" {
		current.Honesty = epochHonesty
		out.Epochs = append(out.Epochs, current)
	}
	return out
}

func BuildChargePortCourt(vehicleID int64, frames []PhysicsFrame) ChargePortCourt {
	out := ChargePortCourt{VehicleID: vehicleID, Evidence: []PortEvidence{}, Honesty: portCourtHonesty}
	for _, frame := range frames {
		if frame.Latch == "" && frame.DoorOpen == nil && frame.PackCurrentA == nil && normalizeChargeState(frame.ChargeState) == "" {
			continue
		}
		out.Evidence = append(out.Evidence, portEvidence(frame))
	}
	if len(out.Evidence) > 40 {
		out.Evidence = out.Evidence[len(out.Evidence)-40:]
	}
	return out
}

func BuildBlackBox(vehicleID int64, frames []PhysicsFrame, tape LifeTape, now time.Time) BlackBox {
	out := BlackBox{VehicleID: vehicleID, Trigger: "none", Frames: []PortEvidence{}, Honesty: blackBoxHonesty}
	var triggerAt time.Time
	trigger := "none"
	for _, segment := range tape.Segments {
		switch segment.State {
		case "confirmed_park", "unplugged", "unknown":
			trigger = segment.State
			triggerAt = segment.StartedAt
		}
	}
	if trigger == "none" && len(frames) > 0 {
		trigger = "latest"
		triggerAt = frames[len(frames)-1].At
	}
	if trigger == "none" {
		return out
	}
	out.Trigger = trigger
	from := triggerAt.Add(-blackBoxWindow)
	to := triggerAt
	if to.IsZero() {
		to = now.UTC()
	}
	out.From = timePtr(from)
	out.To = timePtr(to)
	for _, frame := range frames {
		if frame.At.Before(from) || frame.At.After(to) {
			continue
		}
		out.Frames = append(out.Frames, portEvidence(frame))
	}
	return out
}

func BuildOwnerDictionary(vehicleID int64, frames []PhysicsFrame) OwnerDictionary {
	out := OwnerDictionary{VehicleID: vehicleID, Honesty: dictionaryHonesty}
	var unplugs []float64
	var parkDwells []float64
	completeWithout := 0
	var completeAt *time.Time
	var parkSince *time.Time
	sawSchedule := false
	inComplete := false
	for _, frame := range frames {
		charge := normalizeChargeState(frame.ChargeState)
		gear := normalizeGear(frame.Gear)
		if scheduledModeActive(frame.ScheduledMode) {
			sawSchedule = true
		}
		if charge == enums.ChargeStateComplete {
			if completeAt == nil {
				copied := frame.At.UTC()
				completeAt = &copied
			}
			if !inComplete && !scheduledModeActive(frame.ScheduledMode) && !sawSchedule {
				completeWithout++
			}
			inComplete = true
		} else {
			inComplete = false
		}
		if charge == enums.ChargeStateDisconnected && completeAt != nil {
			unplugs = append(unplugs, durationSeconds(*completeAt, frame.At))
			completeAt = nil
			sawSchedule = false
		}
		if gear == enums.GearPark {
			if parkSince == nil {
				copied := frame.At.UTC()
				parkSince = &copied
			}
		} else if parkSince != nil {
			parkSince = nil
		}
		if parkSince != nil && !frame.At.Before(parkSince.Add(parkConfirmDuration)) {
			parkDwells = append(parkDwells, durationSeconds(*parkSince, frame.At))
			parkSince = nil
		}
	}
	if v := median(unplugs); v != nil {
		out.TypicalCompleteUnplugS = v
	}
	if v := median(parkDwells); v != nil {
		out.ParkConfirmDwellS = v
	}
	if completeWithout > 0 {
		out.CompleteWithoutSchedule = &completeWithout
	}
	return out
}

func BuildPhysicsVault(vehicleID int64, cert SessionCertificate, unknownHours *float64, epochs FirmwareEpochs, frames []PhysicsFrame) PhysicsVault {
	versions := make([]string, 0, len(epochs.Epochs))
	seen := map[string]struct{}{}
	for _, epoch := range epochs.Epochs {
		if epoch.Version == "" || epoch.Version == "unknown" {
			continue
		}
		if _, ok := seen[epoch.Version]; ok {
			continue
		}
		seen[epoch.Version] = struct{}{}
		versions = append(versions, epoch.Version)
	}
	var dwells []float64
	var completeAt *time.Time
	dc := false
	for _, frame := range frames {
		if frame.FastChargerPresent != nil && *frame.FastChargerPresent {
			dc = true
		}
		charge := normalizeChargeState(frame.ChargeState)
		if charge == enums.ChargeStateComplete && dc {
			if completeAt == nil {
				copied := frame.At.UTC()
				completeAt = &copied
			}
		}
		if charge == enums.ChargeStateDisconnected && completeAt != nil {
			dwells = append(dwells, durationSeconds(*completeAt, frame.At))
			completeAt = nil
			dc = false
		}
	}
	if dwells == nil {
		dwells = []float64{}
	}
	if versions == nil {
		versions = []string{}
	}
	return PhysicsVault{
		VehicleID:        vehicleID,
		Certificate:      cert,
		UnknownHours:     unknownHours,
		FirmwareVersions: versions,
		EtiquetteDwellsS: dwells,
		Honesty:          vaultHonesty,
	}
}

func BuildModeLaws(vehicleID int64, latest *PhysicsFrame) ModeLaws {
	out := ModeLaws{
		VehicleID: vehicleID,
		Allowed:   []string{"report Gear, ChargeState, and trip meters as observed"},
		Forbidden: []string{"count Sentry as parked without confirmed Park", "treat Neutral as Park", "treat Stopped or Complete as unplug"},
		Honesty:   modeHonesty,
	}
	if latest == nil {
		out.Forbidden = append(out.Forbidden, "infer Valet, Service, or Transport — mode signals are unknown")
		return out
	}
	out.Valet = latest.Valet
	out.Service = latest.Service
	if latest.Service != nil && *latest.Service {
		out.Forbidden = append(out.Forbidden, "treat Service-mode samples as owner driving physics")
		out.Allowed = append(out.Allowed, "flag Service-mode amnesia on trip meters")
	}
	if latest.Valet != nil && *latest.Valet {
		out.Forbidden = append(out.Forbidden, "attribute Valet driving to the owner commute identity")
	}
	if latest.Valet == nil && latest.Service == nil {
		out.Forbidden = append(out.Forbidden, "assume Transport/Valet/Service — those signals are unknown")
	}
	return out
}

func BuildNervousSystem(vehicleID int64, frames []PhysicsFrame, now time.Time) NervousSystem {
	out := NervousSystem{VehicleID: vehicleID, Nerves: []Nerve{}, Honesty: nervousHonesty}
	latest := lastFrame(frames)
	nerve := func(field string, present bool, contradicting bool, detail string) Nerve {
		status := "silent"
		if present {
			status = "alive"
		}
		if contradicting {
			status = "contradicting"
		}
		if !present {
			detail = "no recent sample — silent, not zero"
		}
		return Nerve{Field: field, Status: status, Detail: detail}
	}
	if latest == nil {
		out.Nerves = []Nerve{
			nerve("Gear", false, false, ""),
			nerve("ChargeState", false, false, ""),
			nerve("ChargePortLatch", false, false, ""),
			nerve("PackCurrent", false, false, ""),
			nerve("SelfDrivingMilesSinceReset", false, false, ""),
			nerve("MilesSinceReset", false, false, ""),
		}
		return out
	}
	stale := now.Sub(latest.At) > unknownGap
	parkSpeed := normalizeGear(latest.Gear) == enums.GearPark && latest.SpeedMps != nil && *latest.SpeedMps > movingSpeedMps
	unplugCurrent := normalizeChargeState(latest.ChargeState) == enums.ChargeStateDisconnected && packDrawing(latest.PackCurrentA)
	out.Nerves = []Nerve{
		nerve("Gear", normalizeGear(latest.Gear) != "" && !stale, parkSpeed, "P/R/N/D"),
		nerve("ChargeState", normalizeChargeState(latest.ChargeState) != "" && !stale, unplugCurrent, "Tesla charge language"),
		nerve("ChargePortLatch", latest.Latch != "" && !stale, false, latest.Latch),
		nerve("PackCurrent", latest.PackCurrentA != nil && !stale, unplugCurrent, "BMS current"),
		nerve("SelfDrivingMilesSinceReset", latest.FSDDistanceM != nil && !stale, false, "FSD trip meter"),
		nerve("MilesSinceReset", latest.DrivingDistanceM != nil && !stale, false, "driving trip meter"),
	}
	return out
}

func BuildRangeDisagreement(vehicleID int64, latest *PhysicsFrame) RangeDisagreement {
	out := RangeDisagreement{VehicleID: vehicleID, Honesty: rangeHonesty}
	if latest == nil {
		return out
	}
	out.RatedRangeM = latest.RatedRangeM
	out.EstRangeM = latest.EstRangeM
	out.IdealRangeM = latest.IdealRangeM
	out.EnergyRemainingWh = latest.EnergyRemainingWh
	ranges := []*float64{latest.RatedRangeM, latest.EstRangeM, latest.IdealRangeM}
	var first *float64
	for _, value := range ranges {
		if value == nil {
			continue
		}
		if first == nil {
			first = value
			continue
		}
		if math.Abs(*value-*first) > 100 {
			out.Disagree = true
		}
	}
	return out
}

func physicsFramesFromTimeline(rows []signal.TimelineRow) []PhysicsFrame {
	out := make([]PhysicsFrame, 0, len(rows))
	for _, row := range rows {
		out = append(out, PhysicsFrame{
			At:                 row.Timestamp.UTC(),
			Gear:               fieldString(row.Fields, "gear", "Gear"),
			SpeedMps:           fieldFloat(row.Fields, "speed", "VehicleSpeed"),
			ChargeState:        fieldString(row.Fields, "detailed_charge_state", "charge_state", "DetailedChargeState", "ChargeState"),
			Latch:              fieldString(row.Fields, "charge_port_latch", "ChargePortLatch"),
			DoorOpen:           fieldBool(row.Fields, "charge_port_door_open", "ChargePortDoorOpen"),
			PackCurrentA:       fieldFloat(row.Fields, "pack_current", "PackCurrent"),
			PackVoltageV:       fieldFloat(row.Fields, "pack_voltage", "PackVoltage"),
			BatteryPct:         fieldFloat(row.Fields, "battery_level", "BatteryLevel"),
			EnergyRemainingWh:  fieldFloat(row.Fields, "energy_remaining", "EnergyRemaining"),
			RatedRangeM:        fieldFloat(row.Fields, "rated_range", "RatedRange"),
			EstRangeM:          fieldFloat(row.Fields, "est_range", "EstBatteryRange"),
			IdealRangeM:        fieldFloat(row.Fields, "ideal_range", "IdealBatteryRange"),
			FSDDistanceM:       fieldFloat(row.Fields, "fsd_distance_m", "SelfDrivingMilesSinceReset"),
			DrivingDistanceM:   fieldFloat(row.Fields, "driving_distance_m", "MilesSinceReset"),
			OdometerM:          fieldFloat(row.Fields, "odometer", "Odometer"),
			Firmware:           fieldString(row.Fields, "firmware", "Version"),
			Valet:              fieldBool(row.Fields, "valet_mode", "ValetModeEnabled"),
			Service:            fieldBool(row.Fields, "service_mode", "ServiceMode"),
			FastChargerPresent: fieldBool(row.Fields, "fast_charger_present", "FastChargerPresent"),
			ScheduledMode:      fieldString(row.Fields, "scheduled_charging_mode", "ScheduledChargingMode"),
		})
	}
	return out
}

func livePhysicsFrame(state signal.State, now time.Time) PhysicsFrame {
	return PhysicsFrame{
		At:                 now.UTC(),
		Gear:               fieldString(state, "Gear"),
		SpeedMps:           fieldFloat(state, "VehicleSpeed"),
		ChargeState:        firstNonEmpty(fieldString(state, "DetailedChargeState"), fieldString(state, "ChargeState")),
		Latch:              fieldString(state, "ChargePortLatch"),
		DoorOpen:           fieldBool(state, "ChargePortDoorOpen"),
		PackCurrentA:       fieldFloat(state, "PackCurrent"),
		PackVoltageV:       fieldFloat(state, "PackVoltage"),
		BatteryPct:         fieldFloat(state, "BatteryLevel"),
		EnergyRemainingWh:  fieldFloat(state, "EnergyRemaining"),
		RatedRangeM:        fieldFloat(state, "RatedRange"),
		EstRangeM:          fieldFloat(state, "EstBatteryRange"),
		IdealRangeM:        fieldFloat(state, "IdealBatteryRange"),
		FSDDistanceM:       fieldFloat(state, "SelfDrivingMilesSinceReset"),
		DrivingDistanceM:   fieldFloat(state, "MilesSinceReset"),
		OdometerM:          fieldFloat(state, "Odometer"),
		Firmware:           fieldString(state, "Version"),
		Valet:              fieldBool(state, "ValetModeEnabled"),
		Service:            fieldBool(state, "ServiceMode"),
		FastChargerPresent: fieldBool(state, "FastChargerPresent"),
		ScheduledMode:      fieldString(state, "ScheduledChargingMode"),
	}
}

func exclusiveHistoryFields() []signal.FieldMapping {
	return []signal.FieldMapping{
		{Signal: "Gear", Field: "gear"},
		{Signal: "DetailedChargeState", Field: "detailed_charge_state"},
		{Signal: "ChargeState", Field: "charge_state"},
		{Signal: "ChargePortLatch", Field: "charge_port_latch"},
		{Signal: "ChargePortDoorOpen", Field: "charge_port_door_open"},
		{Signal: "Version", Field: "firmware"},
		{Signal: "ValetModeEnabled", Field: "valet_mode"},
		{Signal: "ServiceMode", Field: "service_mode"},
		{Signal: "FastChargerPresent", Field: "fast_charger_present"},
		{Signal: "ScheduledChargingMode", Field: "scheduled_charging_mode"},
	}
}

func exclusiveFields() []signal.FieldMapping {
	return append(exclusiveHistoryFields(), []signal.FieldMapping{
		{Signal: "VehicleSpeed", Field: "speed"},
		{Signal: "PackCurrent", Field: "pack_current"},
		{Signal: "PackVoltage", Field: "pack_voltage"},
		{Signal: "BatteryLevel", Field: "battery_level"},
		{Signal: "EnergyRemaining", Field: "energy_remaining"},
		{Signal: "RatedRange", Field: "rated_range"},
		{Signal: "EstBatteryRange", Field: "est_range"},
		{Signal: "IdealBatteryRange", Field: "ideal_range"},
		{Signal: "SelfDrivingMilesSinceReset", Field: "fsd_distance_m"},
		{Signal: "MilesSinceReset", Field: "driving_distance_m"},
		{Signal: "Odometer", Field: "odometer"},
	}...)
}

func exclusiveCollapseBy() []string {
	return []string{"gear", "detailed_charge_state", "charge_state", "charge_port_latch", "firmware", "valet_mode", "service_mode"}
}

func sortFrames(frames []PhysicsFrame) []PhysicsFrame {
	ordered := append([]PhysicsFrame(nil), frames...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].At.Before(ordered[j].At)
	})
	return ordered
}

func windowOf(frames []PhysicsFrame, now time.Time) (time.Time, time.Time) {
	to := now.UTC()
	if len(frames) == 0 {
		return to.Add(-maxExclusiveLookback), to
	}
	return frames[0].At.UTC(), to
}

func lastFrame(frames []PhysicsFrame) *PhysicsFrame {
	if len(frames) == 0 {
		return nil
	}
	frame := frames[len(frames)-1]
	return &frame
}

func lastFrameTime(frames []PhysicsFrame) *time.Time {
	if latest := lastFrame(frames); latest != nil {
		return timePtr(latest.At)
	}
	return nil
}

func latchEngaged(latch string) bool {
	s := strings.ToLower(strings.TrimSpace(latch))
	return s == "engaged" || strings.Contains(s, "engaged")
}

func packDrawing(current *float64) bool {
	if current == nil {
		return false
	}
	return math.Abs(*current) > packCurrentQuietA
}

func portEvidence(frame PhysicsFrame) PortEvidence {
	return PortEvidence{
		At:            frame.At.UTC(),
		Latch:         frame.Latch,
		DoorOpen:      frame.DoorOpen,
		PackCurrentA:  frame.PackCurrentA,
		ChargeState:   normalizeChargeState(frame.ChargeState),
		ScheduledMode: frame.ScheduledMode,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func median(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	copied := append([]float64(nil), values...)
	sort.Float64s(copied)
	mid := copied[len(copied)/2]
	if len(copied)%2 == 0 {
		mid = (copied[len(copied)/2-1] + copied[len(copied)/2]) / 2
	}
	return floatPtr(mid)
}
