package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Helpers ────────────────────────────────────────────

// energyConfigToTrigger maps the old EnergyConfig event vocabulary to
// the typed AutomationStepTriggerSignal fields used by shouldFireEnergy.
func energyConfigToTrigger(cfg *EnergyConfig) *models.AutomationStepTriggerSignal {
	t := &models.AutomationStepTriggerSignal{}
	threshold := cfg.Threshold
	switch cfg.Event {
	case "solar_above":
		t.Signal, t.Op, t.ValueNum = "solar_power", "crossed_above", &threshold
	case "solar_below":
		t.Signal, t.Op, t.ValueNum = "solar_power", "crossed_below", &threshold
	case "battery_above":
		t.Signal, t.Op, t.ValueNum = "battery_level", "crossed_above", &threshold
	case "battery_below":
		t.Signal, t.Op, t.ValueNum = "battery_level", "crossed_below", &threshold
	case "grid_outage":
		t.Signal, t.Op = "grid_status", "="
		v := "Islanded"
		t.ValueText = &v
	case "grid_restored":
		t.Signal, t.Op = "grid_status", "="
		v := "Active"
		t.ValueText = &v
	case "storm_mode_activated":
		t.Signal, t.Op = "storm_mode_active", "="
		v := true
		t.ValueBool = &v
	case "storm_mode_deactivated":
		t.Signal, t.Op = "storm_mode_active", "="
		v := false
		t.ValueBool = &v
	case "exporting_to_grid":
		zero := float64(0)
		t.Signal, t.Op, t.ValueNum = "grid_power", "crossed_below", &zero
	default:
		t.Signal, t.Op = cfg.Event, "="
	}
	return t
}

func makeEnergyAutomation(id int64, name string, cfg EnergyConfig) EnergyAutomation {
	trig := energyConfigToTrigger(&cfg)
	return EnergyAutomation{
		Automation:   models.Automation{ID: id, Name: name, Enabled: true},
		Trigger:      *trig,
		EnergySiteID: cfg.EnergySiteID,
	}
}

func liveStatus(solar, battLevel, gridPower float64, gridStatus string, stormMode bool) *models.TeslaEnergyLiveStatus {
	return &models.TeslaEnergyLiveStatus{
		SolarPower:        &solar,
		PercentageCharged: &battLevel,
		GridPower:         &gridPower,
		GridStatus:        &gridStatus,
		StormModeActive:   &stormMode,
	}
}

// ─── shouldFireEnergy Pure Logic Tests ──────────────────

func TestShouldFireEnergy_SolarAbove_CrossingUp(t *testing.T) {
	prev := energyState{SolarPower: 4800}
	curr := energyState{SolarPower: 5200}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 5000}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: solar crossing 4800→5200 with threshold 5000")
	}
}

func TestShouldFireEnergy_SolarAbove_AlreadyAbove(t *testing.T) {
	prev := energyState{SolarPower: 5100}
	curr := energyState{SolarPower: 5500}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 5000}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already above threshold (5100→5500)")
	}
}

func TestShouldFireEnergy_SolarAbove_ExactThreshold(t *testing.T) {
	prev := energyState{SolarPower: 5000}
	curr := energyState{SolarPower: 5001}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 5000}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: crossing from exact threshold (5000→5001)")
	}
}

func TestShouldFireEnergy_SolarAbove_AtThreshold_NoFire(t *testing.T) {
	prev := energyState{SolarPower: 4999}
	curr := energyState{SolarPower: 5000}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 5000}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: reached threshold but not above (4999→5000)")
	}
}

func TestShouldFireEnergy_SolarAbove_Dropping(t *testing.T) {
	prev := energyState{SolarPower: 5200}
	curr := energyState{SolarPower: 4800}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 5000}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: dropping below threshold (5200→4800)")
	}
}

func TestShouldFireEnergy_SolarBelow_CrossingDown(t *testing.T) {
	prev := energyState{SolarPower: 5200}
	curr := energyState{SolarPower: 4800}
	cfg := &EnergyConfig{Event: "solar_below", Threshold: 5000}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: solar crossing 5200→4800 with threshold 5000")
	}
}

