package rediscache

import (
	"context"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/platform/cache"
	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// testPrefix mirrors the fixed key prefix that cache.Connect applies to every
// key (see internal/platform/cache/connect.go). Tests that inspect Redis
// directly (TTL, raw value seeding) must prepend it to the adapter's logical
// key.
const testPrefix = "teslasync:"

// newTestClient starts an in-process miniredis server and returns a real
// *cache.Client wired to it via cache.Connect. Using the genuine connect path
// (rather than reaching into unexported fields) exercises the same code the
// production adapter runs, while staying hermetic — no real Redis, network, or
// Tesla API. The server and client are torn down automatically.
func newTestClient(t *testing.T) (*cache.Client, *miniredis.Miniredis) {
	t.Helper()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)

	host, portStr, err := net.SplitHostPort(mr.Addr())
	if err != nil {
		t.Fatalf("net.SplitHostPort(%q) error = %v", mr.Addr(), err)
	}
	if host == "" {
		host = "127.0.0.1"
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("strconv.Atoi(%q) error = %v", portStr, err)
	}

	client, err := cache.Connect(config.RedisConfig{Host: host, Port: port})
	if err != nil {
		t.Fatalf("cache.Connect() error = %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	return client, mr
}

// sampleVehicle returns a fully-populated vehicle with deterministic,
// JSON-stable timestamps (UTC, no monotonic clock) so round-trip equality is
// reliable.
func sampleVehicle(id string) *vehicle.Vehicle {
	ts := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	return &vehicle.Vehicle{
		ID:            id,
		UserID:        "user-42",
		VIN:           "5YJ3E1EA7KF000001",
		DisplayName:   "Rocinante ☄",
		Model:         "model3",
		Year:          2025,
		Color:         "midnight-silver",
		FSMState:      fsm.State("parked"),
		SubFSMState:   fsm.State("idle"),
		OdometerMiles: 12345.6,
		BatteryLevel:  87,
		RangeMiles:    241.3,
		IsCharging:    false,
		Latitude:      37.7749,
		Longitude:     -122.4194,
		CreatedAt:     ts,
		UpdatedAt:     ts.Add(time.Hour),
	}
}

// vehiclesEqual compares two vehicles, treating timestamps with time.Equal
// (location-agnostic) and the remaining comparable fields with ==.
func vehiclesEqual(a, b *vehicle.Vehicle) bool {
	if a == nil || b == nil {
		return a == b
	}
	if !a.CreatedAt.Equal(b.CreatedAt) || !a.UpdatedAt.Equal(b.UpdatedAt) {
		return false
	}
	ac, bc := *a, *b
	ac.CreatedAt, ac.UpdatedAt = time.Time{}, time.Time{}
	bc.CreatedAt, bc.UpdatedAt = time.Time{}, time.Time{}
	return ac == bc
}

func TestNewVehicleCache(t *testing.T) {
	client, _ := newTestClient(t)
	if got := NewVehicleCache(client); got == nil {
		t.Fatal("NewVehicleCache returned nil")
	}
}

func TestNewSessionCache(t *testing.T) {
	client, _ := newTestClient(t)
	if got := NewSessionCache(client); got == nil {
		t.Fatal("NewSessionCache returned nil")
	}
}

func TestVehicleCacheKey(t *testing.T) {
	vc := NewVehicleCache(nil) // key() does not touch the client
	tests := []struct {
		name string
		id   string
		want string
	}{
		{"simple", "1", "vehicle:1:state"},
		{"uuid", "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "vehicle:3f2504e0-4f89-11d3-9a0c-0305e82c3301:state"},
		{"empty", "", "vehicle::state"},
		{"unicode", "车", "vehicle:车:state"},
		{"embedded-colon", "a:b", "vehicle:a:b:state"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := vc.key(tc.id); got != tc.want {
				t.Fatalf("key(%q) = %q, want %q", tc.id, got, tc.want)
			}
		})
	}
}

func TestVehicleCacheSetGetRoundTrip(t *testing.T) {
	tests := []struct {
		name string
		v    *vehicle.Vehicle
	}{
		{"fully-populated", sampleVehicle("veh-1")},
		{"minimal-id-only", &vehicle.Vehicle{ID: "veh-2"}},
		{"zero-numeric-fields", &vehicle.Vehicle{ID: "veh-3", BatteryLevel: 0, RangeMiles: 0, Latitude: 0}},
		{"negative-coordinates", &vehicle.Vehicle{ID: "veh-4", Latitude: -89.5, Longitude: -179.9, OdometerMiles: 0.001}},
		{"charging-true", &vehicle.Vehicle{ID: "veh-5", IsCharging: true, BatteryLevel: 100, FSMState: fsm.State("charging")}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := newTestClient(t)
			vc := NewVehicleCache(client)
			ctx := context.Background()

			if err := vc.Set(ctx, tc.v); err != nil {
				t.Fatalf("Set() error = %v", err)
			}
			got, ok := vc.Get(ctx, tc.v.ID)
			if !ok {
				t.Fatalf("Get(%q) ok = false, want true", tc.v.ID)
			}
			if got == nil {
				t.Fatal("Get returned nil vehicle with ok=true")
			}
			if !vehiclesEqual(got, tc.v) {
				t.Fatalf("round-trip mismatch:\n got  = %+v\n want = %+v", got, tc.v)
			}
		})
	}
}

func TestVehicleCacheGetMiss(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	tests := []struct {
		name string
		id   string
	}{
		{"never-set", "absent"},
		{"empty-id", ""},
		{"other-namespace", "vehicle"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := vc.Get(ctx, tc.id)
			if ok {
				t.Fatalf("Get(%q) ok = true, want false", tc.id)
			}
			if got != nil {
				t.Fatalf("Get(%q) vehicle = %+v, want nil", tc.id, got)
			}
		})
	}
}

