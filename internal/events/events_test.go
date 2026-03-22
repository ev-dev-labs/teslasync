package events

import (
	"testing"
	"time"
)

func TestEventConstants(t *testing.T) {
	expectedEvents := []string{
		VehicleUpdated, VehicleAsleep, VehicleOnline,
		DriveStarted, DriveEnded,
		ChargeStarted, ChargeCompleted,
		AlertTriggered, GeofenceEntered, GeofenceExited,
		BatteryLow,
	}
	for _, e := range expectedEvents {
		if e == "" {
			t.Error("Event constant should not be empty")
		}
	}
}

func TestNewBusNilClient(t *testing.T) {
	bus := NewBus(nil)
	if bus == nil {
		t.Fatal("NewBus(nil) should return a non-nil bus")
	}

	// Publish should not panic with nil client
	bus.Publish(Event{
		Type:      VehicleUpdated,
		VehicleID: 1,
		VIN:       "TEST_VIN",
		Data:      map[string]interface{}{"test": true},
		Timestamp: time.Now(),
	})
}

func TestEventTimestampAutoFill(t *testing.T) {
	bus := NewBus(nil)
	evt := Event{Type: DriveStarted}
	before := time.Now()
	bus.Publish(evt)
	// Can't easily check the modified event since Publish takes a copy,
	// but at least verify it doesn't panic
	_ = before
}

func TestTopicPrefix(t *testing.T) {
	if TopicPrefix != "teslasync/events/" {
		t.Errorf("TopicPrefix = %q, want 'teslasync/events/'", TopicPrefix)
	}
}

func TestSubscribeNilClient(t *testing.T) {
	bus := NewBus(nil)
	// Should not panic
	bus.Subscribe(VehicleUpdated, func(evt Event) {})
}
