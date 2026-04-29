package signal

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestHybridLiveSignalStoreL1OnlyOperationWithNilRedis(t *testing.T) {
	ctx := context.Background()
	local := New()
	liveStore, err := NewHybridLiveSignalStore(local, nil, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if err := liveStore.Update(ctx, 42, map[string]interface{}{
		"BatteryLevel": 81.0,
		"ShiftState":   "P",
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	value, err := liveStore.GetSignal(ctx, 42, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal() error = %v", err)
	}
	assertFloat64(t, value.Raw, 81)

	values, err := liveStore.GetAll(ctx, 42, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	assertString(t, values["ShiftState"].Raw, "P")

	ids := liveStore.LocalVehicleIDs()
	if len(ids) != 1 || ids[0] != 42 {
		t.Fatalf("LocalVehicleIDs() = %v, want [42]", ids)
	}
}

func TestHybridLiveSignalStoreUpdateWritesL1AndL2(t *testing.T) {
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if err := liveStore.Update(ctx, 7, map[string]interface{}{
		"BatteryLevel": 64.0,
		"Online":       true,
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	assertFloat64(t, local.Get(7, "BatteryLevel").Raw, 64)
	redisValue, err := redisCache.GetSignalValue(ctx, 7, "BatteryLevel")
	if err != nil {
		t.Fatalf("GetSignalValue() error = %v", err)
	}
	assertFloat64(t, redisValue.Raw, 64)
	if redisValue.Timestamp.IsZero() {
		t.Fatal("Redis value timestamp is zero, want timestamped L2 write")
	}
}

func TestHybridLiveSignalStoreLocalModeDoesNotUseRedisBackedReadsOrWrites(t *testing.T) {
	ctx := context.Background()
	local := New()
	local.Update(5, map[string]interface{}{"BatteryLevel": 12.0})

	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	if err := redisCache.Update(ctx, 5, map[string]interface{}{"BatteryLevel": 98.0}); err != nil {
		t.Fatalf("RedisSignalCache.Update() error = %v", err)
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeLocal)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	value, err := liveStore.GetSignal(ctx, 5, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal() error = %v", err)
	}
	assertFloat64(t, value.Raw, 12)

	if err := liveStore.Update(ctx, 6, map[string]interface{}{"BatteryLevel": 44.0}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if _, ok := redisClient.hashes[redisSignalKey(6)]; ok {
		t.Fatal("local mode wrote vehicle 6 to Redis, want L1-only update")
	}
}

func TestHybridLiveSignalStoreModeSwitchDisablesRedisBackedDistributedReads(t *testing.T) {
	ctx := context.Background()
	local := New()
	local.Update(9, map[string]interface{}{"BatteryLevel": 21.0})

	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	if err := redisCache.Update(ctx, 9, map[string]interface{}{"BatteryLevel": 87.0}); err != nil {
		t.Fatalf("RedisSignalCache.Update() error = %v", err)
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	value, err := liveStore.GetSignal(ctx, 9, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal() hybrid error = %v", err)
	}
	assertFloat64(t, value.Raw, 87)

	if err := liveStore.SetMode(LiveSignalStoreModeLocal); err != nil {
		t.Fatalf("SetMode(local) error = %v", err)
	}
	value, err = liveStore.GetSignal(ctx, 9, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal() local error = %v", err)
	}
	assertFloat64(t, value.Raw, 21)
}

func TestHybridLiveSignalStoreDistributedReadsPreferRedisWhenAvailable(t *testing.T) {
	ctx := context.Background()
	local := New()
	local.Update(11, map[string]interface{}{
		"BatteryLevel": 31.0,
		"ShiftState":   "D",
	})

	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	if err := redisCache.Update(ctx, 11, map[string]interface{}{
		"BatteryLevel": 93.0,
		"ShiftState":   "P",
	}); err != nil {
		t.Fatalf("RedisSignalCache.Update() error = %v", err)
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	distributed, err := liveStore.GetSignal(ctx, 11, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal(distributed) error = %v", err)
	}
	assertFloat64(t, distributed.Raw, 93)

	localOnly, err := liveStore.GetSignal(ctx, 11, "BatteryLevel", LiveSignalReadLocal)
	if err != nil {
		t.Fatalf("GetSignal(local) error = %v", err)
	}
	assertFloat64(t, localOnly.Raw, 31)

	values, err := liveStore.GetAll(ctx, 11, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll(distributed) error = %v", err)
	}
	assertString(t, values["ShiftState"].Raw, "P")
}

func TestHybridLiveSignalStoreRedisFailureDoesNotCorruptL1State(t *testing.T) {
	ctx := context.Background()
	local := New()
	local.Update(13, map[string]interface{}{"BatteryLevel": 10.0})

	redisErr := errors.New("redis unavailable")
	redisCache := &RedisSignalCache{rdb: failingRedisSignalClient{err: redisErr}}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	err = liveStore.Update(ctx, 13, map[string]interface{}{"BatteryLevel": 66.0})
	if err == nil || !errors.Is(err, redisErr) {
		t.Fatalf("Update() error = %v, want redis failure surfaced", err)
	}
	assertFloat64(t, local.Get(13, "BatteryLevel").Raw, 66)

	value, err := liveStore.GetSignal(ctx, 13, "BatteryLevel", LiveSignalReadLocal)
	if err != nil {
		t.Fatalf("GetSignal(local) error = %v", err)
	}
	assertFloat64(t, value.Raw, 66)

	if _, err := liveStore.GetSignal(ctx, 13, "BatteryLevel", LiveSignalReadDistributed); err == nil {
		t.Fatal("GetSignal(distributed) error = nil, want Redis read failure surfaced")
	}
	assertFloat64(t, local.Get(13, "BatteryLevel").Raw, 66)
}

func TestHybridLiveSignalStoreRejectsInvalidInputs(t *testing.T) {
	ctx := context.Background()
	liveStore, err := NewHybridLiveSignalStore(New(), nil, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if _, err := NewHybridLiveSignalStore(nil, nil, LiveSignalStoreModeHybrid); !errors.Is(err, ErrNilLocalSignalStore) {
		t.Fatalf("NewHybridLiveSignalStore(nil) error = %v, want ErrNilLocalSignalStore", err)
	}
	if _, err := ParseLiveSignalStoreMode("remote"); !errors.Is(err, ErrInvalidLiveSignalStoreMode) {
		t.Fatalf("ParseLiveSignalStoreMode(remote) error = %v, want ErrInvalidLiveSignalStoreMode", err)
	}
	if err := liveStore.Update(ctx, 0, map[string]interface{}{"BatteryLevel": 50.0}); !errors.Is(err, ErrInvalidLiveSignalVehicleID) {
		t.Fatalf("Update(invalid vehicle) error = %v, want ErrInvalidLiveSignalVehicleID", err)
	}
	if err := liveStore.Update(ctx, 1, nil); !errors.Is(err, ErrNilLiveSignalBatch) {
		t.Fatalf("Update(nil signals) error = %v, want ErrNilLiveSignalBatch", err)
	}
	if _, err := liveStore.GetSignal(ctx, 1, " ", LiveSignalReadLocal); !errors.Is(err, ErrEmptyLiveSignalName) {
		t.Fatalf("GetSignal(empty name) error = %v, want ErrEmptyLiveSignalName", err)
	}
	if _, err := liveStore.GetAll(ctx, -1, LiveSignalReadLocal); !errors.Is(err, ErrInvalidLiveSignalVehicleID) {
		t.Fatalf("GetAll(invalid vehicle) error = %v, want ErrInvalidLiveSignalVehicleID", err)
	}
	if err := liveStore.Warm(nil, 1); !errors.Is(err, ErrNilLiveSignalContext) {
		t.Fatalf("Warm(nil ctx) error = %v, want ErrNilLiveSignalContext", err)
	}
}

func TestHybridLiveSignalStoreWarmHydratesL1FromRedis(t *testing.T) {
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	if err := redisCache.Update(ctx, 15, map[string]interface{}{
		"BatteryLevel": 77.0,
		"ShiftState":   "N",
	}); err != nil {
		t.Fatalf("RedisSignalCache.Update() error = %v", err)
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	if err := liveStore.Warm(ctx, 15); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}

	assertFloat64(t, local.Get(15, "BatteryLevel").Raw, 77)
	assertString(t, local.Get(15, "ShiftState").Raw, "N")
}

type failingRedisSignalClient struct {
	err error
}

func (f failingRedisSignalClient) HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd {
	return redis.NewIntResult(0, f.err)
}

func (f failingRedisSignalClient) Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd {
	return redis.NewBoolResult(false, f.err)
}

func (f failingRedisSignalClient) HGetAll(ctx context.Context, key string) *redis.MapStringStringCmd {
	return redis.NewMapStringStringResult(nil, f.err)
}

func (f failingRedisSignalClient) HGet(ctx context.Context, key string, field string) *redis.StringCmd {
	return redis.NewStringResult("", f.err)
}

func (f failingRedisSignalClient) Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd {
	return redis.NewIntResult(0, f.err)
}

func (f failingRedisSignalClient) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return nil
}

func TestNewLiveSignalStoreUsesRuntimeModeString(t *testing.T) {
	store, err := NewLiveSignalStore(New(), nil, "local")
	if err != nil {
		t.Fatalf("NewLiveSignalStore(local) error = %v", err)
	}
	hybrid, ok := store.(*HybridLiveSignalStore)
	if !ok {
		t.Fatalf("NewLiveSignalStore() type = %T, want *HybridLiveSignalStore", store)
	}
	if hybrid.Mode() != LiveSignalStoreModeLocal {
		t.Fatalf("Mode() = %s, want local", hybrid.Mode())
	}
}

func ExampleParseLiveSignalStoreMode() {
	mode, err := ParseLiveSignalStoreMode("hybrid")
	fmt.Println(mode, err)
	// Output: hybrid <nil>
}
