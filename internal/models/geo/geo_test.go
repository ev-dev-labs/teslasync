package geo

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// This package is a pure DTO leaf (ADR-006): it exposes no functions,
// methods, or handlers — only the Address and VisitedLocation transport +
// persistence structs. For a DTO leaf the production contract IS the wire
// shape and the column mapping, so these tests pin exactly that:
//
//   - the snake_case JSON key set the frontend (web/src/api/types.ts) depends
//     on, with no accidental camelCase or untagged-field leakage;
//   - omitempty semantics on the nullable pointer fields (nil drops out, a set
//     pointer stays — even when it points at a zero value);
//   - that non-omitempty required fields are always emitted, including the
//     coordinate 0/0 "Null Island" edge case that MUST NOT be dropped;
//   - SI unit naming (total_duration_s), guarding the Phase-48 SI mandate;
//   - round-trip fidelity (marshal → unmarshal → marshal is stable);
//   - the db column tags used by the persistence layer.
//
// A regression in any of these silently breaks either the SPA render or a
// SELECT scan, so they are the highest-value checks for this leaf.

func strptr(s string) *string     { return &s }
func i64ptr(i int64) *int64       { return &i }
func tptr(t time.Time) *time.Time { return &t }

// fixedTime is a stable, monotonic-clock-free UTC instant so JSON round-trips
// are byte-for-byte reproducible.
var fixedTime = time.Date(2026, 3, 14, 15, 9, 26, 0, time.UTC)

// fullAddress is a fully-populated Address (every optional pointer set).
func fullAddress() Address {
	return Address{
		ID:          101,
		DisplayName: "123 Market St, San Francisco, CA",
		Latitude:    37.7749,
		Longitude:   -122.4194,
		Name:        strptr("Home"),
		HouseNumber: strptr("123"),
		Road:        strptr("Market St"),
		City:        strptr("San Francisco"),
		County:      strptr("San Francisco County"),
		State:       strptr("California"),
		Country:     strptr("United States"),
		PostCode:    strptr("94103"),
		CreatedAt:   fixedTime,
	}
}

// fullVisitedLocation is a fully-populated VisitedLocation.
func fullVisitedLocation() VisitedLocation {
	return VisitedLocation{
		ID:             11,
		VehicleID:      7,
		AddressID:      i64ptr(3),
		AddressName:    "Home — 123 Market St",
		VisitCount:     42,
		TotalDurationS: 7200.5,
		LastVisited:    tptr(fixedTime.Add(24 * time.Hour)),
		CreatedAt:      fixedTime,
	}
}

// jsonKeys marshals v and returns its top-level JSON object key set.
func jsonKeys(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal to map: %v (body=%s)", err, b)
	}
	return m
}

// ---- Address: exact JSON key set (no leakage, no camelCase) ----------------

func TestAddress_JSONKeySet_FullyPopulated(t *testing.T) {
	t.Parallel()

	got := jsonKeys(t, fullAddress())
	want := []string{
		"id", "display_name", "latitude", "longitude",
		"name", "house_number", "road", "city", "county",
		"state", "country", "postcode", "created_at",
	}
	wantSet := map[string]bool{}
	for _, k := range want {
		wantSet[k] = true
		if _, ok := got[k]; !ok {
			t.Errorf("missing expected JSON key %q; keys=%v", k, keysOf(got))
		}
	}
	for k := range got {
		if !wantSet[k] {
			t.Errorf("unexpected JSON key %q (accidental untagged/renamed field?); keys=%v", k, keysOf(got))
		}
	}
	if len(got) != len(want) {
		t.Errorf("key count: got %d, want %d; keys=%v", len(got), len(want), keysOf(got))
	}
	// Guard against a future camelCase drift the SPA would silently miss.
	for _, bad := range []string{"displayName", "houseNumber", "postCode", "createdAt"} {
		if _, ok := got[bad]; ok {
			t.Errorf("camelCase key %q leaked; the wire contract is snake_case", bad)
		}
	}
}

// ---- Address: omitempty on every nullable pointer --------------------------

