package api

import (
	"context"
	"fmt"
	"time"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	"github.com/ev-dev-labs/teslasync/internal/api/sse"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/rs/zerolog/log"
)

// TelemetryAlertEvaluator runs alert rules against incoming streaming signals.
type TelemetryAlertEvaluator struct {
	alertRuleRepo *dbalert.AlertRuleRepo
	notifRepo     *dbnotif.NotificationRepo
	settingsRepo  *settingsdb.SettingsRepo
	vehicleRepo   *vehicledb.VehicleRepo
	eventBus      *events.Bus
	eventHub      *sse.EventHub
	ruleEngine    *RuleEngine
	mqttClient    pahomqtt.Client
}

// NewTelemetryAlertEvaluator creates an alert evaluator for streaming data.
func NewTelemetryAlertEvaluator(db *database.DB, eventBus *events.Bus, hub *sse.EventHub, mqttClient pahomqtt.Client) *TelemetryAlertEvaluator {
	engine := NewRuleEngine()
	// Wire the persistent latch/fire-state repo so once-mode latches
	// survive pod restarts. Phase-49 / Slice 0002. The hydration call
	// itself is invoked from internal/app/new.go after the evaluator is
	// constructed, before MQTT subscribers start dispatching telemetry.
	engine.SetStateRepo(dbalert.NewAlertRuleStateRepo(db))
	return &TelemetryAlertEvaluator{
		alertRuleRepo: dbalert.NewAlertRuleRepo(db),
		notifRepo:     dbnotif.NewNotificationRepo(db),
		settingsRepo:  settingsdb.NewSettingsRepo(db),
		vehicleRepo:   vehicledb.NewVehicleRepo(db),
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
			e.fireAlert(ctx, rule, vehicleID, vin, result.Context, result.Severity)
		}
	}
	metrics.ActiveAlertRules.Set(float64(enabledCount))
	metrics.ObserveDurationWithExemplar(ctx, metrics.AlertRuleEvalDuration, time.Since(evalStart).Seconds())
}

// fireAlert broadcasts via SSE and dispatches to notification channels.
// `effectiveSeverity` is the severity returned by the engine, which may
// differ from `rule.Severity` when the Phase-49 / Slice 0009 escalation
// gate fired. It is the SOURCE OF TRUTH for every downstream consumer
// (SSE, event bus, metrics, quiet-hours suppression, notification
// dispatch). An empty `effectiveSeverity` falls back to the rule's
// declared severity so legacy callers (none today) keep working.
//
// Phase-50 / ADR-005: `evalContext` is the merged-signals map returned
// from RuleEngine.Evaluate. We build the canonical title/body via the
// internal/alertmsg package so every dispatch path (telemetry, computed
// metric, preview) renders identically. The rule's IncludeTitle flag is
// passed through to notification.Request.SuppressTransportTitle — the
// canonical title is still persisted in notification_logs and broadcast
// over SSE regardless.
func (e *TelemetryAlertEvaluator) fireAlert(ctx context.Context, rule *alertmodel.AlertRule, vehicleID int64, vin string, evalContext map[string]any, effectiveSeverity string) {
	severity := effectiveSeverity
	if severity == "" {
		severity = rule.Severity
	}
	if severity == "" {
		severity = "warning"
	}

	// Resolve vehicle display name for context (best-effort: VIN
	// fallback when the DB row lacks a friendly DisplayName).
	vehicleName := ""
	if v, err := e.vehicleRepo.GetByID(ctx, vehicleID); err == nil && v != nil && v.DisplayName != "" {
		vehicleName = v.DisplayName
	} else if vin != "" {
		vehicleName = vin
	}

	// Build the canonical render context. We start from the engine's
	// merged signals so the user's template can reference any in-batch
	// or previously-seen signal. The dispatch-time built-ins (Severity
	// + VehicleName) overwrite the rule-level defaults the alertmsg
	// package would otherwise stamp.
	msgCtx := alertmsg.BuildContext(rule, vehicleName, evalContext, map[string]any{
		"Severity": severity,
	})
	title := alertmsg.RenderTitle(rule, msgCtx)
	body := alertmsg.RenderBody(rule, msgCtx)
	// When include_title is FALSE we promise the transport will deliver
	// a body-only notification. If the op-aware default produced an
	// empty body (state-change rules), fall back to the rule name so
	// the user sees something. We do NOT fall back when include_title
	// is TRUE — the bold header IS the message in that case.
	if !rule.IncludeTitle && body == "" {
		body = rule.Name
	}

	// 1. Record the alert firing timestamp
	now := time.Now().UTC()

	log.Info().Int64("rule_id", rule.ID).Str("name", rule.Name).Str("severity", severity).
		Int64("vehicle_id", vehicleID).Str("title", title).Str("body", body).
		Bool("include_title", rule.IncludeTitle).Msg("alert_rules: alert fired")

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

	// 2. Broadcast via SSE — always uses the canonical title so the
	//    in-app UI keeps its row header even when the per-rule toggle
	//    suppresses the transport bold-header. include_title is
	//    deliberately a transport-layer concern only.
	if e.eventHub != nil {
		e.eventHub.BroadcastWithContext(ctx, "alert", map[string]interface{}{
			"vehicle_id":       vehicleID,
			"vehicle_name":     vehicleName,
			"vin":              vin,
			"type":             rule.SignalName,
			"severity":         severity,
			"title":            title,
			"message":          body,
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
				"title":     title,
				"message":   body,
				"severity":  severity,
				"source":    "alert_rule_engine",
			},
		})
	}

	// 4. Dispatch to notification channels (skip during quiet hours for non-critical)
	if !quietSuppressed {
		suppressTransportTitle := !rule.IncludeTitle
		safeGo("notification-dispatch", func() {
			e.dispatchNotifications(title, body, severity, rule.ID, suppressTransportTitle)
		})
	}

	// 5. Prometheus metric
	metrics.TelemetryMessagesReceived.Inc() // reuse counter for now
}

// dispatchNotifications publishes alert to the notification worker via MQTT.
// The worker handles delivery, retry, rate limiting, and metrics — fully decoupled.
// Falls back to direct send if MQTT is unavailable.
//
// Phase-50 / ADR-005: `suppressTransportTitle` is forwarded to the
// per-transport sender so Discord/Slack/Telegram/ntfy/webhook deliver
// body-only output when the rule has IncludeTitle=false. Transports
// that REQUIRE a title (WebPush, email Subject, Pushover) ignore the
// flag and use the canonical title regardless.
func (e *TelemetryAlertEvaluator) dispatchNotifications(title, message, severity string, ruleID int64, suppressTransportTitle bool) {
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
			ChannelType:            ch.Type,
			Config:                 ch.Config,
			Title:                  title,
			Message:                message,
			ChannelID:              ch.ID,
			AlertID:                ruleID,
			SuppressTransportTitle: suppressTransportTitle,
		}
		if err := notification.PublishCtx(ctx, e.mqttClient, req); err != nil {
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
	//
	// WebPush always requires a title (validated by internal/webpush
	// Service.Send) so SuppressTransportTitle is intentionally NOT
	// honoured here — the canonical title goes through regardless.
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
	if err := notification.PublishCtx(ctx, e.mqttClient, pushReq); err != nil {
		log.Warn().Err(err).Msg("alert_rules: webpush fan-out dispatch failed")
	}
}
