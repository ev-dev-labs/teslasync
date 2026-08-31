package fsd

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
)

const (
	maxSynchronizedCounterGap    = 2 * time.Minute
	minRouteDriveCount           = 2
	fsdHeavySharePct             = 50.0
	lowFSDSharePct               = 10.0
	maxEvidenceIntervalsPerDrive = 512
)

type driveAttributionState struct {
	summary            DriveFSDInsight
	drive              DriveRecord
	uniqueDistanceM    float64
	ambiguousDistanceM float64
	uniqueOutsideDrive bool
}

type counterObservation struct {
	at               time.Time
	value            float64
	segment          int
	companionSegment int
}

type firmwareTransition struct {
	at      time.Time
	version *string
}

type groupAccumulator struct {
	key        string
	label      string
	driveCount int
	distanceM  float64
	fsdM       float64
}

type efficiencyAccumulator struct {
	heavyCount    int
	heavyDistance float64
	heavyEnergy   float64
	lowCount      int
	lowDistance   float64
	lowEnergy     float64
}

type driveOverlapSweep struct {
	ordered   []*driveAttributionState
	active    []*driveAttributionState
	next      int
	windowEnd time.Time
}

// BuildDriveAnalytics derives all per-drive and grouped intelligence from
// bounded, set-based repository inputs.
func BuildDriveAnalytics(
	current Response,
	previous Response,
	input AnalyticsInput,
	loc *time.Location,
	includeEvidence bool,
) DriveAnalytics {
	if loc == nil {
		loc = time.UTC
	}

	currentDrives := drivesFullyContained(input.Drives, current.Period.StartAt, current.Period.EndAt)
	currentDriveIDs := make(map[int64]struct{}, len(currentDrives))
	for _, drive := range currentDrives {
		currentDriveIDs[drive.ID] = struct{}{}
	}
	allDrives := drivesOverlapping(input.Drives, previous.Period.StartAt, current.Period.EndAt)
	states := make(map[int64]*driveAttributionState, len(allDrives))
	for _, drive := range allDrives {
		drive.DistanceM = finiteNonNegativePointer(drive.DistanceM)
		drive.EnergyUsedWh = finiteNonNegativePointer(drive.EnergyUsedWh)
		state := &driveAttributionState{
			drive: drive,
			summary: DriveFSDInsight{
				DriveID:      drive.ID,
				StartedAt:    drive.StartedAt,
				EndedAt:      drive.EndedAt,
				StartPlace:   drive.StartPlace,
				EndPlace:     drive.EndPlace,
				DistanceM:    drive.DistanceM,
				EnergyUsedWh: drive.EnergyUsedWh,
				Confidence:   ConfidenceUnknown,
				Evidence:     make([]EvidenceInterval, 0),
			},
		}
		states[drive.ID] = state
	}
	orderedStates := make([]*driveAttributionState, 0, len(states))
	for _, state := range states {
		orderedStates = append(orderedStates, state)
	}
	sort.Slice(orderedStates, func(i, j int) bool {
		if orderedStates[i].drive.StartedAt.Equal(orderedStates[j].drive.StartedAt) {
			return orderedStates[i].drive.ID < orderedStates[j].drive.ID
		}
		return orderedStates[i].drive.StartedAt.Before(orderedStates[j].drive.StartedAt)
	})
	overlapSweep := driveOverlapSweep{
		ordered:   orderedStates,
		active:    make([]*driveAttributionState, 0),
		windowEnd: current.Period.EndAt,
	}

	fsdObservations := trustedCounterObservations(input.CounterSamples, SignalFSDDistance)
	drivingObservations := trustedCounterObservations(input.CounterSamples, SignalDrivingDistance)
	pairedFSDObservations := pairedObservations(fsdObservations, drivingObservations)
	coverageObservations := observationsBefore(pairedFSDObservations, current.Period.EndAt)
	firmware := buildFirmwareTimeline(input.VersionSamples)

	analytics := emptyDriveAnalytics(current, previous)
	var ambiguousDistance, unattributedDistance float64

	for index := 1; index < len(fsdObservations); index++ {
		earlier := fsdObservations[index-1]
		later := fsdObservations[index]
		if earlier.segment != later.segment {
			continue
		}
		if later.at.Before(current.Period.StartAt) || !later.at.Before(current.Period.EndAt) {
			continue
		}

		change := signalcounter.Compare(earlier.value, later.value)
		if change.Kind != signalcounter.ChangeAdvanced {
			continue
		}
		if earlier.at.Before(previous.Period.StartAt) {
			unattributedDistance += change.Delta
			continue
		}

		candidates := overlapSweep.overlapping(earlier.at, later.at)
		currentCandidates := currentPeriodStates(candidates, currentDriveIDs)
		switch len(candidates) {
		case 0:
			unattributedDistance += change.Delta
		case 1:
			if len(currentCandidates) == 0 {
				unattributedDistance += change.Delta
				continue
			}
			state := currentCandidates[0]
			state.uniqueDistanceM += change.Delta
			if !intervalIsBoundedByDrive(
				state.drive,
				earlier.at,
				later.at,
				current.Period.EndAt,
			) || exceedsDriveDistance(state) {
				state.uniqueOutsideDrive = true
			}
			if includeEvidence {
				state.summary.Evidence = append(state.summary.Evidence, EvidenceInterval{
					StartAt:      maxTime(earlier.at, state.drive.StartedAt),
					EndAt:        minTime(later.at, driveEnd(state.drive, current.Period.EndAt)),
					FSDDistanceM: roundMeters(change.Delta),
					Confidence:   ConfidenceEstimated,
					Approximate:  true,
				})
			}
		default:
			if len(currentCandidates) == 0 {
				unattributedDistance += change.Delta
				continue
			}
			ambiguousDistance += change.Delta
			totalOverlap := totalOverlapDuration(candidates, earlier.at, later.at, current.Period.EndAt)
			for _, state := range candidates {
				share := proportionalDistance(
					change.Delta,
					overlapDuration(state.drive, earlier.at, later.at, current.Period.EndAt),
					totalOverlap,
					len(candidates),
				)
				state.ambiguousDistanceM += share
				if includeEvidence {
					state.summary.Evidence = append(state.summary.Evidence, EvidenceInterval{
						StartAt:      maxTime(earlier.at, state.drive.StartedAt),
						EndAt:        minTime(later.at, driveEnd(state.drive, current.Period.EndAt)),
						FSDDistanceM: roundMeters(share),
						Confidence:   ConfidenceAmbiguous,
						Approximate:  true,
					})
				}
			}
		}
	}

	analytics.ResetEvents = counterResetEvents(
		fsdObservations,
		drivingObservations,
		orderedStates,
		currentDriveIDs,
		current.Period.StartAt,
		current.Period.EndAt,
	)

	var attributedDistance, estimatedDistance, unknownDriveDistance float64
	summaries := make([]DriveFSDInsight, 0, len(states))
	for _, state := range orderedStates {
		if _, currentDrive := currentDriveIDs[state.drive.ID]; !currentDrive {
			continue
		}
		state.summary.FirmwareVersion = firmwareAtTimeline(firmware, state.drive.StartedAt)
		state.summary.ResetAffected = driveResetAffected(state.drive.ID, analytics.ResetEvents)

		hasCoverage := hasSynchronizedCoverage(
			state.drive,
			coverageObservations,
			current.Period.EndAt,
			state.summary.ResetAffected,
		)
		attributed := state.uniqueDistanceM + state.ambiguousDistanceM

		switch {
		case state.ambiguousDistanceM > 0:
			state.summary.Confidence = ConfidenceAmbiguous
		case state.uniqueDistanceM > 0 &&
			hasCoverage &&
			!state.uniqueOutsideDrive &&
			!state.summary.ResetAffected:
			state.summary.Confidence = ConfidenceHigh
		case state.uniqueDistanceM > 0:
			state.summary.Confidence = ConfidenceEstimated
		case hasCoverage && !state.summary.ResetAffected:
			state.summary.Confidence = ConfidenceHigh
		default:
			state.summary.Confidence = ConfidenceUnknown
		}

		if state.summary.Confidence != ConfidenceUnknown {
			distance := roundMeters(attributed)
			state.summary.FSDDistanceM = &distance
			state.summary.FSDSharePct, _ = sharePct(state.summary.FSDDistanceM, state.summary.DistanceM)
		} else if state.summary.DistanceM != nil && *state.summary.DistanceM > 0 {
			unknownDriveDistance += *state.summary.DistanceM
		}

		for index := range state.summary.Evidence {
			if state.summary.Evidence[index].Confidence != ConfidenceAmbiguous {
				state.summary.Evidence[index].Confidence = state.summary.Confidence
			}
		}
		state.summary.Evidence, state.summary.EvidenceTruncated = compactEvidence(
			state.summary.Evidence,
			maxEvidenceIntervalsPerDrive,
		)

		if state.uniqueDistanceM > 0 {
			if state.summary.Confidence == ConfidenceHigh {
				attributedDistance += state.uniqueDistanceM
			} else {
				estimatedDistance += state.uniqueDistanceM
			}
		}
		summaries = append(summaries, state.summary)
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].StartedAt.Equal(summaries[j].StartedAt) {
			return summaries[i].DriveID > summaries[j].DriveID
		}
		return summaries[i].StartedAt.After(summaries[j].StartedAt)
	})
	analytics.ContributingDrives = summaries

	if current.Totals.FSDDistanceM != nil {
		accounted := attributedDistance + estimatedDistance + ambiguousDistance + unattributedDistance
		if remainder := *current.Totals.FSDDistanceM - accounted; remainder > 0.001 {
			unattributedDistance += remainder
		}
		analytics.Attribution.AttributedDistanceM = floatPointer(roundMeters(attributedDistance))
		analytics.Attribution.EstimatedDistanceM = floatPointer(roundMeters(estimatedDistance))
		analytics.Attribution.AmbiguousDistanceM = floatPointer(roundMeters(ambiguousDistance))
		analytics.Attribution.UnattributedDistanceM = floatPointer(roundMeters(unattributedDistance))
	}
	analytics.Attribution.UnknownDriveDistanceM = roundMeters(unknownDriveDistance)

	driveByID := make(map[int64]DriveRecord, len(currentDrives))
	for _, drive := range currentDrives {
		driveByID[drive.ID] = drive
	}
	analytics.RepeatedRoutes = buildRouteGroups(summaries, driveByID)
	analytics.TimeOfDay = buildTimeOfDayGroups(summaries, loc)
	analytics.Firmware = buildFirmwareGroups(summaries)
	analytics.RouteEfficiency = buildEfficiencyComparisons(summaries, driveByID)

	return analytics
}

