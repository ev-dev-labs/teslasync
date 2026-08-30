package chaos

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Test the Toxiproxy admin client against an httptest fake to keep
// the test self-contained (no external Toxiproxy required).

func TestClient_AddToxic_HappyPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("want POST, got %s", r.Method)
		}
		if r.URL.Path != "/proxies/mqtt/toxics" {
			t.Errorf("want /proxies/mqtt/toxics, got %s", r.URL.Path)
		}
		var t1 Toxic
		if err := json.NewDecoder(r.Body).Decode(&t1); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if t1.Name != "test" || t1.Type != "latency" {
			t.Errorf("payload not preserved: %+v", t1)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	err := c.AddToxic(context.Background(), "mqtt", Toxic{
		Name: "test",
		Type: "latency",
		Attributes: map[string]interface{}{
			"latency": 100,
		},
	})
	if err != nil {
		t.Fatalf("AddToxic: %v", err)
	}
}

func TestClient_AddToxic_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"duplicate toxic"}`))
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	err := c.AddToxic(context.Background(), "mqtt", Toxic{Name: "x", Type: "latency"})
	if err == nil {
		t.Fatal("expected error on 409, got nil")
	}
}

func TestClient_RemoveToxic_404IsIdempotent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	if err := c.RemoveToxic(context.Background(), "mqtt", "missing"); err != nil {
		t.Fatalf("404 should be swallowed, got: %v", err)
	}
}

func TestScenario_Run_RemovesToxicEvenOnContextCancel(t *testing.T) {
	var addCalled, removeCalled bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			addCalled = true
			w.WriteHeader(http.StatusOK)
		case http.MethodDelete:
			removeCalled = true
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	s := Scenario{
		Name:     "test",
		Proxy:    "mqtt",
		Duration: 1 * time.Hour,
		Toxic:    Toxic{Name: "t", Type: "latency"},
	}
	err := s.Run(ctx, c)
	if err == nil {
		t.Fatal("expected context.DeadlineExceeded")
	}
	if !addCalled {
		t.Error("AddToxic was not called")
	}
	if !removeCalled {
		t.Error("RemoveToxic was not called on cleanup")
	}
}

func TestScenario_RunRemovesToxicBeforeSettleAndVerify(t *testing.T) {
	var events []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			events = append(events, "add")
		case http.MethodDelete:
			events = append(events, "remove")
		default:
			t.Errorf("unexpected method %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	scenario := Scenario{
		Name:        "recovery-order",
		Proxy:       "redis",
		Duration:    time.Millisecond,
		SettleDelay: time.Millisecond,
		Toxic:       Toxic{Name: "blackhole", Type: "timeout"},
		Verify: func(context.Context) error {
			events = append(events, "verify")
			return nil
		},
	}
	if err := scenario.Run(context.Background(), NewClient(srv.URL)); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	want := []string{"add", "remove", "verify"}
	if len(events) != len(want) {
		t.Fatalf("events = %v, want %v", events, want)
	}
	for i := range want {
		if events[i] != want[i] {
			t.Fatalf("events = %v, want %v", events, want)
		}
	}
}

func TestScenario_Run_RejectsInvalidConfig(t *testing.T) {
	c := NewClient("http://127.0.0.1:1")
	s := Scenario{Name: "x"}
	if err := s.Run(context.Background(), c); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestDefaultScenarios_AllValid(t *testing.T) {
	for _, s := range DefaultScenarios() {
		if s.Name == "" || s.Proxy == "" || s.Toxic.Name == "" || s.Duration <= 0 {
			t.Errorf("invalid default scenario: %+v", s)
		}
	}
}