func TestAddress_Omitempty(t *testing.T) {
	t.Parallel()

	// optionalKeys are the *string fields carrying `omitempty`.
	optionalKeys := []string{
		"name", "house_number", "road", "city",
		"county", "state", "country", "postcode",
	}
	// requiredKeys are always emitted regardless of value.
	requiredKeys := []string{"id", "display_name", "latitude", "longitude", "created_at"}

	t.Run("nil_optionals_omitted", func(t *testing.T) {
		t.Parallel()
		got := jsonKeys(t, Address{}) // zero value: all pointers nil
		for _, k := range optionalKeys {
			if _, ok := got[k]; ok {
				t.Errorf("nil optional %q must be omitted; keys=%v", k, keysOf(got))
			}
		}
		for _, k := range requiredKeys {
			if _, ok := got[k]; !ok {
				t.Errorf("required key %q must be present even at zero value; keys=%v", k, keysOf(got))
			}
		}
	})

	t.Run("set_optionals_present", func(t *testing.T) {
		t.Parallel()
		got := jsonKeys(t, fullAddress())
		for _, k := range optionalKeys {
			if _, ok := got[k]; !ok {
				t.Errorf("set optional %q must be present; keys=%v", k, keysOf(got))
			}
		}
	})

	t.Run("pointer_to_empty_string_still_present", func(t *testing.T) {
		t.Parallel()
		// omitempty on a *string keys off pointer nilness, NOT the pointed-to
		// value: a non-nil pointer to "" is a meaningful "known-empty" and
		// must survive on the wire.
		a := Address{Name: strptr(""), City: strptr("")}
		got := jsonKeys(t, a)
		for _, k := range []string{"name", "city"} {
			raw, ok := got[k]
			if !ok {
				t.Errorf("non-nil pointer-to-empty %q must be present, not omitted; keys=%v", k, keysOf(got))
				continue
			}
			if string(raw) != `""` {
				t.Errorf("%q: got %s, want empty JSON string", k, raw)
			}
		}
	})
}

// ---- Address: Null Island (0,0) coordinates must not be dropped ------------

func TestAddress_NullIslandCoordinatesEmitted(t *testing.T) {
	t.Parallel()

	// Latitude/Longitude have no omitempty precisely so a valid 0/0 fix is
	// not silently dropped. If someone adds omitempty, this fails.
	a := Address{ID: 1, DisplayName: "Null Island", Latitude: 0, Longitude: 0, CreatedAt: fixedTime}
	got := jsonKeys(t, a)
	for _, k := range []string{"latitude", "longitude"} {
		raw, ok := got[k]
		if !ok {
			t.Fatalf("%q must be emitted even at 0 (valid coordinate); keys=%v", k, keysOf(got))
		}
		if string(raw) != "0" {
			t.Errorf("%q: got %s, want 0", k, raw)
		}
	}
}

// ---- Address: created_at is RFC3339 ---------------------------------------

func TestAddress_CreatedAtRFC3339(t *testing.T) {
	t.Parallel()

	got := jsonKeys(t, fullAddress())
	var ts string
	if err := json.Unmarshal(got["created_at"], &ts); err != nil {
		t.Fatalf("created_at not a JSON string: %v", err)
	}
	if _, err := time.Parse(time.RFC3339, ts); err != nil {
		t.Errorf("created_at %q is not RFC3339: %v", ts, err)
	}
}

// ---- VisitedLocation: exact JSON key set ----------------------------------

func TestVisitedLocation_JSONKeySet_FullyPopulated(t *testing.T) {
	t.Parallel()

	got := jsonKeys(t, fullVisitedLocation())
	want := []string{
		"id", "vehicle_id", "address_id", "address_name",
		"visit_count", "total_duration_s", "last_visited", "created_at",
	}
	wantSet := map[string]bool{}
	for _, k := range want {
		wantSet[k] = true
		if _, ok := got[k]; !ok {
			t.Errorf("missing expected JSON key %q; keys=%v", k, keysOf(got))
		}
	}
	for k := range got {
		if !wantSet[k] {
			t.Errorf("unexpected JSON key %q; keys=%v", k, keysOf(got))
		}
	}
	if len(got) != len(want) {
		t.Errorf("key count: got %d, want %d; keys=%v", len(got), len(want), keysOf(got))
	}
}

