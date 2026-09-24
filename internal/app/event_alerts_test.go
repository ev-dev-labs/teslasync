package app

import (
	"context"
	"errors"
	"testing"
	"time"

	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

type eventRulesFake struct {
	rules []*alertmodel.AlertRule
	err   error
	kinds []string
}

func (f *eventRulesFake) GetEnabledByKind(_ context.Context, kind string) ([]*alertmodel.AlertRule, error) {
	f.kinds = append(f.kinds, kind)
	return f.rules, f.err
}

type eventClaimsFake struct {
	calls   int
	claimed bool
	err     error
	subject string
}

func (f *eventClaimsFake) Claim(_ context.Context, _ int64, subject string, _ time.Time, _ int) (bool, error) {
	f.calls++
	f.subject = subject
	return f.claimed, f.err
}

type placeObservationFake struct {
	fixes    int
	lat, lng float64
	events   []geofencedb.PlaceTransition
	err      error
}

func (f *placeObservationFake) Observe(_ context.Context, _ int64, _ time.Time, lat, lng float64) ([]geofencedb.PlaceTransition, error) {
	f.fixes++
	f.lat, f.lng = lat, lng
	return f.events, f.err
}

func TestEventAlertMatching(t *testing.T) {
	placeID, vehicleID := int64(71), int64(42)
	enter, outage := "enter", "outage"
	component := "mqtt"
	now := time.Now().UTC()
	place := &alertmodel.AlertRule{Enabled: true, Kind: alertmodel.AlertRuleKindPlace,
		PlaceID: &placeID, Transition: &enter, VehicleIDs: []int64{vehicleID}}
	if !matchesEventAlert(place, 42, 71, "", "enter", now) || matchesEventAlert(place, 43, 71, "", "enter", now) ||
		matchesEventAlert(place, 42, 72, "", "enter", now) || matchesEventAlert(place, 42, 71, "", "exit", now) {
		t.Fatal("place matching must require place, vehicle and direction")
	}

	snooze := now.Add(time.Minute)
	place.SnoozedUntil = &snooze
	if matchesEventAlert(place, 42, 71, "", "enter", now) {
		t.Fatal("snoozed rule matched")
	}

	system := &alertmodel.AlertRule{Enabled: true, AllVehicles: true, Kind: alertmodel.AlertRuleKindSystemComponent,
		ComponentName: &component, Transition: &outage}
	if !matchesEventAlert(system, 0, 0, "mqtt", "outage", now) ||
		matchesEventAlert(system, 0, 0, "mqtt", "recovery", now) ||
		matchesEventAlert(system, 0, 0, "redis", "outage", now) {
		t.Fatal("system component match mismatch")
	}
}

func TestDatabaseOutageRuleUsesCachedDefinition(t *testing.T) {
	component, transition := "database", "outage"
	rules := &eventRulesFake{rules: []*alertmodel.AlertRule{{ID: 4, Name: "Database",
		Enabled: true, AllVehicles: true, Kind: alertmodel.AlertRuleKindSystemComponent,
		ComponentName: &component, Transition: &transition, Severity: "critical", CooldownMin: 15}}}
	claims := &eventClaimsFake{claimed: true}
	var received []componentTransitionEvent
	observer := &eventAlertObserver{rules: rules, claims: claims,
		deliver: func(_ context.Context, event componentTransitionEvent) { received = append(received, event) }}
	observer.refreshSystemRules(context.Background())
	rules.err = errors.New("database offline")
	claims.err = errors.New("database offline")
	observer.fire(context.Background(), alertmodel.AlertRuleKindSystemComponent, "database:outage",
		0, 0, "", "database", "outage", "Database offline", "Unavailable", EventDatabaseOutage)
	if len(received) != 1 || received[0].AlertID != 4 || received[0].EventType != EventDatabaseOutage {
		t.Fatalf("cached outage rule not delivered: %+v", received)
	}
}

func TestEventAlertProductionTemplateRendersEventFields(t *testing.T) {
	component, outage := "mqtt", "outage"
	placeID, enter := int64(71), "enter"
	systemTemplate := "{{ComponentName}} {{Transition}}: {{EventMessage}} ({{Severity}})"
	placeTemplate := "{{VehicleName}} {{Transition}} {{PlaceName}} (#{{PlaceID}}): {{EventMessage}}"
	cases := []struct {
		name, kind, component, transition, title, body, eventType, template, wantTitle, wantBody string
		placeID, vehicleID                                                                       int64
		placeName                                                                                string
	}{
		{"system", alertmodel.AlertRuleKindSystemComponent, component, outage, "MQTT outage", "Broker down",
			EventMQTTOutage, systemTemplate, "MQTT: MQTT outage", "mqtt outage: Broker down (critical)", 0, 0, ""},
		{"place", alertmodel.AlertRuleKindPlace, "", enter, "Home enter", "Vehicle 42 entered Home",
			"place.enter", placeTemplate, "Arrived: Home enter", "Vehicle 42 enter Home (#71): Vehicle 42 entered Home", placeID, 42, "Home"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rule := &alertmodel.AlertRule{ID: 9, Name: "Arrived", Kind: tc.kind, Enabled: true, AllVehicles: true,
				Severity: "critical", MsgTemplate: &tc.template}
			if tc.kind == alertmodel.AlertRuleKindSystemComponent {
				rule.Name = "MQTT"
				rule.ComponentName = &component
				rule.Transition = &outage
			} else {
				rule.PlaceID = &placeID
				rule.Transition = &enter
			}
			var delivered componentTransitionEvent
			observer := &eventAlertObserver{
				rules:   &eventRulesFake{rules: []*alertmodel.AlertRule{rule}},
				claims:  &eventClaimsFake{claimed: true},
				deliver: func(_ context.Context, event componentTransitionEvent) { delivered = event },
			}
			observer.fire(context.Background(), tc.kind, "event:subject", tc.vehicleID, tc.placeID,
				tc.placeName, tc.component, tc.transition, tc.title, tc.body, tc.eventType)
			if delivered.Title != tc.wantTitle || delivered.Message != tc.wantBody || !delivered.SuppressTransportTitle {
				t.Fatalf("rendered notification = %+v; want title %q, body %q and title suppression", delivered, tc.wantTitle, tc.wantBody)
			}
			rule.MsgTemplate = nil
			rule.IncludeTitle = true
			observer.fire(context.Background(), tc.kind, "event:subject", tc.vehicleID, tc.placeID,
				tc.placeName, tc.component, tc.transition, tc.title, tc.body, tc.eventType)
			if delivered.Message != tc.body || delivered.SuppressTransportTitle {
				t.Fatalf("default event body/title mismatch: %+v", delivered)
			}
		})
	}
}

