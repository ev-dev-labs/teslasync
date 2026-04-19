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
	cfg, err := parseGeofenceConfig(raw)
	if err != nil {
		return err
	}
	if cfg.GeofenceID == 0 {
		return fmt.Errorf("geofence_id is required")
	}
	switch cfg.Event {
	case "enter", "leave", "both":
		// valid
	case "":
		return fmt.Errorf("event is required (enter, leave, or both)")
	default:
		return fmt.Errorf("invalid geofence event %q: must be enter, leave, or both", cfg.Event)
	}
	return nil
}

func validateBatteryTrigger(raw json.RawMessage) error {
	cfg, err := parseBatteryConfig(raw)
	if err != nil {
		return err
	}
	switch cfg.Operator {
	case "above", "below", "reaches", "changes_by":
		// valid
	case "":
		return fmt.Errorf("operator is required for battery trigger")
	default:
		return fmt.Errorf("invalid battery operator %q", cfg.Operator)
	}
	if cfg.Threshold < 0 || cfg.Threshold > 100 {
		return fmt.Errorf("threshold must be 0-100, got %.1f", cfg.Threshold)
	}
	return nil
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
	cfg, err := parseEnergyConfig(raw)
	if err != nil {
		return err
	}
	if cfg.Event == "" {
		return fmt.Errorf("event is required for energy trigger")
	}
	return nil
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
