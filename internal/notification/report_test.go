package notification

import (
	"context"
	"errors"
	"testing"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
)

type eventStoreFake struct {
	events []*notificationmodel.NotificationLog
	err    error
}

func (f *eventStoreFake) CreateEvent(_ context.Context, event *notificationmodel.NotificationLog) error {
	if f.err != nil {
		return f.err
	}
	f.events = append(f.events, event)
	return nil
}

func TestRecordTriggerOneEventTwoChannelDeliveries(t *testing.T) {
	store := &eventStoreFake{}
	triggerID := NewTriggerID()
	event, err := RecordTrigger(context.Background(), store, &Request{
		Title: "Battery", Message: "Warning", Severity: "warn",
		AlertID: 17, EventType: "alert.rule", TriggerID: triggerID,
	})
	if err != nil || len(store.events) != 1 || event.ChannelID != 0 || event.Status != "triggered" {
		t.Fatalf("event=%+v stored=%d error=%v", event, len(store.events), err)
	}
	channels := []*Request{
		{ChannelID: 1, TriggerID: triggerID, EventType: "alert.rule"},
		{ChannelID: 2, TriggerID: triggerID, EventType: "alert.rule"},
	}
	deliveries := make([]*notificationmodel.NotificationLog, 0, len(channels))
	for _, req := range channels {
		row := &notificationmodel.NotificationLog{ChannelID: req.ChannelID, Status: "sent"}
		applyRequestMetadata(row, req)
		deliveries = append(deliveries, row)
	}
	if len(store.events) != 1 || len(deliveries) != 2 ||
		*deliveries[0].TriggerID != *event.TriggerID ||
		*deliveries[1].TriggerID != *event.TriggerID {
		t.Fatalf("expected one event and two correlated deliveries: %+v %+v", store.events, deliveries)
	}
}

func TestRecordTriggerSurfacesPersistenceFailure(t *testing.T) {
	if _, err := RecordTrigger(context.Background(), &eventStoreFake{err: errors.New("db down")},
		&Request{TriggerID: NewTriggerID(), EventType: "system.mqtt.outage"}); err == nil {
		t.Fatal("event insertion failure must be returned")
	}
}

func TestSourceFor(t *testing.T) {
	for _, tc := range []struct{ eventType, source string }{
		{"", "unknown"},
		{"alert.rule", "alert"},
		{"alert.computed_metric", "alert"},
		{"system.mqtt.outage", "system"},
		{"schedule.due", "schedule"},
		{"automation.notify", "automation"},
		{"test.channel", "test"},
		{"digest.weekly", "other"},
	} {
		if got := SourceFor(tc.eventType); got != tc.source {
			t.Errorf("SourceFor(%q) = %q, want %q", tc.eventType, got, tc.source)
		}
	}
}

func TestTriggerMetadataSharedAcrossChannels(t *testing.T) {
	id := NewTriggerID()
	first := &Request{ChannelID: 1, TriggerID: id, EventType: "system.mqtt.outage"}
	second := &Request{ChannelID: 2, TriggerID: id, EventType: "system.mqtt.outage"}
	var logs []*notificationmodel.NotificationLog
	for _, req := range []*Request{first, second} {
		entry := &notificationmodel.NotificationLog{ChannelID: req.ChannelID}
		applyRequestMetadata(entry, req)
		logs = append(logs, entry)
	}
	if *logs[0].TriggerID != *logs[1].TriggerID || logs[0].ChannelID == logs[1].ChannelID {
		t.Fatal("two channel deliveries must share one trigger")
	}
	legacy := &notificationmodel.NotificationLog{}
	applyRequestMetadata(legacy, &Request{})
	if legacy.TriggerID != nil || legacy.EventType != nil {
		t.Fatal("legacy metadata must remain unknown, not synthesized")
	}
}
