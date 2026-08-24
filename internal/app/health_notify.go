package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// Component health notification event types. These are the stable
// identifiers users toggle per-channel via the existing
// notification_preferences API (GET/PUT
// /api/v1/notifications/{channelID}/preferences — see
// internal/api/notification/schedule.go). Preferences default to
// enabled when no row exists (dbnotif.NotificationPreferenceRepo.IsEnabled),
// matching every other event type already in that table (drive.started,
// charge.completed, alert.triggered, ...).
//
// The canonical string values (and the full catalog with descriptions
// for the frontend) live in internal/notification.EventCatalog — see
// GET /api/v1/notifications/event-types
// (internal/api/notification/event_catalog.go). These are re-exported
// here as same-named constants purely so this file's existing call
// sites (componentEventTypes below, health_notify_test.go) don't have
// to spell out the notification. prefix everywhere; they are NOT a
// second source of truth — changing a value here requires changing it
// in internal/notification/catalog.go, and go vet/build will catch any
// drift immediately since these are literal aliases, not independent
// string literals.
const (
	EventTelemetryOutage   = notification.EventTelemetryOutage
	EventTelemetryRecovery = notification.EventTelemetryRecovery
	EventMQTTOutage        = notification.EventMQTTOutage
	EventMQTTRecovery      = notification.EventMQTTRecovery
	EventDatabaseOutage    = notification.EventDatabaseOutage
	EventDatabaseRecovery  = notification.EventDatabaseRecovery
	EventRedisOutage       = notification.EventRedisOutage
	EventRedisRecovery     = notification.EventRedisRecovery
	EventTeslaAuthOutage   = notification.EventTeslaAuthOutage
	EventTeslaAuthRecovery = notification.EventTeslaAuthRecovery
	EventWorkerOutage      = notification.EventWorkerOutage
	EventWorkerRecovery    = notification.EventWorkerRecovery
)

// componentEventTypes maps a resilience.HealthMonitor component name to
// its outage/recovery event type pair. Returns ("", "") for a component
// name with no configured notification mapping — Observe treats that as
// "don't notify" rather than guessing.
func componentEventTypes(component string) (outage, recovery string) {
	switch component {
	case "telemetry":
		return EventTelemetryOutage, EventTelemetryRecovery
	case "mqtt":
		return EventMQTTOutage, EventMQTTRecovery
	case "database":
		return EventDatabaseOutage, EventDatabaseRecovery
	case "redis":
		return EventRedisOutage, EventRedisRecovery
	case "tesla_api":
		return EventTeslaAuthOutage, EventTeslaAuthRecovery
	case "worker":
		return EventWorkerOutage, EventWorkerRecovery
	default:
		return "", ""
	}
}

// componentNotifyCooldown is the minimum gap between two notifications
// fired in the SAME direction (outage or recovery) for the SAME
// component. It guards against a flapping component (e.g. Redis
// bouncing Healthy/Degraded every couple of minutes) spamming every
// enabled channel on every edge. The HealthMonitor's own 3-consecutive-
// failure bar (~3 ticks == ~3 minutes at the 60s tick interval) already
// debounces the INITIAL transition; this cooldown debounces REPEATED
// transitions after that.
const componentNotifyCooldown = 15 * time.Minute

// componentTransitionEvent describes a single outage/recovery
// notification to fan out to enabled, preference-matching channels.
type componentTransitionEvent struct {
	Component string
	EventType string
	Severity  string // "info" | "warn" | "critical" — see notification.Request.Severity
	Title     string
	Message   string
}

// componentHealthTracker turns raw resilience.HealthMonitor snapshots
// into edge-triggered, cooldown-debounced notification events. It holds
// no DB/MQTT dependency — Observe is a pure function of (previous state,
// current state, now), so it is fully unit-testable with a fake clock.
type componentHealthTracker struct {
	mu          sync.Mutex
	prev        map[string]resilience.ComponentStatus
	lastSent    map[string]time.Time // key: component + ":" + direction
	firedOutage map[string]bool      // component -> "has an un-recovered outage notification fired"
	cooldown    time.Duration
	now         func() time.Time
}

func newComponentHealthTracker(cooldown time.Duration) *componentHealthTracker {
	return &componentHealthTracker{
		prev:        make(map[string]resilience.ComponentStatus),
		lastSent:    make(map[string]time.Time),
		firedOutage: make(map[string]bool),
		cooldown:    cooldown,
		now:         time.Now,
	}
}

