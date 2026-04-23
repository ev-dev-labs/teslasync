package api

import (
	"context"
	"fmt"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	notifFSM "github.com/ev-dev-labs/teslasync/internal/fsm/notification"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
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
	cooldowns     map[string]*notifFSM.CooldownFSM // keyed by "ruleID:vehicleID"
	cooldownMu    sync.Mutex
}

// NewTelemetryAlertEvaluator creates an alert evaluator for streaming data.
func NewTelemetryAlertEvaluator(db *database.DB, eventBus *events.Bus, hub *EventHub, mqttClient pahomqtt.Client) *TelemetryAlertEvaluator {
	return &TelemetryAlertEvaluator{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		notifRepo:     database.NewNotificationRepo(db),
		settingsRepo:  database.NewSettingsRepo(db),
		vehicleRepo:   database.NewVehicleRepo(db),
		eventBus:      eventBus,
		eventHub:      hub,
		ruleEngine:    NewRuleEngine(),
		cooldowns:     make(map[string]*notifFSM.CooldownFSM),
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

// RuleEngine returns the underlying rule engine for state recovery.
func (e *TelemetryAlertEvaluator) RuleEngine() *RuleEngine {
	return e.ruleEngine
}

// Evaluate checks all alert rules against the given signals for a vehicle.
// accumulatedSignals contains last-known values from recent batches — used as
// fallback for legacy rules when a signal isn't in the current sparse batch.
func (e *TelemetryAlertEvaluator) Evaluate(ctx context.Context, vehicleID int64, vin string, signals, accumulatedSignals map[string]interface{}) {
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

		metrics.CEPRulesEvaluated.Inc()
		result := e.ruleEngine.Evaluate(rule, vehicleID, signals)
		triggered := result.Triggered
		message := result.Message

		if triggered {
			// Check cooldown FSM — suppress if within cooldown period
			cooldownKey := fmt.Sprintf("%d:%d", rule.ID, vehicleID)
			e.cooldownMu.Lock()
			cd, exists := e.cooldowns[cooldownKey]
			if !exists {
				cfg := notifFSM.DefaultCooldownConfig()
				if rule.CooldownMin > 0 {
					cfg.CooldownDuration = time.Duration(rule.CooldownMin) * time.Minute
				}
				cd = notifFSM.NewCooldownFSM(rule.ID, vehicleID, cfg)
				e.cooldowns[cooldownKey] = cd
			}
			e.cooldownMu.Unlock()

			if cd.ShouldFire() {
				e.fireAlert(ctx, rule, vehicleID, vin, message)
			} else {
				log.Debug().Int64("rule_id", rule.ID).Int64("vehicle_id", vehicleID).
					Msg("cep: alert suppressed by cooldown FSM")
			}
		} else if isTransitionRule(rule) {
			// Condition is false for a transition rule — reset cooldown FSM
			cooldownKey := fmt.Sprintf("%d:%d", rule.ID, vehicleID)
			e.cooldownMu.Lock()
			if cd, exists := e.cooldowns[cooldownKey]; exists {
				cd.Reset()
			}
			e.cooldownMu.Unlock()
		}
	}
	metrics.CEPActiveRules.Set(float64(enabledCount))
	metrics.CEPEvalDuration.Observe(time.Since(evalStart).Seconds())
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
		Int64("vehicle_id", vehicleID).Str("message", message).Msg("cep: alert fired")

	// Prometheus metrics
	metrics.AlertsFired.WithLabelValues(severity).Inc()
	metrics.CEPRulesFired.WithLabelValues(rule.Name, severity).Inc()

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
				"source":    "cep_engine",
			},
		})
	}

	// 4. Dispatch to notification channels (skip during quiet hours for non-critical)
	if !quietSuppressed {
		safeGo("notification-dispatch", func() {
			e.dispatchNotifications(title, message)
		})
	}

	// 5. Prometheus metric
	metrics.TelemetryMessagesReceived.Inc() // reuse counter for now
}

// dispatchNotifications publishes alert to the notification worker via MQTT.
// The worker handles delivery, retry, rate limiting, and metrics — fully decoupled.
// Falls back to direct send if MQTT is unavailable.
func (e *TelemetryAlertEvaluator) dispatchNotifications(title, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	channels, err := e.notifRepo.GetAllChannels(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("cep: failed to list notification channels")
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
		}
		if err := notification.Publish(e.mqttClient, req); err != nil {
			log.Warn().Int64("channel_id", ch.ID).Str("type", ch.Type).Err(err).Msg("cep: notification dispatch failed")
		} else {
			metrics.NotificationsDispatched.WithLabelValues(ch.Type).Inc()
			log.Info().Int64("channel_id", ch.ID).Str("type", ch.Type).Msg("cep: notification dispatched to worker")
		}
	}
}
