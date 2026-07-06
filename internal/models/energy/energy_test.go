package energy

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"testing"
)

// EnergyStatsRow is a pure transport DTO: its "behaviour" is entirely its
// JSON wire shape. The cagg_fleet_stats row Scan order
// (Date, EnergyWh, DistanceM, EfficiencyWhPerM, Cost), the OpenAPI schema,
// and the frontend efficiency/energy charts all depend on the exact field
// set, wire names, and SI-canonical units pinned below. These tests treat
// that contract as the unit under test.

// fieldContract is the authoritative, ordered description of EnergyStatsRow.
// Order matters: encoding/json emits struct fields in declaration order and
// the repo Scan relies on the same order.
var fieldContract = []struct {
	goName  string
	jsonTag string
	kind    reflect.Kind
}{
	{"Date", "date", reflect.String},
	{"EnergyWh", "energy_wh", reflect.Float64},
	{"DistanceM", "distance_m", reflect.Float64},
	{"EfficiencyWhPerM", "efficiency_wh_per_m", reflect.Float64},
	{"Cost", "cost", reflect.Float64},
}

// TestEnergyStatsRow_FieldContract pins the Go field names, ordering, kinds,
// and JSON tags. A failure here means the API/DB/frontend contract shifted
// and must be updated deliberately across all three surfaces.
func TestEnergyStatsRow_FieldContract(t *testing.T) {
	typ := reflect.TypeOf(EnergyStatsRow{})
	if got := typ.NumField(); got != len(fieldContract) {
		t.Fatalf("EnergyStatsRow has %d fields, want %d — JSON contract changed; update Scan order, OpenAPI schema, and frontend types", got, len(fieldContract))
	}
	for i, want := range fieldContract {
		f := typ.Field(i)
		if f.Name != want.goName {
			t.Errorf("field %d: Go name = %q, want %q", i, f.Name, want.goName)
		}
		if f.Type.Kind() != want.kind {
			t.Errorf("field %s: kind = %s, want %s", f.Name, f.Type.Kind(), want.kind)
		}
		tag := f.Tag.Get("json")
		if tag != want.jsonTag {
			t.Errorf("field %s: json tag = %q, want %q (bare name, no options)", f.Name, tag, want.jsonTag)
		}
	}
}

