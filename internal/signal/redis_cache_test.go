package signal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type fakeRedisHSetCall struct {
	Key    string
	Fields []interface{}
}

type fakeRedisExpireCall struct {
	Key      string
	Duration time.Duration
}

type fakeRedisSignalClient struct {
	mu     sync.RWMutex
	hashes map[string]map[string]string

	// Optional recorders. Always populated; tests that don't read them ignore them.
	hsetCalls   []fakeRedisHSetCall
	expireCalls []fakeRedisExpireCall

	// Optional error injection. When non-nil, every subsequent HSet call
	// returns this error and does NOT mutate the hash. Set after seeding to
	// exercise partial-failure paths.
	hsetErr error
}

func newFakeRedisSignalClient() *fakeRedisSignalClient {
	return &fakeRedisSignalClient{
		hashes: make(map[string]map[string]string),
	}
}

func (f *fakeRedisSignalClient) HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd {
	if len(values)%2 != 0 {
		return redis.NewIntResult(0, errors.New("HSet requires field/value pairs"))
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	fieldsCopy := append([]interface{}(nil), values...)
	f.hsetCalls = append(f.hsetCalls, fakeRedisHSetCall{Key: key, Fields: fieldsCopy})

	if f.hsetErr != nil {
		return redis.NewIntResult(0, f.hsetErr)
	}

	hash, ok := f.hashes[key]
	if !ok {
		hash = make(map[string]string, len(values)/2)
		f.hashes[key] = hash
	}
	for i := 0; i < len(values); i += 2 {
		hash[fmt.Sprint(values[i])] = fmt.Sprint(values[i+1])
	}
	return redis.NewIntResult(int64(len(values)/2), nil)
}

func (f *fakeRedisSignalClient) Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd {
	f.mu.Lock()
	f.expireCalls = append(f.expireCalls, fakeRedisExpireCall{Key: key, Duration: expiration})
	f.mu.Unlock()
	return redis.NewBoolResult(true, nil)
}

func (f *fakeRedisSignalClient) snapshotHSetCalls() []fakeRedisHSetCall {
	f.mu.RLock()
	defer f.mu.RUnlock()
	out := make([]fakeRedisHSetCall, len(f.hsetCalls))
	copy(out, f.hsetCalls)
	return out
}

func (f *fakeRedisSignalClient) snapshotExpireCalls() []fakeRedisExpireCall {
	f.mu.RLock()
	defer f.mu.RUnlock()
	out := make([]fakeRedisExpireCall, len(f.expireCalls))
	copy(out, f.expireCalls)
	return out
}

func (f *fakeRedisSignalClient) HGetAll(ctx context.Context, key string) *redis.MapStringStringCmd {
	f.mu.RLock()
	defer f.mu.RUnlock()

	hash, ok := f.hashes[key]
	if !ok {
		return redis.NewMapStringStringResult(nil, nil)
	}
	result := make(map[string]string, len(hash))
	for field, value := range hash {
		result[field] = value
	}
	return redis.NewMapStringStringResult(result, nil)
}

func (f *fakeRedisSignalClient) HGet(ctx context.Context, key string, field string) *redis.StringCmd {
	f.mu.RLock()
	defer f.mu.RUnlock()

	hash, ok := f.hashes[key]
	if !ok {
		return redis.NewStringResult("", redis.Nil)
	}
	value, ok := hash[field]
	if !ok {
		return redis.NewStringResult("", redis.Nil)
	}
	return redis.NewStringResult(value, nil)
}

func (f *fakeRedisSignalClient) Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd {
	return redis.NewIntResult(0, nil)
}

func (f *fakeRedisSignalClient) Subscribe(ctx context.Context, channels ...string) *redis.PubSub {
	return nil
}

func TestRedisSignalCacheTimestampedValuesRoundTrip(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(42)

	before := time.Now().UTC()
	if err := cache.Update(ctx, vehicleID, map[string]interface{}{
		"BatteryLevel": 72,
		"Charging":     true,
		"DriveState":   "D",
		"Composite": map[string]interface{}{
			"nested": "value",
			"power":  1.5,
		},
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	after := time.Now().UTC()

	stored := redisClient.hashes[redisSignalKey(vehicleID)]["BatteryLevel"]
	for _, want := range []string{
		`"encoding":"teslasync.signal.v1"`,
		`"timestamp"`,
		`"source":"redis_signal_cache"`,
		`"legacy_value":"72"`,
	} {
		if !strings.Contains(stored, want) {
			t.Fatalf("stored timestamped value %q does not contain %q", stored, want)
		}
	}

	values, err := cache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	if len(values) != 4 {
		t.Fatalf("GetAllValues() returned %d values, want 4", len(values))
	}
	assertFloat64(t, values["BatteryLevel"].Raw, 72)
	assertBool(t, values["Charging"].Raw, true)
	assertString(t, values["DriveState"].Raw, "D")
	assertTimestampBetween(t, values["BatteryLevel"].Timestamp, before, after)

	composite, ok := values["Composite"].Raw.(map[string]interface{})
	if !ok {
		t.Fatalf("Composite Raw type = %T, want map[string]interface{}", values["Composite"].Raw)
	}
	assertString(t, composite["nested"], "value")
	assertFloat64(t, composite["power"], 1.5)

	driveState, err := cache.GetSignalValue(ctx, vehicleID, "DriveState")
	if err != nil {
		t.Fatalf("GetSignalValue() error = %v", err)
	}
	assertString(t, driveState.Raw, "D")
	assertTimestampBetween(t, driveState.Timestamp, before, after)
}

func TestRedisSignalCacheLegacyScalarValuesDecodeWithUnknownFreshness(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(7)
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"legacy_speed":  "88.5",
		"legacy_online": "true",
		"legacy_state":  "asleep",
	}

	rawValues, err := cache.GetAll(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	assertFloat64(t, rawValues["legacy_speed"], 88.5)
	assertBool(t, rawValues["legacy_online"], true)
	assertString(t, rawValues["legacy_state"], "asleep")

	values, err := cache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	assertFloat64(t, values["legacy_speed"].Raw, 88.5)
	assertBool(t, values["legacy_online"].Raw, true)
	assertString(t, values["legacy_state"].Raw, "asleep")
	for name, value := range values {
		if !value.Timestamp.IsZero() {
			t.Fatalf("%s legacy timestamp = %v, want zero unknown freshness", name, value.Timestamp)
		}
		if IsLiveSignalFresh(value, time.Now().UTC()) {
			t.Fatalf("%s legacy scalar value was marked fresh", name)
		}
	}

	state, err := cache.GetSignalValue(ctx, vehicleID, "legacy_state")
	if err != nil {
		t.Fatalf("GetSignalValue() error = %v", err)
	}
	assertString(t, state.Raw, "asleep")
	if !state.Timestamp.IsZero() {
		t.Fatalf("legacy GetSignalValue timestamp = %v, want zero", state.Timestamp)
	}
}

func TestRedisSignalCacheMalformedJSONSurfacesForTimestampAwareReads(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(9)
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"Malformed": `{"encoding":"teslasync.signal.v1","value":`,
	}

	if _, err := cache.GetSignalValue(ctx, vehicleID, "Malformed"); err == nil {
		t.Fatal("GetSignalValue() error = nil, want malformed JSON error")
	}
	if _, err := cache.GetAllValues(ctx, vehicleID); err == nil {
		t.Fatal("GetAllValues() error = nil, want malformed JSON error")
	}

	raw, err := cache.GetSignal(ctx, vehicleID, "Malformed")
	if err != nil {
		t.Fatalf("GetSignal() error = %v", err)
	}
	assertString(t, raw, `{"encoding":"teslasync.signal.v1","value":`)
}

func TestLiveSignalFreshnessThresholdDistinguishesStaleAndLegacyValues(t *testing.T) {
	now := time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC)
	fresh := &Value{Raw: "fresh", Timestamp: now.Add(-LiveSignalFreshnessThreshold)}
	stale := &Value{Raw: "stale", Timestamp: now.Add(-LiveSignalFreshnessThreshold - time.Nanosecond)}
	legacy := &Value{Raw: "legacy"}

	if !IsLiveSignalFresh(fresh, now) {
		t.Fatal("fresh timestamp inside the 2-minute threshold was marked stale")
	}
	if IsLiveSignalFresh(stale, now) {
		t.Fatal("stale timestamp older than the 2-minute threshold was marked fresh")
	}
	if IsLiveSignalFresh(legacy, now) {
		t.Fatal("legacy scalar value with zero timestamp was marked fresh")
	}
	if IsLiveSignalFresh(nil, now) {
		t.Fatal("nil value was marked fresh")
	}
}

func TestRedisSignalCacheGetAllRemainsRawCompatibleWithTimestampedValues(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(11)

	if err := cache.Update(ctx, vehicleID, map[string]interface{}{
		"Numeric": int64(7),
		"Bool":    false,
		"Text":    "parked",
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	rawValues, err := cache.GetAll(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	if len(rawValues) != 3 {
		t.Fatalf("GetAll() returned %d values, want 3", len(rawValues))
	}
	assertFloat64(t, rawValues["Numeric"], 7)
	assertBool(t, rawValues["Bool"], false)
	assertString(t, rawValues["Text"], "parked")
}

func redisSignalKey(vehicleID int64) string {
	return fmt.Sprintf("vehicle:%d:signals", vehicleID)
}

func assertTimestampBetween(t *testing.T, got, start, end time.Time) {
	t.Helper()
	if got.IsZero() {
		t.Fatal("timestamp is zero, want timestamp from Redis value")
	}
	if got.Before(start) || got.After(end) {
		t.Fatalf("timestamp = %v, want between %v and %v", got, start, end)
	}
}

func assertFloat64(t *testing.T, got interface{}, want float64) {
	t.Helper()
	value, ok := got.(float64)
	if !ok {
		t.Fatalf("value type = %T, want float64", got)
	}
	if value != want {
		t.Fatalf("value = %v, want %v", value, want)
	}
}

func assertBool(t *testing.T, got interface{}, want bool) {
	t.Helper()
	value, ok := got.(bool)
	if !ok {
		t.Fatalf("value type = %T, want bool", got)
	}
	if value != want {
		t.Fatalf("value = %v, want %v", value, want)
	}
}

func assertString(t *testing.T, got interface{}, want string) {
	t.Helper()
	value, ok := got.(string)
	if !ok {
		t.Fatalf("value type = %T, want string", got)
	}
	if value != want {
		t.Fatalf("value = %q, want %q", value, want)
	}
}