func TestShouldFireEnergy_SolarBelow_AlreadyBelow(t *testing.T) {
	prev := energyState{SolarPower: 4500}
	curr := energyState{SolarPower: 4200}
	cfg := &EnergyConfig{Event: "solar_below", Threshold: 5000}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already below threshold (4500→4200)")
	}
}

func TestShouldFireEnergy_SolarBelow_ExactThreshold(t *testing.T) {
	prev := energyState{SolarPower: 5000}
	curr := energyState{SolarPower: 4999}
	cfg := &EnergyConfig{Event: "solar_below", Threshold: 5000}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: crossing from exact threshold (5000→4999)")
	}
}

func TestShouldFireEnergy_SolarBelow_AtThreshold_NoFire(t *testing.T) {
	prev := energyState{SolarPower: 5001}
	curr := energyState{SolarPower: 5000}
	cfg := &EnergyConfig{Event: "solar_below", Threshold: 5000}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: reached threshold but not below (5001→5000)")
	}
}

func TestShouldFireEnergy_BatteryAbove_CrossingUp(t *testing.T) {
	prev := energyState{BatteryLevel: 79}
	curr := energyState{BatteryLevel: 81}
	cfg := &EnergyConfig{Event: "battery_above", Threshold: 80}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: battery crossing 79→81 with threshold 80")
	}
}

func TestShouldFireEnergy_BatteryAbove_AlreadyAbove(t *testing.T) {
	prev := energyState{BatteryLevel: 85}
	curr := energyState{BatteryLevel: 90}
	cfg := &EnergyConfig{Event: "battery_above", Threshold: 80}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already above threshold (85→90)")
	}
}

func TestShouldFireEnergy_BatteryBelow_CrossingDown(t *testing.T) {
	prev := energyState{BatteryLevel: 21}
	curr := energyState{BatteryLevel: 19}
	cfg := &EnergyConfig{Event: "battery_below", Threshold: 20}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: battery crossing 21→19 with threshold 20")
	}
}

func TestShouldFireEnergy_BatteryBelow_AlreadyBelow(t *testing.T) {
	prev := energyState{BatteryLevel: 18}
	curr := energyState{BatteryLevel: 15}
	cfg := &EnergyConfig{Event: "battery_below", Threshold: 20}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already below threshold (18→15)")
	}
}

func TestShouldFireEnergy_GridOutage(t *testing.T) {
	prev := energyState{GridStatus: "Active"}
	curr := energyState{GridStatus: "Islanded"}
	cfg := &EnergyConfig{Event: "grid_outage"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: grid status Active→Islanded")
	}
}

func TestShouldFireEnergy_GridOutage_AlreadyIslanded(t *testing.T) {
	prev := energyState{GridStatus: "Islanded"}
	curr := energyState{GridStatus: "Islanded"}
	cfg := &EnergyConfig{Event: "grid_outage"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already Islanded")
	}
}

func TestShouldFireEnergy_GridRestored(t *testing.T) {
	prev := energyState{GridStatus: "Islanded"}
	curr := energyState{GridStatus: "Active"}
	cfg := &EnergyConfig{Event: "grid_restored"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: grid status Islanded→Active")
	}
}

func TestShouldFireEnergy_GridRestored_AlreadyActive(t *testing.T) {
	prev := energyState{GridStatus: "Active"}
	curr := energyState{GridStatus: "Active"}
	cfg := &EnergyConfig{Event: "grid_restored"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already Active")
	}
}

func TestShouldFireEnergy_StormModeActivated(t *testing.T) {
	prev := energyState{StormModeActive: false}
	curr := energyState{StormModeActive: true}
	cfg := &EnergyConfig{Event: "storm_mode_activated"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: storm mode false→true")
	}
}

func TestShouldFireEnergy_StormModeActivated_AlreadyActive(t *testing.T) {
	prev := energyState{StormModeActive: true}
	curr := energyState{StormModeActive: true}
	cfg := &EnergyConfig{Event: "storm_mode_activated"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: storm mode already active")
	}
}

func TestShouldFireEnergy_StormModeDeactivated(t *testing.T) {
	prev := energyState{StormModeActive: true}
	curr := energyState{StormModeActive: false}
	cfg := &EnergyConfig{Event: "storm_mode_deactivated"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: storm mode true→false")
	}
}

