package sse

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// OPS-09 — SSE behaviour under shutdown / draining.
//
// SSE connections are long-lived by design (the API server deliberately
// runs with WriteTimeout: 0 for them). That makes them the single
// biggest risk to a bounded graceful shutdown: if the handler does not
// return when the request context is cancelled, http.Server.Shutdown
// blocks until its grace budget expires and every connection is then
// force-closed instead of being told to reconnect.
//
// These tests pin the two properties the drain path depends on:
//  1. the handler returns promptly when the request context is cancelled
//     (which is what Server.Shutdown does to active handlers), and
//  2. the hub unsubscribes the client, so a drained pod leaks neither a
//     goroutine nor a channel.

func TestSSEHandler_ReturnsWhenRequestContextIsCancelled(t *testing.T) {
	hub := NewEventHub()
	handler := SSEHandler(hub)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		handler(rec, req)
	}()

	// Wait for the client to register before cancelling, so the test is
	// exercising the cancellation path rather than a race with setup.
	waitForClientCount(t, hub, 1)

	cancel()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("SSE handler did not return after request-context cancellation; http.Server.Shutdown would block for its whole grace budget")
	}

	waitForClientCount(t, hub, 0)
}

func TestSSEHandler_NegotiatesStreamHeadersAndSendsConnectedEvent(t *testing.T) {
	hub := NewEventHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		defer close(done)
		SSEHandler(hub)(rec, req)
	}()
	waitForClientCount(t, hub, 1)
	cancel()
	<-done

	if got := rec.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q, want text/event-stream", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", got)
	}
	// X-Accel-Buffering: no is what stops nginx from buffering the
	// stream; without it the SPA sees nothing until the pod drains.
	if got := rec.Header().Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("X-Accel-Buffering = %q, want no", got)
	}
	if !strings.Contains(rec.Body.String(), "event: connected") {
		t.Fatalf("stream did not open with a connected event: %q", rec.Body.String())
	}
}

// TestSSEHandler_DrainSignalReleasesStreamPromptly is the regression
// test for the shutdown-blocking bug: http.Server.Shutdown does not
// cancel in-flight handler contexts, so without an explicit drain signal
// an attached SSE client keeps the shutdown pending for the whole grace
// budget and is then severed abruptly.
func TestSSEHandler_DrainSignalReleasesStreamPromptly(t *testing.T) {
	hub := NewEventHub()
	drain := make(chan struct{})
	srv := httptest.NewServer(SSEHandler(hub, WithDrainSignal(drain)))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read connected event: %v", err)
	}
	if !strings.Contains(line, "connected") {
		t.Fatalf("first line = %q, want the connected event", line)
	}

	// preStop fires: the readiness gate drains.
	close(drain)

	// The client must be told the stream is ending on purpose, so the
	// SPA reconnects deliberately instead of reporting a network error.
	sawShutdown := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		l, rerr := reader.ReadString('\n')
		if strings.Contains(l, "event: shutdown") {
			sawShutdown = true
		}
		if rerr != nil {
			break
		}
	}
	if !sawShutdown {
		t.Fatal("drained stream did not emit an `event: shutdown` frame")
	}

	// And the server must now drain far inside its grace budget.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	start := time.Now()
	if err := srv.Config.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("shutdown with a drained SSE client returned %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("shutdown took %s with a drained SSE client; the drain signal is not being honoured", elapsed)
	}
}

// TestSSEHandler_WithoutDrainSignalShutdownIsBounded documents the
// behaviour the drain signal exists to avoid: with no signal, the
// handler blocks until the client goes away or the grace budget is
// exhausted. The test asserts the documented (bad) behaviour so that a
// future change to net/http or to the handler is noticed rather than
// silently changing the drain contract.
func TestSSEHandler_WithoutDrainSignalShutdownWaitsForTheClient(t *testing.T) {
	hub := NewEventHub()
	srv := httptest.NewServer(SSEHandler(hub))
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	reader := bufio.NewReader(resp.Body)
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatalf("read connected event: %v", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	err = srv.Config.Shutdown(shutdownCtx)
	resp.Body.Close()

	if err == nil {
		t.Fatal("expected Shutdown to hit its deadline while an un-drained SSE client is attached; if this now passes, the drain contract changed and internal/api must be revisited")
	}
	waitForClientCount(t, hub, 0)
}

func waitForClientCount(t *testing.T, hub *EventHub, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if hub.ClientCount() == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("hub client count = %d, want %d", hub.ClientCount(), want)
}