func TestEventAlertProductionObserverConsumesPositionPair(t *testing.T) {
	at := time.Now().UTC()
	placeID, direction := int64(71), "enter"
	rules := &eventRulesFake{rules: []*alertmodel.AlertRule{{ID: 9, Enabled: true, AllVehicles: true,
		Kind: alertmodel.AlertRuleKindPlace, PlaceID: &placeID, Transition: &direction, Severity: "warn", Name: "Arrived"}}}
	claims := &eventClaimsFake{claimed: true}
	places := &placeObservationFake{events: []geofencedb.PlaceTransition{{PlaceID: 71, Name: "Home", Direction: "enter"}}}
	var deliveries []componentTransitionEvent
	observer := &eventAlertObserver{rules: rules, claims: claims, places: places,
		deliver: func(_ context.Context, event componentTransitionEvent) { deliveries = append(deliveries, event) }}
	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "GpsHeading", Value: float64(10), EmittedAt: at},
		{Field: "LocationLatitude", Value: float64(40), EmittedAt: at},
		{Field: "LocationLongitude", Value: float64(-75), EmittedAt: at},
	})
	if places.fixes != 1 || places.lat != 40 || places.lng != -75 || len(deliveries) != 1 ||
		deliveries[0].AlertID != 9 || deliveries[0].EventType != "place.enter" ||
		claims.subject != "place:71:vehicle:42:enter" {
		t.Fatalf("production observer did not deliver attributed position event: fixes=%d events=%+v subject=%s", places.fixes, deliveries, claims.subject)
	}

	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{{Field: "LocationLatitude", Value: float64(40), EmittedAt: at}})
	if places.fixes != 1 {
		t.Fatal("partial GPS update triggered observation")
	}
	claims.claimed = false
	splitAt := at.Add(3 * time.Second)
	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "LocationLongitude", Value: float64(-75), EmittedAt: splitAt},
	})
	if places.fixes != 1 {
		t.Fatal("longitude without partner triggered observation")
	}
	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "LocationLatitude", Value: float64(40), EmittedAt: splitAt},
	})
	if places.fixes != 2 {
		t.Fatal("split production GPS updates were not paired")
	}
	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "LocationLatitude", Value: float64(40), EmittedAt: at.Add(time.Second)},
		{Field: "LocationLongitude", Value: float64(-75), EmittedAt: at.Add(time.Second)},
	})
	if len(deliveries) != 1 {
		t.Fatal("cooldown suppression still delivered")
	}
	places.err = errors.New("db unavailable")
	observer.OnPayloadProcessed(context.Background(), 42, []codec.Atomic{
		{Field: "LocationLatitude", Value: float64(40), EmittedAt: at.Add(2 * time.Second)},
		{Field: "LocationLongitude", Value: float64(-75), EmittedAt: at.Add(2 * time.Second)},
	})
	if len(deliveries) != 1 {
		t.Fatal("failed occupancy read delivered")
	}
}
