package database

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestCache_SetAndGet(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	c.Set(ctx, "key1", map[string]int{"a": 1}, 5*time.Minute)

	var got map[string]int
	if !c.Get(ctx, "key1", &got) {
		t.Fatal("expected cache hit")
	}
	if got["a"] != 1 {
		t.Errorf("got %v, want map[a:1]", got)
	}
}

func TestCache_Miss(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	var got string
	if c.Get(ctx, "nonexistent", &got) {
		t.Error("expected cache miss for nonexistent key")
	}
}

func TestCache_TTLExpiry(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	c.Set(ctx, "ephemeral", "value", 1*time.Millisecond)
	time.Sleep(5 * time.Millisecond)

	var got string
	if c.Get(ctx, "ephemeral", &got) {
		t.Error("expected cache miss after TTL expiry")
	}
}

func TestCache_Delete(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	c.Set(ctx, "del-me", 42, 5*time.Minute)
	c.Delete(ctx, "del-me")

	var got int
	if c.Get(ctx, "del-me", &got) {
		t.Error("expected cache miss after delete")
	}
}

func TestCache_Overwrite(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	c.Set(ctx, "key", "first", 5*time.Minute)
	c.Set(ctx, "key", "second", 5*time.Minute)

	var got string
	if !c.Get(ctx, "key", &got) {
		t.Fatal("expected cache hit")
	}
	if got != "second" {
		t.Errorf("got %q, want 'second'", got)
	}
}

func TestCache_NilSafe(t *testing.T) {
	var c *Cache
	ctx := context.Background()

	c.Set(ctx, "k", "v", time.Minute) // should not panic
	c.Delete(ctx, "k")                // should not panic
	c.Close()                         // should not panic

	var v string
	if c.Get(ctx, "k", &v) {
		t.Error("Get on nil cache should return false")
	}
}

func TestCache_Evict(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	c.Set(ctx, "stale", "val", 1*time.Millisecond)
	c.Set(ctx, "fresh", "val", 5*time.Minute)
	time.Sleep(5 * time.Millisecond)

	c.evict()

	c.mu.RLock()
	_, staleExists := c.items["stale"]
	_, freshExists := c.items["fresh"]
	c.mu.RUnlock()

	if staleExists {
		t.Error("expected stale item to be evicted")
	}
	if !freshExists {
		t.Error("expected fresh item to survive eviction")
	}
}

func TestCache_ComplexTypes(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	type vehicle struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}

	c.Set(ctx, "v1", vehicle{ID: 1, Name: "Model 3"}, 5*time.Minute)

	var got vehicle
	if !c.Get(ctx, "v1", &got) {
		t.Fatal("expected cache hit")
	}
	if got.ID != 1 || got.Name != "Model 3" {
		t.Errorf("got %+v, want {1, Model 3}", got)
	}
}

func TestCache_ConcurrentAccess(t *testing.T) {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	defer c.Close()
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := "key"
			c.Set(ctx, key, i, 5*time.Minute)
			var v int
			c.Get(ctx, key, &v)
			c.Delete(ctx, key)
		}(i)
	}
	wg.Wait()
}
