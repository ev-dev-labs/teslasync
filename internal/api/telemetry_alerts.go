package api

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TelemetryAlertEvaluator runs alert rules against incoming streaming signals.
type TelemetryAlertEvaluator struct {
	alertRuleRepo *database.AlertRuleRepo
	alertRepo     *database.AlertRepo
	eventBus      *events.Bus
}

// NewTelemetryAlertEvaluator creates an alert evaluator for streaming data.
func NewTelemetryAlertEvaluator(db *database.DB, eventBus *events.Bus) *TelemetryAlertEvaluator {
	return &TelemetryAlertEvaluator{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		alertRepo:     database.NewAlertRepo(db),
		eventBus:      eventBus,
	}
}

// Evaluate checks all alert rules against the given signals for a vehicle.
func (e *TelemetryAlertEvaluator) Evaluate(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	rules, err := e.alertRuleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("telemetry: failed to load alert rules, skipping evaluation")
		return
	}

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if rule.VehicleID != nil && *rule.VehicleID != vehicleID {
			continue
		}

		var triggered bool
		var message string

		switch rule.Type {
		case "battery_low":
			bl := toFloat(signals["BatteryLevel"])
			if bl == 0 {
				bl = toFloat(signals["Soc"])
			}
			if bl > 0 && bl <= rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Battery at %.0f%% (threshold: %.0f%%)", bl, rule.Threshold)
			}

		case "battery_high":
			bl := toFloat(signals["BatteryLevel"])
			if bl == 0 {
				bl = toFloat(signals["Soc"])
			}
			if bl > 0 && bl >= rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Battery at %.0f%% (threshold: %.0f%%)", bl, rule.Threshold)
			}

		case "speed_limit":
			speed := toFloat(signals["VehicleSpeed"])
			if speed > rule.Threshold {
				triggered = true
				message = fmt.Sprintf("Speed %.0f km/h exceeds limit of %.0f km/h", speed, rule.Threshold)
			}

		case "charge_complete":
			if cs, ok := signals["DetailedChargeState"].(string); ok && cs == "Complete" {
				triggered = true
				bl := toFloat(signals["BatteryLevel"])
				message = fmt.Sprintf("Charging complete at %.0f%%", bl)
			} else if cs, ok := signals["ChargeState"].(string); ok && cs == "Complete" {
				triggered = true
				bl := toFloat(signals["BatteryLevel"])
				message = fmt.Sprintf("Charging complete at %.0f%%", bl)
			}

		case "sentry_on":
			if locked, ok := signals["SentryMode"].(bool); ok && locked {
				triggered = true
				message = "Sentry mode activated"
			}
		}

		if triggered {
			vid := vehicleID
			alert := &models.Alert{
				VehicleID: &vid,
				Type:      rule.Type,
				Title:     rule.Name,
				Message:   message,
			}
			if err := e.alertRepo.Create(ctx, alert); err != nil {
				log.Warn().Err(err).Str("type", rule.Type).Msg("telemetry alert: failed to create")
				continue
			}

			if e.eventBus != nil {
				e.eventBus.Publish(events.Event{
					Type:      events.AlertTriggered,
					VehicleID: vehicleID,
					VIN:       vin,
					Data: map[string]interface{}{
						"rule_type": rule.Type,
						"message":   message,
						"threshold": rule.Threshold,
						"source":    "fleet_telemetry",
					},
				})
			}
		}
	}
}
