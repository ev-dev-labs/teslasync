package signal

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// SignalDataKind vocabulary
//
// The enum mirrors the CHECK constraint on signal_catalog.data_kind declared in
// migrations/_baseline_source/09-signal-catalog.sql:
//
//	data_kind text CHECK (data_kind IN ('numeric','text','boolean','compound'))
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalDataKind_Valid pins the accepted value set. Valid must accept
// exactly the four canonical kinds and reject anything else — empty, typos,
// casing, and leading/trailing whitespace (Postgres would reject those too).
func TestSignalDataKind_Valid(t *testing.T) {
	tests := []struct {
		name string
		kind SignalDataKind
		want bool
	}{
		{"numeric", SignalDataKindNumeric, true},
		{"text", SignalDataKindText, true},
		{"boolean", SignalDataKindBoolean, true},
		{"compound", SignalDataKindCompound, true},
		{"empty", SignalDataKind(""), false},
		{"unknown", SignalDataKind("bogus"), false},
		{"wrong case", SignalDataKind("Numeric"), false},
		{"upper case", SignalDataKind("NUMERIC"), false},
		{"leading whitespace", SignalDataKind(" numeric"), false},
		{"trailing whitespace", SignalDataKind("numeric "), false},
		{"int alias", SignalDataKind("int"), false},
		{"bool alias", SignalDataKind("bool"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.kind.Valid(); got != tt.want {
				t.Fatalf("SignalDataKind(%q).Valid() = %v, want %v", tt.kind, got, tt.want)
			}
		})
	}
}

// TestSignalDataKind_ConstantValues pins the exact wire/DB string of every
// SignalDataKind constant. A silent rename here would desync the Go enum from
// the Postgres CHECK constraint and the frontend union, so the literals are
// asserted rather than derived.
func TestSignalDataKind_ConstantValues(t *testing.T) {
	tests := []struct {
		got  SignalDataKind
		want string
	}{
		{SignalDataKindNumeric, "numeric"},
		{SignalDataKindText, "text"},
		{SignalDataKindBoolean, "boolean"},
		{SignalDataKindCompound, "compound"},
	}
	for _, tt := range tests {
		if string(tt.got) != tt.want {
			t.Errorf("constant = %q, want %q", string(tt.got), tt.want)
		}
	}
}

