package app

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// --- componentHealthTracker.Observe -----------------------------------

func healthyComponent() resilience.Component {
	return resilience.Component{Status: resilience.StatusHealthy}
}

func degradedComponent(consecFails int, lastErr string) resilience.Component {
	return resilience.Component{Status: resilience.StatusDegraded, ConsecFails: consecFails, LastError: lastErr}
}

func unhealthyComponent(consecFails int) resilience.Component {
	return resilience.Component{Status: resilience.StatusUnhealthy, ConsecFails: consecFails}
}

func TestComponentHealthTracker_FirstHealthyObservationNeverFires(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	if _, fire := tr.Observe("mqtt", healthyComponent(), true); fire {
		t.Fatal("first healthy observation must not fire a notification")
	}
}

func TestComponentHealthTracker_InitialEligibleOutageFires(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	evt, fire := tr.Observe("mqtt", degradedComponent(5, "boom"), true)
	if !fire {
		t.Fatal("configured component starting degraded must fire an outage")
	}
	if evt.EventType != EventMQTTOutage {
		t.Errorf("EventType = %q, want %q", evt.EventType, EventMQTTOutage)
	}
}

func TestComponentHealthTracker_OutageOnHealthyToDegraded(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("mqtt", healthyComponent(), true)

	evt, fire := tr.Observe("mqtt", degradedComponent(3, "broker unreachable"), true)
	if !fire {
		t.Fatal("expected an outage event on Healthy -> Degraded")
	}
	if evt.EventType != EventMQTTOutage {
		t.Errorf("EventType = %q, want %q", evt.EventType, EventMQTTOutage)
	}
	if evt.Severity != "warn" {
		t.Errorf("Severity = %q, want %q for Degraded", evt.Severity, "warn")
	}
}

func TestComponentHealthTracker_OutageSeverityCriticalWhenUnhealthy(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("database", healthyComponent(), true)

	evt, fire := tr.Observe("database", unhealthyComponent(10), true)
	if !fire {
		t.Fatal("expected an outage event on Healthy -> Unhealthy")
	}
	if evt.Severity != "critical" {
		t.Errorf("Severity = %q, want %q for Unhealthy", evt.Severity, "critical")
	}
	if evt.EventType != EventDatabaseOutage {
		t.Errorf("EventType = %q, want %q", evt.EventType, EventDatabaseOutage)
	}
}

func TestComponentHealthTracker_RecoveryOnDegradedToHealthy(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("telemetry", healthyComponent(), true)
	tr.Observe("telemetry", degradedComponent(3, "stale"), true)

	evt, fire := tr.Observe("telemetry", healthyComponent(), true)
	if !fire {
		t.Fatal("expected a recovery event on Degraded -> Healthy")
	}
	if evt.EventType != EventTelemetryRecovery {
		t.Errorf("EventType = %q, want %q", evt.EventType, EventTelemetryRecovery)
	}
	if evt.Severity != "info" {
		t.Errorf("Severity = %q, want %q for recovery", evt.Severity, "info")
	}
}

func TestComponentHealthTracker_EscalationDoesNotReFire(t *testing.T) {
	// Degraded -> Unhealthy while already below Healthy must not
	// re-notify; the operator was already alerted on the first edge.
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("worker", healthyComponent(), true)
	tr.Observe("worker", degradedComponent(3, "boom"), true)

	if _, fire := tr.Observe("worker", unhealthyComponent(10), true); fire {
		t.Fatal("escalation from Degraded to Unhealthy must not re-fire a notification")
	}
}

func TestComponentHealthTracker_UnknownTransitionsNeverFire(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("redis", resilience.Component{Status: resilience.StatusUnknown}, true)

	if _, fire := tr.Observe("redis", healthyComponent(), true); fire {
		t.Fatal("Unknown -> Healthy must not fire a 'recovery' notification")
	}
}

func TestComponentHealthTracker_UnmappedComponentNeverFires(t *testing.T) {
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("some_future_component", healthyComponent(), true)

	if _, fire := tr.Observe("some_future_component", degradedComponent(3, "boom"), true); fire {
		t.Fatal("a component with no configured event-type mapping must never fire")
	}
}