// TestEnergyStatsRow_NoLegacyUnitSuffixes enforces the Phase-48 SI-canonical
// rule at the type level: no JSON key may carry an imperial/legacy unit
// suffix. Guards against a future field being added with e.g. _mi or _kwh.
func TestEnergyStatsRow_NoLegacyUnitSuffixes(t *testing.T) {
	legacy := []string{"_mi", "_min", "_mph", "_kwh", "_kw", "_psi", "_ft", "_deg_f", "_f"}
	typ := reflect.TypeOf(EnergyStatsRow{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		tag, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		for _, suf := range legacy {
			if strings.HasSuffix(tag, suf) {
				t.Errorf("field %s json tag %q ends with legacy unit suffix %q — use SI (_m/_s/_mps/_wh/_w/_kpa)", f.Name, tag, suf)
			}
		}
	}
}

// TestEnergyStatsRow_MarshalJSON pins the exact serialized bytes for
// representative rows: key ordering, snake_case names, SI values, and the
// no-omitempty guarantee (zero values stay in the payload so charts plot a
// real 0 instead of treating a missing key as a gap).
func TestEnergyStatsRow_MarshalJSON(t *testing.T) {
	tests := []struct {
		name string
		row  EnergyStatsRow
		want string
	}{
		{
			name: "fully populated day",
			row:  EnergyStatsRow{Date: "2026-07-01", EnergyWh: 5000, DistanceM: 22000, EfficiencyWhPerM: 0.2273, Cost: 4},
			want: `{"date":"2026-07-01","energy_wh":5000,"distance_m":22000,"efficiency_wh_per_m":0.2273,"cost":4}`,
		},
		{
			name: "zero value keeps every key",
			row:  EnergyStatsRow{},
			want: `{"date":"","energy_wh":0,"distance_m":0,"efficiency_wh_per_m":0,"cost":0}`,
		},
		{
			name: "negative regen energy and zero distance",
			row:  EnergyStatsRow{Date: "2026-07-03", EnergyWh: -250.5, DistanceM: 0, EfficiencyWhPerM: 0, Cost: -1.25},
			want: `{"date":"2026-07-03","energy_wh":-250.5,"distance_m":0,"efficiency_wh_per_m":0,"cost":-1.25}`,
		},
		{
			name: "high-precision efficiency and large fleet numbers",
			row:  EnergyStatsRow{Date: "2026-07-04", EnergyWh: 7345.6, DistanceM: 32321, EfficiencyWhPerM: 0.2273, Cost: 5.87},
			want: `{"date":"2026-07-04","energy_wh":7345.6,"distance_m":32321,"efficiency_wh_per_m":0.2273,"cost":5.87}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(tt.row)
			if err != nil {
				t.Fatalf("Marshal(%+v) unexpected error: %v", tt.row, err)
			}
			if string(got) != tt.want {
				t.Errorf("Marshal mismatch:\n got: %s\nwant: %s", got, tt.want)
			}
		})
	}
}

// TestEnergyStatsRow_KeysAlwaysPresent double-locks the no-omitempty contract
// independently of field ordering: a zero row must serialize all five keys.
func TestEnergyStatsRow_KeysAlwaysPresent(t *testing.T) {
	b, err := json.Marshal(EnergyStatsRow{})
	if err != nil {
		t.Fatalf("Marshal(zero) unexpected error: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("Unmarshal to map unexpected error: %v", err)
	}
	for _, key := range []string{"date", "energy_wh", "distance_m", "efficiency_wh_per_m", "cost"} {
		if _, ok := m[key]; !ok {
			t.Errorf("zero-value JSON missing key %q — a ,omitempty crept in and would hide 0-days from charts", key)
		}
	}
	if len(m) != 5 {
		t.Errorf("zero-value JSON has %d keys, want exactly 5: %s", len(m), b)
	}
}

// TestEnergyStatsRow_UnmarshalJSON covers decoding representative repo/API
// payloads plus the error and defaulting edge cases.
func TestEnergyStatsRow_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    EnergyStatsRow
		wantErr bool
	}{
		{
			name:    "canonical payload",
			payload: `{"date":"2026-07-01","energy_wh":5000,"distance_m":22000,"efficiency_wh_per_m":0.2273,"cost":4}`,
			want:    EnergyStatsRow{Date: "2026-07-01", EnergyWh: 5000, DistanceM: 22000, EfficiencyWhPerM: 0.2273, Cost: 4},
		},
		{
			name:    "missing keys default to zero",
			payload: `{"date":"2026-07-02"}`,
			want:    EnergyStatsRow{Date: "2026-07-02"},
		},
		{
			name:    "unknown keys are ignored",
			payload: `{"date":"2026-07-03","energy_wh":10,"legacy_energy_kwh":0.01,"extra":true}`,
			want:    EnergyStatsRow{Date: "2026-07-03", EnergyWh: 10},
		},
		{
			name:    "explicit nulls keep zero values",
			payload: `{"date":null,"energy_wh":null,"distance_m":null,"efficiency_wh_per_m":null,"cost":null}`,
			want:    EnergyStatsRow{},
		},
		{
			name:    "integer-typed numerics decode into float fields",
			payload: `{"energy_wh":42,"distance_m":100,"cost":3}`,
			want:    EnergyStatsRow{EnergyWh: 42, DistanceM: 100, Cost: 3},
		},
		{
			name:    "wrong type for numeric field errors",
			payload: `{"energy_wh":"lots"}`,
			wantErr: true,
		},
		{
			name:    "wrong type for date field errors",
			payload: `{"date":123}`,
			wantErr: true,
		},
		{
			name:    "malformed json errors",
			payload: `{"date":`,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got EnergyStatsRow
			err := json.Unmarshal([]byte(tt.payload), &got)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("Unmarshal(%s) = nil error, want error", tt.payload)
				}
				return
			}
			if err != nil {
				t.Fatalf("Unmarshal(%s) unexpected error: %v", tt.payload, err)
			}
			if got != tt.want {
				t.Errorf("Unmarshal(%s) = %+v, want %+v", tt.payload, got, tt.want)
			}
		})
	}
}

// TestEnergyStatsRow_RoundTrip proves marshal→unmarshal is lossless across
// boundary float64 magnitudes (encoding/json emits the shortest round-trippable
// representation) and non-ASCII date strings.
func TestEnergyStatsRow_RoundTrip(t *testing.T) {
	tests := []struct {
		name string
		row  EnergyStatsRow
	}{
		{"typical", EnergyStatsRow{Date: "2026-07-01", EnergyWh: 7345.6, DistanceM: 32321, EfficiencyWhPerM: 0.2273, Cost: 5.87}},
		{"zero", EnergyStatsRow{}},
		{"all negative", EnergyStatsRow{Date: "d", EnergyWh: -1, DistanceM: -2, EfficiencyWhPerM: -0.5, Cost: -3.3}},
		{"float extremes", EnergyStatsRow{Date: "d", EnergyWh: math.MaxFloat64, DistanceM: math.SmallestNonzeroFloat64, EfficiencyWhPerM: 1e-9, Cost: 1e12}},
		{"non-ascii date", EnergyStatsRow{Date: "２０２６-07-01 \U0001F697", EnergyWh: 1, DistanceM: 1, EfficiencyWhPerM: 1, Cost: 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, err := json.Marshal(tt.row)
			if err != nil {
				t.Fatalf("Marshal(%+v) error: %v", tt.row, err)
			}
			var back EnergyStatsRow
			if err := json.Unmarshal(b, &back); err != nil {
				t.Fatalf("Unmarshal(%s) error: %v", b, err)
			}
			if back != tt.row {
				t.Errorf("round-trip mismatch:\n got: %+v\nwant: %+v\njson: %s", back, tt.row, b)
			}
		})
	}
}

// TestEnergyStatsRow_DailyBreakdownShape pins the real usage shape from
// service.EnergyStats.DailyBreakdown ([]*EnergyStatsRow): a JSON array of
// objects, including the empty-slice and nil-element edge cases.
func TestEnergyStatsRow_DailyBreakdownShape(t *testing.T) {
	tests := []struct {
		name string
		in   []*EnergyStatsRow
		want string
	}{
		{"empty slice marshals as []", []*EnergyStatsRow{}, `[]`},
		{"nil element marshals as null", []*EnergyStatsRow{nil}, `[null]`},
		{
			name: "two ordered days",
			in: []*EnergyStatsRow{
				{Date: "2026-07-01", EnergyWh: 5000, DistanceM: 22000, EfficiencyWhPerM: 0.2273, Cost: 4},
				{Date: "2026-07-02", EnergyWh: 7345.6, DistanceM: 32321, EfficiencyWhPerM: 0.2273, Cost: 5.87},
			},
			want: `[{"date":"2026-07-01","energy_wh":5000,"distance_m":22000,"efficiency_wh_per_m":0.2273,"cost":4},{"date":"2026-07-02","energy_wh":7345.6,"distance_m":32321,"efficiency_wh_per_m":0.2273,"cost":5.87}]`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(tt.in)
			if err != nil {
				t.Fatalf("Marshal error: %v", err)
			}
			if string(got) != tt.want {
				t.Errorf("Marshal mismatch:\n got: %s\nwant: %s", got, tt.want)
			}
		})
	}

	// Decode the multi-day payload back and confirm the array preserves
	// order and element identity the way the frontend consumes it.
	const payload = `[{"date":"2026-07-01","energy_wh":5000,"distance_m":22000,"efficiency_wh_per_m":0.2273,"cost":4},{"date":"2026-07-02","energy_wh":7345.6,"distance_m":32321,"efficiency_wh_per_m":0.2273,"cost":5.87}]`
	var back []*EnergyStatsRow
	if err := json.Unmarshal([]byte(payload), &back); err != nil {
		t.Fatalf("Unmarshal slice error: %v", err)
	}
	want := []*EnergyStatsRow{
		{Date: "2026-07-01", EnergyWh: 5000, DistanceM: 22000, EfficiencyWhPerM: 0.2273, Cost: 4},
		{Date: "2026-07-02", EnergyWh: 7345.6, DistanceM: 32321, EfficiencyWhPerM: 0.2273, Cost: 5.87},
	}
	if !reflect.DeepEqual(back, want) {
		t.Errorf("slice round-trip mismatch:\n got: %+v\nwant: %+v", back, want)
	}
}

// TestEnergyStatsRow_NonFiniteFloatsFailMarshal documents a real, load-bearing
// limitation: encoding/json cannot represent NaN/±Inf, so a non-finite value
// reaching this DTO (e.g. a 0/0 efficiency or a bad sensor reading) makes the
// whole energy response fail to serialize. The guard must live upstream in the
// repo/service; this pins the failure mode so a regression surfaces loudly.
func TestEnergyStatsRow_NonFiniteFloatsFailMarshal(t *testing.T) {
	tests := []struct {
		name string
		row  EnergyStatsRow
	}{
		{"NaN efficiency", EnergyStatsRow{EfficiencyWhPerM: math.NaN()}},
		{"positive infinity energy", EnergyStatsRow{EnergyWh: math.Inf(1)}},
		{"negative infinity cost", EnergyStatsRow{Cost: math.Inf(-1)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := json.Marshal(tt.row)
			if err == nil {
				t.Fatalf("Marshal(%+v) = nil error, want *json.UnsupportedValueError", tt.row)
			}
			var uve *json.UnsupportedValueError
			if !errors.As(err, &uve) {
				t.Errorf("Marshal error = %T (%v), want *json.UnsupportedValueError", err, err)
			}
		})
	}
}
