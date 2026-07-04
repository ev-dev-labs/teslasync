package worker

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

var (
	hbStarted = time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	hbBeat    = time.Date(2026, 6, 1, 9, 5, 30, 0, time.UTC)
)

// newRedisStore stands up an in-memory miniredis and returns a store bound to
// a real go-redis client — exercising the actual Set/MGet wire paths. The
// client and server are torn down via t.Cleanup.
func newRedisStore(t *testing.T) (*RedisWorkerStatusStore, *redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return NewRedisWorkerStatusStore(rdb), rdb, mr
}

// ─── package constants ─────────────────────────────────────────────

func TestKnownWorkerNames(t *testing.T) {
	t.Parallel()
	want := []string{WorkerNameNotification, WorkerNameExport, WorkerNameAutomation}
	if len(KnownWorkerNames) != len(want) {
		t.Fatalf("KnownWorkerNames len = %d, want %d", len(KnownWorkerNames), len(want))
	}
	for i, w := range want {
		if KnownWorkerNames[i] != w {
			t.Errorf("KnownWorkerNames[%d] = %q, want %q", i, KnownWorkerNames[i], w)
		}
	}
	if WorkerNameNotification != "notification" || WorkerNameExport != "export" || WorkerNameAutomation != "automation" {
		t.Errorf("worker name constants drifted: %q %q %q", WorkerNameNotification, WorkerNameExport, WorkerNameAutomation)
	}
}

// ─── WorkerHeartbeat JSON shape ────────────────────────────────────

func TestWorkerHeartbeat_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	in := WorkerHeartbeat{
		Worker:          WorkerNameExport,
		Host:            "worker-7",
		PID:             4242,
		Version:         "1.9.0",
		StartedAt:       hbStarted,
		LastHeartbeatAt: hbBeat,
	}
	raw, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out WorkerHeartbeat
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out.Worker != in.Worker || out.Host != in.Host || out.PID != in.PID || out.Version != in.Version {
		t.Errorf("scalar mismatch: %+v", out)
	}
	if !out.StartedAt.Equal(in.StartedAt) || !out.LastHeartbeatAt.Equal(in.LastHeartbeatAt) {
		t.Errorf("time mismatch: %+v", out)
	}
}

func TestWorkerHeartbeat_OmitemptyFields(t *testing.T) {
	t.Parallel()
	// Only required fields set; host/pid/version must be omitted from the wire.
	raw, err := json.Marshal(WorkerHeartbeat{Worker: "notification", LastHeartbeatAt: hbBeat})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(raw)
	for _, absent := range []string{`"host"`, `"pid"`, `"version"`} {
		if contains(s, absent) {
			t.Errorf("expected %s to be omitted, got %s", absent, s)
		}
	}
	// worker + last_heartbeat_at are always present.
	if !contains(s, `"worker"`) || !contains(s, `"last_heartbeat_at"`) {
		t.Errorf("required fields missing from %s", s)
	}
}

// ─── shared contract: run against BOTH implementations ─────────────

func storeFactories() []struct {
	name string
	make func(t *testing.T) WorkerStatusStore
} {
	return []struct {
		name string
		make func(t *testing.T) WorkerStatusStore
	}{
		{"redis", func(t *testing.T) WorkerStatusStore { s, _, _ := newRedisStore(t); return s }},
		{"memory", func(t *testing.T) WorkerStatusStore { return NewMemoryWorkerStatusStore() }},
	}
}

func TestStore_RecordThenGet(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			ctx := context.Background()
			hb := WorkerHeartbeat{Worker: WorkerNameNotification, Host: "h1", PID: 11, Version: "2.0", StartedAt: hbStarted, LastHeartbeatAt: hbBeat}
			if err := s.RecordHeartbeat(ctx, hb); err != nil {
				t.Fatalf("RecordHeartbeat: %v", err)
			}
			got, err := s.GetMany(ctx, []string{WorkerNameNotification})
			if err != nil {
				t.Fatalf("GetMany: %v", err)
			}
			g, ok := got[WorkerNameNotification]
			if !ok || g == nil {
				t.Fatalf("missing heartbeat for %s", WorkerNameNotification)
			}
			if g.Host != "h1" || g.PID != 11 || g.Version != "2.0" {
				t.Errorf("provenance mismatch: %+v", g)
			}
			if !g.StartedAt.Equal(hbStarted) || !g.LastHeartbeatAt.Equal(hbBeat) {
				t.Errorf("time mismatch: %+v", g)
			}
		})
	}
}

