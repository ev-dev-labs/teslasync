package api

import (
	"context"
	"fmt"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/rs/zerolog/log"
)

// TelemetryAlertEvaluator runs alert rules against incoming streaming signals.
type TelemetryAlertEvaluator struct {
	alertRuleRepo *database.AlertRuleRepo
	notifRepo     *database.NotificationRepo
	settingsRepo  *database.SettingsRepo
	vehicleRepo   *database.VehicleRepo
	eventBus      *events.Bus
	eventHub      *EventHub
	ruleEngine    *RuleEngine
	mqttClient    pahomqtt.Client
}

// NewTelemetryAlertEvaluator creates an alert evaluator for streaming data.
func NewTelemetryAlertEvaluator(db *database.DB, eventBus *events.Bus, hub *EventHub, mqttClient pahomqtt.Client) *TelemetryAlertEvaluator {
	engine := NewRuleEngine()
	// Wire the persistent latch/fire-state repo so once-mode latches
	// survive pod restarts. Phase-49 / Slice 0002. The hydration call
	// itself is invoked from internal/app/new.go after the evaluator is
	// constructed, before MQTT subscribers start dispatching telemetry.
	engine.SetStateRepo(database.NewAlertRuleStateRepo(db))
	return &TelemetryAlertEvaluator{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		notifRepo:     database.NewNotificationRepo(db),
		settingsRepo:  database.NewSettingsRepo(db),
		vehicleRepo:   database.NewVehicleRepo(db),
		eventBus:      eventBus,
		eventHub:      hub,
		ruleEngine:    engine,
		mqttClient:    mqttClient,
	}
}

// LoadState seeds in-memory rule state from the DB so cooldown tracking
// begins immediately on startup. Pod-restart-safe latch hydration is
// performed separately via RuleEngine.HydrateFromDB (called from
// internal/app/new.go before subscribers attach).
func (e *TelemetryAlertEvaluator) LoadState(ctx context.Context) {
	rules, err := e.alertRuleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("alert_rules: failed to load rules for state recovery")
		return
	}
	e.ruleEngine.LoadCooldownFromDB(ctx, rules)
	log.Info().Int("rules", len(rules)).Msg("alert_rules: loaded rule cooldown state from DB")
}

// RuleEngine returns the underlying rule engine for state recovery.
func (e *TelemetryAlertEvaluator) RuleEngine() *RuleEngine {
	return e.ruleEngine
}

// Evaluate checks all alert rules against the given signals for a vehicle.
// accumulatedSignals is supplied by the telemetry path for callers that need
// last-known context; the typed rule engine keeps its own transition baseline.
//
// Phase-49 / Slice 0004: the second-stage CooldownFSM gate that previously
// stacked on top of the rule-engine result has been removed. The rule
// engine is now the SINGLE place that decides whether a matched rule
// should fire — it owns cooldown, once-mode latch, max-fires-per-resolution,
// and the engine-level hourly safety cap (formerly CooldownFSM.MaxFiresPerHour).
func (e *TelemetryAlertEvaluator) Evaluate(ctx context.Context, vehicleID int64, vin string, signals, accumulatedSignals map[string]interface{}) {
	evalStart := time.Now()
	rules, err := e.alertRuleRepo.GetAll(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("alert_rules: failed to load alert rules, skipping evaluation")
		return
	}

	enabledCount := 0
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if !rule.AppliesTo(vehicleID) {
			continue
		}
		enabledCount++

		metrics.AlertRulesEvaluated.Inc()
		result := e.ruleEngine.Evaluate(rule, vehicleID, signals)
		if result.Triggered {
			e.fireAlert(ctx, rule, vehicleID, vin, result.Message)
		}
	}
	metrics.ActiveAlertRules.Set(float64(enabledCount))
	metrics.AlertRuleEvalDuration.Observe(time.Since(evalStart).Seconds())
}

