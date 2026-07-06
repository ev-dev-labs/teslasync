package telemetry

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// These tests pin the persistence + transport contract of the DTO leaf. Because
// this package is a pure DTO leaf (ADR-006 — no repo/handler/database imports),
// the contract worth locking is exactly the wire + column shape every consumer
// depends on:
//
//   - the JSON key set produced for the API (snake_case, matching the Go json
//     tags the frontend types mirror),
//   - the null-vs-omit semantics of nullable pointer fields (omitempty on
//     Position's optional signals vs always-present null on the error DTOs),
//   - db==json==column tag alignment (the data-modeling ADR calls a mismatch a
//     "silent bug" source), and
//   - json==bson alignment on the Mongo-backed RawTelemetrySignal.
//
// Everything here uses only the standard library so the leaf stays import-clean.

// jsonObject marshals v and decodes it back into a generic object so a test can
// assert on the exact key set and per-key raw values without coupling to field
// ordering.
func jsonObject(t *testing.T, v any) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", v, err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal(%T) into object: %v", v, err)
	}
	return m
}

// assertExactKeys fails unless the JSON object produced by v has precisely the
// keys in want — no missing keys, no surprise extras. This is the guard that
// catches an accidentally-dropped json tag or a stray exported field leaking
// onto the wire.
func assertExactKeys(t *testing.T, v any, want ...string) {
	t.Helper()
	got := jsonObject(t, v)
	wantSet := make(map[string]struct{}, len(want))
	for _, k := range want {
		wantSet[k] = struct{}{}
		if _, ok := got[k]; !ok {
			t.Errorf("%T: missing expected JSON key %q (got keys %v)", v, k, sortedKeys(got))
		}
	}
	for k := range got {
		if _, ok := wantSet[k]; !ok {
			t.Errorf("%T: unexpected JSON key %q (want %v)", v, k, want)
		}
	}
}

func sortedKeys(m map[string]json.RawMessage) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	// insertion sort — tiny maps, avoids importing sort for a diagnostic path.
	for i := 1; i < len(ks); i++ {
		for j := i; j > 0 && ks[j-1] > ks[j]; j-- {
			ks[j-1], ks[j] = ks[j], ks[j-1]
		}
	}
	return ks
}

// assertJSONRoundTrip proves marshal/unmarshal is loss-free by re-marshaling the
// decoded value and asserting byte-for-byte equality against the first
// encoding. Comparing serialized forms (rather than reflect.DeepEqual on
// structs holding time.Time) sidesteps monotonic-clock / location false
// negatives while still catching any field that fails to survive the trip.
func assertJSONRoundTrip[T any](t *testing.T, orig T) T {
	t.Helper()
	first, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("json.Marshal(%T): %v", orig, err)
	}
	var decoded T
	if err := json.Unmarshal(first, &decoded); err != nil {
		t.Fatalf("json.Unmarshal(%T): %v", orig, err)
	}
	second, err := json.Marshal(decoded)
	if err != nil {
		t.Fatalf("json.Marshal(decoded %T): %v", orig, err)
	}
	if string(first) != string(second) {
		t.Errorf("%T JSON round-trip is lossy:\n first:  %s\n second: %s", orig, first, second)
	}
	return decoded
}

// rawEquals reports whether a decoded json.RawMessage equals the given literal
// (both are compact JSON tokens, e.g. `null`, `275`, `"good"`).
func rawEquals(raw json.RawMessage, literal string) bool {
	return strings.TrimSpace(string(raw)) == literal
}

// ---------- RawTelemetrySignal ----------