func TestStore_EmptyWorkerRejected(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			err := s.RecordHeartbeat(context.Background(), WorkerHeartbeat{Worker: "", LastHeartbeatAt: hbBeat})
			if !errors.Is(err, ErrWorkerNameRequired) {
				t.Fatalf("err = %v, want ErrWorkerNameRequired", err)
			}
		})
	}
}

func TestStore_ZeroTimestampDefaulted(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			ctx := context.Background()
			before := time.Now().Add(-time.Second)
			// LastHeartbeatAt left zero -> store stamps it with now().
			if err := s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameExport, StartedAt: hbStarted}); err != nil {
				t.Fatalf("RecordHeartbeat: %v", err)
			}
			got, err := s.GetMany(ctx, []string{WorkerNameExport})
			if err != nil {
				t.Fatalf("GetMany: %v", err)
			}
			g := got[WorkerNameExport]
			if g == nil {
				t.Fatal("missing heartbeat")
			}
			if g.LastHeartbeatAt.IsZero() {
				t.Fatal("LastHeartbeatAt was not defaulted")
			}
			if g.LastHeartbeatAt.Before(before) {
				t.Errorf("LastHeartbeatAt %v predates test start %v", g.LastHeartbeatAt, before)
			}
			if !g.StartedAt.Equal(hbStarted) {
				t.Errorf("StartedAt should be preserved, got %v", g.StartedAt)
			}
		})
	}
}

func TestStore_Overwrite(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			ctx := context.Background()
			_ = s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameAutomation, Version: "old", LastHeartbeatAt: hbBeat})
			_ = s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameAutomation, Version: "new", LastHeartbeatAt: hbBeat.Add(time.Minute)})
			got, err := s.GetMany(ctx, []string{WorkerNameAutomation})
			if err != nil {
				t.Fatalf("GetMany: %v", err)
			}
			if g := got[WorkerNameAutomation]; g == nil || g.Version != "new" {
				t.Errorf("overwrite failed, got %+v", g)
			}
		})
	}
}

func TestStore_GetManyMissingAbsent(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			ctx := context.Background()
			// Only notification recorded; ask for all three.
			if err := s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameNotification, LastHeartbeatAt: hbBeat}); err != nil {
				t.Fatalf("RecordHeartbeat: %v", err)
			}
			got, err := s.GetMany(ctx, KnownWorkerNames)
			if err != nil {
				t.Fatalf("GetMany: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("len(got) = %d, want 1 (missing workers are absent, not zero-valued)", len(got))
			}
			if _, ok := got[WorkerNameNotification]; !ok {
				t.Error("recorded worker missing from result")
			}
			for _, missing := range []string{WorkerNameExport, WorkerNameAutomation} {
				if _, ok := got[missing]; ok {
					t.Errorf("never-recorded worker %q should be absent", missing)
				}
			}
		})
	}
}

func TestStore_GetManyEmptyList(t *testing.T) {
	t.Parallel()
	for _, tc := range storeFactories() {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := tc.make(t)
			got, err := s.GetMany(context.Background(), nil)
			if err != nil {
				t.Fatalf("GetMany(nil) err = %v", err)
			}
			if len(got) != 0 {
				t.Errorf("GetMany(nil) = %v, want empty map", got)
			}
		})
	}
}

// ─── Redis-specific behaviour ──────────────────────────────────────

