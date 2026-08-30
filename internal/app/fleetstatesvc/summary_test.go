package fleetstatesvc

// Summary (trust taxonomy) tests.
//
// The summary is the panel's first paint, so the rule it must never break is:
// an operational claim requires CURRENT, VERIFIED evidence, and everything
// else is a statement about our evidence — never about the vehicle. In
// particular, `offline` must be unreachable from missing / stale / unverified
// / failed data.

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
)

var summaryNow = time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)

func resolvedItem(id int64, state *vehiclemodel.VehicleState, observedAgo time.Duration, freshness service.StateFreshness, verified ...string) VehicleStateItem {
	observed := summaryNow.Add(-observedAgo)
	item := VehicleStateItem{
		VehicleID:      id,
		Outcome:        OutcomeResolved,
		State:          state,
		Live:           true,
		DataSource:     service.DataSourceLiveSignalStore,
		ObservedAt:     &observed,
		Freshness:      string(freshness),
		VerifiedFields: verified,
	}
	if item.VerifiedFields == nil {
		item.VerifiedFields = []string{}
	}
	return item
}

func TestSummaryCountsTrustedOperationalStatuses(t *testing.T) {
	items := []VehicleStateItem{
		resolvedItem(1, &vehiclemodel.VehicleState{State: enums.StateParked, IsCharging: true}, time.Second, service.FreshnessFresh, "is_charging", "state"),
		resolvedItem(2, &vehiclemodel.VehicleState{State: enums.StateParked, Speed: 42}, time.Second, service.FreshnessFresh, "speed", "state"),
		resolvedItem(3, &vehiclemodel.VehicleState{State: enums.StateParked}, time.Second, service.FreshnessFresh, "state"),
		resolvedItem(4, &vehiclemodel.VehicleState{State: enums.StateAsleep}, time.Second, service.FreshnessFresh, "state"),
		resolvedItem(5, &vehiclemodel.VehicleState{State: enums.StateOnline}, time.Second, service.FreshnessFresh, "state"),
		resolvedItem(6, &vehiclemodel.VehicleState{State: enums.StateOffline}, time.Second, service.FreshnessFresh, "state"),
		resolvedItem(7, &vehiclemodel.VehicleState{State: "updating"}, time.Second, service.FreshnessFresh, "state"),
	}

	got := summarise(items, summaryNow)

	want := OperationalTotals{Charging: 1, Driving: 1, Parked: 1, Asleep: 1, Online: 1, Offline: 1, Other: 1}
	if got.Operational != want {
		t.Fatalf("operational = %+v, want %+v", got.Operational, want)
	}
	if got.VerifiedCount != 7 || got.AttentionCount != 0 {
		t.Fatalf("coverage = %d verified / %d attention, want 7/0", got.VerifiedCount, got.AttentionCount)
	}
	if got.Counted != 7 {
		t.Fatalf("counted = %d, want 7", got.Counted)
	}
}

func TestSummaryPrecedenceMatchesItemDerivation(t *testing.T) {
	// Charging outranks motion, motion outranks the FSM state — the same
	// precedence a client applies to the per-item metadata.
	items := []VehicleStateItem{
		resolvedItem(1, &vehiclemodel.VehicleState{State: enums.StateDriving, IsCharging: true, Speed: 30},
			time.Second, service.FreshnessFresh, "is_charging", "speed", "state"),
		resolvedItem(2, &vehiclemodel.VehicleState{State: enums.StateParked, Speed: 30},
			time.Second, service.FreshnessFresh, "speed", "state"),
	}

	got := summarise(items, summaryNow)

	if got.Operational.Charging != 1 {
		t.Fatalf("charging = %d, want the charging claim to win over motion", got.Operational.Charging)
	}
	if got.Operational.Driving != 1 {
		t.Fatalf("driving = %d, want verified motion to win over the parked FSM state", got.Operational.Driving)
	}
	if got.Operational.Parked != 0 {
		t.Fatalf("parked = %d, want 0", got.Operational.Parked)
	}
}

func TestSummaryNeverClaimsOfflineWithoutTrustedEvidence(t *testing.T) {
	offline := func() *vehiclemodel.VehicleState {
		return &vehiclemodel.VehicleState{State: enums.StateOffline}
	}
	items := []VehicleStateItem{
		// Stale stream: a real observation, outside the freshness window.
		resolvedItem(1, offline(), 10*time.Minute, service.FreshnessStale, "state"),
		// Fresh stream but `state` is not backed by a real observation.
		resolvedItem(2, offline(), time.Second, service.FreshnessFresh, "battery_level"),
		// No real observation at all (durable fallback only).
		{
			VehicleID: 3, Outcome: OutcomeResolved, State: offline(),
			DataSource: service.DataSourceDBFallback, Freshness: string(service.FreshnessUnknown),
			VerifiedFields: []string{},
		},
		// Authoritative absence.
		{VehicleID: 4, Outcome: OutcomeMissing, DataSource: DataSourceUnavailable, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}},
		// Our failure.
		{VehicleID: 5, Outcome: OutcomeFailed, DataSource: DataSourceUnavailable, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}, Error: ErrCodeStateUnavailable},
	}

	got := summarise(items, summaryNow)

	if got.Operational != (OperationalTotals{}) {
		t.Fatalf("operational = %+v, want no claims at all — none of these items is trusted", got.Operational)
	}
	want := AttentionTotals{Stale: 1, Unverified: 1, Unknown: 1, Missing: 1, Failed: 1}
	if got.Attention != want {
		t.Fatalf("attention = %+v, want %+v", got.Attention, want)
	}
	if got.VerifiedCount != 0 || got.AttentionCount != 5 {
		t.Fatalf("coverage = %d/%d, want 0 verified and 5 needing attention", got.VerifiedCount, got.AttentionCount)
	}
}