func emptyDriveAnalytics(current, previous Response) DriveAnalytics {
	analytics := DriveAnalytics{
		Comparison: PeriodComparison{
			PreviousPeriod:           previous.Period,
			PreviousFSDDistanceM:     previous.Totals.FSDDistanceM,
			PreviousDrivingDistanceM: previous.Totals.DrivingDistanceM,
			PreviousFSDSharePct:      previous.Totals.FSDSharePct,
		},
		ContributingDrives:    make([]DriveFSDInsight, 0),
		ResetEvents:           make([]CounterResetEvent, 0),
		RepeatedRoutes:        make([]GroupedFSDInsight, 0),
		TimeOfDay:             make([]GroupedFSDInsight, 0),
		Firmware:              make([]GroupedFSDInsight, 0),
		RouteEfficiency:       make([]RouteEfficiencyComparison, 0),
		CorrelationDisclaimer: "This is a same-route correlation, not proof that supervised driving caused an efficiency difference.",
	}

	if fsdPeriodComparable(current) && fsdPeriodComparable(previous) {
		change := roundMeters(*current.Totals.FSDDistanceM - *previous.Totals.FSDDistanceM)
		analytics.Comparison.FSDDistanceChangeM = &change
		if *previous.Totals.FSDDistanceM > 0 {
			pct := roundPct(change / *previous.Totals.FSDDistanceM * 100)
			analytics.Comparison.FSDDistanceChangePct = &pct
		}
	}
	if sharePeriodComparable(current) && sharePeriodComparable(previous) {
		points := roundPct(*current.Totals.FSDSharePct - *previous.Totals.FSDSharePct)
		analytics.Comparison.FSDShareChangePctPoints = &points
	}
	return analytics
}