func TestVehicleCacheGetCorruptJSON(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	// Seed a non-JSON payload directly at the fully-prefixed key so the
	// unmarshal branch inside cache.Get is exercised.
	fullKey := testPrefix + vc.key("corrupt")
	if err := client.Underlying().Set(ctx, fullKey, "{not-valid-json", time.Minute).Err(); err != nil {
		t.Fatalf("seeding corrupt value error = %v", err)
	}

	got, ok := vc.Get(ctx, "corrupt")
	if ok {
		t.Fatal("Get on corrupt payload ok = true, want false")
	}
	if got != nil {
		t.Fatalf("Get on corrupt payload vehicle = %+v, want nil", got)
	}
}

func TestVehicleCacheSetValidation(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	tests := []struct {
		name    string
		v       *vehicle.Vehicle
		wantSub string
	}{
		{"nil-vehicle", nil, "nil vehicle"},
		{"empty-id", &vehicle.Vehicle{ID: ""}, "empty vehicle ID"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := vc.Set(ctx, tc.v)
			if err == nil {
				t.Fatal("Set() error = nil, want validation error")
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("Set() error = %q, want substring %q", err.Error(), tc.wantSub)
			}
		})
	}

	// The empty-ID guard must prevent any write to the malformed key.
	if _, ok := vc.Get(ctx, ""); ok {
		t.Fatal("empty-ID vehicle was cached despite validation error")
	}
}

func TestVehicleCacheSetAppliesTTL(t *testing.T) {
	client, mr := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	v := sampleVehicle("ttl-veh")
	if err := vc.Set(ctx, v); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	fullKey := testPrefix + vc.key(v.ID)
	ttl := client.Underlying().TTL(ctx, fullKey).Val()
	if ttl <= 0 || ttl > vehicleTTL {
		t.Fatalf("TTL = %v, want (0, %v]", ttl, vehicleTTL)
	}

	// Advancing miniredis past the TTL must expire the entry — deterministic,
	// no sleeps.
	mr.FastForward(vehicleTTL + time.Second)
	if _, ok := vc.Get(ctx, v.ID); ok {
		t.Fatal("vehicle still cached after TTL expiry")
	}
}

func TestVehicleCacheInvalidate(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	v := sampleVehicle("inv-veh")
	if err := vc.Set(ctx, v); err != nil {
		t.Fatalf("Set() error = %v", err)
	}
	if _, ok := vc.Get(ctx, v.ID); !ok {
		t.Fatal("precondition failed: vehicle not cached before Invalidate")
	}

	if err := vc.Invalidate(ctx, v.ID); err != nil {
		t.Fatalf("Invalidate() error = %v", err)
	}
	if _, ok := vc.Get(ctx, v.ID); ok {
		t.Fatal("vehicle still cached after Invalidate")
	}

	// Invalidating an absent key is a no-op, not an error.
	if err := vc.Invalidate(ctx, "never-existed"); err != nil {
		t.Fatalf("Invalidate(absent) error = %v, want nil", err)
	}
}

func TestVehicleCacheClientClosedErrors(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	// Simulate Redis being unreachable by closing the client.
	if err := client.Close(); err != nil {
		t.Fatalf("client.Close() error = %v", err)
	}

	err := vc.Set(ctx, sampleVehicle("veh-x"))
	if err == nil {
		t.Fatal("Set() error = nil after client closed, want wrapped error")
	}
	if !strings.Contains(err.Error(), "set vehicle") {
		t.Fatalf("Set() error = %q, want it to include operation context", err.Error())
	}

	if err := vc.Invalidate(ctx, "veh-x"); err == nil {
		t.Fatal("Invalidate() error = nil after client closed, want wrapped error")
	} else if !strings.Contains(err.Error(), "invalidate vehicle") {
		t.Fatalf("Invalidate() error = %q, want it to include operation context", err.Error())
	}

	// Reads degrade gracefully to a miss rather than surfacing the error.
	if got, ok := vc.Get(ctx, "veh-x"); ok || got != nil {
		t.Fatalf("Get() after close = (%+v, %v), want (nil, false)", got, ok)
	}
}

