package app

import (
	"context"
	"testing"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

func TestEventRuleDeliveryPersistsAlertIDAndEventType(t *testing.T) {
	channels := &fakeChannelSource{channels: []*notificationmodel.NotificationChannel{
		{ID: 1, Type: "webhook", Enabled: true},
		{ID: 2, Type: "discord", Enabled: true},
	}}
	event := componentTransitionEvent{
		Component: "place", EventType: "place.exit", Title: "Left", Message: "Exited",
		Severity: "warn", AlertID: 73, ChannelIDs: []int64{2},
	}
	var published []*notification.Request
	dispatchComponentNotification(context.Background(), channels, nil, nil,
		func(_ context.Context, _ pahomqtt.Client, req *notification.Request) error {
			published = append(published, req)
			return nil
		}, event)
	if len(published) != 1 || published[0].ChannelID != 2 || published[0].AlertID != 73 ||
		published[0].EventType != "place.exit" || len(channels.logs) != 1 ||
		channels.logs[0].AlertID == nil || *channels.logs[0].AlertID != 73 ||
		len(channels.events) != 1 || channels.events[0].AlertID == nil || *channels.events[0].AlertID != 73 {
		t.Fatalf("event attribution lost: requests=%+v events=%+v logs=%+v", published, channels.events, channels.logs)
	}
}
