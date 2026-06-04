package sse

import (
	"strings"
	"testing"
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
