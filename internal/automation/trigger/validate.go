package trigger

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/robfig/cron/v3"
)

// ValidateTriggerConfig validates the trigger_config JSON for the given trigger type.
// It delegates to the existing per-type parsers and performs additional semantic checks.
// Returns nil if the config is valid.
func ValidateTriggerConfig(triggerType string, raw json.RawMessage) error {
	if len(raw) == 0 {
		return fmt.Errorf("trigger_config is required")
	}

	switch triggerType {
	case "cron":
		return validateCronTrigger(raw)
	case "vehicle_state":
		return validateVehicleStateTrigger(raw)
	case "geofence":
		return validateGeofenceTrigger(raw)
	case "battery":
		return validateBatteryTrigger(raw)
	case "sunrise_sunset":
		return validateSunriseSunsetTrigger(raw)
	case "energy":
		return validateEnergyTrigger(raw)
	case "mqtt":
		return validateMQTTTrigger(raw)
	case "webhook":
		return validateWebhookTrigger(raw)
	case "calendar":
		return validateCalendarTrigger(raw)
	default:
		return fmt.Errorf("unknown trigger_type %q", triggerType)
	}
}

// SupportedTriggerTypes returns the set of known trigger type names.
func SupportedTriggerTypes() []string {
	return []string{
		"cron", "vehicle_state", "geofence", "battery",
		"sunrise_sunset", "energy", "mqtt", "webhook", "calendar",
	}
}

// ComputeNextCronFireTime parses a cron expression with optional timezone and
// returns the next scheduled fire time. Returns nil if the expression is invalid.
func ComputeNextCronFireTime(cronExpr, timezone string) *time.Time {
	if cronExpr == "" {
		return nil
	}

	loc, err := loadTimezone(timezone)
	if err != nil {
		return nil
	}

	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
	schedule, err := parser.Parse(cronExpr)
	if err != nil {
		return nil
	}

	now := time.Now().In(loc)
	next := schedule.Next(now)
	next = next.UTC()
	return &next
}

// CronConfig represents the parsed trigger_config for cron automations.
// Moved here from cron.go after Phase 5b rewire — validate.go is the only caller.
type CronConfig struct {
	CronExpr    string `json:"cron_expr"`
	Timezone    string `json:"timezone"`
	OneTime     bool   `json:"one_time"`
	OneTimeDate string `json:"one_time_date"`
}

func parseCronConfig(raw json.RawMessage) (*CronConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg CronConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	return &cfg, nil
}

// GeofenceConfig represents the parsed trigger_config for geofence automations.
type GeofenceConfig struct {
	GeofenceID   int64  `json:"geofence_id"`
	Event        string `json:"event"`
	DwellMinutes int    `json:"dwell_minutes"`
}

func parseGeofenceConfig(raw json.RawMessage) (*GeofenceConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg GeofenceConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	if cfg.GeofenceID <= 0 {
		return nil, fmt.Errorf("geofence_id is required")
	}
	switch cfg.Event {
	case "enter", "leave", "both":
	case "":
		return nil, fmt.Errorf("event is required (enter, leave, or both)")
	default:
		return nil, fmt.Errorf("invalid geofence event %q: must be enter, leave, or both", cfg.Event)
	}
	if cfg.DwellMinutes < 0 {
		return nil, fmt.Errorf("dwell_minutes must be non-negative")
	}
	return &cfg, nil
}

// BatteryConfig represents the parsed trigger_config for battery automations.
type BatteryConfig struct {
	Operator  string   `json:"operator"`
	Threshold float64  `json:"threshold"`
	Delta     *float64 `json:"delta"`
	Direction string   `json:"direction"`
}

func parseBatteryConfig(raw json.RawMessage) (*BatteryConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg BatteryConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	switch cfg.Operator {
	case "above", "below", "reaches":
		if cfg.Threshold < 0 || cfg.Threshold > 100 {
			return nil, fmt.Errorf("threshold must be 0-100, got %.1f", cfg.Threshold)
		}
	case "changes_by":
		if cfg.Delta == nil {
			return nil, fmt.Errorf("delta is required for changes_by")
		}
		if *cfg.Delta < 0 || *cfg.Delta > 100 {
			return nil, fmt.Errorf("delta must be 0-100, got %.1f", *cfg.Delta)
		}
		if cfg.Direction == "" {
			cfg.Direction = "any"
		}
		switch cfg.Direction {
		case "any", "up", "down":
		default:
			return nil, fmt.Errorf("invalid changes_by direction %q", cfg.Direction)
		}
	case "":
		return nil, fmt.Errorf("operator is required for battery trigger")
	default:
		return nil, fmt.Errorf("invalid battery operator %q", cfg.Operator)
	}
	return &cfg, nil
}

