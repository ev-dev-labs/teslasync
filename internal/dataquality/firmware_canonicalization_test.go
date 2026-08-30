// Regression tests for firmware-segment canonicalization.
//
// A vehicle with no `Version` signal yields SQL NULL; a vehicle that reported
// an empty or whitespace-only Version yields "". Left un-canonicalized these
// are two distinct GROUP BY keys, which produces two "unknown" firmware
// segments. The visible damage is twofold:
//
//  1. vehicle_count is a per-group aggregate, so each partial group counts
//     only its own vehicles — the unknown cohort is undercounted.
//  2. The same field appears once per partial group, so the merged segment
//     lists duplicate FieldScore rows and double-counts its samples.
//
// The primary fix is SQL (NULLIF(btrim(...), '')); the Go merge is hardened as
// defence in depth. Both layers are pinned here.

package dataquality

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestScoreQuery_CanonicalizesFirmwareVersionInSQL(t *testing.T) {
	t.Parallel()
	if !strings.Contains(scoreQuery, "NULLIF(btrim(firmware.str_value), '') AS firmware_version") {
		t.Error("scoreQuery must fold NULL and empty/whitespace firmware versions to one NULL group in SQL")
	}
	// The raw, un-canonicalized projection must not come back.
	if strings.Contains(scoreQuery, "firmware.str_value AS firmware_version") {
		t.Error("scoreQuery still projects the raw firmware value without canonicalization")
	}
}

// Even if the SQL regressed, the Go merge must produce ONE unknown segment
// with the full vehicle count and no duplicated field.
func TestSnapshot_NullAndEmptyFirmwareCollapseToOneUnknownSegment(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	empty := ""
	blank := "   "

	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			// Same field arriving under three spellings of "unknown".
			{firmware: nil, vehicles: 2, field: "VehicleSpeed", count: 100, lastSeen: now, versioned: 100},
			{firmware: &empty, vehicles: 3, field: "VehicleSpeed", count: 50, lastSeen: now, versioned: 40, unversioned: 10},
			{firmware: &blank, vehicles: 5, field: "VehicleSpeed", count: 25, lastSeen: now, versioned: 25},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: versionOf(1), count: 165},
			{version: nil, count: 10},
		}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.FirmwareSegments) != 1 {
		t.Fatalf("firmware segments = %d, want exactly one unknown group", len(snap.FirmwareSegments))
	}
	segment := snap.FirmwareSegments[0]
	if segment.FirmwareVersion != nil {
		t.Errorf("unknown segment must carry a nil firmware version, got %q", *segment.FirmwareVersion)
	}
	if segment.FirmwareEvidenceState != "unknown" {
		t.Errorf("evidence state = %q, want unknown", segment.FirmwareEvidenceState)
	}
	// Undercount guard: the largest per-group aggregate wins, not the first.
	if segment.VehicleCount != 5 {
		t.Errorf("vehicle count = %d, want 5 (must not undercount the unknown cohort)", segment.VehicleCount)
	}
	// Duplicate guard: one field, not three.
	if len(segment.Fields) != 1 {
		t.Fatalf("segment fields = %d, want 1 merged VehicleSpeed", len(segment.Fields))
	}
	merged := segment.Fields[0]
	if merged.Field != "VehicleSpeed" {
		t.Errorf("merged field name = %q", merged.Field)
	}
	if merged.SampleCount != 175 {
		t.Errorf("merged sample count = %d, want 175", merged.SampleCount)
	}
	if merged.VersionedSampleCount != 165 || merged.UnversionedSampleCount != 10 {
		t.Errorf("merged coverage counts = %d/%d, want 165/10",
			merged.VersionedSampleCount, merged.UnversionedSampleCount)
	}
	// Segment totals must equal the merged field, not triple-count it.
	if segment.TotalSampleCount != 175 {
		t.Errorf("segment total = %d, want 175", segment.TotalSampleCount)
	}
	if segment.VersionedSampleCount != 165 || segment.UnversionedSampleCount != 10 {
		t.Errorf("segment coverage = %d/%d, want 165/10",
			segment.VersionedSampleCount, segment.UnversionedSampleCount)
	}
	if segment.NormalizationCoveragePct == nil ||
		!almostEqual(*segment.NormalizationCoveragePct, 165.0/175.0*100) {
		t.Errorf("segment coverage pct = %v", segment.NormalizationCoveragePct)
	}
}

// A known firmware version must stay its own segment and must be trimmed
// consistently so "2026.32.5" and " 2026.32.5 " are one cohort.
func TestSnapshot_KnownFirmwareIsTrimmedAndKeptSeparate(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	tight := "2026.32.5"
	padded := "  2026.32.5  "

	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{firmware: nil, vehicles: 1, field: "Gear", count: 10, lastSeen: now, unversioned: 10},
			{firmware: &tight, vehicles: 4, field: "VehicleSpeed", count: 100, lastSeen: now, versioned: 100},
			{firmware: &padded, vehicles: 4, field: "VehicleSpeed", count: 20, lastSeen: now, versioned: 20},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: versionOf(1), count: 120},
			{version: nil, count: 10},
		}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.FirmwareSegments) != 2 {
		t.Fatalf("segments = %d, want unknown + one known cohort", len(snap.FirmwareSegments))
	}
	// Unknown sorts first.
	if snap.FirmwareSegments[0].FirmwareVersion != nil {
		t.Error("unknown segment must sort first")
	}
	known := snap.FirmwareSegments[1]
	if known.FirmwareVersion == nil || *known.FirmwareVersion != tight {
		t.Fatalf("known firmware version = %v, want trimmed %q", known.FirmwareVersion, tight)
	}
	if known.FirmwareEvidenceState != "known" {
		t.Errorf("evidence state = %q, want known", known.FirmwareEvidenceState)
	}
	if known.VehicleCount != 4 {
		t.Errorf("known vehicle count = %d, want 4", known.VehicleCount)
	}
	if len(known.Fields) != 1 || known.Fields[0].SampleCount != 120 {
		t.Errorf("padded and tight spellings must merge into one field: %+v", known.Fields)
	}
}