func TestRawTelemetrySignal_JSONContract(t *testing.T) {
	t.Parallel()
	created := time.Date(2026, 7, 5, 8, 15, 0, 0, time.UTC)
	rec := RawTelemetrySignal{
		VIN:         "5YJ3E1EA1PF000001",
		Source:      "mqtt",
		SignalCount: 12,
		CreatedAt:   created,
	}

	// Metadata-only DTO: every field is always present (no omitempty).
	assertExactKeys(t, rec, "vin", "source", "signal_count", "created_at")

	obj := jsonObject(t, rec)
	if !rawEquals(obj["vin"], `"5YJ3E1EA1PF000001"`) {
		t.Errorf("vin = %s, want quoted VIN", obj["vin"])
	}
	if !rawEquals(obj["signal_count"], `12`) {
		t.Errorf("signal_count = %s, want 12", obj["signal_count"])
	}

	decoded := assertJSONRoundTrip(t, rec)
	if decoded.SignalCount != 12 {
		t.Errorf("decoded SignalCount = %d, want 12", decoded.SignalCount)
	}
	if !decoded.CreatedAt.Equal(created) {
		t.Errorf("decoded CreatedAt = %v, want %v", decoded.CreatedAt, created)
	}
}

func TestRawTelemetrySignal_ZeroValue(t *testing.T) {
	t.Parallel()
	// The zero value must still emit all four keys — a repo that inserts a
	// freshly-constructed record relies on signal_count serializing as 0, not
	// vanishing.
	assertExactKeys(t, RawTelemetrySignal{}, "vin", "source", "signal_count", "created_at")
	obj := jsonObject(t, RawTelemetrySignal{})
	if !rawEquals(obj["signal_count"], `0`) {
		t.Errorf("zero-value signal_count = %s, want 0", obj["signal_count"])
	}
}

// ---------- TeslaFleetTelemetryError ----------

func TestTeslaFleetTelemetryError_NullableFieldsRenderNull(t *testing.T) {
	t.Parallel()
	// This DTO deliberately omits `omitempty`: the partner-error mirror must
	// distinguish "field known to be absent" (JSON null) from "field not part of
	// this record" (key missing). A nil pointer therefore serializes as an
	// explicit null with the key still present.
	fetched := time.Date(2026, 7, 5, 9, 0, 0, 0, time.UTC)
	e := TeslaFleetTelemetryError{
		ID:        7,
		VIN:       "VIN123",
		FetchedAt: fetched,
		// ErrorCode, ErrorMessage, ReportedAt, TeslaUpdatedAt intentionally nil.
	}

	assertExactKeys(t, e,
		"id", "vin", "error_code", "error_message",
		"reported_at", "tesla_updated_at", "fetched_at",
	)

	obj := jsonObject(t, e)
	for _, k := range []string{"error_code", "error_message", "reported_at", "tesla_updated_at"} {
		if !rawEquals(obj[k], `null`) {
			t.Errorf("nil pointer field %q = %s, want null", k, obj[k])
		}
	}
}

func TestTeslaFleetTelemetryError_PopulatedRoundTrip(t *testing.T) {
	t.Parallel()
	code := "TELEMETRY_CONNECTION_LOST"
	msg := "vehicle stopped streaming"
	reported := time.Date(2026, 7, 4, 23, 45, 0, 0, time.UTC)
	teslaUpdated := time.Date(2026, 7, 5, 0, 5, 0, 0, time.UTC)
	fetched := time.Date(2026, 7, 5, 0, 6, 0, 0, time.UTC)

	e := TeslaFleetTelemetryError{
		ID:             99,
		VIN:            "VIN999",
		ErrorCode:      &code,
		ErrorMessage:   &msg,
		ReportedAt:     &reported,
		TeslaUpdatedAt: &teslaUpdated,
		FetchedAt:      fetched,
	}

	decoded := assertJSONRoundTrip(t, e)
	if decoded.ID != 99 || decoded.VIN != "VIN999" {
		t.Errorf("decoded id/vin = %d/%q, want 99/VIN999", decoded.ID, decoded.VIN)
	}
	if decoded.ErrorCode == nil || *decoded.ErrorCode != code {
		t.Errorf("decoded ErrorCode = %v, want %q", decoded.ErrorCode, code)
	}
	if decoded.ErrorMessage == nil || *decoded.ErrorMessage != msg {
		t.Errorf("decoded ErrorMessage = %v, want %q", decoded.ErrorMessage, msg)
	}
	if decoded.ReportedAt == nil || !decoded.ReportedAt.Equal(reported) {
		t.Errorf("decoded ReportedAt = %v, want %v", decoded.ReportedAt, reported)
	}
	if decoded.TeslaUpdatedAt == nil || !decoded.TeslaUpdatedAt.Equal(teslaUpdated) {
		t.Errorf("decoded TeslaUpdatedAt = %v, want %v", decoded.TeslaUpdatedAt, teslaUpdated)
	}
}

