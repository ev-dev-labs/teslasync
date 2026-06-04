// VehicleSettingsRepo unit tests.
//
// Repo's pgx queries require a live PostgreSQL connection, so the
// bulk-resolver coverage lives in the in-process resolver tests below
// (which use stub stores). These tests cover the pure-Go pieces:
//
//   - The whitelist matches the documented set (no accidental
//     polling_seconds slip).
//   - Per-key validators reject every documented bad shape and
//     accept every good shape.
//   - The resolver returns vehicle override > user > default in
//     priority order, and DELETE-of-override falls through.
//   - DefaultsForKey covers every whitelisted key.

package settings

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestVehicleSettingDefs_WhitelistMatchesPhase1(t *testing.T) {
	got := make([]string, 0, len(VehicleSettingDefs()))
	for _, d := range VehicleSettingDefs() {
		got = append(got, d.Key)
	}
	want := []string{
		"nickname",
		"mute_until",
		"charge_cost_tariff_id",
		"units_distance",
		"units_temperature",
		"units_energy",
	}
	if len(got) != len(want) {
		t.Fatalf("whitelist length: got %d, want %d (got=%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("whitelist[%d]: got %q, want %q (full=%v)", i, got[i], want[i], got)
		}
	}
}

func TestVehicleSettingDefs_PollingSecondsIsExplicitlyExcluded(t *testing.T) {
	// Per the rubber-duck pre-implementation review, polling_seconds
	// is owned by the canonical polling_config table — a duplicate
	// vehicle_settings entry would create a second source of truth.
	// This test pins the exclusion so a future maintainer can't
	// accidentally re-introduce it without updating the doc.
	if IsValidVehicleSettingKey("polling_seconds") {
		t.Fatal("polling_seconds must NOT be a vehicle_settings key (owned by polling_config)")
	}
}

func TestIsValidVehicleSettingKey(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"nickname", true},
		{"mute_until", true},
		{"units_distance", true},
		{"polling_seconds", false},
		{"unknown_key", false},
		{"", false},
	}
	for _, tc := range cases {
		t.Run(tc.key, func(t *testing.T) {
			if got := IsValidVehicleSettingKey(tc.key); got != tc.want {
				t.Fatalf("IsValidVehicleSettingKey(%q) = %v, want %v", tc.key, got, tc.want)
			}
		})
	}
}

