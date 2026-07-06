package rediscache

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/platform/cache"
)

const (
	// vehicleTTL bounds how long a cached vehicle state is served before a
	// re-read from the source of truth is forced.
	vehicleTTL = 30 * time.Second
	// sessionTTL bounds how long a cached session/preference value lives.
	sessionTTL = 5 * time.Minute
)

// VehicleCache provides cache-aside caching for vehicle data.
type VehicleCache struct {
	client *cache.Client
}

func NewVehicleCache(client *cache.Client) *VehicleCache {
	return &VehicleCache{client: client}
}

func (c *VehicleCache) key(id string) string {
	return fmt.Sprintf("vehicle:%s:state", id)
}

func (c *VehicleCache) Get(ctx context.Context, id string) (*vehicle.Vehicle, bool) {
	v, ok := cache.Get[vehicle.Vehicle](ctx, c.client, c.key(id))
	if !ok {
		return nil, false
	}
	return &v, true
}

// Set caches a vehicle with a 30-second TTL. It rejects a nil vehicle or one
// with an empty ID rather than dereferencing nil or writing a malformed key.
func (c *VehicleCache) Set(ctx context.Context, v *vehicle.Vehicle) error {
	if v == nil {
		return fmt.Errorf("rediscache: set vehicle: nil vehicle")
	}
	if v.ID == "" {
		return fmt.Errorf("rediscache: set vehicle: empty vehicle ID")
	}
	if err := cache.Set(ctx, c.client, c.key(v.ID), v, vehicleTTL); err != nil {
		return fmt.Errorf("rediscache: set vehicle %s: %w", v.ID, err)
	}
	return nil
}

func (c *VehicleCache) Invalidate(ctx context.Context, id string) error {
	if err := cache.Delete(ctx, c.client, c.key(id)); err != nil {
		return fmt.Errorf("rediscache: invalidate vehicle %s: %w", id, err)
	}
	return nil
}

// SessionCache provides cache-aside caching for user sessions/preferences.
type SessionCache struct {
	client *cache.Client
}

func NewSessionCache(client *cache.Client) *SessionCache {
	return &SessionCache{client: client}
}

func (c *SessionCache) Get(ctx context.Context, userID, key string) (string, bool) {
	cacheKey := fmt.Sprintf("session:%s:%s", userID, key)
	val, ok := cache.Get[string](ctx, c.client, cacheKey)
	return val, ok
}

// Set caches a session value with a 5-minute TTL.
func (c *SessionCache) Set(ctx context.Context, userID, key, value string) error {
	cacheKey := fmt.Sprintf("session:%s:%s", userID, key)
	if err := cache.Set(ctx, c.client, cacheKey, value, sessionTTL); err != nil {
		return fmt.Errorf("rediscache: set session %s/%s: %w", userID, key, err)
	}
	return nil
}