func TestComponentHealthTracker_NoPhantomRecoveryOnInitialBringUp(t *testing.T) {
	// tesla_api (and worker/redis/telemetry) start life at StatusUnknown
	// and ramp to Degraded before their first-ever success (e.g. no
	// Tesla account connected yet). That ramp must not count as a fired
	// "outage" — so the eventual first Degraded -> Healthy transition
	// (the user finally connects their account) must NOT fire a
	// misleading "recovered" notification for a component that was
	// never actually up and then went down.
	tr := newComponentHealthTracker(componentNotifyCooldown)
	tr.Observe("tesla_api", resilience.Component{Status: resilience.StatusUnknown}, false)
	if _, fire := tr.Observe("tesla_api", degradedComponent(3, "no token yet"), false); fire {
		t.Fatal("Unknown -> Degraded ramp-up must not fire an outage notification")
	}

	if _, fire := tr.Observe("tesla_api", healthyComponent(), false); fire {
		t.Fatal("first-ever Healthy transition after Unknown->Degraded ramp-up must not fire a phantom recovery")
	}

	// But a GENUINE outage/recovery cycle after that must still work.
	if _, fire := tr.Observe("tesla_api", degradedComponent(3, "token expired"), true); !fire {
		t.Fatal("expected a genuine outage to fire after the component was truly healthy")
	}
	evt, fire := tr.Observe("tesla_api", healthyComponent(), true)
	if !fire {
		t.Fatal("expected a genuine recovery to fire after a real fired outage")
	}
	if evt.EventType != EventTeslaAuthRecovery {
		t.Errorf("EventType = %q, want %q", evt.EventType, EventTeslaAuthRecovery)
	}
}

func TestComponentHealthTracker_CooldownSuppressesRepeatOutage(t *testing.T) {
	fakeNow := time.Now()
	tr := newComponentHealthTracker(15 * time.Minute)
	tr.now = func() time.Time { return fakeNow }

	tr.Observe("mqtt", healthyComponent(), true)
	if _, fire := tr.Observe("mqtt", degradedComponent(3, "boom"), true); !fire {
		t.Fatal("expected the first outage transition to fire")
	}

	// Flap back healthy then degraded again within the cooldown window —
	// the second outage in the same direction must be suppressed.
	tr.Observe("mqtt", healthyComponent(), true)
	fakeNow = fakeNow.Add(5 * time.Minute)
	if _, fire := tr.Observe("mqtt", degradedComponent(3, "boom again"), true); fire {
		t.Fatal("repeat outage within the cooldown window must be suppressed")
	}

	// Advance past the cooldown window — the next genuine transition
	// fires again.
	tr.Observe("mqtt", healthyComponent(), true)
	fakeNow = fakeNow.Add(16 * time.Minute)
	if _, fire := tr.Observe("mqtt", degradedComponent(3, "boom a third time"), true); !fire {
		t.Fatal("expected the outage transition to fire again once the cooldown window has passed")
	}
}

func TestComponentHealthTracker_CooldownIsPerDirection(t *testing.T) {
	// An outage notification's cooldown must not suppress the
	// immediately-following recovery notification (different direction,
	// different cooldown key).
	fakeNow := time.Now()
	tr := newComponentHealthTracker(15 * time.Minute)
	tr.now = func() time.Time { return fakeNow }

	tr.Observe("database", healthyComponent(), true)
	if _, fire := tr.Observe("database", degradedComponent(3, "boom"), true); !fire {
		t.Fatal("expected outage to fire")
	}
	fakeNow = fakeNow.Add(30 * time.Second)
	if _, fire := tr.Observe("database", healthyComponent(), true); !fire {
		t.Fatal("expected recovery to fire immediately after outage despite the outage's own cooldown")
	}
}

// --- dispatchComponentNotification -------------------------------------

type fakeChannelSource struct {
	channels []*notificationmodel.NotificationChannel
	listErr  error
	logs     []*notificationmodel.NotificationLog
}

func (f *fakeChannelSource) GetAllChannels(_ context.Context) ([]*notificationmodel.NotificationChannel, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	return f.channels, nil
}

