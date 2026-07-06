package settings

import (
	"encoding/json"
	"reflect"
	"testing"
)

// equalStrings compares two string slices element-wise, treating a nil slice and
// an empty slice as equal (both have length 0). The endpoint helpers return a nil
// slice when nothing is enabled, so this normalisation keeps the tables readable.
func equalStrings(a, b []string) bool {
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

// allSubEndpoints toggles every automatic vehicle_data sub-endpoint flag.
func allSubEndpoints() LegacyPollingConfig {
	return LegacyPollingConfig{
		ChargeState:   true,
		ClimateState:  true,
		DriveState:    true,
		LocationData:  true,
		VehicleState:  true,
		VehicleConfig: true,
	}
}

// allOnDemandSubEndpoints toggles every on-demand vehicle_data sub-endpoint flag.
func allOnDemandSubEndpoints() LegacyPollingConfig {
	return LegacyPollingConfig{
		OnDemandChargeState:   true,
		OnDemandClimateState:  true,
		OnDemandDriveState:    true,
		OnDemandLocationData:  true,
		OnDemandVehicleState:  true,
		OnDemandVehicleConfig: true,
	}
}

// TestDefaultPollingConfig pins the safe-default contract the worker and the
// GET /settings/polling-config handler both depend on: every polling and
// on-demand endpoint enabled, telemetry capture OFF, and a 7-day retention.
func TestDefaultPollingConfig(t *testing.T) {
	pc := DefaultPollingConfig()

	boolFlags := []struct {
		name string
		got  bool
		want bool
	}{
		{"VehicleDiscovery", pc.VehicleDiscovery, true},
		{"ChargeState", pc.ChargeState, true},
		{"ClimateState", pc.ClimateState, true},
		{"DriveState", pc.DriveState, true},
		{"LocationData", pc.LocationData, true},
		{"VehicleState", pc.VehicleState, true},
		{"VehicleConfig", pc.VehicleConfig, true},
		{"OnDemandVehicleDiscovery", pc.OnDemandVehicleDiscovery, true},
		{"OnDemandChargeState", pc.OnDemandChargeState, true},
		{"OnDemandClimateState", pc.OnDemandClimateState, true},
		{"OnDemandDriveState", pc.OnDemandDriveState, true},
		{"OnDemandLocationData", pc.OnDemandLocationData, true},
		{"OnDemandVehicleState", pc.OnDemandVehicleState, true},
		{"OnDemandVehicleConfig", pc.OnDemandVehicleConfig, true},
		{"NearbyChargingSites", pc.NearbyChargingSites, true},
		{"ReleaseNotes", pc.ReleaseNotes, true},
		{"RecentAlerts", pc.RecentAlerts, true},
		{"ServiceData", pc.ServiceData, true},
		{"WakeUp", pc.WakeUp, true},
		{"Commands", pc.Commands, true},
		{"TelemetryCapture", pc.TelemetryCapture, false},
	}
	for _, f := range boolFlags {
		if f.got != f.want {
			t.Errorf("DefaultPollingConfig().%s = %v, want %v", f.name, f.got, f.want)
		}
	}

	if pc.TelemetryCaptureRetentionDays != 7 {
		t.Errorf("DefaultPollingConfig().TelemetryCaptureRetentionDays = %d, want 7", pc.TelemetryCaptureRetentionDays)
	}

	// The default must present a fully-enabled polling surface to downstream
	// consumers, so the derived helpers must agree with the flags above.
	if !pc.HasAnyVehicleDataEndpoint() {
		t.Error("DefaultPollingConfig().HasAnyVehicleDataEndpoint() = false, want true")
	}
	wantAll := []string{"charge_state", "climate_state", "drive_state", "location_data", "vehicle_state", "vehicle_config"}
	if got := pc.EnabledVehicleDataEndpoints(); !equalStrings(got, wantAll) {
		t.Errorf("DefaultPollingConfig().EnabledVehicleDataEndpoints() = %v, want %v", got, wantAll)
	}
	if got := pc.EnabledOnDemandVehicleDataEndpoints(); !equalStrings(got, wantAll) {
		t.Errorf("DefaultPollingConfig().EnabledOnDemandVehicleDataEndpoints() = %v, want %v", got, wantAll)
	}
}

// TestLegacyPollingConfig_EnabledVehicleDataEndpoints exercises the ordering,
// subset selection, empty, and nil-receiver behaviour of the automatic endpoint
// projection used to build the Tesla vehicle_data query string.
func TestLegacyPollingConfig_EnabledVehicleDataEndpoints(t *testing.T) {
	// discoveryOnly proves the projection ignores non-sub-endpoint flags such as
	// VehicleDiscovery / NearbyChargingSites / WakeUp.
	discoveryOnly := LegacyPollingConfig{
		VehicleDiscovery:    true,
		NearbyChargingSites: true,
		WakeUp:              true,
		Commands:            true,
	}
	// onDemandOnly proves the automatic projection never leaks on-demand flags.
	onDemandOnly := allOnDemandSubEndpoints()

	tests := []struct {
		name string
		pc   *LegacyPollingConfig
		want []string
	}{
		{"nil receiver", nil, nil},
		{"none enabled", &LegacyPollingConfig{}, nil},
		{"only non-sub-endpoint flags", &discoveryOnly, nil},
		{"only on-demand flags", &onDemandOnly, nil},
		{"all enabled preserves order", ptr(allSubEndpoints()), []string{"charge_state", "climate_state", "drive_state", "location_data", "vehicle_state", "vehicle_config"}},
		{"single middle endpoint", &LegacyPollingConfig{DriveState: true}, []string{"drive_state"}},
		{"first and last only", &LegacyPollingConfig{ChargeState: true, VehicleConfig: true}, []string{"charge_state", "vehicle_config"}},
		{"out-of-struct-order stays canonical", &LegacyPollingConfig{VehicleState: true, ClimateState: true, LocationData: true}, []string{"climate_state", "location_data", "vehicle_state"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.pc.EnabledVehicleDataEndpoints()
			if !equalStrings(got, tc.want) {
				t.Errorf("EnabledVehicleDataEndpoints() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestLegacyPollingConfig_VehicleDataEndpointsString verifies the semicolon join
// and that it stays consistent with EnabledVehicleDataEndpoints, including the
// nil-receiver case (which must not panic).
func TestLegacyPollingConfig_VehicleDataEndpointsString(t *testing.T) {
	tests := []struct {
		name string
		pc   *LegacyPollingConfig
		want string
	}{
		{"nil receiver", nil, ""},
		{"none enabled", &LegacyPollingConfig{}, ""},
		{"single endpoint has no separator", &LegacyPollingConfig{ClimateState: true}, "climate_state"},
		{"two endpoints joined", &LegacyPollingConfig{ChargeState: true, DriveState: true}, "charge_state;drive_state"},
		{"all enabled", ptr(allSubEndpoints()), "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.pc.VehicleDataEndpointsString()
			if got != tc.want {
				t.Errorf("VehicleDataEndpointsString() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestLegacyPollingConfig_HasAnyVehicleDataEndpoint pins the "any automatic
// sub-endpoint" predicate the worker uses to skip idle poll cycles. It must
// consider only the six automatic flags — never on-demand flags or the
// discovery/command flags — and must be nil-safe.
func TestLegacyPollingConfig_HasAnyVehicleDataEndpoint(t *testing.T) {
	tests := []struct {
		name string
		pc   *LegacyPollingConfig
		want bool
	}{
		{"nil receiver", nil, false},
		{"empty", &LegacyPollingConfig{}, false},
		{"charge_state", &LegacyPollingConfig{ChargeState: true}, true},
		{"climate_state", &LegacyPollingConfig{ClimateState: true}, true},
		{"drive_state", &LegacyPollingConfig{DriveState: true}, true},
		{"location_data", &LegacyPollingConfig{LocationData: true}, true},
		{"vehicle_state", &LegacyPollingConfig{VehicleState: true}, true},
		{"vehicle_config", &LegacyPollingConfig{VehicleConfig: true}, true},
		{"all enabled", ptr(allSubEndpoints()), true},
		{"on-demand only does not count", ptr(allOnDemandSubEndpoints()), false},
		{"discovery only does not count", &LegacyPollingConfig{VehicleDiscovery: true}, false},
		{"commands only does not count", &LegacyPollingConfig{WakeUp: true, Commands: true}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.pc.HasAnyVehicleDataEndpoint(); got != tc.want {
				t.Errorf("HasAnyVehicleDataEndpoint() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestLegacyPollingConfig_EnabledOnDemandVehicleDataEndpoints mirrors the
// automatic-projection tests for the on-demand flag set, confirming ordering,
// isolation from automatic flags, and nil safety.
func TestLegacyPollingConfig_EnabledOnDemandVehicleDataEndpoints(t *testing.T) {
	automaticOnly := allSubEndpoints()

	tests := []struct {
		name string
		pc   *LegacyPollingConfig
		want []string
	}{
		{"nil receiver", nil, nil},
		{"none enabled", &LegacyPollingConfig{}, nil},
		{"automatic flags do not leak", &automaticOnly, nil},
		{"all on-demand preserves order", ptr(allOnDemandSubEndpoints()), []string{"charge_state", "climate_state", "drive_state", "location_data", "vehicle_state", "vehicle_config"}},
		{"single on-demand endpoint", &LegacyPollingConfig{OnDemandVehicleState: true}, []string{"vehicle_state"}},
		{"subset stays canonical", &LegacyPollingConfig{OnDemandVehicleConfig: true, OnDemandChargeState: true}, []string{"charge_state", "vehicle_config"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.pc.EnabledOnDemandVehicleDataEndpoints()
			if !equalStrings(got, tc.want) {
				t.Errorf("EnabledOnDemandVehicleDataEndpoints() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestLegacyPollingConfig_AutomaticAndOnDemandAreIndependent locks the invariant
// that the automatic and on-demand projections read disjoint flag sets, so
// enabling one family never affects the other.
func TestLegacyPollingConfig_AutomaticAndOnDemandAreIndependent(t *testing.T) {
	automatic := allSubEndpoints()
	if got := automatic.EnabledOnDemandVehicleDataEndpoints(); len(got) != 0 {
		t.Errorf("automatic-only config leaked on-demand endpoints: %v", got)
	}
	if !automatic.HasAnyVehicleDataEndpoint() {
		t.Error("automatic-only config should report HasAnyVehicleDataEndpoint() = true")
	}

	onDemand := allOnDemandSubEndpoints()
	if got := onDemand.EnabledVehicleDataEndpoints(); len(got) != 0 {
		t.Errorf("on-demand-only config leaked automatic endpoints: %v", got)
	}
	if onDemand.HasAnyVehicleDataEndpoint() {
		t.Error("on-demand-only config should report HasAnyVehicleDataEndpoint() = false")
	}
}

// TestLegacyPollingConfig_JSONRoundTrip guards the wire/DB contract that
// UpdatePollingConfig decodes: a marshal→unmarshal cycle must be lossless and
// the payload must use the documented snake_case keys.
func TestLegacyPollingConfig_JSONRoundTrip(t *testing.T) {
	orig := DefaultPollingConfig()
	orig.ChargeState = false
	orig.TelemetryCapture = true
	orig.TelemetryCaptureRetentionDays = 14

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("json.Marshal(LegacyPollingConfig) error: %v", err)
	}

	var got LegacyPollingConfig
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("json.Unmarshal(LegacyPollingConfig) error: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("polling config round-trip mismatch:\n orig = %+v\n got  = %+v", orig, got)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("json.Unmarshal to map error: %v", err)
	}
	for _, key := range []string{
		"charge_state", "climate_state", "drive_state", "location_data",
		"vehicle_state", "vehicle_config", "on_demand_charge_state",
		"nearby_charging_sites", "wake_up", "commands",
		"telemetry_capture", "telemetry_capture_retention_days",
	} {
		if _, ok := raw[key]; !ok {
			t.Errorf("marshaled polling config missing expected snake_case key %q", key)
		}
	}
}

// TestLegacySettings_JSONRoundTrip guards the top-level settings DTO wire
// contract, including the embedded polling config and the SI-relevant unit and
// cost fields, and confirms it survives a lossless JSON round-trip.
func TestLegacySettings_JSONRoundTrip(t *testing.T) {
	orig := LegacySettings{
		ID:                7,
		UnitOfLength:      "km",
		UnitOfTemp:        "C",
		UnitOfPressure:    "bar",
		PreferredRange:    "rated",
		Language:          "en",
		BaseCostPerKWh:    0.14,
		APISuspended:      true,
		Theme:             "neon-cyan",
		Mode:              "dark",
		CustomPrimary:     "#00e0ff",
		CustomAccent:      "#ff0055",
		GasPricePerUnit:   3.79,
		GasUnit:           "gallon",
		GasEfficiencyMPG:  30,
		DecimalPrecision:  2,
		QuietHoursEnabled: true,
		QuietHoursStart:   "22:00",
		QuietHoursEnd:     "07:00",
		AlertDigestMode:   "hourly",
		PollingConfig:     DefaultPollingConfig(),
	}

	data, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("json.Marshal(LegacySettings) error: %v", err)
	}

	var got LegacySettings
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("json.Unmarshal(LegacySettings) error: %v", err)
	}
	if !reflect.DeepEqual(orig, got) {
		t.Errorf("settings round-trip mismatch:\n orig = %+v\n got  = %+v", orig, got)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("json.Unmarshal to map error: %v", err)
	}
	for _, key := range []string{
		"unit_of_length", "unit_of_temp", "unit_of_pressure", "preferred_range",
		"base_cost_per_kwh", "api_suspended", "gas_price_per_unit", "gas_unit",
		"gas_efficiency_mpg", "decimal_precision", "quiet_hours_enabled",
		"quiet_hours_start", "quiet_hours_end", "alert_digest_mode", "polling_config",
	} {
		if _, ok := raw[key]; !ok {
			t.Errorf("marshaled settings missing expected snake_case key %q", key)
		}
	}
}

// ptr returns the address of the supplied config. It exists so table rows can
// embed a fully-built LegacyPollingConfig value inline without a named local.
func ptr(pc LegacyPollingConfig) *LegacyPollingConfig {
	return &pc
}