// ---- VisitedLocation: SI unit naming (Phase-48 guard) ---------------------

func TestVisitedLocation_SIUnitNaming(t *testing.T) {
	t.Parallel()

	got := jsonKeys(t, fullVisitedLocation())
	if _, ok := got["total_duration_s"]; !ok {
		t.Errorf("duration must be SI seconds keyed total_duration_s; keys=%v", keysOf(got))
	}
	// No legacy non-SI unit suffixes may appear on this DTO's wire form.
	for k := range got {
		for _, bad := range []string{"_min", "_mph", "_mi", "_kwh", "_kw", "_psi"} {
			if strings.HasSuffix(k, bad) {
				t.Errorf("non-SI unit-suffixed key %q leaked (Phase-48 forbids %s)", k, bad)
			}
		}
	}
}

// ---- VisitedLocation: omitempty on nullable pointers ----------------------

func TestVisitedLocation_Omitempty(t *testing.T) {
	t.Parallel()

	optionalKeys := []string{"address_id", "last_visited"}
	requiredKeys := []string{"id", "vehicle_id", "address_name", "visit_count", "total_duration_s", "created_at"}

	t.Run("nil_optionals_omitted", func(t *testing.T) {
		t.Parallel()
		// A derived-from-drives row carries no legacy address FK and may lack
		// a last-visited instant; both must drop off the wire.
		vl := VisitedLocation{ID: 1, VehicleID: 2, AddressName: "Unnamed", VisitCount: 1, CreatedAt: fixedTime}
		got := jsonKeys(t, vl)
		for _, k := range optionalKeys {
			if _, ok := got[k]; ok {
				t.Errorf("nil optional %q must be omitted; keys=%v", k, keysOf(got))
			}
		}
		for _, k := range requiredKeys {
			if _, ok := got[k]; !ok {
				t.Errorf("required key %q must be present; keys=%v", k, keysOf(got))
			}
		}
	})

	t.Run("set_optionals_present", func(t *testing.T) {
		t.Parallel()
		got := jsonKeys(t, fullVisitedLocation())
		for _, k := range optionalKeys {
			if _, ok := got[k]; !ok {
				t.Errorf("set optional %q must be present; keys=%v", k, keysOf(got))
			}
		}
	})

	t.Run("address_id_zero_pointer_present", func(t *testing.T) {
		t.Parallel()
		// A *int64 pointing at 0 is distinct from nil and must be emitted.
		vl := VisitedLocation{ID: 1, VehicleID: 2, AddressName: "x", AddressID: i64ptr(0), CreatedAt: fixedTime}
		got := jsonKeys(t, vl)
		raw, ok := got["address_id"]
		if !ok {
			t.Fatalf("non-nil address_id pointing at 0 must be present; keys=%v", keysOf(got))
		}
		if string(raw) != "0" {
			t.Errorf("address_id: got %s, want 0", raw)
		}
	})
}

// ---- VisitedLocation: null JSON decodes to nil pointer --------------------

func TestVisitedLocation_NullNullablesDecodeToNil(t *testing.T) {
	t.Parallel()

	// The frontend type declares address_id/last_visited as `T | null`; an
	// explicit null in the payload must decode back to a nil pointer, not a
	// pointer to a zero value.
	const body = `{"id":1,"vehicle_id":2,"address_id":null,"address_name":"x","visit_count":3,"total_duration_s":0,"last_visited":null,"created_at":"2026-03-14T15:09:26Z"}`
	var vl VisitedLocation
	if err := json.Unmarshal([]byte(body), &vl); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if vl.AddressID != nil {
		t.Errorf("address_id: got %v, want nil for JSON null", *vl.AddressID)
	}
	if vl.LastVisited != nil {
		t.Errorf("last_visited: got %v, want nil for JSON null", *vl.LastVisited)
	}
	if vl.ID != 1 || vl.VehicleID != 2 || vl.AddressName != "x" || vl.VisitCount != 3 {
		t.Errorf("scalar fields corrupted: %+v", vl)
	}
}

// ---- Round-trip fidelity (marshal is stable through a decode) -------------