// EnergyConfig represents the parsed trigger_config for energy automations.
type EnergyConfig struct {
	EnergySiteID int64   `json:"energy_site_id"`
	Event        string  `json:"event"`
	Threshold    float64 `json:"threshold"`
	Operator     string  `json:"operator"`
}

func parseEnergyConfig(raw json.RawMessage) (*EnergyConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg EnergyConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	if cfg.EnergySiteID <= 0 {
		return nil, fmt.Errorf("energy_site_id is required")
	}
	switch cfg.Event {
	case "solar_above", "solar_below":
		if cfg.Threshold < 0 {
			return nil, fmt.Errorf("solar threshold must be non-negative")
		}
	case "battery_above", "battery_below":
		if cfg.Threshold < 0 || cfg.Threshold > 100 {
			return nil, fmt.Errorf("battery threshold must be 0-100")
		}
	case "grid_outage", "grid_restored", "storm_mode_activated", "storm_mode_deactivated", "exporting_to_grid", "importing_from_grid":
	case "":
		return nil, fmt.Errorf("event is required for energy trigger")
	default:
		return nil, fmt.Errorf("invalid energy event %q", cfg.Event)
	}
	return &cfg, nil
}

func validateCronTrigger(raw json.RawMessage) error {
	cfg, err := parseCronConfig(raw)
	if err != nil {
		return err
	}
	if cfg.CronExpr == "" {
		return fmt.Errorf("cron_expr is required")
	}

	// Validate cron expression is parseable.
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
	if _, err := parser.Parse(cfg.CronExpr); err != nil {
		return fmt.Errorf("invalid cron_expr %q: %w", cfg.CronExpr, err)
	}

	// Validate timezone if provided.
	if cfg.Timezone != "" {
		if _, err := time.LoadLocation(cfg.Timezone); err != nil {
			return fmt.Errorf("invalid timezone %q: %w", cfg.Timezone, err)
		}
	}

	return nil
}

func validateVehicleStateTrigger(raw json.RawMessage) error {
	cfg, err := parseVehicleStateConfig(raw)
	if err != nil {
		return err
	}
	if cfg.Event == "" {
		return fmt.Errorf("event is required for vehicle_state trigger")
	}
	if _, ok := supportedEvents[cfg.Event]; !ok {
		return fmt.Errorf("unsupported vehicle_state event %q", cfg.Event)
	}
	return nil
}

func validateGeofenceTrigger(raw json.RawMessage) error {
	_, err := parseGeofenceConfig(raw)
	return err
}

func validateBatteryTrigger(raw json.RawMessage) error {
	_, err := parseBatteryConfig(raw)
	return err
}

func validateSunriseSunsetTrigger(raw json.RawMessage) error {
	cfg, err := parseSunriseSunsetConfig(raw)
	if err != nil {
		return err
	}
	switch cfg.Event {
	case "sunrise", "sunset":
		// valid
	case "":
		return fmt.Errorf("event is required (sunrise or sunset)")
	default:
		return fmt.Errorf("invalid sunrise_sunset event %q", cfg.Event)
	}
	if cfg.Timezone != "" {
		if _, err := time.LoadLocation(cfg.Timezone); err != nil {
			return fmt.Errorf("invalid timezone %q: %w", cfg.Timezone, err)
		}
	}
	return nil
}

func validateEnergyTrigger(raw json.RawMessage) error {
	_, err := parseEnergyConfig(raw)
	return err
}

func validateMQTTTrigger(raw json.RawMessage) error {
	cfg, err := parseMQTTConfig(raw)
	if err != nil {
		return err
	}
	if cfg.Topic == "" {
		return fmt.Errorf("topic is required for mqtt trigger")
	}
	if err := validateMQTTTopicFilter(cfg.Topic); err != nil {
		return fmt.Errorf("invalid mqtt topic: %w", err)
	}
	return nil
}

func validateWebhookTrigger(raw json.RawMessage) error {
	_, err := parseWebhookConfig(raw)
	return err
}

func validateCalendarTrigger(raw json.RawMessage) error {
	_, err := parseCalendarConfig(raw)
	return err
}
