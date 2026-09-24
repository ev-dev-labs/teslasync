package app

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/rs/zerolog/log"
	oteltrace "go.opentelemetry.io/otel/trace"
)

type eventAlertRules interface {
	GetEnabledByKind(context.Context, string) ([]*alertmodel.AlertRule, error)
}
type eventAlertClaims interface {
	Claim(context.Context, int64, string, time.Time, int) (bool, error)
}
type placeObservations interface {
	Observe(context.Context, int64, time.Time, float64, float64) ([]geofencedb.PlaceTransition, error)
}

type eventAlertObserver struct {
	rules             eventAlertRules
	claims            eventAlertClaims
	places            placeObservations
	deliver           func(context.Context, componentTransitionEvent)
	mu                sync.RWMutex
	cachedSystemRules []*alertmodel.AlertRule
	positionMu        sync.Mutex
	pendingPositions  map[placeFixKey]*placeFix
}

type placeFixKey struct {
	vehicleID int64
	at        time.Time
}

type placeFix struct {
	lat, lng       float64
	hasLat, hasLng bool
	receivedAt     time.Time
}

func (o *eventAlertObserver) fire(ctx context.Context, kind, subject string, vehicleID int64, placeID int64, placeName, component, transition, title, body, eventType string) {
	rules, err := o.rules.GetEnabledByKind(ctx, kind)
	if err != nil {
		log.Error().Err(err).Str("trace_id", oteltrace.SpanFromContext(ctx).SpanContext().TraceID().String()).
			Str("kind", kind).Msg("event alert: load rules failed")
		if kind != alertmodel.AlertRuleKindSystemComponent || component != "database" {
			return
		}

		o.mu.RLock()
		rules = append([]*alertmodel.AlertRule(nil), o.cachedSystemRules...)
		o.mu.RUnlock()
	} else if kind == alertmodel.AlertRuleKindSystemComponent {
		o.mu.Lock()
		o.cachedSystemRules = append([]*alertmodel.AlertRule(nil), rules...)
		o.mu.Unlock()
	}
	now := time.Now().UTC()
	for _, rule := range rules {
		if !matchesEventAlert(rule, vehicleID, placeID, component, transition, now) {
			continue
		}
		claimed, err := o.claims.Claim(ctx, rule.ID, subject, now, rule.CooldownMin)
		if err != nil {
			log.Error().Err(err).Str("trace_id", oteltrace.SpanFromContext(ctx).SpanContext().TraceID().String()).
				Int64("rule_id", rule.ID).Msg("event alert: cooldown claim failed")
			// Database outages must still reach cached notification channels.
			// The watchdog's edge/cooldown tracker bounds this best-effort
			// fallback when durable claims cannot be written.
			if kind != alertmodel.AlertRuleKindSystemComponent || component != "database" {
				continue
			}
			claimed = true
		}
		if !claimed {
			continue
		}
		metrics.AlertsFired.WithLabelValues(rule.Severity).Inc()
		metrics.AlertRulesFired.WithLabelValues(rule.Name, rule.Severity).Inc()
		vehicleName := ""
		if kind == alertmodel.AlertRuleKindPlace {
			vehicleName = fmt.Sprintf("Vehicle %d", vehicleID)
		}
		renderCtx := alertmsg.BuildContext(rule, vehicleName, nil, map[string]any{
			"EventTitle": title, "EventMessage": body, "PlaceName": placeName,
			"ComponentName": component, "Transition": transition, "PlaceID": placeID,
		})
		o.deliver(ctx, componentTransitionEvent{
			Component: component, EventType: eventType, Severity: rule.Severity,
			Title: alertmsg.RenderTitle(rule, renderCtx), Message: alertmsg.RenderBody(rule, renderCtx),
			AlertID: rule.ID, ChannelIDs: rule.ChannelIDs, SuppressTransportTitle: !rule.IncludeTitle,
		})
	}
}

func (o *eventAlertObserver) refreshSystemRules(ctx context.Context) {
	rules, err := o.rules.GetEnabledByKind(ctx, alertmodel.AlertRuleKindSystemComponent)
	if err != nil {
		log.Warn().Err(err).Msg("event alert: system rule cache refresh failed")
		return
	}
	o.mu.Lock()
	o.cachedSystemRules = append([]*alertmodel.AlertRule(nil), rules...)
	o.mu.Unlock()
}