func fsdPeriodComparable(response Response) bool {
	quality := response.Quality
	return response.Totals.FSDDistanceM != nil &&
		quality.FSDBaselineAvailable &&
		quality.FSDResetCount == 0 &&
		quality.FSDInvalidSampleCount == 0 &&
		quality.FSDUntrustedSampleCount == 0
}

func sharePeriodComparable(response Response) bool {
	quality := response.Quality
	return fsdPeriodComparable(response) &&
		response.Totals.FSDSharePct != nil &&
		quality.ShareBasisAvailable &&
		quality.DrivingBaselineAvailable &&
		quality.DrivingResetCount == 0 &&
		quality.DrivingInvalidSampleCount == 0 &&
		quality.DrivingUntrustedSampleCount == 0
}

func drivesOverlapping(drives []DriveRecord, start, end time.Time) []DriveRecord {
	filtered := make([]DriveRecord, 0, len(drives))
	for _, drive := range drives {
		if drive.StartedAt.Before(end) && driveEnd(drive, end).After(start) {
			filtered = append(filtered, drive)
		}
	}
	return filtered
}

func drivesFullyContained(drives []DriveRecord, start, end time.Time) []DriveRecord {
	filtered := make([]DriveRecord, 0, len(drives))
	for _, drive := range drives {
		if drive.EndedAt == nil ||
			drive.StartedAt.Before(start) ||
			!drive.StartedAt.Before(end) ||
			drive.EndedAt.Before(drive.StartedAt) ||
			drive.EndedAt.After(end) {
			continue
		}
		filtered = append(filtered, drive)
	}
	return filtered
}