func (f *fakeChannelSource) CreateLog(_ context.Context, l *notificationmodel.NotificationLog) error {
	f.logs = append(f.logs, l)
	return nil
}

type fakePreferenceSource struct {
	// disabled maps "channelID:eventType" to true when that pairing
	// should be treated as opted out. Anything absent defaults enabled,
	// matching dbnotif.NotificationPreferenceRepo.IsEnabled's contract.
	disabled map[string]bool
}

type fakePreferenceListSource struct {
	byChannel map[int64][]*notificationmodel.NotificationPreference
	err       error
}

func (f *fakePreferenceListSource) GetByChannel(_ context.Context, channelID int64) ([]*notificationmodel.NotificationPreference, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byChannel[channelID], nil
}

func (f *fakePreferenceSource) IsEnabled(_ context.Context, channelID int64, eventType string) bool {
	if f.disabled == nil {
		return true
	}
	key := eventTypeKey(channelID, eventType)
	return !f.disabled[key]
}

func eventTypeKey(channelID int64, eventType string) string {
	return fmt.Sprintf("%d:%s", channelID, eventType)
}

func testEvent() componentTransitionEvent {
	return componentTransitionEvent{
		Component: "mqtt",
		EventType: EventMQTTOutage,
		Severity:  "critical",
		Title:     "MQTT Broker is unhealthy",
		Message:   "Component mqtt has 10 consecutive failures.",
	}
}

func TestDispatchComponentNotification_SkipsDisabledChannel(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 1, Type: "webhook", Enabled: false},
	}}
	calls := 0
	publish := func(_ context.Context, _ pahomqtt.Client, _ *notification.Request) error {
		calls++
		return nil
	}
	dispatchComponentNotification(context.Background(), channels, &fakePreferenceSource{}, nil, publish, testEvent())
	if calls != 0 {
		t.Errorf("publish called %d times, want 0 for a disabled channel", calls)
	}
}

func TestDispatchComponentNotification_SkipsPreferenceDisabledChannel(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 1, Type: "webhook", Enabled: true},
		{ID: 2, Type: "discord", Enabled: true},
	}}
	prefs := &fakePreferenceSource{disabled: map[string]bool{
		eventTypeKey(1, EventMQTTOutage): true,
	}}
	var publishedChannelIDs []int64
	publish := func(_ context.Context, _ pahomqtt.Client, req *notification.Request) error {
		publishedChannelIDs = append(publishedChannelIDs, req.ChannelID)
		return nil
	}
	dispatchComponentNotification(context.Background(), channels, prefs, nil, publish, testEvent())
	if len(publishedChannelIDs) != 1 || publishedChannelIDs[0] != 2 {
		t.Errorf("published channel IDs = %v, want [2] (channel 1 opted out of %s)", publishedChannelIDs, EventMQTTOutage)
	}
}

func TestDispatchComponentNotification_MQTTUnavailable_UsesDirectFallbackAndLogs(t *testing.T) {
	// This is the regression test for requirement #3: when the MQTT
	// transport is nil (broker never connected / not configured), the
	// dispatcher must still deliver via the direct fallback (simulated
	// here by a publish func that succeeds unconditionally, mirroring
	// notification.PublishCtx's own nil-transport contract) and must
	// persist a notification_logs row itself, since no async worker
	// will do it for a synchronous dispatch.
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 7, Type: "webhook", Enabled: true},
	}}
	publish := func(_ context.Context, transport pahomqtt.Client, _ *notification.Request) error {
		if transport != nil {
			t.Errorf("expected nil transport to be passed through to publish, got %v", transport)
		}
		return nil // simulates notification.PublishCtx's direct-Send fallback succeeding
	}
	dispatchComponentNotification(context.Background(), channels, &fakePreferenceSource{}, nil, publish, testEvent())

	if len(channels.logs) != 1 {
		t.Fatalf("logs = %d, want 1 (direct-fallback path must self-log since no async worker will)", len(channels.logs))
	}
	if channels.logs[0].Status != "sent" {
		t.Errorf("log status = %q, want %q", channels.logs[0].Status, "sent")
	}
	if channels.logs[0].ChannelID != 7 {
		t.Errorf("log channel_id = %d, want 7", channels.logs[0].ChannelID)
	}
}

