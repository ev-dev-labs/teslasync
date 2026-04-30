package telemetry

import (
	"sync"
	"testing"
	"time"
)

// ─── Lifecycle: unknown → connecting → streaming ─────────────────────────

func TestUnknown_FirstBatch_TransitionsToConnecting(t *testing.T) {
	f := New(1, "VIN001")
	if f.State() != Unknown {
		t.Fatalf("expected Unknown, got %s", f.State())
	}

	f.RecordBatch(10, "fleet_telemetry")
	if f.State() != Connecting {
		t.Fatalf("expected Connecting, got %s", f.State())
	}
}

func TestConnecting_SecondBatch_TransitionsToStreaming(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(10, "fleet_telemetry") // unknown → connecting
	f.RecordBatch(5, "fleet_telemetry")  // connecting → streaming
	if f.State() != Streaming {
		t.Fatalf("expected Streaming, got %s", f.State())
	}
}

func TestStreaming_AdditionalBatches_StayStreaming(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(10, "fleet_telemetry") // unknown → connecting
	f.RecordBatch(5, "fleet_telemetry")  // connecting → streaming
	f.RecordBatch(3, "fleet_telemetry")  // stays streaming
	f.RecordBatch(7, "fleet_telemetry")  // stays streaming
	if f.State() != Streaming {
		t.Fatalf("expected Streaming, got %s", f.State())
	}
}

// ─── Stale Detection ────────────────────────────────────────────────────