func trustedCounterObservations(samples []Sample, field string) []counterObservation {
	ordered := make([]Sample, 0, len(samples)/2+1)
	for _, sample := range samples {
		if sample.Field == field {
			ordered = append(ordered, sample)
		}
	}
	if !sort.SliceIsSorted(ordered, func(i, j int) bool {
		return ordered[i].TS.Before(ordered[j].TS)
	}) {
		sort.SliceStable(ordered, func(i, j int) bool {
			return ordered[i].TS.Before(ordered[j].TS)
		})
	}

	observations := make([]counterObservation, 0, len(ordered))
	segment := 0
	for _, sample := range ordered {
		value, ok := validCounterValue(sample.Value)
		if !trustedNormalization(sample) || !ok {
			segment++
			continue
		}
		if len(observations) > 0 &&
			!sample.TS.After(observations[len(observations)-1].at) {
			continue
		}
		observations = append(observations, counterObservation{
			at:      sample.TS,
			value:   value,
			segment: segment,
		})
	}
	return observations
}

func pairedObservations(
	fsdObservations []counterObservation,
	drivingObservations []counterObservation,
) []counterObservation {
	drivingSegments := make(map[int64]int, len(drivingObservations))
	for _, observation := range drivingObservations {
		drivingSegments[observation.at.UnixNano()] = observation.segment
	}
	paired := make([]counterObservation, 0, len(fsdObservations))
	for _, observation := range fsdObservations {
		if segment, ok := drivingSegments[observation.at.UnixNano()]; ok {
			observation.companionSegment = segment
			paired = append(paired, observation)
		}
	}
	return paired
}

func observationsBefore(observations []counterObservation, end time.Time) []counterObservation {
	limit := sort.Search(len(observations), func(index int) bool {
		return !observations[index].at.Before(end)
	})
	return observations[:limit]
}

func (s *driveOverlapSweep) overlapping(start, end time.Time) []*driveAttributionState {
	for s.next < len(s.ordered) && s.ordered[s.next].drive.StartedAt.Before(end) {
		s.active = append(s.active, s.ordered[s.next])
		s.next++
	}
	kept := s.active[:0]
	for _, state := range s.active {
		if driveEnd(state.drive, s.windowEnd).After(start) {
			kept = append(kept, state)
		}
	}
	s.active = kept
	return s.active
}