func TestVehicleCacheConcurrentAccess(t *testing.T) {
	client, _ := newTestClient(t)
	vc := NewVehicleCache(client)
	ctx := context.Background()

	const workers = 16
	const opsPerWorker = 25

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func(w int) {
			defer wg.Done()
			id := "concurrent-" + strconv.Itoa(w)
			v := sampleVehicle(id)
			for i := 0; i < opsPerWorker; i++ {
				if err := vc.Set(ctx, v); err != nil {
					t.Errorf("worker %d Set error = %v", w, err)
					return
				}
				if _, ok := vc.Get(ctx, id); !ok {
					t.Errorf("worker %d Get miss for own key", w)
					return
				}
				if err := vc.Invalidate(ctx, id); err != nil {
					t.Errorf("worker %d Invalidate error = %v", w, err)
					return
				}
			}
		}(w)
	}
	wg.Wait()
}

func TestSessionCacheSetGetRoundTrip(t *testing.T) {
	tests := []struct {
		name   string
		userID string
		key    string
		value  string
	}{
		{"typical", "user-1", "theme", "dark"},
		{"empty-value", "user-2", "collapsed", ""},
		{"unicode-value", "user-3", "greeting", "こんにちは"},
		{"json-like-value", "user-4", "prefs", `{"units":"metric"}`},
		{"colon-in-key", "user-5", "a:b:c", "nested"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := newTestClient(t)
			sc := NewSessionCache(client)
			ctx := context.Background()

			if err := sc.Set(ctx, tc.userID, tc.key, tc.value); err != nil {
				t.Fatalf("Set() error = %v", err)
			}
			got, ok := sc.Get(ctx, tc.userID, tc.key)
			if !ok {
				t.Fatalf("Get(%q,%q) ok = false, want true", tc.userID, tc.key)
			}
			if got != tc.value {
				t.Fatalf("Get(%q,%q) = %q, want %q", tc.userID, tc.key, got, tc.value)
			}
		})
	}
}

func TestSessionCacheGetMiss(t *testing.T) {
	client, _ := newTestClient(t)
	sc := NewSessionCache(client)
	ctx := context.Background()

	tests := []struct {
		name   string
		userID string
		key    string
	}{
		{"never-set", "user-1", "theme"},
		{"wrong-user", "user-unknown", "theme"},
		{"empty-both", "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := sc.Get(ctx, tc.userID, tc.key)
			if ok {
				t.Fatalf("Get(%q,%q) ok = true, want false", tc.userID, tc.key)
			}
			if got != "" {
				t.Fatalf("Get(%q,%q) = %q, want empty string", tc.userID, tc.key, got)
			}
		})
	}
}

func TestSessionCacheKeyFormatAndTTL(t *testing.T) {
	client, mr := newTestClient(t)
	sc := NewSessionCache(client)
	ctx := context.Background()

	if err := sc.Set(ctx, "user-9", "locale", "en-US"); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	fullKey := testPrefix + "session:user-9:locale"
	if got := client.Underlying().Get(ctx, fullKey).Val(); got != `"en-US"` {
		t.Fatalf("stored value = %q, want JSON-encoded %q", got, `"en-US"`)
	}

	ttl := client.Underlying().TTL(ctx, fullKey).Val()
	if ttl <= 0 || ttl > sessionTTL {
		t.Fatalf("TTL = %v, want (0, %v]", ttl, sessionTTL)
	}

	mr.FastForward(sessionTTL + time.Second)
	if _, ok := sc.Get(ctx, "user-9", "locale"); ok {
		t.Fatal("session value still cached after TTL expiry")
	}
}

func TestSessionCacheGetCorruptJSON(t *testing.T) {
	client, _ := newTestClient(t)
	sc := NewSessionCache(client)
	ctx := context.Background()

	fullKey := testPrefix + "session:user-c:bad"
	if err := client.Underlying().Set(ctx, fullKey, "raw-not-json", time.Minute).Err(); err != nil {
		t.Fatalf("seeding corrupt value error = %v", err)
	}

	got, ok := sc.Get(ctx, "user-c", "bad")
	if ok {
		t.Fatal("Get on corrupt session payload ok = true, want false")
	}
	if got != "" {
		t.Fatalf("Get on corrupt session payload = %q, want empty string", got)
	}
}

func TestSessionCacheSetClientClosedError(t *testing.T) {
	client, _ := newTestClient(t)
	sc := NewSessionCache(client)
	ctx := context.Background()

	if err := client.Close(); err != nil {
		t.Fatalf("client.Close() error = %v", err)
	}

	err := sc.Set(ctx, "user-1", "theme", "dark")
	if err == nil {
		t.Fatal("Set() error = nil after client closed, want wrapped error")
	}
	if !strings.Contains(err.Error(), "set session") {
		t.Fatalf("Set() error = %q, want it to include operation context", err.Error())
	}
}
