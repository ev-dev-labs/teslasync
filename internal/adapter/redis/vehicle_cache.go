package rediscache

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/platform/cache"
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

// Set caches a vehicle with a 30-second TTL.
func (c *VehicleCache) Set(ctx context.Context, v *vehicle.Vehicle) error {
	return cache.Set(ctx, c.client, c.key(v.ID), v, 30*time.Second)
}

func (c *VehicleCache) Invalidate(ctx context.Context, id string) error {
	return cache.Delete(ctx, c.client, c.key(id))
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
	return cache.Set(ctx, c.client, cacheKey, value, 5*time.Minute)
}
