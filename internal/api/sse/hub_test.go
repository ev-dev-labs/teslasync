package sse

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestEventHub_SubscribeAndBroadcast(t *testing.T) {
	hub := NewEventHub()

	ch, unsub := hub.Subscribe("test-client")
	defer unsub()

	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}

	hub.Broadcast("update", map[string]string{"msg": "hello"})

	select {
	case msg := <-ch:
		s := string(msg)
		if !strings.Contains(s, "event: update") {
			t.Errorf("expected event type 'update' in message, got %q", s)
		}
		if !strings.Contains(s, "hello") {
			t.Errorf("expected 'hello' in message, got %q", s)
		}
	default:
		t.Error("expected to receive a broadcast message")
	}
}

func TestEventHub_Unsubscribe(t *testing.T) {
	hub := NewEventHub()

	_, unsub := hub.Subscribe("test-client")
	if hub.ClientCount() != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount())
	}

	unsub()
	if hub.ClientCount() != 0 {
		t.Errorf("expected 0 clients after unsubscribe, got %d", hub.ClientCount())
	}
}

func TestEventHub_MultipleClients(t *testing.T) {
	hub := NewEventHub()

	ch1, unsub1 := hub.Subscribe("client-1")
	defer unsub1()
	ch2, unsub2 := hub.Subscribe("client-2")
	defer unsub2()

	if hub.ClientCount() != 2 {
		t.Fatalf("expected 2 clients, got %d", hub.ClientCount())
	}

	hub.Broadcast("ping", map[string]bool{"ok": true})

	for _, ch := range []<-chan []byte{ch1, ch2} {
		select {
		case msg := <-ch:
			if !strings.Contains(string(msg), "event: ping") {
				t.Errorf("expected ping event, got %q", string(msg))
			}
		default:
			t.Error("client did not receive broadcast")
		}
	}
}

func TestEventHub_SignalChangeSequenceAndStreamEpoch(t *testing.T) {
	hub := NewEventHub()
	ch, unsub := hub.Subscribe("sequenced-client")
	defer unsub()

	at := time.Date(2026, time.August, 27, 12, 0, 0, 0, time.UTC)
	hub.BroadcastSignalChange(7, "VehicleSpeed", &signal.Value{Raw: float32(12.5), Timestamp: at})
	hub.BroadcastSignalChange(7, "BatteryLevel", &signal.Value{Raw: float32(72), Timestamp: at})

	first := readSignalChange(t, ch)
	second := readSignalChange(t, ch)
	if first.StreamID == "" {
		t.Fatal("first stream_id is empty")
	}
	if first.StreamID != hub.StreamID() || second.StreamID != first.StreamID {
		t.Fatalf("stream ids = %q, %q; hub = %q", first.StreamID, second.StreamID, hub.StreamID())
	}
	if first.Sequence != 1 || second.Sequence != 2 {
		t.Fatalf("sequences = %d, %d; want 1, 2", first.Sequence, second.Sequence)
	}

	restarted := NewEventHub()
	if restarted.StreamID() == hub.StreamID() {
		t.Fatal("new hub reused the prior stream epoch")
	}
	restartedCh, restartedUnsub := restarted.Subscribe("restarted-client")
	defer restartedUnsub()
	restarted.BroadcastSignalChange(7, "VehicleSpeed", &signal.Value{Raw: float32(13), Timestamp: at})
	if got := readSignalChange(t, restartedCh); got.Sequence != 1 {
		t.Fatalf("restarted sequence = %d, want 1", got.Sequence)
	}
}

func readSignalChange(t *testing.T, ch <-chan []byte) SignalChangeEvent {
	t.Helper()
	select {
	case msg := <-ch:
		const prefix = "data: "
		start := strings.Index(string(msg), prefix)
		if start < 0 {
			t.Fatalf("SSE frame has no data line: %q", msg)
		}
		raw := strings.TrimSpace(string(msg)[start+len(prefix):])
		var event SignalChangeEvent
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			t.Fatalf("decode signal-change frame: %v", err)
		}
		return event
	default:
		t.Fatal("expected signal-change frame")
		return SignalChangeEvent{}
	}
}
