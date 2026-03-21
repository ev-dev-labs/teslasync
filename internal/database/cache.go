package database

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Cache is a thread-safe in-memory cache with TTL-based expiration.
type Cache struct {
	mu    sync.RWMutex
	items map[string]cacheItem
	done  chan struct{}
}

type cacheItem struct {
	data      []byte
	expiresAt time.Time
}

// NewCache creates a new in-memory cache and starts a background
// goroutine that evicts expired entries every 60 seconds.
func NewCache() *Cache {
	c := &Cache{
		items: make(map[string]cacheItem),
		done:  make(chan struct{}),
	}
	go c.evictLoop()
	log.Info().Msg("in-memory cache initialised")
	return c
}

// Get unmarshals the cached value for key into dest.
// Returns true on cache hit, false on miss or expiry.
func (c *Cache) Get(_ context.Context, key string, dest interface{}) bool {
	if c == nil {
		return false
	}
	c.mu.RLock()
	item, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(item.expiresAt) {
		return false
	}
	return json.Unmarshal(item.data, dest) == nil
}

// Set stores val under key with the given TTL.
func (c *Cache) Set(_ context.Context, key string, val interface{}, ttl time.Duration) {
	if c == nil {
		return
	}
	data, err := json.Marshal(val)
	if err != nil {
		return
	}
	c.mu.Lock()
	c.items[key] = cacheItem{data: data, expiresAt: time.Now().Add(ttl)}
	c.mu.Unlock()
}

// Delete removes a single key from the cache.
func (c *Cache) Delete(_ context.Context, key string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

// Close stops the background eviction goroutine.
func (c *Cache) Close() {
	if c == nil {
		return
	}
	close(c.done)
}

func (c *Cache) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			c.evict()
		}
	}
}

func (c *Cache) evict() {
	now := time.Now()
	c.mu.Lock()
	for k, v := range c.items {
		if now.After(v.expiresAt) {
			delete(c.items, k)
		}
	}
	c.mu.Unlock()
}
