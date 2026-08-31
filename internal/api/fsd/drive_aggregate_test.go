package fsd

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func trustedSample(field string, ts time.Time, value float64) Sample {
	version := int16(trustedSignalLogNormalizationVersion)
	return Sample{
		Field:                field,
		TS:                   ts,
		Value:                fp(value),
		NormalizationVersion: &version,
	}
}

func responseForRange(vehicleID int64, start, end time.Time, samples []Sample) Response {
	return Aggregate(AggregateParams{
		VehicleID: vehicleID,
		Days:      inclusiveCivilDayCount(start, end, time.UTC),
		Loc:       time.UTC,
		Start:     start,
		End:       end,
		Samples:   samples,
	})
}

func TestBuildDriveAnalytics_AttributesSynchronizedEvidenceToOneDrive(t *testing.T) {
	start := at(t, "2026-03-03T09:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	driveStart := at(t, "2026-03-03T10:00:00Z")
	driveEndAt := at(t, "2026-03-03T11:00:00Z")

	samples := make([]Sample, 0, 130)
	fsdValue := 1000.0
	drivingValue := 10000.0
	for ts := driveStart.Add(-time.Minute); !ts.After(driveEndAt.Add(time.Minute)); ts = ts.Add(time.Minute) {
		if ts.Equal(driveStart.Add(30 * time.Minute)) {
			fsdValue += 500
		}
		if !ts.Before(driveStart) && !ts.After(driveEndAt) {
			drivingValue += 1000.0 / 60.0
		}
		samples = append(
			samples,
			trustedSample(SignalFSDDistance, ts, fsdValue),
			trustedSample(SignalDrivingDistance, ts, drivingValue),
		)
	}

	current := responseForRange(7, start, end, samples)
	previousStart := start.Add(-end.Sub(start))
	previous := responseForRange(7, previousStart, start, samples)
	home := "Home"
	work := "Work"
	distance := 1000.0
	energy := 180.0
	normalizationVersion := int16(trustedSignalLogNormalizationVersion)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		VersionSamples: []VersionSample{{
			TS:                   driveStart.Add(-time.Hour),
			Version:              "2026.20.3",
			NormalizationVersion: &normalizationVersion,
		}},
		Drives: []DriveRecord{{
			ID:           295,
			StartedAt:    driveStart,
			EndedAt:      &driveEndAt,
			StartPlace:   &home,
			EndPlace:     &work,
			DistanceM:    &distance,
			EnergyUsedWh: &energy,
		}},
	}, time.UTC, true)

	if len(analytics.ContributingDrives) != 1 {
		t.Fatalf("drives = %d, want 1", len(analytics.ContributingDrives))
	}
	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceHigh {
		t.Errorf("confidence = %q, want high", drive.Confidence)
	}
	wantMeasured(t, drive.FSDDistanceM, 500, "drive FSD distance")
	wantMeasured(t, drive.FSDSharePct, 50, "drive FSD share")
	if drive.FirmwareVersion == nil || *drive.FirmwareVersion != "2026.20.3" {
		t.Errorf("firmware = %v", drive.FirmwareVersion)
	}
	if len(drive.Evidence) != 1 || !drive.Evidence[0].Approximate {
		t.Fatalf("evidence = %+v", drive.Evidence)
	}
	wantMeasured(t, analytics.Attribution.AttributedDistanceM, 500, "attributed distance")
	wantMeasured(t, analytics.Attribution.AmbiguousDistanceM, 0, "ambiguous distance")
	if analytics.Attribution.UnknownDriveDistanceM != 0 {
		t.Errorf("unknown drive distance = %v, want 0", analytics.Attribution.UnknownDriveDistanceM)
	}
}