// Observe records the latest status for component `name` and returns
// the notification event that should fire, if any, plus whether one
// should fire at all. Semantics:
//
//   - Healthy -> {Degraded,Unhealthy} always fires. An initial
//     Unknown -> {Degraded,Unhealthy} also fires when
//     initialOutageEligible is true. This is required after process
//     restarts: an already-configured installation may come up while MQTT,
//     Redis, telemetry, or Tesla authentication is already unavailable.
//     Callers keep initialOutageEligible false for a not-yet-onboarded Tesla
//     account so first-run setup does not create a false outage.
//   - A notification fires only on a threshold-crossing transition:
//     Healthy -> {Degraded,Unhealthy} ("outage") or
//     {Degraded,Unhealthy} -> Healthy ("recovery"). Escalating from
//     Degraded to Unhealthy while already below Healthy does NOT
//     re-fire — the operator was already alerted this component is
//     unwell; the notification body's consecutive-failure count and
//     severity still reflect the worse state on the NEXT genuine edge.
//   - Unknown -> Healthy never fires, and a component that remains Unknown
//     never fires (for example Redis when it is disabled).
//   - A "recovery" is only ever fired for a component that previously
//     had a genuinely-fired "outage" notification (firedOutage tracks
//     this per component). This matters for the FIRST-time bring-up of
//     a component that starts at StatusUnknown and ramps to Degraded
//     before its first-ever success (e.g. tesla_api before a Tesla
//     account is connected, or worker before the first vehicle poll
//     completes) — that Unknown -> Degraded ramp never fires an
//     "outage" (see the transition table below), so the eventual first
//     Degraded -> Healthy transition must not fire a misleading
//     "recovered" notification for a component that was never actually
//     up and then went down.
//   - A per-component-per-direction cooldown suppresses repeat
//     notifications for a flapping component. The internal prev-state
//     map is updated on EVERY call regardless of cooldown, so the next
//     genuine transition is still evaluated correctly once the cooldown
//     window passes.
func (t *componentHealthTracker) Observe(name string, comp resilience.Component, initialOutageEligible bool) (componentTransitionEvent, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()

	prev, seen := t.prev[name]
	t.prev[name] = comp.Status
	if !seen {
		prev = resilience.StatusUnknown
	}
	if prev == comp.Status {
		return componentTransitionEvent{}, false
	}

	outageEvt, recoveryEvt := componentEventTypes(name)
	if outageEvt == "" {
		return componentTransitionEvent{}, false
	}

	var direction, eventType, severity string
	switch {
	case (prev == resilience.StatusHealthy || (prev == resilience.StatusUnknown && initialOutageEligible)) &&
		comp.Status == resilience.StatusDegraded:
		direction, eventType, severity = "outage", outageEvt, "warn"
	case (prev == resilience.StatusHealthy || (prev == resilience.StatusUnknown && initialOutageEligible)) &&
		comp.Status == resilience.StatusUnhealthy:
		direction, eventType, severity = "outage", outageEvt, "critical"
	case prev != resilience.StatusHealthy && prev != resilience.StatusUnknown && comp.Status == resilience.StatusHealthy && t.firedOutage[name]:
		direction, eventType, severity = "recovery", recoveryEvt, "info"
	default:
		// Degraded -> Unhealthy escalation, Unknown edges, a
		// first-time-Healthy transition with no prior fired outage
		// (initial bring-up), or any other non-threshold-crossing move
		// — already alerted, not worth alerting, or nothing to alert on
		// yet.
		return componentTransitionEvent{}, false
	}

	now := t.now()
	cooldownKey := name + ":" + direction
	if last, ok := t.lastSent[cooldownKey]; ok && now.Sub(last) < t.cooldown {
		return componentTransitionEvent{}, false
	}
	t.lastSent[cooldownKey] = now
	if direction == "outage" {
		t.firedOutage[name] = true
	} else {
		t.firedOutage[name] = false
	}

	title := fmt.Sprintf("%s is %s", componentDisplayName(name), comp.Status.String())
	message := fmt.Sprintf("Component %s has %d consecutive failures. Last error: %s", name, comp.ConsecFails, comp.LastError)
	if direction == "recovery" {
		title = fmt.Sprintf("%s recovered", componentDisplayName(name))
		message = fmt.Sprintf("Component %s is healthy again", name)
	}

	return componentTransitionEvent{
		Component: name,
		EventType: eventType,
		Severity:  severity,
		Title:     title,
		Message:   message,
	}, true
}

