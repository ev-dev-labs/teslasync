// TCO narration wire-shape tests.
//
// Wire-shape contract test for the canonical
// /api/v1/analytics/tco endpoint. Locks the JSON field list +
// types so a future refactor of [ComputeTCOSummary] /
// [Handler.GetTCO] cannot silently drop or rename a field
// the SPA's TrueCostPage chart consumes.
//
// The deterministic TCO chart on /tco (and its alias
// /analytics/tco) iterates over `monthly_breakdown` and reads 17
// top-level scalar / vector fields by snake_case key. A drift
// here would be invisible to the React unit tests (they use
// hand-rolled fixture JSON) but would break the production
// chart.
//
// This test lives with the AI code because [ComputeTCOSummary]
// is shared with the AI tool. It pins the OUTPUT of the handler
// so the refactor cannot silently change the wire
// shape — the AI envelope is allowed to grow, but the legacy
// chart contract is not allowed to shrink.

package tco

import (
	"math"
	"reflect"
	"sort"
	"testing"
)

// TestComputeTCOSummary_StructFieldsPinWireShape pins the
// field-name list of [TCOSummary] against the canonical
// /api/v1/analytics/tco JSON shape consumed by TrueCostPage.tsx.
// Adding a new field is fine (the SPA ignores unknown keys);
// renaming or removing one is a breaking change that MUST land
// alongside a coordinated TS interface change.
//
// This test inspects the struct via reflection rather than
// running the helper because running ComputeTCOSummary requires
// a live database. The struct shape IS the contract.
func TestComputeTCOSummary_StructFieldsPinWireShape(t *testing.T) {
	t.Parallel()

	wantTopLevel := []string{
		"base_cost_per_kwh",
		"cost_per_km_ev",
		"cost_per_km_ice",
		"equivalent_gas_cost",
		"first_date",
		"gas_efficiency_mpg",
		"gas_price",
		"gas_unit",
		"last_date",
		"maintenance_savings_estimate",
		"monthly_breakdown",
		"monthly_savings",
		"months_of_ownership",
		"total_charging_cost",
		"total_km",
		"total_savings",
		"total_sessions",
		"total_wh",
		"vehicle_id",
	}

	gotTopLevel := jsonTagsForStruct(t, TCOSummary{})
	sort.Strings(gotTopLevel)
	if !equalStringSlices(gotTopLevel, wantTopLevel) {
		t.Fatalf("TCOSummary JSON keys drifted:\ngot:  %v\nwant: %v", gotTopLevel, wantTopLevel)
	}

	wantMonthly := []string{
		"cumulative_savings",
		"energy_wh",
		"equiv_gas_cost",
		"ev_cost",
		"month",
		"savings",
	}
	gotMonthly := jsonTagsForStruct(t, TCOMonthlyEntry{})
	sort.Strings(gotMonthly)
	if !equalStringSlices(gotMonthly, wantMonthly) {
		t.Fatalf("TCOMonthlyEntry JSON keys drifted:\ngot:  %v\nwant: %v", gotMonthly, wantMonthly)
	}
}

func TestGasCostForDistanceKm_UsesConfiguredPriceUnit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		distanceKm   float64
		pricePerUnit float64
		efficiency   float64
		unit         string
		want         float64
	}{
		{
			name:         "gallon price",
			distanceKm:   160.934,
			pricePerUnit: 3.50,
			efficiency:   25,
			unit:         "gallon",
			want:         14,
		},
		{
			name:         "liter price",
			distanceKm:   160.934,
			pricePerUnit: 1.50,
			efficiency:   25,
			unit:         "liter",
			want:         4 * litersPerUSGallon * 1.50,
		},
		{
			name:         "case insensitive liter",
			distanceKm:   160.934,
			pricePerUnit: 1.50,
			efficiency:   25,
			unit:         " LITER ",
			want:         4 * litersPerUSGallon * 1.50,
		},
		{
			name:         "invalid denominator",
			distanceKm:   160.934,
			pricePerUnit: 3.50,
			efficiency:   0,
			unit:         "gallon",
			want:         0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := gasCostForDistanceKm(
				tt.distanceKm,
				tt.pricePerUnit,
				tt.efficiency,
				tt.unit,
			)
			if math.Abs(got-tt.want) > 0.000_001 {
				t.Fatalf("gasCostForDistanceKm() = %f, want %f", got, tt.want)
			}
		})
	}
}

// jsonTagsForStruct extracts the JSON tag (or field name as
// fallback) for every exported field on v.
func jsonTagsForStruct(t *testing.T, v interface{}) []string {
	t.Helper()
	out := make([]string, 0)
	rt := reflect.TypeOf(v)
	for i := 0; i < rt.NumField(); i++ {
		f := rt.Field(i)
		if !f.IsExported() {
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "" {
			out = append(out, f.Name)
			continue
		}
		// Strip ",omitempty" / ",string" suffixes — we want
		// the wire key, not the encoder hints.
		key := tag
		for i, c := range tag {
			if c == ',' {
				key = tag[:i]
				break
			}
		}
		if key == "-" {
			continue
		}
		out = append(out, key)
	}
	return out
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