func overlappingStates(
	states []*driveAttributionState,
	start, end, windowEnd time.Time,
) []*driveAttributionState {
	candidates := make([]*driveAttributionState, 0, 2)
	limit := sort.Search(len(states), func(index int) bool {
		return !states[index].drive.StartedAt.Before(end)
	})
	for _, state := range states[:limit] {
		if state.drive.StartedAt.Before(end) && driveEnd(state.drive, windowEnd).After(start) {
			candidates = append(candidates, state)
		}
	}
	return candidates
}

func currentPeriodStates(
	candidates []*driveAttributionState,
	currentDriveIDs map[int64]struct{},
) []*driveAttributionState {
	current := make([]*driveAttributionState, 0, len(candidates))
	for _, candidate := range candidates {
		if _, ok := currentDriveIDs[candidate.drive.ID]; ok {
			current = append(current, candidate)
		}
	}
	return current
}

func counterResetEvents(
	fsdObservations []counterObservation,
	drivingObservations []counterObservation,
	states []*driveAttributionState,
	currentDriveIDs map[int64]struct{},
	start, end time.Time,
) []CounterResetEvent {
	events := make([]CounterResetEvent, 0)
	counters := []struct {
		field        string
		observations []counterObservation
	}{
		{field: SignalFSDDistance, observations: fsdObservations},
		{field: SignalDrivingDistance, observations: drivingObservations},
	}
	for _, counter := range counters {
		observations := counter.observations
		for index := 1; index < len(observations); index++ {
			earlier := observations[index-1]
			later := observations[index]
			if earlier.segment != later.segment {
				continue
			}
			if later.at.Before(start) || !later.at.Before(end) {
				continue
			}
			if signalcounter.Compare(earlier.value, later.value).Kind != signalcounter.ChangeReset {
				continue
			}
			candidates := overlappingStates(states, earlier.at, later.at, end)
			driveIDs := make([]int64, 0, len(candidates))
			for _, candidate := range candidates {
				if _, currentDrive := currentDriveIDs[candidate.drive.ID]; currentDrive {
					driveIDs = append(driveIDs, candidate.drive.ID)
				}
			}
			events = append(events, CounterResetEvent{
				Field:            counter.field,
				At:               later.at,
				PreviousValueM:   roundMeters(earlier.value),
				CurrentValueM:    roundMeters(later.value),
				AffectedDriveIDs: driveIDs,
			})
		}
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].At.Equal(events[j].At) {
			return events[i].Field < events[j].Field
		}
		return events[i].At.Before(events[j].At)
	})
	return events
}

func hasSynchronizedCoverage(
	drive DriveRecord,
	observations []counterObservation,
	windowEnd time.Time,
	resetAffected bool,
) bool {
	if resetAffected || len(observations) < 2 {
		return false
	}
	end := driveEnd(drive, windowEnd)
	if !end.After(drive.StartedAt) {
		return false
	}

	first := sort.Search(len(observations), func(i int) bool {
		return !observations[i].at.Before(drive.StartedAt)
	})
	if first == 0 {
		if observations[0].at.After(drive.StartedAt) {
			return false
		}
	} else if first == len(observations) || observations[first].at.After(drive.StartedAt) {
		first--
	}

	last := sort.Search(len(observations), func(i int) bool {
		return !observations[i].at.Before(end)
	})
	if last >= len(observations) {
		return false
	}
	if drive.StartedAt.Sub(observations[first].at) > maxSynchronizedCounterGap ||
		observations[last].at.Sub(end) > maxSynchronizedCounterGap {
		return false
	}
	for index := first + 1; index <= last; index++ {
		if observations[index].segment != observations[index-1].segment ||
			observations[index].companionSegment != observations[index-1].companionSegment {
			return false
		}
		if observations[index].at.Sub(observations[index-1].at) > maxSynchronizedCounterGap {
			return false
		}
	}
	return true
}