func TestShouldFireEnergy_StormModeDeactivated_AlreadyInactive(t *testing.T) {
	prev := energyState{StormModeActive: false}
	curr := energyState{StormModeActive: false}
	cfg := &EnergyConfig{Event: "storm_mode_deactivated"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: storm mode already inactive")
	}
}

func TestShouldFireEnergy_ExportingToGrid(t *testing.T) {
	prev := energyState{GridPower: 500}
	curr := energyState{GridPower: -200}
	cfg := &EnergyConfig{Event: "exporting_to_grid"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: grid power 500→-200 (now exporting)")
	}
}

func TestShouldFireEnergy_ExportingToGrid_AlreadyExporting(t *testing.T) {
	prev := energyState{GridPower: -100}
	curr := energyState{GridPower: -300}
	cfg := &EnergyConfig{Event: "exporting_to_grid"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: already exporting (-100→-300)")
	}
}

func TestShouldFireEnergy_ExportingToGrid_FromZero(t *testing.T) {
	prev := energyState{GridPower: 0}
	curr := energyState{GridPower: -100}
	cfg := &EnergyConfig{Event: "exporting_to_grid"}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: grid power 0→-100 (now exporting)")
	}
}

func TestShouldFireEnergy_ExportingToGrid_StoppedExporting(t *testing.T) {
	prev := energyState{GridPower: -200}
	curr := energyState{GridPower: 100}
	cfg := &EnergyConfig{Event: "exporting_to_grid"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: stopped exporting (-200→100)")
	}
}

func TestShouldFireEnergy_UnknownEvent(t *testing.T) {
	prev := energyState{}
	curr := energyState{}
	cfg := &EnergyConfig{Event: "unknown_event"}
	if shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("should not fire: unknown event")
	}
}

func TestShouldFireEnergy_SolarAbove_ZeroThreshold(t *testing.T) {
	prev := energyState{SolarPower: 0}
	curr := energyState{SolarPower: 100}
	cfg := &EnergyConfig{Event: "solar_above", Threshold: 0}
	if !shouldFireEnergy(prev, curr, energyConfigToTrigger(cfg)) {
		t.Fatal("expected fire: solar crossing 0→100 with threshold 0")
	}
}

// ─── parseEnergyConfig Tests ────────────────────────────

func TestParseEnergyConfig_ValidSolarAbove(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":12345,"event":"solar_above","threshold":5000}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.EnergySiteID != 12345 || cfg.Event != "solar_above" || cfg.Threshold != 5000 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseEnergyConfig_ValidBatteryBelow(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"battery_below","threshold":20}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "battery_below" || cfg.Threshold != 20 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseEnergyConfig_ValidGridOutage(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"grid_outage"}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "grid_outage" {
		t.Fatalf("unexpected event: %q", cfg.Event)
	}
}

func TestParseEnergyConfig_ValidStormMode(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"storm_mode_activated"}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "storm_mode_activated" {
		t.Fatalf("unexpected event: %q", cfg.Event)
	}
}

func TestParseEnergyConfig_ValidExportingToGrid(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"exporting_to_grid"}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Event != "exporting_to_grid" {
		t.Fatalf("unexpected event: %q", cfg.Event)
	}
}