// ---------- TeslaFleetTelemetryErrorVIN ----------

func TestTeslaFleetTelemetryErrorVIN_JSONContract(t *testing.T) {
	t.Parallel()
	first := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		vin        TeslaFleetTelemetryErrorVIN
		wantActive string
		wantResolv string
	}{
		{
			name: "active unresolved VIN renders resolved_at null",
			vin: TeslaFleetTelemetryErrorVIN{
				ID: 1, VIN: "VINA", Active: true,
				FirstSeenAt: first, LastSeenAt: last,
			},
			wantActive: `true`,
			wantResolv: `null`,
		},
		{
			name: "resolved VIN carries a resolved_at timestamp and active=false",
			vin: func() TeslaFleetTelemetryErrorVIN {
				resolved := time.Date(2026, 7, 5, 13, 0, 0, 0, time.UTC)
				return TeslaFleetTelemetryErrorVIN{
					ID: 2, VIN: "VINB", Active: false,
					FirstSeenAt: first, LastSeenAt: last, ResolvedAt: &resolved,
				}
			}(),
			wantActive: `false`,
			wantResolv: `"2026-07-05T13:00:00Z"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assertExactKeys(t, tt.vin,
				"id", "vin", "active", "first_seen_at", "last_seen_at", "resolved_at")
			obj := jsonObject(t, tt.vin)
			if !rawEquals(obj["active"], tt.wantActive) {
				t.Errorf("active = %s, want %s", obj["active"], tt.wantActive)
			}
			if !rawEquals(obj["resolved_at"], tt.wantResolv) {
				t.Errorf("resolved_at = %s, want %s", obj["resolved_at"], tt.wantResolv)
			}
			assertJSONRoundTrip(t, tt.vin)
		})
	}
}

// ---------- cross-cutting tag alignment ----------

// TestModel_TagAlignment enforces the data-modeling ADR invariant that db (or
// bson) tag == json key on every field. A drift here is exactly the "silent
// bug" the instructions warn about: a repo Scan targets the db column while the
// handler emits a different json key, so the wire value and the stored value
// quietly diverge. It also fails loudly if any exported field loses its json
// tag (which would leak an UpperCamel key onto the API).
func TestModel_TagAlignment(t *testing.T) {
	t.Parallel()
	types := []reflect.Type{
		reflect.TypeOf(Position{}),
		reflect.TypeOf(RawTelemetrySignal{}),
		reflect.TypeOf(TeslaFleetTelemetryError{}),
		reflect.TypeOf(TeslaFleetTelemetryErrorVIN{}),
	}
	for _, typ := range types {
		t.Run(typ.Name(), func(t *testing.T) {
			t.Parallel()
			for i := 0; i < typ.NumField(); i++ {
				f := typ.Field(i)
				jsonTag, ok := f.Tag.Lookup("json")
				if !ok || jsonTag == "" || jsonTag == "-" {
					t.Errorf("%s.%s: missing/omitted json tag (every wire field needs a snake_case json tag)", typ.Name(), f.Name)
					continue
				}
				jsonName := strings.Split(jsonTag, ",")[0]
				if jsonName == "" {
					t.Errorf("%s.%s: empty json name in tag %q", typ.Name(), f.Name, jsonTag)
					continue
				}
				if db, ok := f.Tag.Lookup("db"); ok {
					if got := strings.Split(db, ",")[0]; got != jsonName {
						t.Errorf("%s.%s: db tag %q != json key %q (ADR: db==json==column)", typ.Name(), f.Name, got, jsonName)
					}
				}
				if bson, ok := f.Tag.Lookup("bson"); ok {
					if got := strings.Split(bson, ",")[0]; got != jsonName {
						t.Errorf("%s.%s: bson tag %q != json key %q", typ.Name(), f.Name, got, jsonName)
					}
				}
			}
		})
	}
}