func TestSummaryDemotesAnItemThatAgedOutOfTheFreshnessWindow(t *testing.T) {
	// The item CLAIMS fresh, but its observation is older than the window at
	// the request-level now. The summary trusts the instant, not the label.
	item := resolvedItem(1, &vehiclemodel.VehicleState{State: enums.StateParked}, 5*time.Minute, service.FreshnessFresh, "state")

	got := summarise([]VehicleStateItem{item}, summaryNow)

	if got.VerifiedCount != 0 {
		t.Fatalf("verified = %d, want 0 for an observation outside the window", got.VerifiedCount)
	}
	if got.Attention.Stale != 1 {
		t.Fatalf("attention = %+v, want the item classified stale", got.Attention)
	}
}

func TestSummaryTreatsResolvedWithoutStateAsMissing(t *testing.T) {
	items := []VehicleStateItem{{
		VehicleID: 1, Outcome: OutcomeResolved, State: nil,
		DataSource: DataSourceUnavailable, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{},
	}}

	got := summarise(items, summaryNow)

	if got.Attention.Missing != 1 {
		t.Fatalf("attention = %+v, want a stateless resolved item counted as missing", got.Attention)
	}
	if got.Operational.Offline != 0 {
		t.Fatal("a stateless item must never be counted offline")
	}
}

func TestSummaryReportsOldestAndNewestRealObservation(t *testing.T) {
	items := []VehicleStateItem{
		resolvedItem(1, &vehiclemodel.VehicleState{State: enums.StateParked}, 90*time.Second, service.FreshnessFresh, "state"),
		resolvedItem(2, &vehiclemodel.VehicleState{State: enums.StateParked}, 30*time.Minute, service.FreshnessStale, "state"),
		resolvedItem(3, &vehiclemodel.VehicleState{State: enums.StateParked}, 5*time.Second, service.FreshnessFresh, "state"),
		// No observation instant at all: must not participate.
		{VehicleID: 4, Outcome: OutcomeMissing, DataSource: DataSourceUnavailable, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}},
	}

	got := summarise(items, summaryNow)

	if got.ObservedCount != 3 {
		t.Fatalf("observed_count = %d, want 3", got.ObservedCount)
	}
	if got.OldestObservedAt == nil || !got.OldestObservedAt.Equal(summaryNow.Add(-30*time.Minute)) {
		t.Fatalf("oldest = %v, want the stalest real observation", got.OldestObservedAt)
	}
	if got.NewestObservedAt == nil || !got.NewestObservedAt.Equal(summaryNow.Add(-5*time.Second)) {
		t.Fatalf("newest = %v, want the freshest real observation", got.NewestObservedAt)
	}
}

func TestSummaryTaxonomyIsExhaustiveAndExclusive(t *testing.T) {
	items := []VehicleStateItem{
		resolvedItem(1, &vehiclemodel.VehicleState{State: enums.StateParked, IsCharging: true}, time.Second, service.FreshnessFresh, "is_charging", "state"),
		resolvedItem(2, &vehiclemodel.VehicleState{State: enums.StateParked}, time.Second, service.FreshnessFresh, "state"),
		resolvedItem(3, &vehiclemodel.VehicleState{State: enums.StateParked}, 10*time.Minute, service.FreshnessStale, "state"),
		resolvedItem(4, &vehiclemodel.VehicleState{State: enums.StateParked}, time.Second, service.FreshnessFresh),
		{VehicleID: 5, Outcome: OutcomeResolved, State: &vehiclemodel.VehicleState{State: enums.StateParked}, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}},
		{VehicleID: 6, Outcome: OutcomeMissing, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}},
		{VehicleID: 7, Outcome: OutcomeFailed, Freshness: string(service.FreshnessUnknown), VerifiedFields: []string{}},
	}

	got := summarise(items, summaryNow)

	operational := got.Operational.Charging + got.Operational.Driving + got.Operational.Parked +
		got.Operational.Asleep + got.Operational.Online + got.Operational.Offline + got.Operational.Other
	attention := got.Attention.Unverified + got.Attention.Stale + got.Attention.Unknown +
		got.Attention.Missing + got.Attention.Failed
	if operational+attention != len(items) {
		t.Fatalf("taxonomy covered %d of %d items (operational %d, attention %d)", operational+attention, len(items), operational, attention)
	}
	if operational != got.VerifiedCount || attention != got.AttentionCount {
		t.Fatalf("bucket totals disagree with the coverage counters: %+v", got)
	}
}

func TestSummaryOfAnEmptyPageIsZeroed(t *testing.T) {
	got := summarise(nil, summaryNow)
	if got.Counted != 0 || got.VerifiedCount != 0 || got.AttentionCount != 0 {
		t.Fatalf("summary = %+v, want zeroes", got)
	}
	if got.OldestObservedAt != nil || got.NewestObservedAt != nil {
		t.Fatal("an empty page has no observations, not a fabricated instant")
	}
}