func TestParseEnergyConfig_Empty(t *testing.T) {
	_, err := parseEnergyConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseEnergyConfig_InvalidJSON(t *testing.T) {
	_, err := parseEnergyConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseEnergyConfig_MissingSiteID(t *testing.T) {
	raw := json.RawMessage(`{"event":"solar_above","threshold":5000}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing energy_site_id")
	}
}

func TestParseEnergyConfig_ZeroSiteID(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":0,"event":"solar_above","threshold":5000}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for zero energy_site_id")
	}
}

func TestParseEnergyConfig_NegativeSiteID(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":-1,"event":"solar_above","threshold":5000}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative energy_site_id")
	}
}

func TestParseEnergyConfig_UnknownEvent(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"wind_speed"}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for unknown event")
	}
}

func TestParseEnergyConfig_NegativeSolarThreshold(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"solar_above","threshold":-100}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative solar threshold")
	}
}

func TestParseEnergyConfig_BatteryThresholdOutOfRange(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"battery_above","threshold":150}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for battery threshold > 100")
	}
}

func TestParseEnergyConfig_NegativeBatteryThreshold(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"battery_below","threshold":-5}`)
	_, err := parseEnergyConfig(raw)
	if err == nil {
		t.Fatal("expected error for negative battery threshold")
	}
}

func TestParseEnergyConfig_WithOperator(t *testing.T) {
	raw := json.RawMessage(`{"energy_site_id":1,"event":"solar_above","threshold":5000,"operator":"above"}`)
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Operator != "above" {
		t.Fatalf("expected operator 'above', got %q", cfg.Operator)
	}
}

// ─── EnergyTrigger.OnEnergyUpdate Integration Tests ─────

func TestEnergyTrigger_FirstObservation_NoFire(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}

	status := liveStatus(6000, 50, 0, "Active", false)
	if err := et.OnEnergyUpdate(context.Background(), 100, status); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire on first observation")
	}
}

func TestEnergyTrigger_SolarCrossingUp_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot content.
	call := engine.lastCall()
	var snap energySnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.EnergySiteID != 100 {
		t.Fatalf("expected energy_site_id 100, got %d", snap.EnergySiteID)
	}
	if snap.Signal != "solar_power" {
		t.Fatalf("expected signal 'solar_power', got %q", snap.Signal)
	}
	if snap.SolarPower != 5200 {
		t.Fatalf("expected solar_power 5200, got %v", snap.SolarPower)
	}
	if snap.PreviousSolarPower != 4800 {
		t.Fatalf("expected previous_solar_power 4800, got %v", snap.PreviousSolarPower)
	}
	if snap.Threshold != 5000 {
		t.Fatalf("expected threshold 5000, got %v", snap.Threshold)
	}
}

func TestEnergyTrigger_SolarAlreadyAbove_NoFire(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}

	et.Seed(100, liveStatus(5100, 50, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5500, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: already above threshold")
	}
}

