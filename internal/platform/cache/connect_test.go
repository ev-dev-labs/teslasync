package cache

import (
	"context"
	"fmt"
	"net"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// testVehicle is a small JSON-serialisable struct used to exercise the generic
// Get/Set helpers with a non-primitive value type.
type testVehicle struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Battery int    `json:"battery"`
}

// redisCfg converts a miniredis host:port address into the RedisConfig shape
// that Connect/MustConnect expect, so the real connection path is exercised.
func redisCfg(t *testing.T, addr string) config.RedisConfig {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("SplitHostPort(%q): %v", addr, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("Atoi(%q): %v", portStr, err)
	}
	return config.RedisConfig{Host: host, Port: port}
}

// newTestClient spins up an in-memory Redis (miniredis) and connects a real
// Client to it via the exported Connect path. Both are torn down automatically.
func newTestClient(t *testing.T) (*Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run(): %v", err)
	}
	t.Cleanup(mr.Close)

	c, err := Connect(redisCfg(t, mr.Addr()))
	if err != nil {
		t.Fatalf("Connect(): %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c, mr
}

func TestConnect(t *testing.T) {
	tests := []struct {
		name        string
		cfg         func(t *testing.T) config.RedisConfig
		wantErr     bool
		errContains string
	}{
		{
			name: "success against live server",
			cfg: func(t *testing.T) config.RedisConfig {
				mr, err := miniredis.Run()
				if err != nil {
					t.Fatalf("miniredis.Run(): %v", err)
				}
				t.Cleanup(mr.Close)
				return redisCfg(t, mr.Addr())
			},
			wantErr: false,
		},
		{
			name: "connection refused when server is down",
			cfg: func(t *testing.T) config.RedisConfig {
				mr, err := miniredis.Run()
				if err != nil {
					t.Fatalf("miniredis.Run(): %v", err)
				}
				addr := mr.Addr()
				mr.Close() // nothing is listening now
				return redisCfg(t, addr)
			},
			wantErr:     true,
			errContains: "pinging Redis",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, err := Connect(tt.cfg(t))
			if tt.wantErr {
				if err == nil {
					t.Fatal("Connect() error = nil, want error")
				}
				if c != nil {
					t.Errorf("Connect() client = %v, want nil on error", c)
				}
				if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("Connect() error = %q, want it to contain %q", err, tt.errContains)
				}
				return
			}
			if err != nil {
				t.Fatalf("Connect() error = %v, want nil", err)
			}
			if c == nil {
				t.Fatal("Connect() client = nil, want non-nil")
			}
			t.Cleanup(func() { _ = c.Close() })
			if c.prefix != "teslasync:" {
				t.Errorf("Connect() prefix = %q, want %q", c.prefix, "teslasync:")
			}
			if c.Underlying() == nil {
				t.Error("Connect() Underlying() = nil, want non-nil")
			}
		})
	}
}

func TestMustConnect(t *testing.T) {
	// The failure branch calls log.Fatal (os.Exit) and is intentionally not
	// exercised here; the success branch is verified end-to-end.
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run(): %v", err)
	}
	t.Cleanup(mr.Close)

	c := MustConnect(redisCfg(t, mr.Addr()))
	if c == nil {
		t.Fatal("MustConnect() = nil, want non-nil")
	}
	t.Cleanup(func() { _ = c.Close() })
	if c.prefix != "teslasync:" {
		t.Errorf("MustConnect() prefix = %q, want %q", c.prefix, "teslasync:")
	}
	if err := c.Health(context.Background()); err != nil {
		t.Errorf("MustConnect() client Health() = %v, want nil", err)
	}
}

// assertRoundTrip stores val and reads it back, asserting the value survives a
// Set/Get cycle intact. Constrained to comparable types for direct ==.
func assertRoundTrip[T comparable](t *testing.T, ctx context.Context, c *Client, key string, val T) {
	t.Helper()
	if err := Set(ctx, c, key, val, time.Minute); err != nil {
		t.Fatalf("Set(%q): %v", key, err)
	}
	got, ok := Get[T](ctx, c, key)
	if !ok {
		t.Fatalf("Get(%q): ok = false, want true", key)
	}
	if got != val {
		t.Errorf("Get(%q) = %v, want %v", key, got, val)
	}
}

