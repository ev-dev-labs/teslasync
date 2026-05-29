package cache

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestMemoryCache(t *testing.T) {
	cfg := config.RedisConfig{Enabled: false}
	store := New(cfg)
	defer store.Close()

	if store.IsRedis() {
		t.Error("Should be in-memory mode when Redis is disabled")
	}

	ctx := context.Background()

	store.Set(ctx, "key1", "value1", 5*time.Second)
	var result string
	if !store.Get(ctx, "key1", &result) {
		t.Error("Get() should return true for existing key")
	}
	if result != "value1" {
		t.Errorf("Get() = %q, want 'value1'", result)
	}

	if store.Get(ctx, "nonexistent", &result) {
		t.Error("Get() should return false for missing key")
	}

	store.Delete(ctx, "key1")
	if store.Get(ctx, "key1", &result) {
		t.Error("Get() should return false after Delete()")
	}
}

func TestMemoryCacheExpiry(t *testing.T) {
	cfg := config.RedisConfig{Enabled: false}
	store := New(cfg)
	defer store.Close()

	ctx := context.Background()
	store.Set(ctx, "expiring", "data", 50*time.Millisecond)

	var result string
	if !store.Get(ctx, "expiring", &result) {
		t.Error("Get() should find key before expiry")
	}

	time.Sleep(100 * time.Millisecond)
	if store.Get(ctx, "expiring", &result) {
		t.Error("Get() should return false after TTL")
	}
}

func TestMemoryCacheInvalidate(t *testing.T) {
	cfg := config.RedisConfig{Enabled: false}
	store := New(cfg)
	defer store.Close()

	ctx := context.Background()
	store.Set(ctx, "vehicle:1:data", "v1", time.Minute)
	store.Set(ctx, "vehicle:1:state", "online", time.Minute)
	store.Set(ctx, "vehicle:2:data", "v2", time.Minute)

	store.Invalidate(ctx, "vehicle:1:")

	var result string
	if store.Get(ctx, "vehicle:1:data", &result) {
		t.Error("vehicle:1:data should be invalidated")
	}
	if store.Get(ctx, "vehicle:1:state", &result) {
		t.Error("vehicle:1:state should be invalidated")
	}
	if !store.Get(ctx, "vehicle:2:data", &result) {
		t.Error("vehicle:2:data should NOT be invalidated")
	}
}

func TestCacheStructValues(t *testing.T) {
	cfg := config.RedisConfig{Enabled: false}
	store := New(cfg)
	defer store.Close()

	type Vehicle struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}

	ctx := context.Background()
	store.Set(ctx, "v", Vehicle{ID: 42, Name: "Model 3"}, time.Minute)

	var got Vehicle
	if !store.Get(ctx, "v", &got) {
		t.Fatal("Get() should find struct value")
	}
	if got.ID != 42 || got.Name != "Model 3" {
		t.Errorf("Get() = %+v, want {42, Model 3}", got)
	}
}