func TestAddress_RoundTrip(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   Address
	}{
		{"zero_value", Address{}},
		{"fully_populated", fullAddress()},
		{"null_island", Address{ID: 5, DisplayName: "Null Island", Latitude: 0, Longitude: 0, CreatedAt: fixedTime}},
		{"partial_optionals", Address{ID: 9, DisplayName: "Partial", Latitude: 1.5, Longitude: -2.5, City: strptr("Reno"), Country: strptr("US"), CreatedAt: fixedTime}},
		{"pointer_to_empty", Address{ID: 3, DisplayName: "Empty ptr", Road: strptr(""), CreatedAt: fixedTime}},
		{"negative_coordinates", Address{ID: 4, DisplayName: "SW hemisphere", Latitude: -33.8688, Longitude: 151.2093, CreatedAt: fixedTime}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assertJSONStable(t, tc.in, func(b []byte) any {
				var out Address
				if err := json.Unmarshal(b, &out); err != nil {
					t.Fatalf("unmarshal: %v", err)
				}
				return out
			})
		})
	}
}

func TestVisitedLocation_RoundTrip(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   VisitedLocation
	}{
		{"zero_value", VisitedLocation{}},
		{"fully_populated", fullVisitedLocation()},
		{"nil_optionals", VisitedLocation{ID: 1, VehicleID: 2, AddressName: "Unnamed", VisitCount: 1, TotalDurationS: 0, CreatedAt: fixedTime}},
		{"zero_address_id_ptr", VisitedLocation{ID: 1, VehicleID: 2, AddressName: "x", AddressID: i64ptr(0), CreatedAt: fixedTime}},
		{"fractional_duration", VisitedLocation{ID: 8, VehicleID: 3, AddressName: "Cafe", VisitCount: 5, TotalDurationS: 1234.567, LastVisited: tptr(fixedTime), CreatedAt: fixedTime}},
		{"large_counts", VisitedLocation{ID: 1 << 40, VehicleID: 1 << 31, AddressName: "Depot", VisitCount: 1_000_000, TotalDurationS: 9.9e9, CreatedAt: fixedTime}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			assertJSONStable(t, tc.in, func(b []byte) any {
				var out VisitedLocation
				if err := json.Unmarshal(b, &out); err != nil {
					t.Fatalf("unmarshal: %v", err)
				}
				return out
			})
		})
	}
}

// ---- Typed decode preserves every field value -----------------------------

func TestVisitedLocation_TypedDecodeValues(t *testing.T) {
	t.Parallel()

	in := fullVisitedLocation()
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out VisitedLocation
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID != in.ID || out.VehicleID != in.VehicleID {
		t.Errorf("id/vehicle_id: got %d/%d, want %d/%d", out.ID, out.VehicleID, in.ID, in.VehicleID)
	}
	if out.AddressID == nil || *out.AddressID != *in.AddressID {
		t.Errorf("address_id: got %v, want %d", out.AddressID, *in.AddressID)
	}
	if out.AddressName != in.AddressName {
		t.Errorf("address_name: got %q, want %q", out.AddressName, in.AddressName)
	}
	if out.VisitCount != in.VisitCount {
		t.Errorf("visit_count: got %d, want %d", out.VisitCount, in.VisitCount)
	}
	if out.TotalDurationS != in.TotalDurationS {
		t.Errorf("total_duration_s: got %v, want %v", out.TotalDurationS, in.TotalDurationS)
	}
	if out.LastVisited == nil || !out.LastVisited.Equal(*in.LastVisited) {
		t.Errorf("last_visited: got %v, want %v", out.LastVisited, in.LastVisited)
	}
	if !out.CreatedAt.Equal(in.CreatedAt) {
		t.Errorf("created_at: got %v, want %v", out.CreatedAt, in.CreatedAt)
	}
}