func TestBuildDriveAnalytics_SparseIntervalAcrossDrivesIsAmbiguous(t *testing.T) {
	start := at(t, "2026-03-03T08:00:00Z")
	end := at(t, "2026-03-03T13:00:00Z")
	firstStart := at(t, "2026-03-03T10:00:00Z")
	firstEnd := at(t, "2026-03-03T10:30:00Z")
	secondStart := at(t, "2026-03-03T11:00:00Z")
	secondEnd := at(t, "2026-03-03T11:30:00Z")
	distance := 2000.0
	samples := []Sample{
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T09:00:00Z"), 1000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T09:00:00Z"), 10000),
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T12:00:00Z"), 2000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T12:00:00Z"), 14000),
	}
	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-5*time.Hour), start, samples)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{
			{ID: 1, StartedAt: firstStart, EndedAt: &firstEnd, DistanceM: &distance},
			{ID: 2, StartedAt: secondStart, EndedAt: &secondEnd, DistanceM: &distance},
		},
	}, time.UTC, true)

	wantMeasured(t, analytics.Attribution.AmbiguousDistanceM, 1000, "ambiguous distance")
	if len(analytics.ContributingDrives) != 2 {
		t.Fatalf("drives = %d, want 2", len(analytics.ContributingDrives))
	}
	for _, drive := range analytics.ContributingDrives {
		if drive.Confidence != ConfidenceAmbiguous {
			t.Errorf("drive %d confidence = %q", drive.DriveID, drive.Confidence)
		}
		wantMeasured(t, drive.FSDDistanceM, 500, "proportional ambiguous estimate")
	}
}

func TestBuildDriveAnalytics_PreviousPeriodDrivePreventsFalseUniqueAttribution(t *testing.T) {
	start := at(t, "2026-03-03T10:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	previousDriveStart := at(t, "2026-03-03T09:40:00Z")
	previousDriveEnd := start
	currentDriveStart := at(t, "2026-03-03T10:10:00Z")
	currentDriveEnd := at(t, "2026-03-03T10:40:00Z")
	distance := 2000.0
	samples := []Sample{
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T09:30:00Z"), 1000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T09:30:00Z"), 10000),
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T11:00:00Z"), 2000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T11:00:00Z"), 14000),
	}
	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-2*time.Hour), start, samples)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{
			{
				ID:        1,
				StartedAt: previousDriveStart,
				EndedAt:   &previousDriveEnd,
				DistanceM: &distance,
			},
			{
				ID:        2,
				StartedAt: currentDriveStart,
				EndedAt:   &currentDriveEnd,
				DistanceM: &distance,
			},
		},
	}, time.UTC, true)

	wantMeasured(t, analytics.Attribution.AmbiguousDistanceM, 1000, "ambiguous distance")
	if len(analytics.ContributingDrives) != 1 {
		t.Fatalf("current-period drives = %d, want 1", len(analytics.ContributingDrives))
	}
	drive := analytics.ContributingDrives[0]
	if drive.DriveID != 2 || drive.Confidence != ConfidenceAmbiguous {
		t.Errorf("current drive = %+v, want drive 2 with ambiguous confidence", drive)
	}
	wantMeasured(t, drive.FSDDistanceM, 600, "current drive proportional estimate")
}

func TestBuildDriveAnalytics_ExcludesPartialAndOngoingBoundaryDrives(t *testing.T) {
	start := at(t, "2026-03-03T10:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	beforeStart := at(t, "2026-03-03T09:30:00Z")
	leftEnd := at(t, "2026-03-03T10:30:00Z")
	containedStart := at(t, "2026-03-03T10:45:00Z")
	containedEnd := at(t, "2026-03-03T11:15:00Z")
	rightStart := at(t, "2026-03-03T11:30:00Z")
	rightEnd := at(t, "2026-03-03T12:30:00Z")
	distance := 10000.0

	current := responseForRange(7, start, end, nil)
	previous := responseForRange(7, start.Add(-2*time.Hour), start, nil)
	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		Drives: []DriveRecord{
			{ID: 1, StartedAt: beforeStart, EndedAt: &leftEnd, DistanceM: &distance},
			{ID: 2, StartedAt: containedStart, EndedAt: &containedEnd, DistanceM: &distance},
			{ID: 3, StartedAt: rightStart, EndedAt: &rightEnd, DistanceM: &distance},
			{ID: 4, StartedAt: rightStart, EndedAt: nil, DistanceM: &distance},
		},
	}, time.UTC, true)

	if len(analytics.ContributingDrives) != 1 {
		t.Fatalf("drives = %+v, want only the fully contained drive", analytics.ContributingDrives)
	}
	if analytics.ContributingDrives[0].DriveID != 2 {
		t.Errorf("drive id = %d, want 2", analytics.ContributingDrives[0].DriveID)
	}
	if analytics.ContributingDrives[0].Confidence != ConfidenceUnknown {
		t.Errorf("confidence = %q, want unknown without counter evidence", analytics.ContributingDrives[0].Confidence)
	}
	if analytics.Attribution.UnknownDriveDistanceM != distance {
		t.Errorf("unknown full-drive distance = %v, want %v", analytics.Attribution.UnknownDriveDistanceM, distance)
	}
}

