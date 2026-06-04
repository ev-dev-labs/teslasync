package alert

import (
	"errors"
	"strings"
	"testing"

	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// TestAlertRuleColumnsIncludesMaxFiresCap pins the schema contract:
// max_fires_per_resolution must appear in BOTH the SELECT column list
// and the canonical scan order, otherwise a Create/Update would silently
// drop the value or scan it into the wrong destination.
//
// SQL-shape tests pin critical schema contracts without a containerised DB;
// see guard_repo_test.go, vampire_drain_repo_test.go, and mileage_repo_test.go
// for the same pattern.
func TestAlertRuleColumnsIncludesMaxFiresCap(t *testing.T) {
	if !strings.Contains(alertRuleColumns, "max_fires_per_resolution") {
		t.Fatalf("alertRuleColumns must include max_fires_per_resolution; got: %q", alertRuleColumns)
	}
}

// TestAlertRuleColumnsIncludesAllVehicles pins the schema contract: the
// all_vehicles column added in migration 000195 must appear in BOTH the SELECT
// column list and the canonical scan order. Without this, every Create/Update
// silently writes the column DEFAULT (TRUE), and scanning all_vehicles=FALSE
// would shift into the next destination pointer.
func TestAlertRuleColumnsIncludesAllVehicles(t *testing.T) {
	if !strings.Contains(alertRuleColumns, "all_vehicles") {
		t.Fatalf("alertRuleColumns must include all_vehicles; got: %q", alertRuleColumns)
	}
}

// TestValidateVehicleSelection pins the multi-select invariants Create
// and Update enforce before any SQL touches the row. It catches both the
// "all_vehicles + explicit subset" conflict and the "explicit subset but empty
// list" footgun.
func TestValidateVehicleSelection(t *testing.T) {
	tests := []struct {
		name        string
		allVehicles bool
		vehicleIDs  []int64
		wantErr     bool
	}{
		{name: "sticky_all_no_subset", allVehicles: true, vehicleIDs: nil, wantErr: false},
		{name: "sticky_all_empty_subset", allVehicles: true, vehicleIDs: []int64{}, wantErr: false},
		{name: "sticky_all_with_subset_rejected", allVehicles: true, vehicleIDs: []int64{1}, wantErr: true},
		{name: "explicit_one_vehicle", allVehicles: false, vehicleIDs: []int64{1}, wantErr: false},
		{name: "explicit_multi_vehicle", allVehicles: false, vehicleIDs: []int64{1, 2, 3}, wantErr: false},
		{name: "explicit_empty_subset_rejected", allVehicles: false, vehicleIDs: nil, wantErr: true},
		{name: "explicit_negative_id_rejected", allVehicles: false, vehicleIDs: []int64{-1}, wantErr: true},
		{name: "explicit_zero_id_rejected", allVehicles: false, vehicleIDs: []int64{0}, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateVehicleSelection(tt.allVehicles, tt.vehicleIDs)
			gotErr := err != nil
			if gotErr != tt.wantErr {
				t.Fatalf("validateVehicleSelection(%v, %v) err=%v, want err=%v",
					tt.allVehicles, tt.vehicleIDs, err, tt.wantErr)
			}
			if tt.wantErr && !errors.Is(err, ErrInvalidVehicleSelection) {
				t.Fatalf("expected ErrInvalidVehicleSelection sentinel, got %T: %v", err, err)
			}
		})
	}
}