func TestGetSetRoundTrip(t *testing.T) {
	c, _ := newTestClient(t)
	ctx := context.Background()

	comparableCases := []struct {
		name string
		fn   func(t *testing.T)
	}{
		{"string", func(t *testing.T) { assertRoundTrip(t, ctx, c, "str", "hello world") }},
		{"empty string", func(t *testing.T) { assertRoundTrip(t, ctx, c, "empty", "") }},
		{"int", func(t *testing.T) { assertRoundTrip(t, ctx, c, "int", 42) }},
		{"zero int", func(t *testing.T) { assertRoundTrip(t, ctx, c, "zero", 0) }},
		{"negative int", func(t *testing.T) { assertRoundTrip(t, ctx, c, "neg", -17) }},
		{"float", func(t *testing.T) { assertRoundTrip(t, ctx, c, "float", 3.14159) }},
		{"bool true", func(t *testing.T) { assertRoundTrip(t, ctx, c, "bt", true) }},
		{"bool false", func(t *testing.T) { assertRoundTrip(t, ctx, c, "bf", false) }},
		{"struct", func(t *testing.T) {
			assertRoundTrip(t, ctx, c, "veh", testVehicle{ID: "7", Name: "Model 3", Battery: 88})
		}},
	}
	for _, tc := range comparableCases {
		t.Run(tc.name, func(t *testing.T) { tc.fn(t) })
	}

	t.Run("slice", func(t *testing.T) {
		want := []int{1, 2, 3, 4}
		if err := Set(ctx, c, "slice", want, time.Minute); err != nil {
			t.Fatalf("Set(slice): %v", err)
		}
		got, ok := Get[[]int](ctx, c, "slice")
		if !ok {
			t.Fatal("Get(slice): ok = false, want true")
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("Get(slice) = %v, want %v", got, want)
		}
	})

	t.Run("map", func(t *testing.T) {
		want := map[string]int{"a": 1, "b": 2}
		if err := Set(ctx, c, "map", want, time.Minute); err != nil {
			t.Fatalf("Set(map): %v", err)
		}
		got, ok := Get[map[string]int](ctx, c, "map")
		if !ok {
			t.Fatal("Get(map): ok = false, want true")
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("Get(map) = %v, want %v", got, want)
		}
	})

	t.Run("overwrite existing key", func(t *testing.T) {
		if err := Set(ctx, c, "ow", "first", time.Minute); err != nil {
			t.Fatalf("Set first: %v", err)
		}
		if err := Set(ctx, c, "ow", "second", time.Minute); err != nil {
			t.Fatalf("Set second: %v", err)
		}
		got, ok := Get[string](ctx, c, "ow")
		if !ok || got != "second" {
			t.Errorf("Get after overwrite = (%q, %v), want (\"second\", true)", got, ok)
		}
	})
}

func TestGet_MissesAndErrors(t *testing.T) {
	c, mr := newTestClient(t)
	ctx := context.Background()

	t.Run("missing key returns zero and false", func(t *testing.T) {
		got, ok := Get[string](ctx, c, "does-not-exist")
		if ok {
			t.Errorf("Get(missing) ok = true, want false")
		}
		if got != "" {
			t.Errorf("Get(missing) = %q, want zero value", got)
		}
	})

	t.Run("corrupt json returns zero and false", func(t *testing.T) {
		if err := mr.Set("teslasync:corrupt", "this-is-not-json{"); err != nil {
			t.Fatalf("seed corrupt value: %v", err)
		}
		got, ok := Get[testVehicle](ctx, c, "corrupt")
		if ok {
			t.Errorf("Get(corrupt) ok = true, want false")
		}
		if got != (testVehicle{}) {
			t.Errorf("Get(corrupt) = %+v, want zero value", got)
		}
	})

	t.Run("type mismatch returns zero and false", func(t *testing.T) {
		if err := Set(ctx, c, "typed", "a string", time.Minute); err != nil {
			t.Fatalf("Set: %v", err)
		}
		got, ok := Get[int](ctx, c, "typed")
		if ok {
			t.Errorf("Get[int] on string value ok = true, want false")
		}
		if got != 0 {
			t.Errorf("Get[int] = %d, want 0", got)
		}
	})

	t.Run("get respects key prefix", func(t *testing.T) {
		// A value written without the teslasync: prefix must not be visible.
		if err := mr.Set("unprefixed", `"value"`); err != nil {
			t.Fatalf("seed unprefixed value: %v", err)
		}
		if _, ok := Get[string](ctx, c, "unprefixed"); ok {
			t.Error("Get(unprefixed) ok = true, want false — prefix not applied on read")
		}
	})
}