func TestBuildDriveAnalytics_PostWindowIncreaseCannotCertifyHighConfidenceZero(t *testing.T) {
	start := at(t, "2026-03-03T10:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	driveStart := at(t, "2026-03-03T11:58:00Z")
	driveEnd := at(t, "2026-03-03T11:59:30Z")
	distance := 1000.0
	samples := []Sample{
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T11:57:00Z"), 100),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T11:57:00Z"), 1000),
		trustedSample(SignalFSDDistance, end, 200),
		trustedSample(SignalDrivingDistance, end, 2000),
	}

	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-2*time.Hour), start, samples)
	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{{
			ID:        295,
			StartedAt: driveStart,
			EndedAt:   &driveEnd,
			DistanceM: &distance,
		}},
	}, time.UTC, true)

	if len(analytics.ContributingDrives) != 1 {
		t.Fatalf("drives = %+v", analytics.ContributingDrives)
	}
	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceUnknown || drive.FSDDistanceM != nil {
		t.Errorf("drive = %+v, want unknown because only the excluded end anchor closes coverage", drive)
	}
}

func TestBuildDriveAnalytics_PreviousWindowBaselineCannotHideEarlierDrives(t *testing.T) {
	start := at(t, "2026-03-03T10:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	previousStart := at(t, "2026-03-03T08:00:00Z")
	driveStart := at(t, "2026-03-03T10:15:00Z")
	driveEnd := at(t, "2026-03-03T10:45:00Z")
	distance := 2000.0
	samples := []Sample{
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T07:00:00Z"), 1000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T07:00:00Z"), 5000),
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T11:00:00Z"), 2000),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T11:00:00Z"), 9000),
	}

	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, previousStart, start, samples)
	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{{
			ID:        295,
			StartedAt: driveStart,
			EndedAt:   &driveEnd,
			DistanceM: &distance,
		}},
	}, time.UTC, true)

	wantMeasured(t, analytics.Attribution.UnattributedDistanceM, 1000, "pre-horizon interval")
	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceUnknown || drive.FSDDistanceM != nil {
		t.Errorf("drive = %+v, want unknown when the interval starts before the loaded drive horizon", drive)
	}
}

func TestBuildDriveAnalytics_MissingFSDObservationsRemainUnknown(t *testing.T) {
	start := at(t, "2026-03-03T09:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	driveStart := at(t, "2026-03-03T10:00:00Z")
	driveEndAt := at(t, "2026-03-03T11:00:00Z")
	distance := 12000.0
	samples := []Sample{
		trustedSample(SignalDrivingDistance, driveStart, 1000),
		trustedSample(SignalDrivingDistance, driveEndAt, 13000),
	}
	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-3*time.Hour), start, samples)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{{
			ID:        295,
			StartedAt: driveStart,
			EndedAt:   &driveEndAt,
			DistanceM: &distance,
		}},
	}, time.UTC, true)

	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceUnknown {
		t.Errorf("confidence = %q, want unknown", drive.Confidence)
	}
	wantUnmeasured(t, drive.FSDDistanceM, "drive FSD distance")
	wantUnmeasured(t, analytics.Attribution.AttributedDistanceM, "attributed bucket")
	if analytics.Attribution.UnknownDriveDistanceM != distance {
		t.Errorf("unknown distance = %v, want %v", analytics.Attribution.UnknownDriveDistanceM, distance)
	}
}

