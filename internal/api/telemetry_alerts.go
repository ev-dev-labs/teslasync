package api

import (
	"context"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// TelemetryAlertEvaluator runs alert rules against incoming streaming signals.
// Supports both legacy simple rules (Type+Threshold) and CEP rules (JSONB conditions).
type TelemetryAlertEvaluator struct {
	alertRuleRepo *database.AlertRuleRepo
	alertRepo     *database.AlertRepo
	notifRepo     *database.NotificationRepo
	eventBus      *events.Bus
	eventHub      *EventHub
	ruleEngine    *RuleEngine
	mqttClient    pahomqtt.Client
}

// NewTelemetryAlertEvaluator creates an alert evaluator for streaming data.
func NewTelemetryAlertEvaluator(db *database.DB, eventBus *events.Bus, hub *EventHub, mqttClient pahomqtt.Client) *TelemetryAlertEvaluator {
	return &TelemetryAlertEvaluator{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		alertRepo:     database.NewAlertRepo(db),
		notifRepo:     database.NewNotificationRepo(db),
		eventBus:      eventBus,
		eventHub:      hub,
		ruleEngine:    NewRuleEngine(),
		mqttClient:    mqttClient,
	}
}

// LoadState loads cooldown state from DB (called on startup for pod restart recovery).
func (e *TelemetryAlertEvaluator) LoadState(ctx context.Context) {
	rules, err := e.alertRuleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("cep: failed to load rules for state recovery")
		return
	}
	e.ruleEngine.LoadCooldownFromDB(ctx, rules)
	log.Info().Int("rules", len(rules)).Msg("cep: loaded rule cooldown state from DB")
}

// Evaluate checks all alert rules against the given signals for a vehicle.
func (e *TelemetryAlertEvaluator) Evaluate(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	evalStart := time.Now()
	rules, err := e.alertRuleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("cep: failed to load alert rules, skipping evaluation")
		return
	}

	enabledCount := 0
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if rule.VehicleID != nil && *rule.VehicleID != vehicleID {
			continue
		}
		enabledCount++

		var triggered bool
		var message string

		if rule.IsCEPRule() {
			metrics.CEPRulesEvaluated.Inc()
			result := e.ruleEngine.Evaluate(rule, vehicleID, signals)
			triggered = result.Triggered
			message = result.Message
		} else {
			metrics.AlertsEvaluated.Inc()
			triggered, message = e.evaluateLegacy(rule, signals)
		}

		if triggered {
			e.fireAlert(ctx, rule, vehicleID, vin, message)
		}
	}
	metrics.CEPActiveRules.Set(float64(enabledCount))
	metrics.CEPEvalDuration.Observe(time.Since(evalStart).Seconds())
}

// evaluateLegacy handles the old Type+Threshold rules.
func (e *TelemetryAlertEvaluator) evaluateLegacy(rule *models.AlertRule, signals map[string]interface{}) (bool, string) {
	switch rule.Type {
	case "battery_low":
		bl, ok := toFloatOk(signals["BatteryLevel"])
		if !ok {
			bl, ok = toFloatOk(signals["Soc"])
		}
		if ok && bl <= rule.Threshold {
			return true, fmt.Sprintf("Battery at %.0f%% (threshold: %.0f%%)", bl, rule.Threshold)
		}
	case "battery_high":
		bl, ok := toFloatOk(signals["BatteryLevel"])
		if !ok {
			bl, ok = toFloatOk(signals["Soc"])
		}
		if ok && bl >= rule.Threshold {
			return true, fmt.Sprintf("Battery at %.0f%% (threshold: %.0f%%)", bl, rule.Threshold)
		}
	case "speed_limit":
		speed := toFloat(signals["VehicleSpeed"])
		if speed > rule.Threshold {
			return true, fmt.Sprintf("Speed %.0f km/h exceeds limit of %.0f km/h", speed, rule.Threshold)
		}
	case "charge_complete":
		if cs, ok := signals["DetailedChargeState"].(string); ok && cs == "Complete" {
			bl := toFloat(signals["BatteryLevel"])
			return true, fmt.Sprintf("Charging complete at %.0f%%", bl)
		}
	case "sentry_on":
		if locked, ok := signals["SentryMode"].(bool); ok && locked {
			return true, "Sentry mode activated"
		}
	}
	return false, ""
}