func buildFirmwareTimeline(samples []VersionSample) []firmwareTransition {
	ordered := samples
	if !sort.SliceIsSorted(ordered, func(i, j int) bool {
		return ordered[i].TS.Before(ordered[j].TS)
	}) {
		ordered = append([]VersionSample(nil), samples...)
		sort.SliceStable(ordered, func(i, j int) bool {
			return ordered[i].TS.Before(ordered[j].TS)
		})
	}

	timeline := make([]firmwareTransition, 0, len(ordered))
	for index := 0; index < len(ordered); {
		next := index + 1
		for next < len(ordered) && ordered[next].TS.Equal(ordered[index].TS) {
			next++
		}

		var accepted *string
		rejected := false
		for _, sample := range ordered[index:next] {
			version := strings.TrimSpace(sample.Version)
			if sample.NormalizationVersion == nil ||
				*sample.NormalizationVersion < trustedSignalLogNormalizationVersion ||
				version == "" {
				rejected = true
				continue
			}
			value := version
			accepted = &value
		}
		if rejected || accepted == nil {
			accepted = nil
		}
		timeline = append(timeline, firmwareTransition{
			at:      ordered[index].TS,
			version: accepted,
		})
		index = next
	}
	return timeline
}

func firmwareAtTimeline(timeline []firmwareTransition, at time.Time) *string {
	index := sort.Search(len(timeline), func(index int) bool {
		return timeline[index].at.After(at)
	}) - 1
	if index < 0 || timeline[index].version == nil {
		return nil
	}
	value := *timeline[index].version
	return &value
}

func firmwareAt(samples []VersionSample, at time.Time) *string {
	return firmwareAtTimeline(buildFirmwareTimeline(samples), at)
}

func buildRouteGroups(
	summaries []DriveFSDInsight,
	driveByID map[int64]DriveRecord,
) []GroupedFSDInsight {
	groups := make(map[string]*groupAccumulator)
	for _, summary := range summaries {
		if summary.Confidence != ConfidenceHigh ||
			summary.FSDDistanceM == nil ||
			summary.DistanceM == nil ||
			*summary.DistanceM <= 0 {
			continue
		}
		drive, ok := driveByID[summary.DriveID]
		if !ok {
			continue
		}
		key, label, ok := routeIdentity(drive)
		if !ok {
			continue
		}
		group := groups[key]
		if group == nil {
			group = &groupAccumulator{key: key, label: label}
			groups[key] = group
		}
		group.driveCount++
		group.distanceM += *summary.DistanceM
		group.fsdM += *summary.FSDDistanceM
	}
	return finalizedGroups(groups, minRouteDriveCount)
}

func buildTimeOfDayGroups(
	summaries []DriveFSDInsight,
	loc *time.Location,
) []GroupedFSDInsight {
	groups := make(map[string]*groupAccumulator)
	for _, summary := range summaries {
		if summary.Confidence != ConfidenceHigh ||
			summary.FSDDistanceM == nil ||
			summary.DistanceM == nil ||
			*summary.DistanceM <= 0 {
			continue
		}
		key, label := timeOfDayBucket(summary.StartedAt.In(loc).Hour())
		group := groups[key]
		if group == nil {
			group = &groupAccumulator{key: key, label: label}
			groups[key] = group
		}
		group.driveCount++
		group.distanceM += *summary.DistanceM
		group.fsdM += *summary.FSDDistanceM
	}
	return finalizedGroups(groups, 1)
}

func buildFirmwareGroups(summaries []DriveFSDInsight) []GroupedFSDInsight {
	groups := make(map[string]*groupAccumulator)
	for _, summary := range summaries {
		if summary.Confidence != ConfidenceHigh ||
			summary.FirmwareVersion == nil ||
			summary.FSDDistanceM == nil ||
			summary.DistanceM == nil ||
			*summary.DistanceM <= 0 {
			continue
		}
		key := *summary.FirmwareVersion
		group := groups[key]
		if group == nil {
			group = &groupAccumulator{key: key, label: key}
			groups[key] = group
		}
		group.driveCount++
		group.distanceM += *summary.DistanceM
		group.fsdM += *summary.FSDDistanceM
	}
	return finalizedGroups(groups, 1)
}