func TestBuildDriveAnalytics_UntrustedSampleBreaksAttributionContinuity(t *testing.T) {
	start := at(t, "2026-03-03T09:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	driveStart := at(t, "2026-03-03T10:00:00Z")
	driveEndAt := at(t, "2026-03-03T11:00:00Z")
	distance := 10000.0
	untrusted := trustedSample(
		SignalFSDDistance,
		at(t, "2026-03-03T10:30:00Z"),
		500,
	)
	untrusted.NormalizationVersion = nil
	samples := []Sample{
		trustedSample(SignalFSDDistance, at(t, "2026-03-03T09:59:00Z"), 100),
		trustedSample(SignalDrivingDistance, at(t, "2026-03-03T09:59:00Z"), 1000),
		untrusted,
		trustedSample(SignalFSDDistance, driveEndAt, 510),
		trustedSample(SignalDrivingDistance, driveEndAt, 11000),
	}
	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-3*time.Hour), start, samples)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{{
			ID:        295,
			StartedAt: driveStart,
			EndedAt:   &driveEndAt,
			DistanceM: &distance,
		}},
	}, time.UTC, true)

	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceUnknown || drive.FSDDistanceM != nil {
		t.Fatalf("drive = %+v, want unknown after an untrusted continuity barrier", drive)
	}
	if len(drive.Evidence) != 0 {
		t.Errorf("evidence = %+v, want none across an untrusted row", drive.Evidence)
	}
}

func TestBuildDriveAnalytics_DrivingBarrierPreventsHighConfidenceZero(t *testing.T) {
	start := at(t, "2026-03-03T09:00:00Z")
	end := at(t, "2026-03-03T11:00:00Z")
	driveStart := at(t, "2026-03-03T10:00:00Z")
	driveEndAt := at(t, "2026-03-03T10:02:00Z")
	distance := 2000.0
	untrustedDriving := trustedSample(
		SignalDrivingDistance,
		at(t, "2026-03-03T10:01:00Z"),
		1100,
	)
	untrustedDriving.NormalizationVersion = nil
	samples := []Sample{
		trustedSample(SignalFSDDistance, driveStart, 100),
		trustedSample(SignalDrivingDistance, driveStart, 1000),
		untrustedDriving,
		trustedSample(SignalFSDDistance, driveEndAt, 100),
		trustedSample(SignalDrivingDistance, driveEndAt, 1200),
	}
	current := responseForRange(7, start, end, samples)
	previous := responseForRange(7, start.Add(-2*time.Hour), start, samples)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		CounterSamples: samples,
		Drives: []DriveRecord{{
			ID:        295,
			StartedAt: driveStart,
			EndedAt:   &driveEndAt,
			DistanceM: &distance,
		}},
	}, time.UTC, false)

	drive := analytics.ContributingDrives[0]
	if drive.Confidence != ConfidenceUnknown || drive.FSDDistanceM != nil {
		t.Fatalf("drive = %+v, want unknown after a driving-counter barrier", drive)
	}
}

func TestFirmwareAtRejectedRowClearsStaleVersionUntilTrustedRecovery(t *testing.T) {
	version := int16(trustedSignalLogNormalizationVersion)
	start := at(t, "2026-03-03T09:00:00Z")
	samples := []VersionSample{
		{
			TS:                   start,
			Version:              "2026.20.3",
			NormalizationVersion: &version,
		},
		{
			TS:      start.Add(time.Hour),
			Version: "2026.20.4",
		},
		{
			TS:                   start.Add(2 * time.Hour),
			Version:              "2026.20.5",
			NormalizationVersion: &version,
		},
	}

	if got := firmwareAt(samples, start.Add(90*time.Minute)); got != nil {
		t.Fatalf("firmware after rejected row = %q, want unknown", *got)
	}
	got := firmwareAt(samples, start.Add(3*time.Hour))
	if got == nil || *got != "2026.20.5" {
		t.Fatalf("firmware after trusted recovery = %v, want 2026.20.5", got)
	}
}