func TestRedisStore_PoisonedKeySkipped(t *testing.T) {
	t.Parallel()
	s, _, mr := newRedisStore(t)
	ctx := context.Background()
	// Write a valid heartbeat and a garbage value directly under the export key.
	if err := s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameNotification, LastHeartbeatAt: hbBeat}); err != nil {
		t.Fatalf("RecordHeartbeat: %v", err)
	}
	if err := mr.Set(workerStatusKeyPrefix+WorkerNameExport, "}{ not json"); err != nil {
		t.Fatalf("seed poison: %v", err)
	}
	got, err := s.GetMany(ctx, []string{WorkerNameNotification, WorkerNameExport})
	if err != nil {
		t.Fatalf("GetMany: %v", err)
	}
	if _, ok := got[WorkerNameNotification]; !ok {
		t.Error("valid heartbeat should survive alongside a poisoned key")
	}
	if _, ok := got[WorkerNameExport]; ok {
		t.Error("poisoned key should be skipped, not surfaced")
	}
}

func TestRedisStore_RecordError(t *testing.T) {
	t.Parallel()
	s, rdb, _ := newRedisStore(t)
	_ = rdb.Close() // force the SET to fail
	err := s.RecordHeartbeat(context.Background(), WorkerHeartbeat{Worker: WorkerNameNotification, LastHeartbeatAt: hbBeat})
	if err == nil {
		t.Fatal("expected error when redis client is closed")
	}
	if !contains(err.Error(), "worker_status: set heartbeat") {
		t.Errorf("error missing context: %v", err)
	}
}

func TestRedisStore_GetManyError(t *testing.T) {
	t.Parallel()
	s, rdb, _ := newRedisStore(t)
	_ = rdb.Close() // force the MGET to fail
	_, err := s.GetMany(context.Background(), []string{WorkerNameNotification})
	if err == nil {
		t.Fatal("expected error when redis client is closed")
	}
	if !contains(err.Error(), "worker_status: mget heartbeats") {
		t.Errorf("error missing context: %v", err)
	}
}

func TestNewRedisWorkerStatusStore(t *testing.T) {
	t.Parallel()
	s, rdb, _ := newRedisStore(t)
	if s == nil || s.rdb != rdb {
		t.Fatal("NewRedisWorkerStatusStore did not retain the provided client")
	}
}

// ─── Memory-specific behaviour ─────────────────────────────────────

func TestMemoryStore_GetManyReturnsCopies(t *testing.T) {
	t.Parallel()
	s := NewMemoryWorkerStatusStore()
	ctx := context.Background()
	if err := s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: WorkerNameNotification, Host: "original", LastHeartbeatAt: hbBeat}); err != nil {
		t.Fatalf("RecordHeartbeat: %v", err)
	}
	got, _ := s.GetMany(ctx, []string{WorkerNameNotification})
	got[WorkerNameNotification].Host = "mutated" // caller mutation must not leak back

	again, _ := s.GetMany(ctx, []string{WorkerNameNotification})
	if again[WorkerNameNotification].Host != "original" {
		t.Errorf("internal state leaked to caller: Host = %q, want original", again[WorkerNameNotification].Host)
	}
}

func TestMemoryStore_Concurrent(t *testing.T) {
	t.Parallel()
	s := NewMemoryWorkerStatusStore()
	ctx := context.Background()
	const goroutines = 16
	const iterations = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := 0; g < goroutines; g++ {
		go func(id int) {
			defer wg.Done()
			worker := KnownWorkerNames[id%len(KnownWorkerNames)]
			for i := 0; i < iterations; i++ {
				if err := s.RecordHeartbeat(ctx, WorkerHeartbeat{Worker: worker, PID: id, LastHeartbeatAt: hbBeat}); err != nil {
					t.Errorf("RecordHeartbeat: %v", err)
					return
				}
				if _, err := s.GetMany(ctx, KnownWorkerNames); err != nil {
					t.Errorf("GetMany: %v", err)
					return
				}
			}
		}(g)
	}
	wg.Wait()

	// After the storm every worker must have exactly one snapshot present.
	got, err := s.GetMany(ctx, KnownWorkerNames)
	if err != nil {
		t.Fatalf("final GetMany: %v", err)
	}
	if len(got) != len(KnownWorkerNames) {
		t.Errorf("final snapshot count = %d, want %d", len(got), len(KnownWorkerNames))
	}
}