// componentNotificationChannelSource is the narrow surface
// dispatchComponentNotification needs from *dbnotif.NotificationRepo.
// Defined as an interface so unit tests can inject a fake without a
// live Postgres pool.
type componentNotificationChannelSource interface {
	GetAllChannels(ctx context.Context) ([]*notificationmodel.NotificationChannel, error)
	CreateLog(ctx context.Context, l *notificationmodel.NotificationLog) error
}

// componentNotificationPreferenceSource is the narrow surface
// dispatchComponentNotification needs from
// *dbnotif.NotificationPreferenceRepo.
type componentNotificationPreferenceSource interface {
	IsEnabled(ctx context.Context, channelID int64, eventType string) bool
}

type componentNotificationPreferenceListSource interface {
	GetByChannel(ctx context.Context, channelID int64) ([]*notificationmodel.NotificationPreference, error)
}

// componentNotificationCache keeps the last successfully loaded channel and
// preference snapshot in memory. Database outage notifications cannot query
// their own delivery configuration from a failed database, so the watchdog
// refreshes this cache while PostgreSQL is healthy and dispatches from the
// snapshot during an outage.
type componentNotificationCache struct {
	mu          sync.RWMutex
	channels    []*notificationmodel.NotificationChannel
	preferences map[int64]map[string]bool
	ready       bool
	channelRepo componentNotificationChannelSource
	prefRepo    componentNotificationPreferenceListSource
}

func newComponentNotificationCache(
	channelRepo componentNotificationChannelSource,
	prefRepo componentNotificationPreferenceListSource,
) *componentNotificationCache {
	return &componentNotificationCache{
		channelRepo: channelRepo,
		prefRepo:    prefRepo,
	}
}

func (c *componentNotificationCache) Refresh(ctx context.Context) error {
	if c == nil || c.channelRepo == nil || c.prefRepo == nil {
		return fmt.Errorf("component notification cache is not configured")
	}
	channels, err := c.channelRepo.GetAllChannels(ctx)
	if err != nil {
		return fmt.Errorf("list notification channels: %w", err)
	}
	preferences := make(map[int64]map[string]bool, len(channels))
	for _, channel := range channels {
		if channel == nil {
			continue
		}
		rows, err := c.prefRepo.GetByChannel(ctx, channel.ID)
		if err != nil {
			return fmt.Errorf("list notification preferences for channel %d: %w", channel.ID, err)
		}
		explicit := make(map[string]bool, len(rows))
		for _, row := range rows {
			if row != nil {
				explicit[row.EventType] = row.Enabled
			}
		}
		preferences[channel.ID] = explicit
	}

	c.mu.Lock()
	c.channels = append([]*notificationmodel.NotificationChannel(nil), channels...)
	c.preferences = preferences
	c.ready = true
	c.mu.Unlock()
	return nil
}

