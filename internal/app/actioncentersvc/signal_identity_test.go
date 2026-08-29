package actioncentersvc

import (
	"context"
	"errors"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	advanceddomain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
)

var errBoom = errors.New("roster query failed")

// ---------------------------------------------------------------------------
// Finding 1 — deterministic identity of the signal-freshness incident.
//
// deterministicID() hashes SourceFeature|SourceKey|VehicleID, and every
// acknowledgement / snooze / dismissal is keyed by that ID. Re-keying an
// EXISTING incident therefore silently orphans operator state: the old row
// keeps its status while the board renders a brand-new "open" card.
//
// The freshness incident has shipped under `vehicle:<id>` and must keep it.
// Only the newer normalization-provenance candidate may use a distinct key.
// ---------------------------------------------------------------------------

func TestSignalFreshnessSourceKeyIsStable(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	row := domain.SignalHealthRecord{
		Vehicle:        domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		LatestSignalAt: testTimePtr(now.Add(-48 * time.Hour)),
		CheckedAt:      now,
	}

	candidate := signalFreshnessCandidate(row, now)

	if candidate.SourceKey != "vehicle:7" {
		t.Fatalf(
			"freshness SourceKey = %q, want the historical %q — changing it "+
				"orphans every existing acknowledgement/snooze/dismissal",
			candidate.SourceKey, "vehicle:7",
		)
	}
	if candidate.DedupKey != "7:signal_freshness" {
		t.Errorf("freshness DedupKey = %q", candidate.DedupKey)
	}
}

// The exact recommendation ID is the operator-state primary key. Pin it as a
// literal so any future change to SourceFeature, SourceKey, or the hashing
// scheme fails here with an explicit migration prompt.
func TestSignalFreshnessRecommendationIDIsPinned(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	row := domain.SignalHealthRecord{
		Vehicle:        domain.VehicleRef{ID: 7},
		LatestSignalAt: testTimePtr(now.Add(-48 * time.Hour)),
		CheckedAt:      now,
	}

	got := deterministicID(signalFreshnessCandidate(row, now))

	// sha256("signal_health|vehicle:7|7")[:12] hex-encoded — the pre-existing
	// identity, verified independently of this implementation.
	const want = "ac_0424ea7e84a454956404b47c"
	if got != want {
		t.Fatalf(
			"freshness recommendation ID = %q, want %q. If this changed "+
				"deliberately, existing operator state must be migrated.",
			got, want,
		)
	}
}

// The provenance candidate is a NEW finding, so it must NOT collide with the
// freshness incident's identity — otherwise acknowledging one would silence
// the other.
func TestSignalProvenanceIdentityIsDistinctFromFreshness(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	row := domain.SignalHealthRecord{
		Vehicle:                domain.VehicleRef{ID: 7},
		LatestSignalAt:         testTimePtr(now.Add(-48 * time.Hour)),
		LatestUnversionedAt:    testTimePtr(now.Add(-49 * time.Hour)),
		SampleCount:            100,
		VersionedSampleCount:   80,
		UnversionedSampleCount: 20,
		CheckedAt:              now,
	}

	freshness := signalFreshnessCandidate(row, now)
	provenance := signalNormalizationCandidate(row, now)

	if provenance.SourceKey == freshness.SourceKey {
		t.Fatal("provenance must not reuse the freshness SourceKey")
	}
	if provenance.SourceKey != "signal_normalization_provenance:vehicle:7" {
		t.Errorf("provenance SourceKey = %q", provenance.SourceKey)
	}
	if provenance.DedupKey == freshness.DedupKey {
		t.Fatal("provenance must not reuse the freshness DedupKey")
	}
	if deterministicID(provenance) == deterministicID(freshness) {
		t.Fatal("provenance and freshness must hash to different recommendation IDs")
	}
	// Both remain under the same source feature so the Action Center filter
	// keeps grouping them together.
	if provenance.SourceFeature != domain.SourceSignalHealth ||
		freshness.SourceFeature != domain.SourceSignalHealth {
		t.Error("both findings must stay under SourceSignalHealth")
	}
}

// End-to-end: the two findings must carry independent operator state.
func TestSignalFreshnessIDSurvivesProvenanceRollout(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	// A vehicle that produces ONLY a freshness finding (fully attested rows)
	// must mint exactly the same ID as a vehicle that also produces a
	// provenance finding — the provenance rollout must not perturb it.
	freshOnly := domain.SignalHealthRecord{
		Vehicle:              domain.VehicleRef{ID: 7},
		LatestSignalAt:       testTimePtr(now.Add(-48 * time.Hour)),
		SampleCount:          100,
		VersionedSampleCount: 100,
		CheckedAt:            now,
	}
	both := domain.SignalHealthRecord{
		Vehicle:                domain.VehicleRef{ID: 7},
		LatestSignalAt:         testTimePtr(now.Add(-48 * time.Hour)),
		LatestUnversionedAt:    testTimePtr(now.Add(-49 * time.Hour)),
		SampleCount:            100,
		VersionedSampleCount:   80,
		UnversionedSampleCount: 20,
		CheckedAt:              now,
	}

	a := deterministicID(signalFreshnessCandidate(freshOnly, now))
	b := deterministicID(signalFreshnessCandidate(both, now))
	if a != b {
		t.Fatalf("freshness ID drifted with provenance data present: %q vs %q", a, b)
	}
}