func finalizedGroups(groups map[string]*groupAccumulator, minimumDrives int) []GroupedFSDInsight {
	result := make([]GroupedFSDInsight, 0, len(groups))
	for _, group := range groups {
		if group.driveCount < minimumDrives {
			continue
		}
		distance := roundMeters(group.distanceM)
		fsdDistance := roundMeters(group.fsdM)
		share, _ := sharePct(&fsdDistance, &distance)
		result = append(result, GroupedFSDInsight{
			Key:              group.key,
			Label:            group.label,
			DriveCount:       group.driveCount,
			DrivingDistanceM: distance,
			FSDDistanceM:     fsdDistance,
			FSDSharePct:      share,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		left, right := -1.0, -1.0
		if result[i].FSDSharePct != nil {
			left = *result[i].FSDSharePct
		}
		if result[j].FSDSharePct != nil {
			right = *result[j].FSDSharePct
		}
		if left == right {
			return result[i].DrivingDistanceM > result[j].DrivingDistanceM
		}
		return left > right
	})
	return result
}

func buildEfficiencyComparisons(
	summaries []DriveFSDInsight,
	driveByID map[int64]DriveRecord,
) []RouteEfficiencyComparison {
	groups := make(map[string]*efficiencyAccumulator)
	labels := make(map[string]string)
	for _, summary := range summaries {
		if summary.Confidence != ConfidenceHigh ||
			summary.FSDSharePct == nil ||
			summary.DistanceM == nil ||
			*summary.DistanceM <= 0 ||
			summary.EnergyUsedWh == nil ||
			*summary.EnergyUsedWh <= 0 ||
			math.IsNaN(*summary.EnergyUsedWh) ||
			math.IsInf(*summary.EnergyUsedWh, 0) {
			continue
		}
		drive, ok := driveByID[summary.DriveID]
		if !ok {
			continue
		}
		key, label, ok := routeIdentity(drive)
		if !ok {
			continue
		}
		group := groups[key]
		if group == nil {
			group = &efficiencyAccumulator{}
			groups[key] = group
			labels[key] = label
		}
		switch {
		case *summary.FSDSharePct >= fsdHeavySharePct:
			group.heavyCount++
			group.heavyDistance += *summary.DistanceM
			group.heavyEnergy += *summary.EnergyUsedWh
		case *summary.FSDSharePct <= lowFSDSharePct:
			group.lowCount++
			group.lowDistance += *summary.DistanceM
			group.lowEnergy += *summary.EnergyUsedWh
		}
	}

	result := make([]RouteEfficiencyComparison, 0)
	for key, group := range groups {
		if group.heavyCount < minRouteDriveCount ||
			group.lowCount < minRouteDriveCount ||
			group.heavyDistance <= 0 ||
			group.lowDistance <= 0 ||
			group.heavyEnergy <= 0 ||
			group.lowEnergy <= 0 {
			continue
		}
		heavy := group.heavyEnergy / (group.heavyDistance / 1000)
		low := group.lowEnergy / (group.lowDistance / 1000)
		if math.IsNaN(heavy) || math.IsInf(heavy, 0) ||
			math.IsNaN(low) || math.IsInf(low, 0) ||
			heavy <= 0 ||
			low <= 0 {
			continue
		}
		result = append(result, RouteEfficiencyComparison{
			RouteKey:                  key,
			RouteLabel:                labels[key],
			FSDHeavyDriveCount:        group.heavyCount,
			LowFSDDriveCount:          group.lowCount,
			FSDHeavyEfficiencyWhPerKM: roundPct(heavy),
			LowFSDEfficiencyWhPerKM:   roundPct(low),
			DifferencePct:             roundPct((heavy - low) / low * 100),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return math.Abs(result[i].DifferencePct) > math.Abs(result[j].DifferencePct)
	})
	return result
}

func routeIdentity(drive DriveRecord) (string, string, bool) {
	startLabel := trimmedString(drive.StartPlace)
	endLabel := trimmedString(drive.EndPlace)
	label := startLabel + " to " + endLabel

	if drive.StartGeofenceID != nil && drive.EndGeofenceID != nil {
		if startLabel == "" {
			startLabel = "Geofence " + strconv.FormatInt(*drive.StartGeofenceID, 10)
		}
		if endLabel == "" {
			endLabel = "Geofence " + strconv.FormatInt(*drive.EndGeofenceID, 10)
		}
		return "geofence:" +
				strconv.FormatInt(*drive.StartGeofenceID, 10) + ":" +
				strconv.FormatInt(*drive.EndGeofenceID, 10),
			startLabel + " to " + endLabel,
			true
	}
	if startLabel == "" || endLabel == "" {
		return "", "", false
	}
	return "place:" + normalizePlace(startLabel) + ":" + normalizePlace(endLabel), label, true
}

func normalizePlace(place string) string {
	return strings.ToLower(strings.Join(strings.Fields(place), " "))
}

func trimmedString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func timeOfDayBucket(hour int) (string, string) {
	switch {
	case hour >= 5 && hour < 12:
		return "morning", "Morning (05:00-11:59)"
	case hour >= 12 && hour < 17:
		return "afternoon", "Afternoon (12:00-16:59)"
	case hour >= 17 && hour < 22:
		return "evening", "Evening (17:00-21:59)"
	default:
		return "night", "Night (22:00-04:59)"
	}
}

func driveResetAffected(driveID int64, events []CounterResetEvent) bool {
	for _, event := range events {
		for _, affectedID := range event.AffectedDriveIDs {
			if affectedID == driveID {
				return true
			}
		}
	}
	return false
}

func driveEnd(drive DriveRecord, fallback time.Time) time.Time {
	if drive.EndedAt == nil || drive.EndedAt.After(fallback) {
		return fallback
	}
	return *drive.EndedAt
}

func exceedsDriveDistance(state *driveAttributionState) bool {
	return state.drive.DistanceM != nil &&
		*state.drive.DistanceM >= 0 &&
		state.uniqueDistanceM+state.ambiguousDistanceM > *state.drive.DistanceM
}

func intervalIsBoundedByDrive(
	drive DriveRecord,
	start, end, windowEnd time.Time,
) bool {
	driveEndAt := driveEnd(drive, windowEnd)
	startSpill := time.Duration(0)
	if start.Before(drive.StartedAt) {
		startSpill = drive.StartedAt.Sub(start)
	}
	endSpill := time.Duration(0)
	if end.After(driveEndAt) {
		endSpill = end.Sub(driveEndAt)
	}
	return startSpill <= maxSynchronizedCounterGap && endSpill <= maxSynchronizedCounterGap
}

func overlapDuration(drive DriveRecord, start, end, windowEnd time.Time) time.Duration {
	overlapStart := maxTime(start, drive.StartedAt)
	overlapEnd := minTime(end, driveEnd(drive, windowEnd))
	if !overlapEnd.After(overlapStart) {
		return 0
	}
	return overlapEnd.Sub(overlapStart)
}

func totalOverlapDuration(
	states []*driveAttributionState,
	start, end, windowEnd time.Time,
) time.Duration {
	var total time.Duration
	for _, state := range states {
		total += overlapDuration(state.drive, start, end, windowEnd)
	}
	return total
}

func proportionalDistance(
	distance float64,
	overlap, total time.Duration,
	candidateCount int,
) float64 {
	if total > 0 {
		return distance * float64(overlap) / float64(total)
	}
	if candidateCount <= 0 {
		return 0
	}
	return distance / float64(candidateCount)
}

func compactEvidence(
	intervals []EvidenceInterval,
	limit int,
) ([]EvidenceInterval, bool) {
	compacted := make([]EvidenceInterval, 0, len(intervals))
	for _, interval := range intervals {
		if !interval.EndAt.After(interval.StartAt) {
			continue
		}
		if len(compacted) > 0 {
			previous := &compacted[len(compacted)-1]
			if previous.EndAt.Equal(interval.StartAt) &&
				previous.Confidence == interval.Confidence &&
				previous.Approximate == interval.Approximate {
				previous.EndAt = interval.EndAt
				previous.FSDDistanceM = roundMeters(previous.FSDDistanceM + interval.FSDDistanceM)
				continue
			}
		}
		compacted = append(compacted, interval)
	}
	if limit > 0 && len(compacted) > limit {
		return compacted[:limit], true
	}
	return compacted, false
}

func floatPointer(value float64) *float64 {
	return &value
}

func finiteNonNegativePointer(value *float64) *float64 {
	if value == nil ||
		math.IsNaN(*value) ||
		math.IsInf(*value, 0) ||
		*value < 0 {
		return nil
	}
	safe := *value
	return &safe
}

func minTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}

func maxTime(left, right time.Time) time.Time {
	if left.After(right) {
		return left
	}
	return right
}