func TestAddress_TypedDecodeValues(t *testing.T) {
	t.Parallel()

	in := fullAddress()
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out Address
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.ID != in.ID || out.DisplayName != in.DisplayName {
		t.Errorf("id/display_name: got %d/%q", out.ID, out.DisplayName)
	}
	if out.Latitude != in.Latitude || out.Longitude != in.Longitude {
		t.Errorf("lat/lon: got %v/%v, want %v/%v", out.Latitude, out.Longitude, in.Latitude, in.Longitude)
	}
	for _, p := range []struct {
		name     string
		got, exp *string
	}{
		{"name", out.Name, in.Name},
		{"house_number", out.HouseNumber, in.HouseNumber},
		{"road", out.Road, in.Road},
		{"city", out.City, in.City},
		{"county", out.County, in.County},
		{"state", out.State, in.State},
		{"country", out.Country, in.Country},
		{"postcode", out.PostCode, in.PostCode},
	} {
		if p.got == nil || p.exp == nil || *p.got != *p.exp {
			t.Errorf("%s: got %v, want %v", p.name, deref(p.got), deref(p.exp))
		}
	}
	if !out.CreatedAt.Equal(in.CreatedAt) {
		t.Errorf("created_at: got %v, want %v", out.CreatedAt, in.CreatedAt)
	}
}

// ---- Struct-tag contract (json + db) via reflection -----------------------

func TestStructTags(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		typ  reflect.Type
		want map[string]struct{ json, db string }
	}{
		{
			name: "Address",
			typ:  reflect.TypeOf(Address{}),
			want: map[string]struct{ json, db string }{
				"ID":          {"id", "id"},
				"DisplayName": {"display_name", "display_name"},
				"Latitude":    {"latitude", "latitude"},
				"Longitude":   {"longitude", "longitude"},
				"Name":        {"name,omitempty", "name"},
				"HouseNumber": {"house_number,omitempty", "house_number"},
				"Road":        {"road,omitempty", "road"},
				"City":        {"city,omitempty", "city"},
				"County":      {"county,omitempty", "county"},
				"State":       {"state,omitempty", "state"},
				"Country":     {"country,omitempty", "country"},
				"PostCode":    {"postcode,omitempty", "postcode"},
				"CreatedAt":   {"created_at", "created_at"},
			},
		},
		{
			name: "VisitedLocation",
			typ:  reflect.TypeOf(VisitedLocation{}),
			want: map[string]struct{ json, db string }{
				"ID":             {"id", "id"},
				"VehicleID":      {"vehicle_id", "vehicle_id"},
				"AddressID":      {"address_id,omitempty", "address_id"},
				"AddressName":    {"address_name", "address_name"},
				"VisitCount":     {"visit_count", "visit_count"},
				"TotalDurationS": {"total_duration_s", "total_duration_s"},
				"LastVisited":    {"last_visited,omitempty", "last_visited"},
				"CreatedAt":      {"created_at", "created_at"},
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if tc.typ.NumField() != len(tc.want) {
				t.Fatalf("%s field count: got %d, want %d (add the new field to this contract test)",
					tc.name, tc.typ.NumField(), len(tc.want))
			}
			for i := 0; i < tc.typ.NumField(); i++ {
				f := tc.typ.Field(i)
				exp, ok := tc.want[f.Name]
				if !ok {
					t.Errorf("%s.%s not covered by tag contract", tc.name, f.Name)
					continue
				}
				if got := f.Tag.Get("json"); got != exp.json {
					t.Errorf("%s.%s json tag: got %q, want %q", tc.name, f.Name, got, exp.json)
				}
				if got := f.Tag.Get("db"); got != exp.db {
					t.Errorf("%s.%s db tag: got %q, want %q", tc.name, f.Name, got, exp.db)
				}
			}
		})
	}
}

// ---- helpers ---------------------------------------------------------------

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func deref(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}

// assertJSONStable marshals in, decodes it via decode, re-marshals the decoded
// value, and asserts the two encodings are byte-identical. Comparing at the
// wire level side-steps time.Time's internal representation while still proving
// no field is dropped, added, or mistyped across a round-trip.
func assertJSONStable(t *testing.T, in any, decode func([]byte) any) {
	t.Helper()
	first, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal(in): %v", err)
	}
	out := decode(first)
	second, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal(out): %v", err)
	}
	if string(first) != string(second) {
		t.Errorf("round-trip not stable:\n first = %s\nsecond = %s", first, second)
	}
}