// TestLegacyVehicleIDFor pins the rolling-deploy contract: the deprecated
// vehicle_id column is mirrored from the resolved (AllVehicles, VehicleIDs)
// pair on every write. A downgraded API binary that still reads the legacy
// column must see a sensible value.
func TestLegacyVehicleIDFor(t *testing.T) {
	tests := []struct {
		name        string
		allVehicles bool
		vehicleIDs  []int64
		wantNil     bool
		wantValue   int64
	}{
		{name: "all_vehicles_emits_nil", allVehicles: true, vehicleIDs: nil, wantNil: true},
		{name: "all_vehicles_with_subset_still_nil", allVehicles: true, vehicleIDs: []int64{5}, wantNil: true},
		{name: "single_vehicle_mirrors_id", allVehicles: false, vehicleIDs: []int64{42}, wantValue: 42},
		{name: "multi_vehicle_mirrors_min", allVehicles: false, vehicleIDs: []int64{7, 3, 9}, wantValue: 3},
		{name: "explicit_no_subset_emits_nil", allVehicles: false, vehicleIDs: nil, wantNil: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := legacyVehicleIDFor(tt.allVehicles, tt.vehicleIDs)
			if tt.wantNil {
				if got != nil {
					t.Fatalf("legacyVehicleIDFor(%v, %v) = %d, want nil",
						tt.allVehicles, tt.vehicleIDs, *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("legacyVehicleIDFor(%v, %v) = nil, want %d",
					tt.allVehicles, tt.vehicleIDs, tt.wantValue)
			}
			if *got != tt.wantValue {
				t.Fatalf("legacyVehicleIDFor(%v, %v) = %d, want %d",
					tt.allVehicles, tt.vehicleIDs, *got, tt.wantValue)
			}
		})
	}
}

// TestDedupAndSortVehicleIDs pins the normalisation pass: empty input
// returns a non-nil empty slice so JSON encodes `[]`, not `null`; duplicates
// are removed; output is sorted ascending so equality comparison and JSON
// output are deterministic.
func TestDedupAndSortVehicleIDs(t *testing.T) {
	tests := []struct {
		name string
		in   []int64
		want []int64
	}{
		{name: "nil_returns_non_nil_empty", in: nil, want: []int64{}},
		{name: "empty_returns_non_nil_empty", in: []int64{}, want: []int64{}},
		{name: "single", in: []int64{5}, want: []int64{5}},
		{name: "already_sorted_unique", in: []int64{1, 2, 3}, want: []int64{1, 2, 3}},
		{name: "unsorted_unique", in: []int64{3, 1, 2}, want: []int64{1, 2, 3}},
		{name: "with_duplicates", in: []int64{2, 1, 2, 3, 1}, want: []int64{1, 2, 3}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := dedupAndSortVehicleIDs(tt.in)
			if got == nil {
				t.Fatalf("dedupAndSortVehicleIDs returned nil; must always return non-nil for JSON `[]` encoding")
			}
			if len(got) != len(tt.want) {
				t.Fatalf("len = %d, want %d (got=%v want=%v)", len(got), len(tt.want), got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("got = %v, want %v", got, tt.want)
				}
			}
		})
	}
}

// TestAlertRulesEquivalentMultiVehicle pins the settings-export round-trip
// contract: two rules with the same (AllVehicles, VehicleIDs modulo order)
// compare equal so the import path correctly classifies them as "skipped"
// rather than "updated".
func TestAlertRulesEquivalentMultiVehicle(t *testing.T) {
	mk := func(all bool, ids []int64) *modelsAlertRuleStub {
		return &modelsAlertRuleStub{AllVehicles: all, VehicleIDs: ids}
	}
	_ = mk
	cases := []struct {
		name string
		a    func() *modelsAlertRuleStub
		b    func() *modelsAlertRuleStub
		want bool
	}{
		{
			name: "same_all_vehicles_empty_subset",
			a:    func() *modelsAlertRuleStub { return mk(true, nil) },
			b:    func() *modelsAlertRuleStub { return mk(true, nil) },
			want: true,
		},
		{
			name: "same_subset_different_order",
			a:    func() *modelsAlertRuleStub { return mk(false, []int64{1, 2, 3}) },
			b:    func() *modelsAlertRuleStub { return mk(false, []int64{3, 1, 2}) },
			want: true,
		},
		{
			name: "different_all_vehicles_flag",
			a:    func() *modelsAlertRuleStub { return mk(true, nil) },
			b:    func() *modelsAlertRuleStub { return mk(false, []int64{1}) },
			want: false,
		},
		{
			name: "different_subset_membership",
			a:    func() *modelsAlertRuleStub { return mk(false, []int64{1, 2}) },
			b:    func() *modelsAlertRuleStub { return mk(false, []int64{1, 3}) },
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := tc.a().toModel()
			b := tc.b().toModel()
			got := settingsdb.AlertRulesEquivalent(a, b)
			if got != tc.want {
				t.Fatalf("settingsdb.AlertRulesEquivalent(a=%+v, b=%+v) = %v, want %v", a, b, got, tc.want)
			}
		})
	}
}