func TestBuildDriveAnalyticsSanitizesNonFiniteDriveValues(t *testing.T) {
	start := at(t, "2026-03-03T09:00:00Z")
	end := at(t, "2026-03-03T12:00:00Z")
	driveStart := at(t, "2026-03-03T10:00:00Z")
	driveEndAt := at(t, "2026-03-03T11:00:00Z")
	distance := math.NaN()
	energy := math.Inf(1)
	current := responseForRange(7, start, end, nil)
	previous := responseForRange(7, start.Add(-3*time.Hour), start, nil)

	analytics := BuildDriveAnalytics(current, previous, AnalyticsInput{
		Drives: []DriveRecord{{
			ID:           295,
			StartedAt:    driveStart,
			EndedAt:      &driveEndAt,
			DistanceM:    &distance,
			EnergyUsedWh: &energy,
		}},
	}, time.UTC, false)

	drive := analytics.ContributingDrives[0]
	if drive.DistanceM != nil || drive.EnergyUsedWh != nil {
		t.Fatalf("non-finite values escaped sanitization: %+v", drive)
	}
	if _, err := json.Marshal(analytics); err != nil {
		t.Fatalf("marshal analytics: %v", err)
	}
}

func TestRouteGroupsAndEfficiencyRequireRepeatedHighConfidenceDrives(t *testing.T) {
	startPlace := "Home"
	endPlace := "Office"
	startGeofence := int64(10)
	endGeofence := int64(20)
	distance := 10000.0
	shares := []float64{50, 60, 0, 10}
	energies := []float64{2000, 2200, 1800, 2000}
	summaries := make([]DriveFSDInsight, 0, 4)
	driveByID := make(map[int64]DriveRecord, 4)
	for index := range shares {
		id := int64(index + 1)
		fsdDistance := distance * shares[index] / 100
		share := shares[index]
		energy := energies[index]
		summaries = append(summaries, DriveFSDInsight{
			DriveID:      id,
			DistanceM:    &distance,
			EnergyUsedWh: &energy,
			FSDDistanceM: &fsdDistance,
			FSDSharePct:  &share,
			Confidence:   ConfidenceHigh,
		})
		driveByID[id] = DriveRecord{
			ID:              id,
			StartPlace:      &startPlace,
			EndPlace:        &endPlace,
			StartGeofenceID: &startGeofence,
			EndGeofenceID:   &endGeofence,
			DistanceM:       &distance,
			EnergyUsedWh:    &energy,
		}
	}

	routes := buildRouteGroups(summaries, driveByID)
	if len(routes) != 1 || routes[0].DriveCount != 4 {
		t.Fatalf("routes = %+v", routes)
	}
	wantMeasured(t, routes[0].FSDSharePct, 30, "route FSD share")

	comparisons := buildEfficiencyComparisons(summaries, driveByID)
	if len(comparisons) != 1 {
		t.Fatalf("comparisons = %+v", comparisons)
	}
	comparison := comparisons[0]
	if comparison.FSDHeavyEfficiencyWhPerKM != 210 ||
		comparison.LowFSDEfficiencyWhPerKM != 190 {
		t.Errorf("efficiencies = %v / %v", comparison.FSDHeavyEfficiencyWhPerKM, comparison.LowFSDEfficiencyWhPerKM)
	}
	if !approx(comparison.DifferencePct, 10.53) {
		t.Errorf("difference = %v, want 10.53", comparison.DifferencePct)
	}

	zeroEnergy := 0.0
	zeroHeavy := append([]DriveFSDInsight(nil), summaries...)
	zeroHeavy[0].EnergyUsedWh = &zeroEnergy
	zeroHeavy[1].EnergyUsedWh = &zeroEnergy
	if got := buildEfficiencyComparisons(zeroHeavy, driveByID); len(got) != 0 {
		t.Errorf("zero-energy heavy cohort produced comparison: %+v", got)
	}
}