// fireAlert broadcasts via SSE and dispatches to notification channels.
func (e *TelemetryAlertEvaluator) fireAlert(ctx context.Context, rule *models.AlertRule, vehicleID int64, vin, message string) {
	severity := rule.Severity
	if severity == "" {
		severity = "warning"
	}

	// Resolve vehicle display name for context
	vehicleName := ""
	if v, err := e.vehicleRepo.GetByID(ctx, vehicleID); err == nil && v != nil && v.DisplayName != "" {
		vehicleName = v.DisplayName
	} else if vin != "" {
		vehicleName = vin
	}

	// Prefix message with vehicle name so users know which vehicle triggered it
	title := rule.Name
	if vehicleName != "" {
		title = fmt.Sprintf("[%s] %s", vehicleName, rule.Name)
		message = fmt.Sprintf("%s — %s", vehicleName, message)
	}

	// 1. Record the alert firing timestamp
	now := time.Now().UTC()

	log.Info().Int64("rule_id", rule.ID).Str("name", rule.Name).Str("severity", severity).
		Int64("vehicle_id", vehicleID).Str("message", message).Msg("alert_rules: alert fired")

	// Prometheus metrics
	metrics.AlertsFired.WithLabelValues(severity).Inc()
	metrics.AlertRulesFired.WithLabelValues(rule.Name, severity).Inc()

	// Check quiet hours — suppress non-critical notifications during quiet hours
	quietSuppressed := false
	if severity != "critical" {
		if settings, err := e.settingsRepo.Get(ctx); err == nil && settings.QuietHoursEnabled {
			nowHHMM := now.Format("15:04")
			start, end := settings.QuietHoursStart, settings.QuietHoursEnd
			if start <= end {
				quietSuppressed = nowHHMM >= start && nowHHMM < end
			} else {
				quietSuppressed = nowHHMM >= start || nowHHMM < end
			}
		}
	}

	// 2. Broadcast via SSE (always — let frontend decide to show/suppress)
	if e.eventHub != nil {
		e.eventHub.Broadcast("alert", map[string]interface{}{
			"vehicle_id":       vehicleID,
			"vehicle_name":     vehicleName,
			"vin":              vin,
			"type":             rule.SignalName,
			"severity":         severity,
			"title":            title,
			"message":          message,
			"rule_id":          rule.ID,
			"timestamp":        now,
			"quiet_suppressed": quietSuppressed,
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
				"rule_type": rule.Op,
				"message":   message,
				"severity":  severity,
				"source":    "alert_rule_engine",
			},
		})
	}

	// 4. Dispatch to notification channels (skip during quiet hours for non-critical)
	if !quietSuppressed {
		safeGo("notification-dispatch", func() {
			e.dispatchNotifications(title, message, severity, rule.ID)
		})
	}

	// 5. Prometheus metric
	metrics.TelemetryMessagesReceived.Inc() // reuse counter for now
}

// dispatchNotifications publishes alert to the notification worker via MQTT.
// The worker handles delivery, retry, rate limiting, and metrics — fully decoupled.
// Falls back to direct send if MQTT is unavailable.
func (e *TelemetryAlertEvaluator) dispatchNotifications(title, message, severity string, ruleID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	channels, err := e.notifRepo.GetAllChannels(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("alert_rules: failed to list notification channels")
		return
	}
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       title,
			Message:     message,
			ChannelID:   ch.ID,
			AlertID:     ruleID,
		}
		if err := notification.Publish(e.mqttClient, req); err != nil {
			log.Warn().Int64("channel_id", ch.ID).Str("type", ch.Type).Err(err).Msg("alert_rules: notification dispatch failed")
		} else {
			metrics.NotificationsDispatched.WithLabelValues(ch.Type).Inc()
			log.Info().Int64("channel_id", ch.ID).Str("type", ch.Type).Msg("alert_rules: notification dispatched to worker")
		}
	}

	// Web Push fan-out — one synthetic Request per alert, dispatched
	// alongside the user-configured channels. The webpush dispatcher
	// (registered via notification.SetWebPushDispatcher in main()) iterates
	// over every push_subscriptions row and delivers to each browser. When
	// VAPID is not configured the dispatcher is a no-op, so this stays
	// safe in dev installs without push.
	pushReq := &notification.Request{
		ChannelType: notification.ChannelTypeWebPush,
		Config: map[string]string{
			"severity":  severity,
			"url":       fmt.Sprintf("/alerts?rule=%d", ruleID),
			"alert_tag": fmt.Sprintf("alert-rule-%d", ruleID),
		},
		Title:   title,
		Message: message,
		AlertID: ruleID,
	}
	if err := notification.Publish(e.mqttClient, pushReq); err != nil {
		log.Warn().Err(err).Msg("alert_rules: webpush fan-out dispatch failed")
	}
}