func TestSet_Validation(t *testing.T) {
	c, mr := newTestClient(t)
	ctx := context.Background()

	tests := []struct {
		name        string
		ttl         time.Duration
		wantErr     bool
		errContains string
	}{
		{"zero ttl rejected", 0, true, "must be positive"},
		{"negative ttl rejected", -time.Second, true, "must be positive"},
		{"positive ttl accepted", 30 * time.Second, false, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := "ttl-" + strings.ReplaceAll(tt.name, " ", "-")
			err := Set(ctx, c, key, "v", tt.ttl)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("Set(ttl=%v) error = nil, want error", tt.ttl)
				}
				if !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("Set error = %q, want it to contain %q", err, tt.errContains)
				}
				if mr.Exists("teslasync:" + key) {
					t.Errorf("Set rejected but key %q was still written", key)
				}
				return
			}
			if err != nil {
				t.Fatalf("Set(ttl=%v) error = %v, want nil", tt.ttl, err)
			}
			if !mr.Exists("teslasync:" + key) {
				t.Errorf("Set succeeded but key %q missing", key)
			}
			if got := mr.TTL("teslasync:" + key); got != tt.ttl {
				t.Errorf("stored TTL = %v, want %v", got, tt.ttl)
			}
		})
	}
}

func TestSet_MarshalError(t *testing.T) {
	c, _ := newTestClient(t)
	ctx := context.Background()

	// A channel cannot be JSON-encoded, so Set must surface a wrapped error and
	// write nothing.
	err := Set(ctx, c, "bad", make(chan int), time.Minute)
	if err == nil {
		t.Fatal("Set(chan) error = nil, want marshal error")
	}
	if !strings.Contains(err.Error(), "marshaling cache value") {
		t.Errorf("Set error = %q, want it to contain %q", err, "marshaling cache value")
	}
}

func TestSet_PrefixApplied(t *testing.T) {
	c, mr := newTestClient(t)
	ctx := context.Background()

	if err := Set(ctx, c, "vehicle:1:state", "cached", time.Minute); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if !mr.Exists("teslasync:vehicle:1:state") {
		t.Error("expected prefixed key teslasync:vehicle:1:state to exist")
	}
	if mr.Exists("vehicle:1:state") {
		t.Error("unprefixed key must not exist")
	}
}

func TestDelete(t *testing.T) {
	tests := []struct {
		name      string
		seed      bool
		wantExist bool
	}{
		{"removes existing key", true, false},
		{"missing key is a no-op", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, mr := newTestClient(t)
			ctx := context.Background()
			const key = "del-key"

			if tt.seed {
				if err := Set(ctx, c, key, "v", time.Minute); err != nil {
					t.Fatalf("seed Set: %v", err)
				}
			}

			if err := Delete(ctx, c, key); err != nil {
				t.Fatalf("Delete(%q) error = %v, want nil", key, err)
			}
			if mr.Exists("teslasync:"+key) != tt.wantExist {
				t.Errorf("after Delete, Exists = %v, want %v", mr.Exists("teslasync:"+key), tt.wantExist)
			}
			if _, ok := Get[string](ctx, c, key); ok {
				t.Errorf("Get after Delete ok = true, want false")
			}
		})
	}
}