func TestDispatchComponentNotification_PublishFailureIsLoggedNotSwallowed(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 3, Type: "webhook", Enabled: true},
	}}
	publish := func(_ context.Context, _ pahomqtt.Client, _ *notification.Request) error {
		return errors.New("upstream 500")
	}
	dispatchComponentNotification(context.Background(), channels, &fakePreferenceSource{}, nil, publish, testEvent())

	if len(channels.logs) != 1 {
		t.Fatalf("logs = %d, want 1 (failure must be recorded, not swallowed)", len(channels.logs))
	}
	if channels.logs[0].Status != "failed" {
		t.Errorf("log status = %q, want %q", channels.logs[0].Status, "failed")
	}
	if channels.logs[0].Error == "" {
		t.Errorf("log error is empty, want the publish error message recorded")
	}
}

func TestDispatchComponentNotification_ChannelListErrorDoesNotPanic(t *testing.T) {
	channels := &fakeChannelSource{listErr: errors.New("db down")}
	calls := 0
	publish := func(_ context.Context, _ pahomqtt.Client, _ *notification.Request) error {
		calls++
		return nil
	}
	dispatchComponentNotification(context.Background(), channels, &fakePreferenceSource{}, nil, publish, testEvent())
	if calls != 0 {
		t.Errorf("publish called %d times, want 0 when the channel list query fails", calls)
	}
}

func TestComponentNotificationCache_UsesExplicitAndCatalogDefaults(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 1, Type: "webhook", Enabled: true},
	}}
	prefs := &fakePreferenceListSource{byChannel: map[int64][]*notificationmodel.NotificationPreference{
		1: {
			{ChannelID: 1, EventType: EventMQTTOutage, Enabled: false},
		},
	}}
	cache := newComponentNotificationCache(channels, prefs)
	if err := cache.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh() error = %v", err)
	}
	if cache.IsEnabled(context.Background(), 1, EventMQTTOutage) {
		t.Fatal("explicit disabled preference resolved enabled")
	}
	if !cache.IsEnabled(context.Background(), 1, EventMQTTRecovery) {
		t.Fatal("missing preference did not use catalog default_enabled=true")
	}
	if cache.IsEnabled(context.Background(), 1, "system.unknown.outage") {
		t.Fatal("unknown event type defaulted enabled")
	}
}

func TestComponentNotificationCache_RetainsSnapshotWhenDatabaseRefreshFails(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 7, Type: "webhook", Enabled: true},
	}}
	cache := newComponentNotificationCache(channels, &fakePreferenceListSource{})
	if err := cache.Refresh(context.Background()); err != nil {
		t.Fatalf("initial Refresh() error = %v", err)
	}

	channels.listErr = errors.New("database unavailable")
	if err := cache.Refresh(context.Background()); err == nil {
		t.Fatal("Refresh() error = nil after database failure")
	}
	cached, err := cache.GetAllChannels(context.Background())
	if err != nil {
		t.Fatalf("GetAllChannels() error = %v", err)
	}
	if len(cached) != 1 || cached[0].ID != 7 {
		t.Fatalf("cached channels = %+v, want channel 7 retained", cached)
	}
}

func TestMQTTHealthError_RequiresFleetTelemetrySubscriber(t *testing.T) {
	tests := []struct {
		name             string
		baseConnected    bool
		pipelineRequired bool
		pipelineHealthy  bool
		wantErr          bool
	}{
		{name: "all connected", baseConnected: true, pipelineRequired: true, pipelineHealthy: true},
		{name: "auxiliary broker disconnected", pipelineRequired: true, pipelineHealthy: true, wantErr: true},
		{name: "pipeline subscriber disconnected", baseConnected: true, pipelineRequired: true, wantErr: true},
		{name: "pipeline not required", baseConnected: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mqttHealthError(tt.baseConnected, tt.pipelineRequired, tt.pipelineHealthy)
			if (err != nil) != tt.wantErr {
				t.Fatalf("mqttHealthError() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
