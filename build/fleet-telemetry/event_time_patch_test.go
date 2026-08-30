//go:build fleettelemetry_patch

package mqtt

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestTeslaSyncMQTTEventTimeEnvelope(t *testing.T) {
	eventTime := time.Date(2026, time.August, 20, 7, 8, 9, 123456789, time.UTC)
	payload := &protos.Payload{CreatedAt: timestamppb.New(eventTime)}

	body, err := marshalVehicleField(float32(72.5), payload)
	if err != nil {
		t.Fatalf("marshalVehicleField: %v", err)
	}

	var envelope struct {
		Value float64 `json:"value"`
		TS    string  `json:"ts"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if envelope.Value != 72.5 {
		t.Fatalf("value = %v, want 72.5", envelope.Value)
	}
	if envelope.TS != eventTime.Format(time.RFC3339Nano) {
		t.Fatalf("ts = %q, want %q", envelope.TS, eventTime.Format(time.RFC3339Nano))
	}

	body, err = marshalVehicleField(nil, &protos.Payload{})
	if err != nil {
		t.Fatalf("marshalVehicleField without timestamp: %v", err)
	}
	if string(body) != `{"value":null}` {
		t.Fatalf("body without timestamp = %s, want value-only envelope", body)
	}
}