func matchesEventAlert(rule *alertmodel.AlertRule, vehicleID, placeID int64, component, transition string, at time.Time) bool {
	if rule == nil || !rule.Enabled || rule.Transition == nil || *rule.Transition != transition ||
		(rule.SnoozedUntil != nil && rule.SnoozedUntil.After(at)) {
		return false
	}
	switch rule.Kind {
	case alertmodel.AlertRuleKindSystemComponent:
		return rule.ComponentName != nil && *rule.ComponentName == component && rule.AllVehicles
	case alertmodel.AlertRuleKindPlace:
		return rule.PlaceID != nil && *rule.PlaceID == placeID && rule.AppliesTo(vehicleID)
	}
	return false
}

func (o *eventAlertObserver) OnPayloadProcessed(ctx context.Context, vehicleID int64, atomics []codec.Atomic) {
	if o == nil || o.places == nil {
		return
	}
	o.positionMu.Lock()
	if o.pendingPositions == nil {
		o.pendingPositions = make(map[placeFixKey]*placeFix)
	}
	now := time.Now()
	for key, pending := range o.pendingPositions {
		if now.Sub(pending.receivedAt) > 5*time.Minute {
			delete(o.pendingPositions, key)
		}
	}
	fixes := make(map[time.Time]*placeFix)
	for _, atom := range atomics {
		if atom.Field != "LocationLatitude" && atom.Field != "LocationLongitude" {
			continue
		}
		value, ok := atom.Value.(float64)
		if !ok {
			continue
		}
		at := atom.EmittedAt.UTC()
		key := placeFixKey{vehicleID: vehicleID, at: at}
		p := o.pendingPositions[key]
		if p == nil {
			if len(o.pendingPositions) >= 100_000 {
				log.Warn().Msg("event alert: pending position pair capacity exhausted")
				continue
			}
			p = &placeFix{receivedAt: now}
			o.pendingPositions[key] = p
		}
		if atom.Field == "LocationLatitude" {
			p.lat, p.hasLat = value, true
		} else {
			p.lng, p.hasLng = value, true
		}
		if p.hasLat && p.hasLng {
			fixes[at] = p
			delete(o.pendingPositions, key)
		}
	}
	o.positionMu.Unlock()
	timestamps := make([]time.Time, 0, len(fixes))
	for at := range fixes {
		timestamps = append(timestamps, at)
	}
	sort.Slice(timestamps, func(i, j int) bool { return timestamps[i].Before(timestamps[j]) })
	for _, at := range timestamps {
		p := fixes[at]
		if !p.hasLat || !p.hasLng {
			continue
		}
		transitions, err := o.places.Observe(ctx, vehicleID, at, p.lat, p.lng)
		if err != nil {
			log.Error().Err(err).Str("trace_id", oteltrace.SpanFromContext(ctx).SpanContext().TraceID().String()).
				Int64("vehicle_id", vehicleID).Msg("event alert: position observation failed")
			continue
		}
		for _, tr := range transitions {
			o.fire(ctx, alertmodel.AlertRuleKindPlace, fmt.Sprintf("place:%d:vehicle:%d:%s", tr.PlaceID, vehicleID, tr.Direction),
				vehicleID, tr.PlaceID, tr.Name, "", tr.Direction, tr.Name+" "+tr.Direction,
				fmt.Sprintf("Vehicle %d %sed %s", vehicleID, tr.Direction, tr.Name), "place."+tr.Direction)
		}
	}
}

func (a *App) newEventAlertObserver() *eventAlertObserver {
	observer := &eventAlertObserver{
		rules:  dbalert.NewAlertRuleRepo(a.DB),
		claims: dbalert.NewEventCooldownRepo(a.DB),
		places: geofencedb.NewPlaceObservationRepo(a.DB),
	}
	observer.deliver = func(ctx context.Context, evt componentTransitionEvent) {
		var channels componentNotificationChannelSource = dbnotif.NewNotificationRepo(a.DB)
		var prefs componentNotificationPreferenceSource
		if evt.Component != "" && a.healthNotifications != nil {
			channels = a.healthNotifications
			prefs = a.healthNotifications
		}
		dispatchComponentNotification(ctx, channels, prefs, mqttTransport(a.MQTT), notification.PublishCtx, evt)
	}
	return observer
}