// fireAlert creates the alert, broadcasts via SSE, and dispatches to notification channels.
func (e *TelemetryAlertEvaluator) fireAlert(ctx context.Context, rule *models.AlertRule, vehicleID int64, vin, message string) {
	severity := rule.Severity
	if severity == "" {
		severity = "warning"
	}

	// 1. Create alert in DB
	vid := vehicleID
	alert := &models.Alert{
		VehicleID: &vid,
		Type:      rule.Type,
		Severity:  severity,
		Title:     rule.Name,
		Message:   message,
	}
	if err := e.alertRepo.Create(ctx, alert); err != nil {
		log.Warn().Err(err).Str("type", rule.Type).Msg("cep: failed to create alert")
		return
	}

	// Update rule fire count and last_fired_at
	now := time.Now().UTC()
	rule.LastFiredAt = &now
	rule.FireCount++
	_ = e.alertRuleRepo.UpdateFireState(ctx, rule.ID, now, rule.FireCount)

	log.Info().Int64("rule_id", rule.ID).Str("name", rule.Name).Str("severity", severity).
		Int64("vehicle_id", vehicleID).Str("message", message).Msg("cep: alert fired")

	// Prometheus metrics
	metrics.AlertsFired.WithLabelValues(severity).Inc()
	if rule.IsCEPRule() {
		metrics.CEPRulesFired.WithLabelValues(rule.Name, severity).Inc()
	}

	// 2. Broadcast via SSE (instant browser notification)
	if e.eventHub != nil {
		e.eventHub.Broadcast("alert", map[string]interface{}{
			"id":         alert.ID,
			"vehicle_id": vehicleID,
			"vin":        vin,
			"type":       rule.Type,
			"severity":   severity,
			"title":      rule.Name,
			"message":    message,
			"rule_id":    rule.ID,
			"timestamp":  now,
		})
	}

	// 3. Publish to internal event bus
	if e.eventBus != nil {
		e.eventBus.Publish(events.Event{
			Type:      events.AlertTriggered,
			VehicleID: vehicleID,
			VIN:       vin,
			Data: map[string]interface{}{
				"rule_id":   rule.ID,
				"rule_type": rule.Type,
				"message":   message,
				"severity":  severity,
				"source":    "cep_engine",
			},
		})
	}

	// 4. Dispatch to notification channels (async)
	if len(rule.NotifyChannels) > 0 {
		go e.dispatchNotifications(rule, message)
	}

	// 5. Prometheus metric
	metrics.TelemetryMessagesReceived.Inc() // reuse counter for now
}

// dispatchNotifications publishes alert to the notification worker via MQTT.
// The worker handles delivery, retry, rate limiting, and metrics — fully decoupled.
// Falls back to direct send if MQTT is unavailable.
func (e *TelemetryAlertEvaluator) dispatchNotifications(rule *models.AlertRule, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, chID := range rule.NotifyChannels {
		ch, err := e.notifRepo.GetChannel(ctx, chID)
		if err != nil || ch == nil {
			log.Warn().Int64("channel_id", chID).Err(err).Msg("cep: notification channel not found")
			continue
		}
		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       rule.Name,
			Message:     message,
			ChannelID:   ch.ID,
		}
		if err := notification.Publish(e.mqttClient, req); err != nil {
			log.Warn().Int64("channel_id", chID).Str("type", ch.Type).Err(err).Msg("cep: notification dispatch failed")
		} else {
			metrics.NotificationsDispatched.WithLabelValues(ch.Type).Inc()
			log.Info().Int64("channel_id", chID).Str("type", ch.Type).Msg("cep: notification dispatched to worker")
		}
	}
}