// The window-wide Fields list is keyed by field name only, so it must already
// be free of firmware-group duplication.
func TestSnapshot_TopLevelFieldsAreNotDuplicatedByFirmwareGroups(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	empty := ""
	a := "2026.1.1"

	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{firmware: nil, vehicles: 1, field: "VehicleSpeed", count: 10, lastSeen: now, versioned: 10},
			{firmware: &empty, vehicles: 1, field: "VehicleSpeed", count: 10, lastSeen: now, versioned: 10},
			{firmware: &a, vehicles: 1, field: "VehicleSpeed", count: 10, lastSeen: now, versioned: 10},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{{version: versionOf(1), count: 30}}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Fields) != 1 {
		t.Fatalf("top-level fields = %d, want 1", len(snap.Fields))
	}
	if snap.Fields[0].SampleCount != 30 {
		t.Errorf("top-level sample count = %d, want 30", snap.Fields[0].SampleCount)
	}
}

func TestMergeFieldScores(t *testing.T) {
	t.Parallel()
	windowEnd := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	older := windowEnd.Add(-10 * time.Minute)
	newer := windowEnd.Add(-1 * time.Minute)

	a := FieldScore{
		Field: "VehicleSpeed", SampleCount: 100, LastSeenAt: older,
		MaxGapSeconds: 30, DuplicateRatio: 0.10,
		VersionedSampleCount: 80, UnversionedSampleCount: 20,
	}
	b := FieldScore{
		Field: "VehicleSpeed", SampleCount: 100, LastSeenAt: newer,
		MaxGapSeconds: 600, DuplicateRatio: 0.30,
		VersionedSampleCount: 100, UnversionedSampleCount: 0,
	}

	merged := mergeFieldScores(a, b, windowEnd)

	if merged.SampleCount != 200 {
		t.Errorf("sample count = %d, want 200", merged.SampleCount)
	}
	if !merged.LastSeenAt.Equal(newer) {
		t.Errorf("last seen = %v, want the later %v", merged.LastSeenAt, newer)
	}
	if !almostEqual(merged.FreshnessSeconds, 60) {
		t.Errorf("freshness = %v, want 60 (re-derived from the merged last-seen)", merged.FreshnessSeconds)
	}
	if !almostEqual(merged.MaxGapSeconds, 600) {
		t.Errorf("max gap = %v, want the larger 600", merged.MaxGapSeconds)
	}
	// Equal sample counts ⇒ the weighted duplicate ratio is the mean.
	if !almostEqual(merged.DuplicateRatio, 0.20) {
		t.Errorf("duplicate ratio = %v, want the sample-weighted 0.20", merged.DuplicateRatio)
	}
	if merged.VersionedSampleCount != 180 || merged.UnversionedSampleCount != 20 {
		t.Errorf("coverage counts = %d/%d, want 180/20",
			merged.VersionedSampleCount, merged.UnversionedSampleCount)
	}
	if merged.NormalizationCoveragePct == nil || !almostEqual(*merged.NormalizationCoveragePct, 90) {
		t.Errorf("coverage pct = %v, want 90", merged.NormalizationCoveragePct)
	}
	if merged.NormalizationCoverageState != "measured" {
		t.Errorf("coverage state = %q, want measured", merged.NormalizationCoverageState)
	}
	// Composite/severity must be re-derived from the merged inputs.
	if !almostEqual(merged.CompositeScore, compositeScore(merged)) {
		t.Error("composite score is not self-consistent with the merged axes")
	}
	if merged.Severity != severity(merged) {
		t.Error("severity is not self-consistent with the merged composite")
	}
}

// Merging two empty-sample scores must not divide by zero or fabricate
// coverage.
func TestMergeFieldScores_ZeroSamplesStaysUnknown(t *testing.T) {
	t.Parallel()
	windowEnd := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	a := FieldScore{Field: "Quiet", LastSeenAt: windowEnd}
	b := FieldScore{Field: "Quiet", LastSeenAt: windowEnd}

	merged := mergeFieldScores(a, b, windowEnd)

	if merged.SampleCount != 0 {
		t.Errorf("sample count = %d, want 0", merged.SampleCount)
	}
	if merged.DuplicateRatio != 0 {
		t.Errorf("duplicate ratio = %v, want 0", merged.DuplicateRatio)
	}
	if merged.NormalizationCoveragePct != nil {
		t.Errorf("coverage pct = %v, want nil (unknown, never a fabricated 0%%)", *merged.NormalizationCoveragePct)
	}
	if merged.NormalizationCoverageState != "unknown" {
		t.Errorf("coverage state = %q, want unknown", merged.NormalizationCoverageState)
	}
}