func TestValidateVehicleSettingValue_Nickname(t *testing.T) {
	type tc struct {
		name    string
		val     any
		wantErr error
	}
	cases := []tc{
		{"valid", "Daily Driver", nil},
		{"unicode", "Tesla 🚗", nil},
		{"empty", "", ErrVehicleSettingInvalidValue},
		{"whitespace_only", "   ", ErrVehicleSettingInvalidValue},
		{"leading_space", " name", ErrVehicleSettingInvalidValue},
		{"trailing_space", "name ", ErrVehicleSettingInvalidValue},
		{"too_long", strings.Repeat("a", VehicleNicknameMaxLen+1), ErrVehicleSettingInvalidValue},
		{"max_length", strings.Repeat("a", VehicleNicknameMaxLen), nil},
		{"wrong_type_int", 42, ErrVehicleSettingInvalidValue},
		{"wrong_type_nil", nil, ErrVehicleSettingInvalidValue},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateVehicleSettingValue("nickname", c.val)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err: got %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateVehicleSettingValue_MuteUntil(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name    string
		val     any
		wantErr error
	}{
		{"future", now.Add(time.Hour), nil},
		{"past_allowed", now.Add(-time.Hour), nil},
		{"pointer_future", func() *time.Time { t := now.Add(time.Hour); return &t }(), nil},
		{"zero", time.Time{}, ErrVehicleSettingInvalidValue},
		{"nil_pointer", (*time.Time)(nil), ErrVehicleSettingInvalidValue},
		{"wrong_type_string", "2026-01-01", ErrVehicleSettingInvalidValue},
		{"wrong_type_nil", nil, ErrVehicleSettingInvalidValue},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateVehicleSettingValue("mute_until", c.val)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err: got %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateVehicleSettingValue_UnitsEnums(t *testing.T) {
	cases := []struct {
		key     string
		val     any
		wantErr error
	}{
		{"units_distance", "km", nil},
		{"units_distance", "mi", nil},
		{"units_distance", "lightyears", ErrVehicleSettingInvalidValue},
		{"units_distance", "KM", ErrVehicleSettingInvalidValue},
		{"units_distance", "", ErrVehicleSettingInvalidValue},
		{"units_temperature", "C", nil},
		{"units_temperature", "F", nil},
		{"units_temperature", "K", ErrVehicleSettingInvalidValue},
		{"units_energy", "kWh", nil},
		{"units_energy", "Wh", ErrVehicleSettingInvalidValue},
	}
	for _, c := range cases {
		t.Run(c.key+"_"+toString(c.val), func(t *testing.T) {
			err := ValidateVehicleSettingValue(c.key, c.val)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err: got %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateVehicleSettingValue_ChargeCostTariffID(t *testing.T) {
	cases := []struct {
		name    string
		val     any
		wantErr error
	}{
		{"valid", "tariff-pg-e-ev2-a", nil},
		{"empty", "", ErrVehicleSettingInvalidValue},
		{"whitespace", "  ", ErrVehicleSettingInvalidValue},
		{"too_long", strings.Repeat("x", 65), ErrVehicleSettingInvalidValue},
		{"int", 42, ErrVehicleSettingInvalidValue},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateVehicleSettingValue("charge_cost_tariff_id", c.val)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err: got %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestValidateVehicleSettingValue_UnknownKey(t *testing.T) {
	if err := ValidateVehicleSettingValue("polling_seconds", 42.0); !errors.Is(err, ErrVehicleSettingInvalidKey) {
		t.Fatalf("polling_seconds: got %v, want ErrVehicleSettingInvalidKey", err)
	}
	if err := ValidateVehicleSettingValue("", "x"); !errors.Is(err, ErrVehicleSettingInvalidKey) {
		t.Fatalf("empty key: got %v, want ErrVehicleSettingInvalidKey", err)
	}
}

func TestDefaultsForKey_CoversWhitelist(t *testing.T) {
	for _, def := range VehicleSettingDefs() {
		t.Run(def.Key, func(t *testing.T) {
			_, src, ok := DefaultsForKey(def.Key)
			if !ok {
				t.Fatalf("DefaultsForKey(%q): missing", def.Key)
			}
			if src != EffectiveSourceDefault {
				t.Fatalf("DefaultsForKey(%q) source: got %q, want %q",
					def.Key, src, EffectiveSourceDefault)
			}
		})
	}
}

func TestDefaultsForKey_UnknownReturnsFalse(t *testing.T) {
	_, _, ok := DefaultsForKey("polling_seconds")
	if ok {
		t.Fatal("DefaultsForKey(polling_seconds) must be false (excluded from this layer)")
	}
}

func TestVehicleSettingRow_AsAny(t *testing.T) {
	t.Run("text", func(t *testing.T) {
		s := "hi"
		row := VehicleSettingRow{Kind: VehicleSettingKindText, ValueText: &s}
		if got := row.AsAny(); got != "hi" {
			t.Fatalf("got %v, want hi", got)
		}
	})
	t.Run("number", func(t *testing.T) {
		v := 42.0
		row := VehicleSettingRow{Kind: VehicleSettingKindNumber, ValueNum: &v}
		if got := row.AsAny(); got != 42.0 {
			t.Fatalf("got %v, want 42.0", got)
		}
	})
	t.Run("boolean", func(t *testing.T) {
		v := true
		row := VehicleSettingRow{Kind: VehicleSettingKindBoolean, ValueBool: &v}
		if got := row.AsAny(); got != true {
			t.Fatalf("got %v, want true", got)
		}
	})
	t.Run("timestamp", func(t *testing.T) {
		ts := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
		row := VehicleSettingRow{Kind: VehicleSettingKindTimestamp, ValueTS: &ts}
		got, ok := row.AsAny().(string)
		if !ok || got != "2026-05-05T12:00:00Z" {
			t.Fatalf("got %v, want 2026-05-05T12:00:00Z", row.AsAny())
		}
	})
	t.Run("nil_payload", func(t *testing.T) {
		row := VehicleSettingRow{Kind: VehicleSettingKindText}
		if got := row.AsAny(); got != nil {
			t.Fatalf("got %v, want nil", got)
		}
	})
}

// ─── Resolver tests (use stub adapters) ─────────────────────────

// stubVehicleNameLookup returns a fixed name + ok pair.
type stubVehicleNameLookup struct {
	name    string
	present bool
	err     error
}

func (s *stubVehicleNameLookup) GetDisplayName(_ context.Context, _ int64) (string, bool, error) {
	return s.name, s.present, s.err
}

// stubUserSettingsLookup returns fixed values for the unit lookups.
type stubUserSettingsLookup struct {
	dist     string
	distOK   bool
	temp     string
	tempOK   bool
	distErr  error
	tempErr  error
	distHits int
	tempHits int
}

func (s *stubUserSettingsLookup) GetUnitOfLength(_ context.Context) (string, bool, error) {
	s.distHits++
	return s.dist, s.distOK, s.distErr
}

func (s *stubUserSettingsLookup) GetUnitOfTemp(_ context.Context) (string, bool, error) {
	s.tempHits++
	return s.temp, s.tempOK, s.tempErr
}

// stubOverridesLister satisfies VehicleSettingsOverridesLister with
// an in-memory map. The resolver depends on the interface, not the
// concrete *VehicleSettingsRepo, so production-shape SQL is not
// exercised here — that is by design (the SQL needs a live database
// and is not part of the pure-Go resolver semantics under test).
type stubOverridesLister struct {
	rows map[string]VehicleSettingRow
	err  error
}

func (s *stubOverridesLister) List(_ context.Context, _ int64) (map[string]VehicleSettingRow, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.rows == nil {
		return map[string]VehicleSettingRow{}, nil
	}
	return s.rows, nil
}

func newResolverWithOverrides(rows map[string]VehicleSettingRow, vehicles VehicleNameLookup, user UserSettingsLookup) *VehicleSettingsResolver {
	return NewVehicleSettingsResolver(&stubOverridesLister{rows: rows}, vehicles, user)
}

func TestResolver_OverrideWins(t *testing.T) {
	tariff := "tariff-pg-e-ev2-a"
	rows := map[string]VehicleSettingRow{
		"charge_cost_tariff_id": {Kind: VehicleSettingKindText, ValueText: &tariff},
	}
	r := newResolverWithOverrides(rows, &stubVehicleNameLookup{name: "Base", present: true}, &stubUserSettingsLookup{dist: "mi", distOK: true, temp: "F", tempOK: true})

	out, err := r.Resolve(context.Background(), 7)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got := indexBy(out)
	if got["charge_cost_tariff_id"].Source != EffectiveSourceOverride {
		t.Fatalf("override source: got %q", got["charge_cost_tariff_id"].Source)
	}
	if got["charge_cost_tariff_id"].Value != "tariff-pg-e-ev2-a" {
		t.Fatalf("override value: got %v", got["charge_cost_tariff_id"].Value)
	}
}

func TestResolver_FallsBackToUser_ForUnits(t *testing.T) {
	r := newResolverWithOverrides(nil, &stubVehicleNameLookup{name: "Base", present: true}, &stubUserSettingsLookup{dist: "mi", distOK: true, temp: "F", tempOK: true})
	out, err := r.Resolve(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got := indexBy(out)
	if got["units_distance"].Source != EffectiveSourceUser || got["units_distance"].Value != "mi" {
		t.Fatalf("units_distance: got %+v", got["units_distance"])
	}
	if got["units_temperature"].Source != EffectiveSourceUser || got["units_temperature"].Value != "F" {
		t.Fatalf("units_temperature: got %+v", got["units_temperature"])
	}
	// units_energy has no user-level fallback, defaults to "kWh".
	if got["units_energy"].Source != EffectiveSourceDefault || got["units_energy"].Value != "kWh" {
		t.Fatalf("units_energy: got %+v", got["units_energy"])
	}
}

func TestResolver_FallsBackToVehicle_ForNickname(t *testing.T) {
	r := newResolverWithOverrides(nil, &stubVehicleNameLookup{name: "Daily Driver", present: true}, nil)
	out, err := r.Resolve(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got := indexBy(out)
	if got["nickname"].Source != EffectiveSourceVehicle || got["nickname"].Value != "Daily Driver" {
		t.Fatalf("nickname: got %+v", got["nickname"])
	}
}

func TestResolver_FallsBackToDefault_WhenNoUpstream(t *testing.T) {
	r := newResolverWithOverrides(nil, nil, nil)
	out, err := r.Resolve(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got := indexBy(out)
	if got["nickname"].Source != EffectiveSourceDefault || got["nickname"].Value != "" {
		t.Fatalf("nickname default: got %+v", got["nickname"])
	}
	if got["units_distance"].Source != EffectiveSourceDefault || got["units_distance"].Value != "km" {
		t.Fatalf("units_distance default: got %+v", got["units_distance"])
	}
	if got["units_temperature"].Source != EffectiveSourceDefault || got["units_temperature"].Value != "C" {
		t.Fatalf("units_temperature default: got %+v", got["units_temperature"])
	}
	if got["mute_until"].Source != EffectiveSourceDefault || got["mute_until"].Value != nil {
		t.Fatalf("mute_until default: got %+v", got["mute_until"])
	}
}

func TestResolver_OverrideMaskingFallback(t *testing.T) {
	// Override on units_distance must defeat the user-level value.
	v := "km"
	rows := map[string]VehicleSettingRow{
		"units_distance": {Kind: VehicleSettingKindText, ValueText: &v},
	}
	user := &stubUserSettingsLookup{dist: "mi", distOK: true, temp: "F", tempOK: true}
	r := newResolverWithOverrides(rows, nil, user)
	out, err := r.Resolve(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	got := indexBy(out)
	if got["units_distance"].Source != EffectiveSourceOverride || got["units_distance"].Value != "km" {
		t.Fatalf("override masking: got %+v", got["units_distance"])
	}
	// The override means the resolver MUST NOT query the user
	// layer for that key — otherwise we'd be doing wasted I/O on
	// the hot path.
	if user.distHits != 0 {
		t.Fatalf("override should short-circuit user lookup: hits=%d", user.distHits)
	}
}

func TestResolver_VehicleNameLookupError(t *testing.T) {
	r := newResolverWithOverrides(nil, &stubVehicleNameLookup{err: errors.New("db down")}, nil)
	if _, err := r.Resolve(context.Background(), 1); err == nil {
		t.Fatal("expected error when nickname fallback fails")
	}
}

func TestResolver_DeterministicOrder(t *testing.T) {
	r := newResolverWithOverrides(nil, &stubVehicleNameLookup{name: "x", present: true}, &stubUserSettingsLookup{dist: "km", distOK: true, temp: "C", tempOK: true})
	out, err := r.Resolve(context.Background(), 1)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	defs := VehicleSettingDefs()
	if len(out) != len(defs) {
		t.Fatalf("len: got %d want %d", len(out), len(defs))
	}
	for i := range defs {
		if out[i].Key != defs[i].Key {
			t.Fatalf("order[%d]: got %q want %q", i, out[i].Key, defs[i].Key)
		}
	}
}

// ─── helpers ─────────────────────────────────────────────────────

func indexBy(rows []EffectiveSetting) map[string]EffectiveSetting {
	out := make(map[string]EffectiveSetting, len(rows))
	for _, r := range rows {
		out[r.Key] = r
	}
	return out
}

func toString(v any) string {
	switch x := v.(type) {
	case string:
		if x == "" {
			return "empty"
		}
		return x
	default:
		return "non-string"
	}
}