func TestInvalidate(t *testing.T) {
	tests := []struct {
		name          string
		pattern       string
		wantRemaining []string
		wantGone      []string
	}{
		{
			name:          "removes matching prefix only",
			pattern:       "vehicle:1:",
			wantGone:      []string{"vehicle:1:state", "vehicle:1:energy"},
			wantRemaining: []string{"vehicle:2:state", "session:1:x"},
		},
		{
			name:          "removes whole namespace",
			pattern:       "vehicle:",
			wantGone:      []string{"vehicle:1:state", "vehicle:1:energy", "vehicle:2:state"},
			wantRemaining: []string{"session:1:x"},
		},
		{
			name:          "non-matching pattern is a no-op",
			pattern:       "nothing:",
			wantGone:      nil,
			wantRemaining: []string{"vehicle:1:state", "vehicle:1:energy", "vehicle:2:state", "session:1:x"},
		},
		{
			name:          "empty pattern clears everything",
			pattern:       "",
			wantGone:      []string{"vehicle:1:state", "vehicle:1:energy", "vehicle:2:state", "session:1:x"},
			wantRemaining: nil,
		},
	}

	seed := []string{"vehicle:1:state", "vehicle:1:energy", "vehicle:2:state", "session:1:x"}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, mr := newTestClient(t)
			ctx := context.Background()
			for _, k := range seed {
				if err := Set(ctx, c, k, "v", time.Minute); err != nil {
					t.Fatalf("seed Set(%q): %v", k, err)
				}
			}

			if err := c.Invalidate(ctx, tt.pattern); err != nil {
				t.Fatalf("Invalidate(%q) error = %v, want nil", tt.pattern, err)
			}

			for _, k := range tt.wantGone {
				if mr.Exists("teslasync:" + k) {
					t.Errorf("key %q still present after Invalidate(%q)", k, tt.pattern)
				}
			}
			for _, k := range tt.wantRemaining {
				if !mr.Exists("teslasync:" + k) {
					t.Errorf("key %q unexpectedly removed by Invalidate(%q)", k, tt.pattern)
				}
			}
		})
	}
}

func TestHealth(t *testing.T) {
	t.Run("healthy server returns nil", func(t *testing.T) {
		c, _ := newTestClient(t)
		if err := c.Health(context.Background()); err != nil {
			t.Errorf("Health() = %v, want nil", err)
		}
	})

	t.Run("stopped server returns wrapped error", func(t *testing.T) {
		mr, err := miniredis.Run()
		if err != nil {
			t.Fatalf("miniredis.Run(): %v", err)
		}
		c, err := Connect(redisCfg(t, mr.Addr()))
		if err != nil {
			t.Fatalf("Connect(): %v", err)
		}
		t.Cleanup(func() { _ = c.Close() })

		mr.Close() // stop the server before the health check

		err = c.Health(context.Background())
		if err == nil {
			t.Fatal("Health() = nil, want error")
		}
		if !strings.Contains(err.Error(), "redis health check") {
			t.Errorf("Health() error = %q, want it to contain %q", err, "redis health check")
		}
	})
}

func TestClose(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run(): %v", err)
	}
	t.Cleanup(mr.Close)

	c, err := Connect(redisCfg(t, mr.Addr()))
	if err != nil {
		t.Fatalf("Connect(): %v", err)
	}

	if err := c.Close(); err != nil {
		t.Errorf("Close() = %v, want nil", err)
	}
	// After Close the pool is shut down, so operations must fail rather than
	// silently succeed.
	if err := c.Health(context.Background()); err == nil {
		t.Error("Health() after Close() = nil, want error")
	}
}

func TestUnderlying(t *testing.T) {
	c, _ := newTestClient(t)
	got := c.Underlying()
	if got == nil {
		t.Fatal("Underlying() = nil, want non-nil")
	}
	if got != c.rdb {
		t.Error("Underlying() did not return the internal redis client")
	}
}

// TestConcurrentAccess drives the client from many goroutines so the race
// detector can prove the exported helpers are safe for concurrent use.
func TestConcurrentAccess(t *testing.T) {
	c, _ := newTestClient(t)
	ctx := context.Background()

	const workers = 24
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("concurrent-%d", n%4)
			if err := Set(ctx, c, key, n, time.Minute); err != nil {
				t.Errorf("Set(%q): %v", key, err)
			}
			_, _ = Get[int](ctx, c, key)
			if n%2 == 0 {
				_ = Delete(ctx, c, key)
			}
			_ = c.Health(ctx)
		}(i)
	}
	wg.Wait()
}