func TestPeriodComparisonRequiresEquivalentTrustedBaselines(t *testing.T) {
	currentDistance := 200.0
	previousDistance := 100.0
	currentShare := 50.0
	previousShare := 25.0
	current := Response{
		Totals: Totals{
			FSDDistanceM: &currentDistance,
			FSDSharePct:  &currentShare,
		},
		Quality: Quality{ShareBasisAvailable: true},
	}
	previous := Response{
		Totals: Totals{
			FSDDistanceM: &previousDistance,
			FSDSharePct:  &previousShare,
		},
		Quality: Quality{ShareBasisAvailable: true},
	}

	incomplete := emptyDriveAnalytics(current, previous).Comparison
	if incomplete.FSDDistanceChangeM != nil || incomplete.FSDShareChangePctPoints != nil {
		t.Fatalf("incomplete periods produced comparison deltas: %+v", incomplete)
	}

	current.Quality.FSDBaselineAvailable = true
	current.Quality.DrivingBaselineAvailable = true
	previous.Quality.FSDBaselineAvailable = true
	previous.Quality.DrivingBaselineAvailable = true
	comparable := emptyDriveAnalytics(current, previous).Comparison
	wantMeasured(t, comparable.FSDDistanceChangeM, 100, "distance change")
	wantMeasured(t, comparable.FSDShareChangePctPoints, 25, "share change")

	previous.Quality.FSDResetCount = 1
	resetAffected := emptyDriveAnalytics(current, previous).Comparison
	if resetAffected.FSDDistanceChangeM != nil || resetAffected.FSDShareChangePctPoints != nil {
		t.Fatalf("reset-affected periods produced comparison deltas: %+v", resetAffected)
	}
}

func TestMinuteCompactionFirstAndLastPreserveCoverageGap(t *testing.T) {
	start := at(t, "2026-03-03T10:00:30Z")
	end := at(t, "2026-03-03T10:02:45Z")
	drive := DriveRecord{
		ID:        295,
		StartedAt: start,
		EndedAt:   &end,
	}
	observations := []counterObservation{
		{at: start, segment: 1, companionSegment: 1},
		{at: at(t, "2026-03-03T10:02:00Z"), segment: 1, companionSegment: 1},
		{at: end, segment: 1, companionSegment: 1},
	}

	if !hasSynchronizedCoverage(drive, observations, end.Add(time.Minute), false) {
		t.Fatal("first and last observations of each minute must preserve raw <=2 minute coverage")
	}
	if hasSynchronizedCoverage(
		drive,
		[]counterObservation{observations[0], observations[2]},
		end.Add(time.Minute),
		false,
	) {
		t.Fatal("last-only minute compaction would incorrectly bridge a 135-second gap")
	}
}

func TestCompactEvidenceCoalescesAdjacentIntervalsAndCapsOutput(t *testing.T) {
	start := at(t, "2026-03-03T10:00:00Z")
	intervals := []EvidenceInterval{
		{
			StartAt:      start,
			EndAt:        start.Add(time.Minute),
			FSDDistanceM: 100,
			Confidence:   ConfidenceHigh,
			Approximate:  true,
		},
		{
			StartAt:      start.Add(time.Minute),
			EndAt:        start.Add(2 * time.Minute),
			FSDDistanceM: 200,
			Confidence:   ConfidenceHigh,
			Approximate:  true,
		},
		{
			StartAt:      start.Add(3 * time.Minute),
			EndAt:        start.Add(4 * time.Minute),
			FSDDistanceM: 50,
			Confidence:   ConfidenceHigh,
			Approximate:  true,
		},
	}

	compacted, truncated := compactEvidence(intervals, 10)
	if truncated || len(compacted) != 2 {
		t.Fatalf("compacted = %+v, truncated=%v", compacted, truncated)
	}
	if compacted[0].FSDDistanceM != 300 ||
		!compacted[0].EndAt.Equal(start.Add(2*time.Minute)) {
		t.Errorf("merged interval = %+v", compacted[0])
	}

	capped, truncated := compactEvidence(intervals, 1)
	if !truncated || len(capped) != 1 {
		t.Fatalf("capped = %+v, truncated=%v", capped, truncated)
	}
}