// ---------------------------------------------------------------------------
// Finding 2 — advanced intelligence must enumerate the vehicle ROSTER.
//
// ListSignalHealth narrows to vehicles carrying a signal-health finding.
// Using it as the roster silently skipped every healthy, fully-versioned
// vehicle, so firmware canary / component survival / road hazard / behavioral
// sentinel evidence stopped being evaluated for exactly the fleet where it is
// most meaningful.
// ---------------------------------------------------------------------------

func TestAdvancedProviderEvaluatesFreshFullyVersionedVehicles(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	healthy := domain.VehicleRef{ID: 42, DisplayName: "Healthy"}
	version := "2026.32.5"

	source := &fakeSource{
		// Deliberately EMPTY: this vehicle is fresh and fully attested, so it
		// produces no signal-health finding at all.
		signals:  nil,
		vehicles: []domain.VehicleRef{healthy},
	}
	advanced := &fakeAdvancedIntelligence{
		firmware: &advanceddomain.Page[advanceddomain.FirmwareCanary]{
			Items: []advanceddomain.FirmwareCanary{{
				VehicleID: healthy.ID,
				Version:   &version,
				Decision:  advanceddomain.CanaryHold,
				WindowQuality: advanceddomain.DataQuality{
					Status:      advanceddomain.QualitySufficient,
					SampleCount: 40,
				},
			}},
		},
	}

	items, err := (advancedProvider{source: source, advanced: advanced}).Recommendations(
		context.Background(), ListFilter{}, now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) == 0 {
		t.Fatal("a fresh, fully-versioned vehicle produced no advanced-intelligence findings")
	}
	if items[0].Vehicle == nil || items[0].Vehicle.ID != healthy.ID {
		t.Fatalf("finding is not attributed to the healthy vehicle: %+v", items[0].Vehicle)
	}
	// It must have gone through the roster method, never the findings feed.
	if source.activeVehicleCalls != 1 {
		t.Errorf("ListActiveVehicles calls = %d, want 1", source.activeVehicleCalls)
	}
	if source.signalHealthCalls != 0 {
		t.Errorf("ListSignalHealth calls = %d, want 0 (findings feed is not a roster)", source.signalHealthCalls)
	}
	if source.activeVehicleLimit != advancedVehicleLimit {
		t.Errorf("roster limit = %d, want the bounded %d", source.activeVehicleLimit, advancedVehicleLimit)
	}
}

func TestAdvancedProviderEvaluatesEveryRosterVehicle(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	version := "2026.32.5"
	source := &fakeSource{vehicles: []domain.VehicleRef{
		{ID: 1, DisplayName: "One"},
		{ID: 2, DisplayName: "Two"},
		{ID: 3, DisplayName: "Three"},
	}}
	advanced := &fakeAdvancedIntelligence{
		firmware: &advanceddomain.Page[advanceddomain.FirmwareCanary]{
			Items: []advanceddomain.FirmwareCanary{{
				Version:  &version,
				Decision: advanceddomain.CanaryHold,
				WindowQuality: advanceddomain.DataQuality{
					Status:      advanceddomain.QualitySufficient,
					SampleCount: 40,
				},
			}},
		},
	}

	items, err := (advancedProvider{source: source, advanced: advanced}).Recommendations(
		context.Background(), ListFilter{}, now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	seen := map[int64]bool{}
	for _, item := range items {
		if item.Vehicle != nil {
			seen[item.Vehicle.ID] = true
		}
	}
	for _, id := range []int64{1, 2, 3} {
		if !seen[id] {
			t.Errorf("vehicle %d was never evaluated", id)
		}
	}
}

func TestAdvancedProviderPropagatesRosterError(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{vehicleErr: errBoom}
	_, err := (advancedProvider{source: source, advanced: &fakeAdvancedIntelligence{}}).Recommendations(
		context.Background(), ListFilter{}, now,
	)
	if err == nil {
		t.Fatal("expected the roster error to propagate")
	}
}

func TestAdvancedProviderEmptyRosterYieldsNoFindings(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{vehicles: nil}
	items, err := (advancedProvider{source: source, advanced: &fakeAdvancedIntelligence{}}).Recommendations(
		context.Background(), ListFilter{}, now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("empty roster produced %d findings", len(items))
	}
	if items == nil {
		t.Error("must return an empty slice, not nil")
	}
}