func TestStreaming_StaleTimeout_TransitionsToStale(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(50*time.Millisecond),
		WithOfflineThreshold(200*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry") // unknown → connecting
	f.RecordBatch(5, "fleet_telemetry")  // connecting → streaming

	time.Sleep(60 * time.Millisecond) // exceed stale threshold
	f.CheckTimeouts()

	if f.State() != Stale {
		t.Fatalf("expected Stale, got %s", f.State())
	}
}

func TestConnecting_StaleTimeout_TransitionsToStale(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(50*time.Millisecond),
		WithOfflineThreshold(200*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry") // unknown → connecting

	time.Sleep(60 * time.Millisecond)
	f.CheckTimeouts()

	if f.State() != Stale {
		t.Fatalf("expected Stale, got %s", f.State())
	}
}

// ─── Offline Detection ──────────────────────────────────────────────────

func TestStreaming_OfflineTimeout_TransitionsToDisconnected(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(30*time.Millisecond),
		WithOfflineThreshold(80*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	time.Sleep(90 * time.Millisecond) // exceed offline threshold
	f.CheckTimeouts()

	// offlineThreshold exceeded while streaming — goes directly to disconnected
	if f.State() != Disconnected {
		t.Fatalf("expected Disconnected, got %s", f.State())
	}
}

func TestStale_OfflineTimeout_TransitionsToDisconnected(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(30*time.Millisecond),
		WithOfflineThreshold(100*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	time.Sleep(40 * time.Millisecond)
	f.CheckTimeouts() // streaming → stale

	if f.State() != Stale {
		t.Fatalf("expected Stale after first timeout, got %s", f.State())
	}

	time.Sleep(70 * time.Millisecond) // total > 100ms offline threshold
	f.CheckTimeouts()                 // stale → disconnected

	if f.State() != Disconnected {
		t.Fatalf("expected Disconnected after offline timeout, got %s", f.State())
	}
}

// ─── Reconnection ───────────────────────────────────────────────────────

func TestStale_NewBatch_TransitionsToStreaming(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(30*time.Millisecond),
		WithOfflineThreshold(200*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	time.Sleep(40 * time.Millisecond)
	f.CheckTimeouts() // streaming → stale

	if f.State() != Stale {
		t.Fatalf("expected Stale, got %s", f.State())
	}

	f.RecordBatch(3, "fleet_telemetry") // stale → streaming (reconnected)
	if f.State() != Streaming {
		t.Fatalf("expected Streaming after reconnection, got %s", f.State())
	}
}

func TestDisconnected_NewBatch_TransitionsToStreaming(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(30*time.Millisecond),
		WithOfflineThreshold(60*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	time.Sleep(70 * time.Millisecond)
	f.CheckTimeouts() // streaming → disconnected (exceeds offline threshold)

	if f.State() != Disconnected {
		t.Fatalf("expected Disconnected, got %s", f.State())
	}

	f.RecordBatch(3, "fleet_telemetry") // disconnected → streaming
	if f.State() != Streaming {
		t.Fatalf("expected Streaming after reconnection from disconnected, got %s", f.State())
	}
}

// ─── Polling Detection ──────────────────────────────────────────────────

func TestUnknown_PollingData_TransitionsToPollingOnly(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(5, "fleet_api") // unknown → polling_only
	if f.State() != PollingOnly {
		t.Fatalf("expected PollingOnly, got %s", f.State())
	}
}

func TestPollingOnly_StreamingData_TransitionsToStreaming(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(5, "fleet_api")          // unknown → polling_only
	f.RecordBatch(10, "fleet_telemetry")   // polling_only → streaming
	if f.State() != Streaming {
		t.Fatalf("expected Streaming, got %s", f.State())
	}
}

func TestPollingOnly_MorePollingData_StaysPollingOnly(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(5, "fleet_api")  // unknown → polling_only
	f.RecordBatch(3, "fleet_api")  // stays polling_only (not fleet_telemetry)
	if f.State() != PollingOnly {
		t.Fatalf("expected PollingOnly, got %s", f.State())
	}
}

// ─── CheckTimeouts Edge Cases ───────────────────────────────────────────

func TestCheckTimeouts_UnknownState_NoTransition(t *testing.T) {
	f := New(1, "VIN001", WithStaleThreshold(1*time.Millisecond))
	time.Sleep(5 * time.Millisecond)
	f.CheckTimeouts()
	if f.State() != Unknown {
		t.Fatalf("expected Unknown (no batch ever), got %s", f.State())
	}
}

func TestCheckTimeouts_PollingOnly_NoTransition(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(1*time.Millisecond),
		WithOfflineThreshold(2*time.Millisecond),
	)
	f.RecordBatch(5, "fleet_api") // unknown → polling_only
	time.Sleep(5 * time.Millisecond)
	f.CheckTimeouts()
	if f.State() != PollingOnly {
		t.Fatalf("expected PollingOnly (timeouts don't apply), got %s", f.State())
	}
}

func TestCheckTimeouts_DisconnectedState_NoTransition(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(10*time.Millisecond),
		WithOfflineThreshold(20*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")
	time.Sleep(25 * time.Millisecond)
	f.CheckTimeouts() // streaming → disconnected

	time.Sleep(50 * time.Millisecond)
	f.CheckTimeouts() // should not change
	if f.State() != Disconnected {
		t.Fatalf("expected Disconnected to stay, got %s", f.State())
	}
}

func TestCheckTimeouts_RecentBatch_NoTransition(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(500*time.Millisecond),
		WithOfflineThreshold(1*time.Second),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")
	f.CheckTimeouts() // recent batch, no timeout
	if f.State() != Streaming {
		t.Fatalf("expected Streaming (recent batch), got %s", f.State())
	}
}

// ─── Snapshot ───────────────────────────────────────────────────────────

func TestSnapshot_ContainsExpectedFields(t *testing.T) {
	f := New(1, "VIN001")
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	snap := f.Snapshot()
	if snap["vin"] != "VIN001" {
		t.Fatalf("expected vin=VIN001, got %v", snap["vin"])
	}
	if snap["data_source"] != "fleet_telemetry" {
		t.Fatalf("expected data_source=fleet_telemetry, got %v", snap["data_source"])
	}
	if snap["batch_count"] != int64(2) {
		t.Fatalf("expected batch_count=2, got %v", snap["batch_count"])
	}
	if snap["signal_count"] != int64(15) {
		t.Fatalf("expected signal_count=15, got %v", snap["signal_count"])
	}
}

// ─── VIN Getter ─────────────────────────────────────────────────────────

func TestVIN_ReturnsConfiguredVIN(t *testing.T) {
	f := New(42, "5YJ3E1EA7KF000001")
	if f.VIN() != "5YJ3E1EA7KF000001" {
		t.Fatalf("expected 5YJ3E1EA7KF000001, got %s", f.VIN())
	}
}

// ─── Custom Thresholds ──────────────────────────────────────────────────

func TestCustomThresholds_Respected(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(20*time.Millisecond),
		WithOfflineThreshold(50*time.Millisecond),
	)
	f.RecordBatch(10, "fleet_telemetry")
	f.RecordBatch(5, "fleet_telemetry")

	// 15ms < 20ms stale threshold — should stay streaming
	time.Sleep(15 * time.Millisecond)
	f.CheckTimeouts()
	if f.State() != Streaming {
		t.Fatalf("expected Streaming (within threshold), got %s", f.State())
	}

	// Wait until > 20ms total — should go stale
	time.Sleep(10 * time.Millisecond)
	f.CheckTimeouts()
	if f.State() != Stale {
		t.Fatalf("expected Stale (exceeded custom threshold), got %s", f.State())
	}
}

// ─── Concurrent Safety ─────────────────────────────────────────────────

func TestConcurrent_RecordBatch_Safety(t *testing.T) {
	f := New(1, "VIN001")
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f.RecordBatch(1, "fleet_telemetry")
		}()
	}

	wg.Wait()

	// Should not panic and state should be valid
	state := f.State()
	if !state.IsValid() {
		t.Fatalf("expected valid state, got %s", state)
	}
}

func TestConcurrent_RecordBatch_And_CheckTimeouts(t *testing.T) {
	f := New(1, "VIN001",
		WithStaleThreshold(10*time.Millisecond),
	)
	var wg sync.WaitGroup

	// Simulate concurrent batches and timeout checks
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			f.RecordBatch(1, "fleet_telemetry")
		}()
		go func() {
			defer wg.Done()
			f.CheckTimeouts()
		}()
	}

	wg.Wait()

	state := f.State()
	if !state.IsValid() {
		t.Fatalf("expected valid state after concurrent ops, got %s", state)
	}
}

// ─── Invalid Transitions ────────────────────────────────────────────────

func TestInvalidTransition_NoStateChange(t *testing.T) {
	f := New(1, "VIN001")
	// Unknown state only accepts first_batch and polling_detected triggers.
	// Sending reconnected should be a no-op.
	f.mu.Lock()
	f.transition(TriggerReconnected)
	f.mu.Unlock()

	if f.State() != Unknown {
		t.Fatalf("expected Unknown (invalid transition), got %s", f.State())
	}
}

// ─── StateEnteredAt ─────────────────────────────────────────────────────

func TestStateEnteredAt_UpdatesOnTransition(t *testing.T) {
	f := New(1, "VIN001")
	initialTime := f.StateEnteredAt()

	time.Sleep(5 * time.Millisecond)
	f.RecordBatch(10, "fleet_telemetry") // unknown → connecting

	connectingTime := f.StateEnteredAt()
	if !connectingTime.After(initialTime) {
		t.Fatalf("expected stateEnteredAt to advance after transition")
	}

	time.Sleep(5 * time.Millisecond)
	f.RecordBatch(5, "fleet_telemetry") // connecting → streaming

	streamingTime := f.StateEnteredAt()
	if !streamingTime.After(connectingTime) {
		t.Fatalf("expected stateEnteredAt to advance again after second transition")
	}
}

// ─── IsStale ────────────────────────────────────────────────────────────

func TestIsStale_ReturnsCorrectly(t *testing.T) {
	tests := []struct {
		name     string
		setup    func(*ConnectionFSM)
		expected bool
	}{
		{
			name:     "unknown state",
			setup:    func(f *ConnectionFSM) {},
			expected: false,
		},
		{
			name: "streaming state",
			setup: func(f *ConnectionFSM) {
				f.RecordBatch(10, "fleet_telemetry")
				f.RecordBatch(5, "fleet_telemetry")
			},
			expected: false,
		},
		{
			name: "stale state",
			setup: func(f *ConnectionFSM) {
				f.RecordBatch(10, "fleet_telemetry")
				f.RecordBatch(5, "fleet_telemetry")
				time.Sleep(15 * time.Millisecond)
				f.CheckTimeouts()
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := New(1, "VIN001",
				WithStaleThreshold(10*time.Millisecond),
				WithOfflineThreshold(100*time.Millisecond),
			)
			tt.setup(f)
			if got := f.IsStale(); got != tt.expected {
				t.Fatalf("IsStale() = %v, want %v (state=%s)", got, tt.expected, f.State())
			}
		})
	}
}

// ─── Transition Table Completeness ──────────────────────────────────────

func TestLookupTransition_AllValidPaths(t *testing.T) {
	tests := []struct {
		from    State
		trigger Trigger
		want    State
	}{
		{Unknown, TriggerFirstBatch, Connecting},
		{Unknown, TriggerPollingDetected, PollingOnly},
		{Connecting, TriggerBatchReceived, Streaming},
		{Connecting, TriggerStaleTimeout, Stale},
		{Connecting, TriggerOfflineTimeout, Disconnected},
		{Streaming, TriggerStaleTimeout, Stale},
		{Streaming, TriggerOfflineTimeout, Disconnected},
		{Stale, TriggerReconnected, Streaming},
		{Stale, TriggerOfflineTimeout, Disconnected},
		{Disconnected, TriggerReconnected, Streaming},
		{PollingOnly, TriggerStreamingResumed, Streaming},
	}

	for _, tt := range tests {
		t.Run(string(tt.from)+"_"+string(tt.trigger), func(t *testing.T) {
			got := LookupTransition(tt.from, tt.trigger)
			if got != tt.want {
				t.Fatalf("LookupTransition(%s, %s) = %s, want %s", tt.from, tt.trigger, got, tt.want)
			}
		})
	}
}

func TestLookupTransition_InvalidPaths_ReturnEmpty(t *testing.T) {
	tests := []struct {
		from    State
		trigger Trigger
	}{
		{Unknown, TriggerBatchReceived},
		{Unknown, TriggerReconnected},
		{Unknown, TriggerStaleTimeout},
		{Streaming, TriggerFirstBatch},
		{Streaming, TriggerReconnected},
		{Disconnected, TriggerStaleTimeout},
		{PollingOnly, TriggerBatchReceived},
	}

	for _, tt := range tests {
		t.Run(string(tt.from)+"_"+string(tt.trigger), func(t *testing.T) {
			got := LookupTransition(tt.from, tt.trigger)
			if got != "" {
				t.Fatalf("LookupTransition(%s, %s) = %s, want empty (invalid)", tt.from, tt.trigger, got)
			}
		})
	}
}
