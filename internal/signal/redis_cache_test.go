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

func (f *fakeRedisSignalClient) HLen(ctx context.Context, key string) *redis.IntCmd {
	f.mu.RLock()
	defer f.mu.RUnlock()
	hash, ok := f.hashes[key]
	if !ok {
		return redis.NewIntResult(0, nil)
	}
	return redis.NewIntResult(int64(len(hash)), nil)
}

func (f *fakeRedisSignalClient) Scan(ctx context.Context, cursor uint64, match string, count int64) *redis.ScanCmd {
	// Naive but deterministic: collect every matching key, return in
	// one shot with cursor=0. Sufficient for tests that don't care about
	// real pagination — the caller's loop handles cursor=0 → done.
	f.mu.RLock()
	keys := make([]string, 0, len(f.hashes))
	for k := range f.hashes {
		if matchesGlob(k, match) {
			keys = append(keys, k)
		}
	}
	f.mu.RUnlock()
	return redis.NewScanCmdResult(keys, 0, nil)
}

// matchesGlob is a minimal glob matcher for the SCAN MATCH patterns used
// in tests: only `*` wildcards are supported.
func matchesGlob(s, pattern string) bool {
	parts := strings.Split(pattern, "*")
	if len(parts) == 1 {
		return s == pattern
	}
	if !strings.HasPrefix(s, parts[0]) {
		return false
	}
	if !strings.HasSuffix(s, parts[len(parts)-1]) {
		return false
	}
	cursor := len(parts[0])
	for i := 1; i < len(parts)-1; i++ {
		idx := strings.Index(s[cursor:], parts[i])
		if idx < 0 {
			return false
		}
		cursor += idx + len(parts[i])
	}
	return true
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


func TestParseVehicleSignalsKey(t *testing.T) {
tests := []struct {
name    string
key     string
wantID  int64
wantOK  bool
}{
{name: "valid id 1", key: "vehicle:1:signals", wantID: 1, wantOK: true},
{name: "valid id 42", key: "vehicle:42:signals", wantID: 42, wantOK: true},
{name: "valid large id", key: "vehicle:9223372036854775807:signals", wantID: 9223372036854775807, wantOK: true},
{name: "missing prefix", key: "veh:1:signals", wantOK: false},
{name: "missing suffix", key: "vehicle:1:signal", wantOK: false},
{name: "non-numeric id", key: "vehicle:abc:signals", wantOK: false},
{name: "empty id", key: "vehicle::signals", wantOK: false},
{name: "negative id", key: "vehicle:-3:signals", wantOK: false},
{name: "zero id", key: "vehicle:0:signals", wantOK: false},
{name: "empty string", key: "", wantOK: false},
{name: "wrong prefix entirely", key: "other:1:signals", wantOK: false},
}
for _, tc := range tests {
t.Run(tc.name, func(t *testing.T) {
id, ok := parseVehicleSignalsKey(tc.key)
if ok != tc.wantOK {
t.Fatalf("parseVehicleSignalsKey(%q) ok = %v, want %v", tc.key, ok, tc.wantOK)
}
if ok && id != tc.wantID {
t.Fatalf("parseVehicleSignalsKey(%q) id = %d, want %d", tc.key, id, tc.wantID)
}
})
}
}

func TestRawFieldCount_EmptyKey(t *testing.T) {
ctx := context.Background()
redisClient := newFakeRedisSignalClient()
cache := &RedisSignalCache{rdb: redisClient}

n, err := cache.RawFieldCount(ctx, 99)
if err != nil {
t.Fatalf("RawFieldCount() error = %v, want nil", err)
}
if n != 0 {
t.Fatalf("RawFieldCount() = %d, want 0 for missing key", n)
}
}

func TestRawFieldCount_PopulatedKey(t *testing.T) {
ctx := context.Background()
redisClient := newFakeRedisSignalClient()
cache := &RedisSignalCache{rdb: redisClient}

if err := cache.Update(ctx, 7, map[string]interface{}{
"BatteryLevel": 72.0,
"VehicleSpeed": 0.0,
"Locked":       true,
}); err != nil {
t.Fatalf("Update() error = %v", err)
}
n, err := cache.RawFieldCount(ctx, 7)
if err != nil {
t.Fatalf("RawFieldCount() error = %v, want nil", err)
}
if n != 3 {
t.Fatalf("RawFieldCount() = %d, want 3", n)
}
}

func TestScanVehicleKeys_FiltersMalformedKeys(t *testing.T) {
ctx := context.Background()
redisClient := newFakeRedisSignalClient()
cache := &RedisSignalCache{rdb: redisClient}

// Seed Redis with a deliberate mix of well-formed and malformed keys.
redisClient.hashes["vehicle:1:signals"] = map[string]string{"a": "1"}
redisClient.hashes["vehicle:7:signals"] = map[string]string{"b": "2"}
redisClient.hashes["vehicle:abc:signals"] = map[string]string{"c": "3"}
redisClient.hashes["vehicle::signals"] = map[string]string{"d": "4"}
redisClient.hashes["other:1:signals"] = map[string]string{"e": "5"}

got, err := cache.ScanVehicleKeys(ctx, 50)
if err != nil {
t.Fatalf("ScanVehicleKeys() error = %v", err)
}

// Sort by id since map iteration is non-deterministic in the fake client.
wantSet := map[int64]bool{1: true, 7: true}
if len(got) != len(wantSet) {
t.Fatalf("ScanVehicleKeys() returned %d ids, want %d (got=%v)", len(got), len(wantSet), got)
}
for _, id := range got {
if !wantSet[id] {
t.Fatalf("ScanVehicleKeys() returned unexpected id %d (got=%v)", id, got)
}
delete(wantSet, id)
}
if len(wantSet) != 0 {
t.Fatalf("ScanVehicleKeys() missing expected ids %v", wantSet)
}
// "other:*" must NOT be matched by the SCAN MATCH "vehicle:*:signals".
for _, id := range got {
if id <= 0 {
t.Fatalf("ScanVehicleKeys() returned non-positive id %d", id)
}
}
}

func TestScanVehicleKeys_RespectsLimit(t *testing.T) {
ctx := context.Background()
redisClient := newFakeRedisSignalClient()
cache := &RedisSignalCache{rdb: redisClient}

for i := int64(1); i <= 50; i++ {
key := fmt.Sprintf("vehicle:%d:signals", i)
redisClient.hashes[key] = map[string]string{"x": "1"}
}

got, err := cache.ScanVehicleKeys(ctx, 10)
if err != nil {
t.Fatalf("ScanVehicleKeys() error = %v", err)
}
if len(got) != 10 {
t.Fatalf("ScanVehicleKeys(limit=10) returned %d ids, want 10", len(got))
}
}