func (c *componentNotificationCache) GetAllChannels(context.Context) ([]*notificationmodel.NotificationChannel, error) {
	if c == nil {
		return nil, fmt.Errorf("component notification cache is nil")
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.ready {
		return nil, fmt.Errorf("component notification cache has not loaded")
	}
	return append([]*notificationmodel.NotificationChannel(nil), c.channels...), nil
}

func (c *componentNotificationCache) CreateLog(ctx context.Context, entry *notificationmodel.NotificationLog) error {
	if c == nil || c.channelRepo == nil {
		return fmt.Errorf("component notification cache is not configured")
	}
	return c.channelRepo.CreateLog(ctx, entry)
}

func (c *componentNotificationCache) IsEnabled(_ context.Context, channelID int64, eventType string) bool {
	if c == nil {
		return false
	}
	c.mu.RLock()
	explicit, found := c.preferences[channelID][eventType]
	c.mu.RUnlock()
	if found {
		return explicit
	}
	defaultEnabled, known := notification.EventTypeDefault(eventType)
	return known && defaultEnabled
}

// componentNotificationPublishFunc abstracts notification.PublishCtx so
// tests can substitute a fake without a live MQTT broker or outbound
// HTTP call. Production wiring always passes notification.PublishCtx,
// which already implements the "MQTT unavailable -> direct dispatch"
// fallback contract (nil transport, disconnected transport, or a
// publish-ack timeout all fall through to notification.Send
// synchronously) — see internal/notification/worker.go.
type componentNotificationPublishFunc func(ctx context.Context, transport pahomqtt.Client, req *notification.Request) error

// dispatchComponentNotification fans a component transition event out to
// every enabled channel whose per-channel preference for evt.EventType
// is enabled (defaulting to enabled when no preference row exists —
// dbnotif.NotificationPreferenceRepo.IsEnabled already implements that
// default). It reuses the existing MQTT-unavailable direct-dispatch
// fallback in notification.PublishCtx rather than reimplementing one,
// so an outage notification for MQTT itself is still delivered over
// every OTHER configured channel (Discord, Slack, webhook, ...) even
// though the MQTT-backed async notification queue is exactly the thing
// that's down.
//
// Errors from GetAllChannels or an individual publish are logged with
// context (component, event type, channel id) — never swallowed
// silently — but do not stop the fan-out to remaining channels.
func dispatchComponentNotification(
	ctx context.Context,
	channels componentNotificationChannelSource,
	prefs componentNotificationPreferenceSource,
	transport pahomqtt.Client,
	publish componentNotificationPublishFunc,
	evt componentTransitionEvent,
) {
	if channels == nil || publish == nil {
		return
	}
	chList, err := channels.GetAllChannels(ctx)
	if err != nil {
		log.Error().Err(err).Str("event_type", evt.EventType).Msg("component health notification: failed to list channels")
		return
	}

	// mqttWasAvailable is evaluated once, up front, so the "did the
	// direct-dispatch fallback fire" inference below matches what
	// PublishCtx observed at call time — it re-checks connectivity
	// itself, but a nil transport short-circuits identically either way.
	mqttWasAvailable := transport != nil && transport.IsConnected()

	for _, ch := range chList {
		if ch == nil || !ch.Enabled {
			continue
		}
		if prefs != nil && !prefs.IsEnabled(ctx, ch.ID, evt.EventType) {
			continue
		}

		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       evt.Title,
			Message:     evt.Message,
			ChannelID:   ch.ID,
			Severity:    evt.Severity,
		}

		started := time.Now()
		pubErr := publish(ctx, transport, req)
		latencyMs := int(time.Since(started).Milliseconds())

		if pubErr != nil {
			log.Error().Err(pubErr).
				Int64("channel_id", ch.ID).
				Str("channel_type", ch.Type).
				Str("event_type", evt.EventType).
				Str("component", evt.Component).
				Msg("component health notification dispatch failed")
			if logErr := channels.CreateLog(ctx, &notificationmodel.NotificationLog{
				ChannelID: ch.ID,
				Title:     evt.Title,
				Message:   evt.Message,
				Status:    "failed",
				Error:     pubErr.Error(),
				Severity:  evt.Severity,
			}); logErr != nil {
				log.Warn().Err(logErr).Int64("channel_id", ch.ID).Msg("component health notification: failed to persist failure log")
			}
			continue
		}

		// When MQTT was available, PublishCtx enqueued the request and
		// the async internal/notification.Worker will create the
		// notification_logs row itself once delivered — logging again
		// here would double-write. Only the synchronous direct-dispatch
		// fallback path (MQTT nil/disconnected) needs us to persist the
		// outcome, since nothing else will.
		if !mqttWasAvailable {
			if logErr := channels.CreateLog(ctx, &notificationmodel.NotificationLog{
				ChannelID: ch.ID,
				Title:     evt.Title,
				Message:   evt.Message,
				Status:    "sent",
				Severity:  evt.Severity,
			}); logErr != nil {
				log.Warn().Err(logErr).Int64("channel_id", ch.ID).Msg("component health notification: failed to persist success log")
			}
		}

		log.Info().
			Int64("channel_id", ch.ID).
			Str("channel_type", ch.Type).
			Str("event_type", evt.EventType).
			Str("component", evt.Component).
			Bool("mqtt_available", mqttWasAvailable).
			Int("latency_ms", latencyMs).
			Msg("component health notification dispatched")
	}
}

// Compile-time assertions that the concrete production repos satisfy
// the narrow interfaces above.
var _ componentNotificationChannelSource = (*dbnotif.NotificationRepo)(nil)
var _ componentNotificationPreferenceSource = (*dbnotif.NotificationPreferenceRepo)(nil)