// TestSignalDataKind_MatchesCheckConstraint asserts the enum's Valid() accepts
// exactly the strings enumerated in the signal_catalog.data_kind CHECK
// constraint and nothing outside it. This is the parity guard between the Go
// vocabulary and the schema source of truth.
func TestSignalDataKind_MatchesCheckConstraint(t *testing.T) {
	// The exact set from 09-signal-catalog.sql.
	checkConstraint := []string{"numeric", "text", "boolean", "compound"}
	for _, s := range checkConstraint {
		if !SignalDataKind(s).Valid() {
			t.Errorf("data_kind %q is in the CHECK constraint but Valid() rejected it", s)
		}
	}
	// A representative sample of values the constraint would reject.
	for _, s := range []string{"", "float", "string", "enum", "compound "} {
		if SignalDataKind(s).Valid() {
			t.Errorf("data_kind %q is not in the CHECK constraint but Valid() accepted it", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalStorageTier vocabulary
//
// Mirrors the CHECK constraint on signal_catalog.storage_tier:
//
//	storage_tier text NOT NULL DEFAULT 'cold'
//	             CHECK (storage_tier IN ('hot','cold','dropped'))
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalStorageTier_Valid pins the accepted tier set. Valid must accept
// exactly hot/cold/dropped and reject everything else.
func TestSignalStorageTier_Valid(t *testing.T) {
	tests := []struct {
		name string
		tier SignalStorageTier
		want bool
	}{
		{"hot", SignalStorageTierHot, true},
		{"cold", SignalStorageTierCold, true},
		{"dropped", SignalStorageTierDropped, true},
		{"empty", SignalStorageTier(""), false},
		{"unknown", SignalStorageTier("warm"), false},
		{"wrong case", SignalStorageTier("Hot"), false},
		{"upper case", SignalStorageTier("COLD"), false},
		{"leading whitespace", SignalStorageTier(" hot"), false},
		{"trailing whitespace", SignalStorageTier("dropped "), false},
		{"drop typo", SignalStorageTier("drop"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.tier.Valid(); got != tt.want {
				t.Fatalf("SignalStorageTier(%q).Valid() = %v, want %v", tt.tier, got, tt.want)
			}
		})
	}
}

// TestSignalStorageTier_ConstantValues pins the exact wire/DB string of every
// tier constant against the schema.
func TestSignalStorageTier_ConstantValues(t *testing.T) {
	tests := []struct {
		got  SignalStorageTier
		want string
	}{
		{SignalStorageTierHot, "hot"},
		{SignalStorageTierCold, "cold"},
		{SignalStorageTierDropped, "dropped"},
	}
	for _, tt := range tests {
		if string(tt.got) != tt.want {
			t.Errorf("constant = %q, want %q", string(tt.got), tt.want)
		}
	}
}

// TestSignalStorageTier_MatchesCheckConstraint asserts Valid() accepts exactly
// the CHECK-constraint set and nothing outside it.
func TestSignalStorageTier_MatchesCheckConstraint(t *testing.T) {
	checkConstraint := []string{"hot", "cold", "dropped"}
	for _, s := range checkConstraint {
		if !SignalStorageTier(s).Valid() {
			t.Errorf("storage_tier %q is in the CHECK constraint but Valid() rejected it", s)
		}
	}
	for _, s := range []string{"", "warm", "frozen", "hot "} {
		if SignalStorageTier(s).Valid() {
			t.Errorf("storage_tier %q is not in the CHECK constraint but Valid() accepted it", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalCatalog predicates
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalCatalog_TierPredicates covers IsHot and IsDropped across every tier
// plus the zero-value (empty tier) case. The two predicates must be mutually
// exclusive and neither may fire for the cold or unset tier.
func TestSignalCatalog_TierPredicates(t *testing.T) {
	tests := []struct {
		name        string
		tier        SignalStorageTier
		wantHot     bool
		wantDropped bool
	}{
		{"hot", SignalStorageTierHot, true, false},
		{"cold", SignalStorageTierCold, false, false},
		{"dropped", SignalStorageTierDropped, false, true},
		{"empty tier", SignalStorageTier(""), false, false},
		{"unknown tier", SignalStorageTier("warm"), false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := SignalCatalog{StorageTier: tt.tier}
			if got := c.IsHot(); got != tt.wantHot {
				t.Errorf("IsHot() = %v, want %v", got, tt.wantHot)
			}
			if got := c.IsDropped(); got != tt.wantDropped {
				t.Errorf("IsDropped() = %v, want %v", got, tt.wantDropped)
			}
			if c.IsHot() && c.IsDropped() {
				t.Errorf("IsHot and IsDropped both true for tier %q — must be mutually exclusive", tt.tier)
			}
		})
	}
}

// TestSignalCatalog_IsHot_ImpliesTypedColumns documents the ADR-002 invariant
// stated on the IsHot doc comment: a hot entry is expected to carry a non-nil
// TypedTable and TypedColumn (the promotion target). It is a contract fixture,
// not enforcement — the model is a DTO leaf — but it pins the intended shape so
// a hot row missing its typed target is caught by construction here.
func TestSignalCatalog_IsHot_ImpliesTypedColumns(t *testing.T) {
	tbl := "positions"
	col := "speed_mps"
	c := SignalCatalog{
		Name:        "VehicleSpeed",
		StorageTier: SignalStorageTierHot,
		TypedTable:  &tbl,
		TypedColumn: &col,
	}
	if !c.IsHot() {
		t.Fatal("fixture is not hot")
	}
	if c.TypedTable == nil || c.TypedColumn == nil {
		t.Fatal("hot catalog entry must carry non-nil TypedTable and TypedColumn")
	}
	if *c.TypedTable != tbl || *c.TypedColumn != col {
		t.Errorf("typed target = %q.%q, want %q.%q", *c.TypedTable, *c.TypedColumn, tbl, col)
	}
}

// TestSignalCatalog_ColdEntry_HasNilTypedTarget documents the complementary
// invariant: cold entries live in signal_observations and therefore leave the
// typed-column pointers nil.
func TestSignalCatalog_ColdEntry_HasNilTypedTarget(t *testing.T) {
	c := SignalCatalog{Name: "SomeRareSignal", StorageTier: SignalStorageTierCold}
	if c.IsHot() || c.IsDropped() {
		t.Fatal("cold entry must be neither hot nor dropped")
	}
	if c.TypedTable != nil || c.TypedColumn != nil {
		t.Errorf("cold entry should have nil typed target, got %v.%v", c.TypedTable, c.TypedColumn)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SignalObservation value-column exclusivity
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalObservation_ExactlyOneValuePopulated pins the doc contract that
// exactly one of ValueNumeric / ValueText / ValueBool is set per row, dictated
// by the catalog data_kind. Each fixture below is the canonical shape for its
// kind; the count must always be one.
func TestSignalObservation_ExactlyOneValuePopulated(t *testing.T) {
	num := 42.5
	txt := "P"
	flag := true

	tests := []struct {
		name string
		kind SignalDataKind
		obs  SignalObservation
	}{
		{"numeric", SignalDataKindNumeric, SignalObservation{ValueNumeric: &num}},
		{"text", SignalDataKindText, SignalObservation{ValueText: &txt}},
		{"boolean", SignalDataKindBoolean, SignalObservation{ValueBool: &flag}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.kind.Valid() {
				t.Fatalf("fixture kind %q is not Valid()", tt.kind)
			}
			populated := 0
			if tt.obs.ValueNumeric != nil {
				populated++
			}
			if tt.obs.ValueText != nil {
				populated++
			}
			if tt.obs.ValueBool != nil {
				populated++
			}
			if populated != 1 {
				t.Fatalf("%s observation populated %d value columns, want exactly 1", tt.kind, populated)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON serialization contract — SignalObservation
// ─────────────────────────────────────────────────────────────────────────────

// marshalToMap marshals v and decodes the result into a map of raw JSON values
// so individual keys and their null-ness can be asserted.
func marshalToMap(t *testing.T, v interface{}) map[string]json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("json.Unmarshal into map: %v (payload=%s)", err, b)
	}
	return m
}

// TestSignalObservation_JSONContract_NullableKeysPresent pins the null contract:
// none of the pointer fields carry omitempty, so a zero-value observation must
// still emit every value_* key with an explicit JSON null.
func TestSignalObservation_JSONContract_NullableKeysPresent(t *testing.T) {
	m := marshalToMap(t, SignalObservation{})

	nullableKeys := []string{"value_numeric", "value_text", "value_bool"}
	for _, k := range nullableKeys {
		raw, ok := m[k]
		if !ok {
			t.Errorf("key %q missing from zero-value JSON (omitempty leaked in?)", k)
			continue
		}
		if strings.TrimSpace(string(raw)) != "null" {
			t.Errorf("key %q = %s, want null for zero-value observation", k, raw)
		}
	}
}

// TestSignalObservation_JSONContract_Populated verifies the full snake_case key
// set and representative value shapes for a populated numeric observation.
func TestSignalObservation_JSONContract_Populated(t *testing.T) {
	val := 12.75
	ts := time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC)

	obs := SignalObservation{
		VehicleID:    7,
		Ts:           ts,
		SignalName:   "OutsideTemp",
		ValueNumeric: &val,
		Source:       "fleet_telemetry",
	}

	m := marshalToMap(t, obs)

	wantKeys := []string{
		"vehicle_id", "ts", "signal_name",
		"value_numeric", "value_text", "value_bool", "source",
	}
	for _, k := range wantKeys {
		if _, ok := m[k]; !ok {
			t.Errorf("populated observation JSON missing key %q", k)
		}
	}
	if len(m) != len(wantKeys) {
		t.Errorf("JSON has %d keys, want %d (unexpected extra/missing key)", len(m), len(wantKeys))
	}

	if got := string(m["vehicle_id"]); got != "7" {
		t.Errorf("vehicle_id = %s, want 7", got)
	}
	if got := string(m["signal_name"]); got != `"OutsideTemp"` {
		t.Errorf("signal_name = %s, want \"OutsideTemp\"", got)
	}
	if got := string(m["value_numeric"]); got != "12.75" {
		t.Errorf("value_numeric = %s, want 12.75", got)
	}
	if got := string(m["source"]); got != `"fleet_telemetry"` {
		t.Errorf("source = %s, want \"fleet_telemetry\"", got)
	}
	// The unset value columns for a numeric row stay null.
	if got := strings.TrimSpace(string(m["value_text"])); got != "null" {
		t.Errorf("value_text = %s, want null", got)
	}
	if got := strings.TrimSpace(string(m["value_bool"])); got != "null" {
		t.Errorf("value_bool = %s, want null", got)
	}
}

// TestSignalObservation_JSONRoundTrip ensures a populated observation survives a
// marshal→unmarshal cycle with pointers and the timestamp preserved.
func TestSignalObservation_JSONRoundTrip(t *testing.T) {
	txt := "P"
	ts := time.Date(2026, 7, 5, 12, 0, 0, 123456789, time.UTC)

	orig := SignalObservation{
		VehicleID:  3,
		Ts:         ts,
		SignalName: "ShiftState",
		ValueText:  &txt,
		Source:     "fleet_api",
	}

	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got SignalObservation
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.VehicleID != orig.VehicleID {
		t.Errorf("VehicleID = %d, want %d", got.VehicleID, orig.VehicleID)
	}
	if got.SignalName != orig.SignalName {
		t.Errorf("SignalName = %q, want %q", got.SignalName, orig.SignalName)
	}
	if got.Source != orig.Source {
		t.Errorf("Source = %q, want %q", got.Source, orig.Source)
	}
	if !got.Ts.Equal(orig.Ts) {
		t.Errorf("Ts = %v, want %v", got.Ts, orig.Ts)
	}
	if got.ValueText == nil || *got.ValueText != txt {
		t.Errorf("ValueText = %v, want %q", got.ValueText, txt)
	}
	if got.ValueNumeric != nil || got.ValueBool != nil {
		t.Errorf("unset value columns must remain nil, got numeric=%v bool=%v", got.ValueNumeric, got.ValueBool)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON serialization contract — SignalCatalog
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalCatalog_JSONContract_NullableKeysPresent pins that every pointer
// field emits its key as explicit null on a zero-value entry (no omitempty).
func TestSignalCatalog_JSONContract_NullableKeysPresent(t *testing.T) {
	m := marshalToMap(t, SignalCatalog{})

	nullableKeys := []string{"typed_table", "typed_column", "data_kind", "unit", "notes"}
	for _, k := range nullableKeys {
		raw, ok := m[k]
		if !ok {
			t.Errorf("key %q missing from zero-value JSON (omitempty leaked in?)", k)
			continue
		}
		if strings.TrimSpace(string(raw)) != "null" {
			t.Errorf("key %q = %s, want null for zero-value catalog entry", k, raw)
		}
	}
	// storage_tier is a non-pointer typed string: it must serialize as an empty
	// string on a zero value, never as null.
	if got := string(m["storage_tier"]); got != `""` {
		t.Errorf("storage_tier = %s, want \"\" (empty string, not null) for zero value", got)
	}
}

// TestSignalCatalog_JSONContract_Populated verifies the full snake_case key set
// and representative values for a fully populated hot entry.
func TestSignalCatalog_JSONContract_Populated(t *testing.T) {
	tbl := "positions"
	col := "speed_mps"
	kind := SignalDataKindNumeric
	unit := "m/s"
	notes := "promoted 2026-04-22"
	first := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC)
	created := time.Date(2026, 1, 1, 0, 0, 1, 0, time.UTC)
	updated := time.Date(2026, 7, 5, 0, 0, 1, 0, time.UTC)

	c := SignalCatalog{
		Name:             "VehicleSpeed",
		FirstSeenAt:      first,
		LastSeenAt:       last,
		ObservationCount: 123456,
		StorageTier:      SignalStorageTierHot,
		TypedTable:       &tbl,
		TypedColumn:      &col,
		DataKind:         &kind,
		Unit:             &unit,
		Notes:            &notes,
		CreatedAt:        created,
		UpdatedAt:        updated,
	}

	m := marshalToMap(t, c)

	wantKeys := []string{
		"name", "first_seen_at", "last_seen_at", "observation_count",
		"storage_tier", "typed_table", "typed_column", "data_kind",
		"unit", "notes", "created_at", "updated_at",
	}
	for _, k := range wantKeys {
		if _, ok := m[k]; !ok {
			t.Errorf("populated catalog JSON missing key %q", k)
		}
	}
	if len(m) != len(wantKeys) {
		t.Errorf("JSON has %d keys, want %d (unexpected extra/missing key)", len(m), len(wantKeys))
	}

	if got := string(m["name"]); got != `"VehicleSpeed"` {
		t.Errorf("name = %s, want \"VehicleSpeed\"", got)
	}
	if got := string(m["observation_count"]); got != "123456" {
		t.Errorf("observation_count = %s, want 123456", got)
	}
	if got := string(m["storage_tier"]); got != `"hot"` {
		t.Errorf("storage_tier = %s, want \"hot\"", got)
	}
	// The *SignalDataKind pointer must serialize as its bare string value.
	if got := string(m["data_kind"]); got != `"numeric"` {
		t.Errorf("data_kind = %s, want \"numeric\"", got)
	}
	if got := string(m["typed_table"]); got != `"positions"` {
		t.Errorf("typed_table = %s, want \"positions\"", got)
	}
}

// TestSignalCatalog_JSONRoundTrip ensures a populated hot entry survives a
// marshal→unmarshal cycle with all pointer fields, the typed enum pointer, and
// timestamps preserved.
func TestSignalCatalog_JSONRoundTrip(t *testing.T) {
	tbl := "charging_telemetry"
	col := "charger_power_w"
	kind := SignalDataKindNumeric
	unit := "W"
	notes := "hot path"
	first := time.Date(2026, 1, 1, 0, 0, 0, 987654321, time.UTC)
	last := time.Date(2026, 7, 5, 0, 0, 0, 0, time.UTC)
	created := time.Date(2026, 1, 1, 0, 0, 1, 0, time.UTC)
	updated := time.Date(2026, 7, 5, 0, 0, 1, 0, time.UTC)

	orig := SignalCatalog{
		Name:             "ChargerPower",
		FirstSeenAt:      first,
		LastSeenAt:       last,
		ObservationCount: 999,
		StorageTier:      SignalStorageTierHot,
		TypedTable:       &tbl,
		TypedColumn:      &col,
		DataKind:         &kind,
		Unit:             &unit,
		Notes:            &notes,
		CreatedAt:        created,
		UpdatedAt:        updated,
	}

	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got SignalCatalog
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got.Name != orig.Name {
		t.Errorf("Name = %q, want %q", got.Name, orig.Name)
	}
	if got.ObservationCount != orig.ObservationCount {
		t.Errorf("ObservationCount = %d, want %d", got.ObservationCount, orig.ObservationCount)
	}
	if got.StorageTier != orig.StorageTier {
		t.Errorf("StorageTier = %q, want %q", got.StorageTier, orig.StorageTier)
	}
	if !got.IsHot() {
		t.Error("round-tripped hot entry no longer reports IsHot()")
	}
	if got.TypedTable == nil || *got.TypedTable != tbl {
		t.Errorf("TypedTable = %v, want %q", got.TypedTable, tbl)
	}
	if got.TypedColumn == nil || *got.TypedColumn != col {
		t.Errorf("TypedColumn = %v, want %q", got.TypedColumn, col)
	}
	if got.DataKind == nil || *got.DataKind != kind {
		t.Errorf("DataKind = %v, want %q", got.DataKind, kind)
	}
	if got.DataKind != nil && !got.DataKind.Valid() {
		t.Errorf("round-tripped DataKind %q is not Valid()", *got.DataKind)
	}
	if got.Unit == nil || *got.Unit != unit {
		t.Errorf("Unit = %v, want %q", got.Unit, unit)
	}
	if got.Notes == nil || *got.Notes != notes {
		t.Errorf("Notes = %v, want %q", got.Notes, notes)
	}
	if !got.FirstSeenAt.Equal(orig.FirstSeenAt) {
		t.Errorf("FirstSeenAt = %v, want %v", got.FirstSeenAt, orig.FirstSeenAt)
	}
	if !got.LastSeenAt.Equal(orig.LastSeenAt) {
		t.Errorf("LastSeenAt = %v, want %v", got.LastSeenAt, orig.LastSeenAt)
	}
	if !got.CreatedAt.Equal(orig.CreatedAt) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, orig.CreatedAt)
	}
	if !got.UpdatedAt.Equal(orig.UpdatedAt) {
		t.Errorf("UpdatedAt = %v, want %v", got.UpdatedAt, orig.UpdatedAt)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Struct-tag contract (persistence + transport)
//
// Being a DTO leaf (ADR-006) this package cannot import the repos that scan
// these rows, so the expected column sets are pinned here as the contract.
// They mirror migrations/_baseline_source/08-signal-observations.sql and
// 09-signal-catalog.sql. db tag == json tag == SQL column for every field.
// ─────────────────────────────────────────────────────────────────────────────

// TestSignalObservation_StructTags asserts every field's json and db tags match
// the signal_observations columns.
func TestSignalObservation_StructTags(t *testing.T) {
	want := map[string][2]string{
		"VehicleID":    {"vehicle_id", "vehicle_id"},
		"Ts":           {"ts", "ts"},
		"SignalName":   {"signal_name", "signal_name"},
		"ValueNumeric": {"value_numeric", "value_numeric"},
		"ValueText":    {"value_text", "value_text"},
		"ValueBool":    {"value_bool", "value_bool"},
		"Source":       {"source", "source"},
	}
	assertStructTags(t, reflect.TypeOf(SignalObservation{}), want)
}

// TestSignalCatalog_StructTags asserts every field's json and db tags match the
// signal_catalog columns.
func TestSignalCatalog_StructTags(t *testing.T) {
	want := map[string][2]string{
		"Name":             {"name", "name"},
		"FirstSeenAt":      {"first_seen_at", "first_seen_at"},
		"LastSeenAt":       {"last_seen_at", "last_seen_at"},
		"ObservationCount": {"observation_count", "observation_count"},
		"StorageTier":      {"storage_tier", "storage_tier"},
		"TypedTable":       {"typed_table", "typed_table"},
		"TypedColumn":      {"typed_column", "typed_column"},
		"DataKind":         {"data_kind", "data_kind"},
		"Unit":             {"unit", "unit"},
		"Notes":            {"notes", "notes"},
		"CreatedAt":        {"created_at", "created_at"},
		"UpdatedAt":        {"updated_at", "updated_at"},
	}
	assertStructTags(t, reflect.TypeOf(SignalCatalog{}), want)
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

func assertStructTags(t *testing.T, typ reflect.Type, want map[string][2]string) {
	t.Helper()
	if typ.NumField() != len(want) {
		t.Fatalf("%s has %d fields, expected %d — update the tag contract", typ.Name(), typ.NumField(), len(want))
	}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		exp, ok := want[f.Name]
		if !ok {
			t.Errorf("%s.%s has no expected tag entry", typ.Name(), f.Name)
			continue
		}
		if got := tagName(f.Tag.Get("json")); got != exp[0] {
			t.Errorf("%s.%s json tag = %q, want %q", typ.Name(), f.Name, got, exp[0])
		}
		if got := tagName(f.Tag.Get("db")); got != exp[1] {
			t.Errorf("%s.%s db tag = %q, want %q", typ.Name(), f.Name, got, exp[1])
		}
	}
}

// tagName returns the bare tag name, stripping any options such as ",omitempty".
func tagName(tag string) string {
	if i := strings.IndexByte(tag, ','); i >= 0 {
		return tag[:i]
	}
	return tag
}
