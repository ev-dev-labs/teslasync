package cache

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

type memItem struct {
	data      []byte
	expiresAt time.Time
}

type memStore struct {
	mu    sync.RWMutex
	items map[string]memItem
	done  chan struct{}
}

func newMemStore() *memStore {
	m := &memStore{
		items: make(map[string]memItem),
		done:  make(chan struct{}),
	}
	go m.evictLoop()
	return m
}

func (m *memStore) Get(key string, dest interface{}) bool {
	m.mu.RLock()
	item, ok := m.items[key]
	m.mu.RUnlock()
	if !ok || time.Now().After(item.expiresAt) {
		return false
	}
	return json.Unmarshal(item.data, dest) == nil
}

func (m *memStore) Set(key string, data []byte, ttl time.Duration) {
	m.mu.Lock()
	m.items[key] = memItem{data: data, expiresAt: time.Now().Add(ttl)}
	m.mu.Unlock()
}

func (m *memStore) Delete(key string) {
	m.mu.Lock()
	delete(m.items, key)
	m.mu.Unlock()
}

func (m *memStore) Invalidate(pattern string) {
	m.mu.Lock()
	for k := range m.items {
		if strings.HasPrefix(k, pattern) {
			delete(m.items, k)
		}
	}
	m.mu.Unlock()
}

func (m *memStore) Close() {
	close(m.done)
}

func (m *memStore) evictLoop() {
	ticker := time.NewTicker(config.MemCacheCleanup)
	defer ticker.Stop()
	for {
		select {
		case <-m.done:
			return
		case <-ticker.C:
			now := time.Now()
			m.mu.Lock()
			for k, v := range m.items {
				if now.After(v.expiresAt) {
					delete(m.items, k)
				}
			}
			m.mu.Unlock()
		}
	}
}
