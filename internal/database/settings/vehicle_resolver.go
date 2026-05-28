// Phase-46 / Prompt 43 — hierarchical resolver for per-vehicle settings.
//
// `Resolver.Resolve` returns the EFFECTIVE value for every supported
// key, layered in this order:
//
//  1. vehicle_settings override (this prompt's table)
//  2. install-global SettingsRepo value
//  3. hard-coded default (DefaultsForKey below)
//
// The vehicles base table is consulted only for the `nickname` key
// because vehicles.display_name is a per-row attribute, not a
// setting; we surface it as the "vehicle" source so the SPA pill
// can render it differently from the install-global "user" source.
//
// SCOPE LIMITS
// ------------
// SettingsRepo.Get reads a single install-global row today; the
// resolver therefore returns the same "user" value for every
// authenticated principal. A future prompt-57 (subject-aware
// settings) will replace this layer with a subject-keyed read; the
// API contract here is forward-compatible because the source pill
// names the LAYER, not the principal that produced it.
package settings

import (
	"context"
	"fmt"
)

// EffectiveSetting is one row in the resolver's response. Source
// names which layer produced Value so the SPA pill can render the
// correct lineage chip.
type EffectiveSetting struct {
	Key    string                 `json:"key"`
	Value  any                    `json:"value"`
	Source EffectiveSettingSource `json:"source"`
}

// VehicleSettingsOverridesLister is the seam the resolver uses to
// read the override layer. Production wires *VehicleSettingsRepo
// (which satisfies this trivially via its `List` method); tests
// substitute an in-memory fake without touching a database.
type VehicleSettingsOverridesLister interface {
	List(ctx context.Context, vehicleID int64) (map[string]VehicleSettingRow, error)
}

// VehicleNameLookup is the seam the resolver uses to read the
// vehicles.display_name fallback for the `nickname` key. Production
// wires *VehicleRepo here; tests can substitute a stub.
type VehicleNameLookup interface {
	// GetDisplayName returns the vehicle's display_name. The
	// returned value is empty and the bool false when the vehicle
	// id does not resolve. The resolver tolerates "not found" by
	// falling through to the default ("") rather than 500-ing.
	GetDisplayName(ctx context.Context, vehicleID int64) (string, bool, error)
}

// UserSettingsLookup is the seam the resolver uses to read the
// install-global per-user setting that backs the units_*` keys.
// Production wires *SettingsRepo here.
type UserSettingsLookup interface {
	// GetUnitOfLength returns the install-global "unit_of_length"
	// (km|mi). The returned bool is false when no row exists in
	// settings — caller falls through to the default.
	GetUnitOfLength(ctx context.Context) (string, bool, error)
	// GetUnitOfTemp returns the install-global "unit_of_temp"
	// (C|F). The returned bool is false when no row exists.
	GetUnitOfTemp(ctx context.Context) (string, bool, error)
}

// VehicleSettingsResolver layers the override repo, vehicle base
// table, install-global settings, and hard-coded defaults into a
// single EffectiveSetting list per vehicle.
type VehicleSettingsResolver struct {
	overrides VehicleSettingsOverridesLister
	vehicles  VehicleNameLookup
	user      UserSettingsLookup
}

// NewVehicleSettingsResolver wires the resolver to its three sources.
// Any of vehicles/user MAY be nil — the resolver's per-key fallback
// chain skips a nil lookup and proceeds to the next layer (the test
// suite leans on this to avoid stubbing every dependency for every
// test case). `overrides` MUST be non-nil; without it there is no
// vehicle-scoped data to layer.
func NewVehicleSettingsResolver(
	overrides VehicleSettingsOverridesLister,
	vehicles VehicleNameLookup,
	user UserSettingsLookup,
) *VehicleSettingsResolver {
	return &VehicleSettingsResolver{
		overrides: overrides,
		vehicles:  vehicles,
		user:      user,
	}
}

// DefaultsForKey returns the hard-coded fallback value + source for
// a supported key. Unsupported keys return (nil, "", false). The
// SPA's <SourcePill> never sees `(nil, "default")` for keys whose
// next layer (vehicle/user) is guaranteed to fire — but the resolver
// still calls this for completeness so a future fallback-change is
// localised.
func DefaultsForKey(key string) (any, EffectiveSettingSource, bool) {
	switch key {
	case "nickname":
		// Empty string with "default" source is reachable only
		// when both the override layer AND the vehicles base
		// row are missing — i.e. the vehicle id does not
		// resolve. Surfacing it lets the SPA render an
		// em-dash without a special case.
		return "", EffectiveSourceDefault, true
	case "mute_until":
		return nil, EffectiveSourceDefault, true
	case "charge_cost_tariff_id":
		return nil, EffectiveSourceDefault, true
	case "units_distance":
		return "km", EffectiveSourceDefault, true
	case "units_temperature":
		return "C", EffectiveSourceDefault, true
	case "units_energy":
		return "kWh", EffectiveSourceDefault, true
	default:
		return nil, "", false
	}
}