func TestEnergyTrigger_GridOutage_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "outage-alert", EnergyConfig{
			EnergySiteID: 100, Event: "grid_outage",
		}),
	}

	et.Seed(100, liveStatus(3000, 80, 500, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(3000, 80, 0, "Islanded", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot includes grid transition.
	var snap energySnapshot
	if err := json.Unmarshal(engine.lastCall().Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.GridStatus != "Islanded" {
		t.Fatalf("expected grid_status 'Islanded', got %q", snap.GridStatus)
	}
	if snap.PreviousGridStatus != "Active" {
		t.Fatalf("expected previous_grid_status 'Active', got %q", snap.PreviousGridStatus)
	}
}

func TestEnergyTrigger_GridRestored_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "grid-back", EnergyConfig{
			EnergySiteID: 100, Event: "grid_restored",
		}),
	}

	et.Seed(100, liveStatus(0, 60, 0, "Islanded", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(0, 60, 500, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_StormModeActivated_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "storm-alert", EnergyConfig{
			EnergySiteID: 100, Event: "storm_mode_activated",
		}),
	}

	et.Seed(100, liveStatus(2000, 90, 100, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(2000, 90, 100, "Active", true)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	var snap energySnapshot
	if err := json.Unmarshal(engine.lastCall().Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if !snap.StormModeActive {
		t.Fatal("expected storm_mode_active true in snapshot")
	}
	if snap.PreviousStormMode {
		t.Fatal("expected previous_storm_mode false in snapshot")
	}
}

func TestEnergyTrigger_StormModeDeactivated_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "storm-clear", EnergyConfig{
			EnergySiteID: 100, Event: "storm_mode_deactivated",
		}),
	}

	et.Seed(100, liveStatus(2000, 90, 100, "Active", true))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(2000, 90, 100, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_ExportingToGrid_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "grid-export", EnergyConfig{
			EnergySiteID: 100, Event: "exporting_to_grid",
		}),
	}

	et.Seed(100, liveStatus(5000, 80, 500, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(6000, 80, -200, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_BatteryCrossingDown_Fires(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "low-powerwall", EnergyConfig{
			EnergySiteID: 100, Event: "battery_below", Threshold: 20,
		}),
	}

	et.Seed(100, liveStatus(0, 21, 500, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(0, 19, 500, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_DifferentSite_NoFire(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[999] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 999, Event: "solar_above", Threshold: 5000,
		}),
	}

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	// Update site 100, but automation targets site 999.
	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: automation targets different site")
	}
}

func TestEnergyTrigger_MultipleSites_Independent(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "site1-solar", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}
	repo.energyAutos[200] = []EnergyAutomation{
		makeEnergyAutomation(2, "site2-solar", EnergyConfig{
			EnergySiteID: 200, Event: "solar_above", Threshold: 3000,
		}),
	}

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))
	et.Seed(200, liveStatus(2800, 50, 0, "Active", false))

	// Site 100 crosses threshold.
	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (site 100 only), got %d", engine.callCount())
	}

	// Site 200 crosses threshold.
	if err := et.OnEnergyUpdate(context.Background(), 200, liveStatus(3200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 total fires, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_MultipleAutomations_SameSite(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
		makeEnergyAutomation(2, "solar-very-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 4000,
		}),
	}

	et.Seed(100, liveStatus(3000, 50, 0, "Active", false))

	// 3000→5200: crosses both 4000 and 5000.
	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_InvalidConfig_Skipped(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	// In the typed model, an unknown signal is silently skipped (not auto-disabled).
	bad := EnergyAutomation{
		Automation:   models.Automation{ID: 99, Name: "broken", Enabled: true},
		Trigger:      models.AutomationStepTriggerSignal{Signal: "invalid_signal", Op: "="},
		EnergySiteID: 100,
	}
	good := makeEnergyAutomation(1, "solar-high", EnergyConfig{
		EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
	})
	repo.energyAutos[100] = []EnergyAutomation{bad, good}

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Good automation should still fire.
	// Good automation should still fire.
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire (good automation), got %d", engine.callCount())
	}
}

func TestEnergyTrigger_RepoError(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.returnErr = fmt.Errorf("db connection lost")

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false))
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestEnergyTrigger_EngineError_ReturnsFirstError(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false))
	if err == nil {
		t.Fatal("expected error from engine failure")
	}
}

func TestEnergyTrigger_NoAutomations_NoError(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	et.Seed(100, liveStatus(4800, 50, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(5200, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 0 {
		t.Fatal("should not fire: no automations configured")
	}
}

func TestEnergyTrigger_Seed_PreventsFirstObservationSkip(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "solar-high", EnergyConfig{
			EnergySiteID: 100, Event: "solar_above", Threshold: 5000,
		}),
	}

	// Seed with solar below threshold, then update above — should fire.
	et.Seed(100, liveStatus(4000, 50, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(6000, 50, 0, "Active", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire after seed, got %d", engine.callCount())
	}
}

func TestEnergyTrigger_SnapshotIncludesZeroValues(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	et := NewEnergyTrigger(repo, engine)

	repo.energyAutos[100] = []EnergyAutomation{
		makeEnergyAutomation(1, "outage-alert", EnergyConfig{
			EnergySiteID: 100, Event: "grid_outage",
		}),
	}

	et.Seed(100, liveStatus(0, 0, 0, "Active", false))

	if err := et.OnEnergyUpdate(context.Background(), 100, liveStatus(0, 0, 0, "Islanded", false)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify zero values are present (not dropped by omitempty).
	raw := engine.lastCall().Snapshot
	var snap map[string]interface{}
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if _, ok := snap["solar_power"]; !ok {
		t.Fatal("solar_power missing from snapshot (zero value dropped)")
	}
	if _, ok := snap["battery_level"]; !ok {
		t.Fatal("battery_level missing from snapshot (zero value dropped)")
	}
	if _, ok := snap["grid_power"]; !ok {
		t.Fatal("grid_power missing from snapshot (zero value dropped)")
	}
	if _, ok := snap["threshold"]; !ok {
		t.Fatal("threshold missing from snapshot (zero value dropped)")
	}
}