// Resolve returns one EffectiveSetting per supported key, in the
// canonical iteration order (matches VehicleSettingDefs). The list
// is always the full whitelist length so the SPA can render rows
// without checking presence.
func (r *VehicleSettingsResolver) Resolve(ctx context.Context, vehicleID int64) ([]EffectiveSetting, error) {
	overrides, err := r.overrides.List(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("resolve: list overrides: %w", err)
	}

	out := make([]EffectiveSetting, 0, len(vehicleSettingDefs))
	for _, def := range vehicleSettingDefs {
		eff, err := r.resolveOne(ctx, vehicleID, def, overrides)
		if err != nil {
			return nil, fmt.Errorf("resolve %s: %w", def.Key, err)
		}
		out = append(out, eff)
	}
	return out, nil
}

// resolveOne computes the effective value for one key. Overrides
// always win; per-key fallback then walks vehicle / user / default
// in the right order for the key.
func (r *VehicleSettingsResolver) resolveOne(
	ctx context.Context,
	vehicleID int64,
	def VehicleSettingDef,
	overrides map[string]VehicleSettingRow,
) (EffectiveSetting, error) {
	// Layer 1 — vehicle_settings override.
	if row, ok := overrides[def.Key]; ok {
		return EffectiveSetting{
			Key:    def.Key,
			Value:  row.AsAny(),
			Source: EffectiveSourceOverride,
		}, nil
	}

	// Layer 2/3 — per-key fallback chain.
	switch def.Key {
	case "nickname":
		if r.vehicles != nil {
			name, ok, err := r.vehicles.GetDisplayName(ctx, vehicleID)
			if err != nil {
				return EffectiveSetting{}, fmt.Errorf("vehicle name: %w", err)
			}
			if ok && name != "" {
				return EffectiveSetting{
					Key:    def.Key,
					Value:  name,
					Source: EffectiveSourceVehicle,
				}, nil
			}
		}
	case "units_distance":
		if r.user != nil {
			v, ok, err := r.user.GetUnitOfLength(ctx)
			if err != nil {
				return EffectiveSetting{}, fmt.Errorf("user units_distance: %w", err)
			}
			if ok && v != "" {
				return EffectiveSetting{
					Key:    def.Key,
					Value:  v,
					Source: EffectiveSourceUser,
				}, nil
			}
		}
	case "units_temperature":
		if r.user != nil {
			v, ok, err := r.user.GetUnitOfTemp(ctx)
			if err != nil {
				return EffectiveSetting{}, fmt.Errorf("user units_temperature: %w", err)
			}
			if ok && v != "" {
				return EffectiveSetting{
					Key:    def.Key,
					Value:  v,
					Source: EffectiveSourceUser,
				}, nil
			}
		}
	}

	// Layer 3 (or 2 for keys without a user-level layer) — default.
	defValue, defSource, ok := DefaultsForKey(def.Key)
	if !ok {
		// Should be unreachable — the canonical loop only
		// iterates whitelisted keys.
		return EffectiveSetting{}, fmt.Errorf("no default for key %q", def.Key)
	}
	return EffectiveSetting{
		Key:    def.Key,
		Value:  defValue,
		Source: defSource,
	}, nil
}

// userSettingsLookupAdapter adapts the production *SettingsRepo to
// the UserSettingsLookup seam.
type userSettingsLookupAdapter struct {
	repo *SettingsRepo
}

// NewUserSettingsLookup returns a UserSettingsLookup backed by the
// supplied *SettingsRepo. Returns nil when repo is nil.
func NewUserSettingsLookup(repo *SettingsRepo) UserSettingsLookup {
	if repo == nil {
		return nil
	}
	return &userSettingsLookupAdapter{repo: repo}
}

// GetUnitOfLength reads the install-global setting; the boolean is
// true whenever the SettingsRepo returned a value (even if the row
// was missing — SettingsRepo applies defaults). We treat the
// SettingsRepo's own default as "user-level" for source purposes
// because that's where a user would change it from the SPA today.
func (a *userSettingsLookupAdapter) GetUnitOfLength(ctx context.Context) (string, bool, error) {
	s, err := a.repo.Get(ctx)
	if err != nil {
		return "", false, err
	}
	if s == nil {
		return "", false, nil
	}
	return s.UnitOfLength, s.UnitOfLength != "", nil
}

// GetUnitOfTemp mirrors GetUnitOfLength for the temperature unit.
func (a *userSettingsLookupAdapter) GetUnitOfTemp(ctx context.Context) (string, bool, error) {
	s, err := a.repo.Get(ctx)
	if err != nil {
		return "", false, err
	}
	if s == nil {
		return "", false, nil
	}
	return s.UnitOfTemp, s.UnitOfTemp != "", nil
}
