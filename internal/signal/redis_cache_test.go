package signal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	miniredis "github.com/alicebob/miniredis/v2"
	dto "github.com/prometheus/client_model/go"
	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
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

func (f *fakeRedisSignalClient) Eval(_ context.Context, _ string, keys []string, args ...interface{}) *redis.Cmd {
	if len(keys) != 1 || len(args) < 1 || (len(args)-1)%3 != 0 {
		return redis.NewCmdResult(nil, errors.New("unexpected timestamped update arguments"))
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	if f.hsetErr != nil {
		return redis.NewCmdResult(nil, f.hsetErr)
	}
	key := keys[0]
	hash, ok := f.hashes[key]
	if !ok {
		hash = make(map[string]string)
		f.hashes[key] = hash
	}
	var written int64
	for i := 1; i < len(args); i += 3 {
		field := fmt.Sprint(args[i])
		incomingTs, err := strconv.ParseInt(fmt.Sprint(args[i+1]), 10, 64)
		if err != nil {
			return redis.NewCmdResult(nil, err)
		}
		if current, exists := hash[field]; exists {
			var envelope redisSignalValueEnvelope
			if jsonErr := json.Unmarshal([]byte(current), &envelope); jsonErr == nil && envelope.TS > incomingTs {
				continue
			}
		}
		hash[field] = fmt.Sprint(args[i+2])
		written++
	}
	return redis.NewCmdResult(written, nil)
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

func (f *fakeRedisSignalClient) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, k := range keys {
		if _, ok := f.hashes[k]; ok {
			delete(f.hashes, k)
			n++
		}
	}
	return redis.NewIntResult(n, nil)
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
	// Typed envelope fields must be present.
	for _, want := range []string{`"kind":`, `"v":`, `"ts":`} {
		if !strings.Contains(stored, want) {
			t.Fatalf("stored timestamped value %q does not contain Phase-42 typed envelope field %q", stored, want)
		}
	}
	// Legacy envelope fields must also be present for mid-rollout decode by
	// old binaries.
	for _, want := range []string{
		`"encoding":"teslasync.signal.v1"`,
		`"timestamp"`,
		`"source":"redis_signal_cache"`,
		`"legacy_value":"72"`,
	} {
		if !strings.Contains(stored, want) {
			t.Fatalf("stored timestamped value %q does not contain pre-Phase-42 fallback field %q", stored, want)
		}
	}

	values, err := cache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	if len(values) != 4 {
		t.Fatalf("GetAllValues() returned %d values, want 4", len(values))
	}
	// Untyped Go int input round-trips as int64 because the typed envelope
	// preserves the producer's runtime type. Callers that
	// want float64 must pass float64 (e.g. real codec output for a
	// ValueKindFloat field).
	assertInt64(t, values["BatteryLevel"].Raw, 72)
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
	// Typed envelope preserves int64 round-trip.
	assertInt64(t, rawValues["Numeric"], 7)
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
		name   string
		key    string
		wantID int64
		wantOK bool
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

func TestPurge_RemovesExistingKey(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	if err := cache.Update(ctx, 7, map[string]interface{}{
		"BatteryLevel": 72.0,
		"Locked":       true,
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	deleted, err := cache.Purge(ctx, 7)
	if err != nil {
		t.Fatalf("Purge() error = %v, want nil", err)
	}
	if !deleted {
		t.Fatalf("Purge() = false, want true (key existed)")
	}
	if _, ok := redisClient.hashes["vehicle:7:signals"]; ok {
		t.Fatalf("Purge() left vehicle:7:signals in fake redis")
	}
	n, _ := cache.RawFieldCount(ctx, 7)
	if n != 0 {
		t.Fatalf("RawFieldCount() after Purge = %d, want 0", n)
	}
}

func TestPurge_MissingKeyIsNoop(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	deleted, err := cache.Purge(ctx, 999)
	if err != nil {
		t.Fatalf("Purge() error = %v, want nil for missing key", err)
	}
	if deleted {
		t.Fatalf("Purge() = true, want false (no key existed)")
	}
}

func TestPurge_DoesNotTouchOtherVehicles(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	if err := cache.Update(ctx, 1, map[string]interface{}{"BatteryLevel": 50.0}); err != nil {
		t.Fatalf("Update(1) error = %v", err)
	}
	if err := cache.Update(ctx, 2, map[string]interface{}{"BatteryLevel": 60.0}); err != nil {
		t.Fatalf("Update(2) error = %v", err)
	}

	if _, err := cache.Purge(ctx, 1); err != nil {
		t.Fatalf("Purge(1) error = %v", err)
	}

	if _, ok := redisClient.hashes["vehicle:1:signals"]; ok {
		t.Fatalf("Purge(1) left vehicle:1:signals behind")
	}
	if _, ok := redisClient.hashes["vehicle:2:signals"]; !ok {
		t.Fatalf("Purge(1) collateral-deleted vehicle:2:signals")
	}
}

func TestPurgeAll_DeletesEveryVehicleKey(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	for _, vid := range []int64{1, 7, 42, 100} {
		if err := cache.Update(ctx, vid, map[string]interface{}{"BatteryLevel": 50.0}); err != nil {
			t.Fatalf("Update(%d) error = %v", vid, err)
		}
	}
	// Sentinel: a non-vehicle key must NOT be touched.
	redisClient.hashes["other:cache"] = map[string]string{"x": "1"}

	purged, scanned, err := cache.PurgeAll(ctx, 1000)
	if err != nil {
		t.Fatalf("PurgeAll() error = %v", err)
	}
	if purged != 4 {
		t.Fatalf("PurgeAll() purged = %d, want 4", purged)
	}
	if scanned != 4 {
		t.Fatalf("PurgeAll() scanned = %d, want 4", scanned)
	}

	for _, vid := range []int64{1, 7, 42, 100} {
		key := fmt.Sprintf("vehicle:%d:signals", vid)
		if _, ok := redisClient.hashes[key]; ok {
			t.Fatalf("PurgeAll() left %s behind", key)
		}
	}
	if _, ok := redisClient.hashes["other:cache"]; !ok {
		t.Fatalf("PurgeAll() collateral-deleted other:cache (non-vehicle key)")
	}
}

func TestPurgeAll_EmptyCacheIsNoop(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	purged, scanned, err := cache.PurgeAll(ctx, 1000)
	if err != nil {
		t.Fatalf("PurgeAll() error = %v, want nil", err)
	}
	if purged != 0 || scanned != 0 {
		t.Fatalf("PurgeAll() = (%d, %d), want (0, 0) for empty cache", purged, scanned)
	}
}

func TestPurgeAll_ReportsScannedAtLimit(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient}

	// Seed 5 vehicles, then ask for limit=2; scanned == limit tells the
	// caller more keys may remain.
	for vid := int64(1); vid <= 5; vid++ {
		if err := cache.Update(ctx, vid, map[string]interface{}{"BatteryLevel": 50.0}); err != nil {
			t.Fatalf("Update(%d) error = %v", vid, err)
		}
	}

	purged, scanned, err := cache.PurgeAll(ctx, 2)
	if err != nil {
		t.Fatalf("PurgeAll() error = %v", err)
	}
	if scanned != 2 {
		t.Fatalf("PurgeAll() scanned = %d, want 2 (== limit, signals more remain)", scanned)
	}
	if purged != 2 {
		t.Fatalf("PurgeAll() purged = %d, want 2", purged)
	}
	// Confirm 3 vehicles still survive in Redis after this limited purge.
	survivors := 0
	for _, vid := range []int64{1, 2, 3, 4, 5} {
		if _, ok := redisClient.hashes[fmt.Sprintf("vehicle:%d:signals", vid)]; ok {
			survivors++
		}
	}
	if survivors != 3 {
		t.Fatalf("survivors after PurgeAll(limit=2) = %d, want 3", survivors)
	}
}

// ── Typed-envelope and stale-cache contract tests ──────────────

func assertInt32(t *testing.T, got interface{}, want int32) {
	t.Helper()
	value, ok := got.(int32)
	if !ok {
		t.Fatalf("value type = %T, want int32", got)
	}
	if value != want {
		t.Fatalf("value = %d, want %d", value, want)
	}
}

func assertInt64(t *testing.T, got interface{}, want int64) {
	t.Helper()
	value, ok := got.(int64)
	if !ok {
		t.Fatalf("value type = %T, want int64", got)
	}
	if value != want {
		t.Fatalf("value = %d, want %d", value, want)
	}
}

func assertFloat32(t *testing.T, got interface{}, want float32) {
	t.Helper()
	value, ok := got.(float32)
	if !ok {
		t.Fatalf("value type = %T, want float32", got)
	}
	if value != want {
		t.Fatalf("value = %v, want %v", value, want)
	}
}

func assertTime(t *testing.T, got interface{}, want time.Time) {
	t.Helper()
	value, ok := got.(time.Time)
	if !ok {
		t.Fatalf("value type = %T, want time.Time", got)
	}
	if !value.Equal(want) {
		t.Fatalf("value = %v, want %v (Equal)", value, want)
	}
}

// readPromCounter extracts the float64 value from a prometheus.Counter
// via the dto.Metric pathway. Necessary because prometheus.Counter
// itself has no public GetValue method. Same pattern used in
// internal/tesla/unit_history/cache_test.go and internal/tesla/bootstrap.
func readPromCounter(t *testing.T, c prometheus_Counter) float64 {
	t.Helper()
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("counter.Write: %v", err)
	}
	if m.Counter == nil || m.Counter.Value == nil {
		return 0
	}
	return *m.Counter.Value
}

// prometheus_Counter is the minimal Counter surface readPromCounter
// needs. Avoids importing the full prometheus package just for one
// type alias in tests.
type prometheus_Counter interface {
	Write(*dto.Metric) error
}

// TestRedisSignalCacheTypedEnvelopeRoundTripPerKind exercises every
// protomodel.ValueKind through encode → store → decode and verifies
// the runtime Go type is preserved end-to-end. This is the core typed-envelope
// guarantee: no silent float64 widening, no string-parse fallback, and no
// untyped JSON-number ambiguity.
func TestRedisSignalCacheTypedEnvelopeRoundTripPerKind(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(101)

	driveStart := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	composite := map[string]interface{}{
		"latitude":  37.0,
		"longitude": -122.0,
	}

	tests := []struct {
		name   string
		field  string // signal name; "" forces runtime-only kind inference
		input  interface{}
		assert func(t *testing.T, got interface{})
	}{
		{
			name:   "string",
			field:  "RoutelineString_test",
			input:  "asleep",
			assert: func(t *testing.T, got interface{}) { assertString(t, got, "asleep") },
		},
		{
			name:   "bool",
			field:  "Charging",
			input:  true,
			assert: func(t *testing.T, got interface{}) { assertBool(t, got, true) },
		},
		{
			name:   "int32",
			field:  "BatteryHeaterOn_test",
			input:  int32(7),
			assert: func(t *testing.T, got interface{}) { assertInt32(t, got, 7) },
		},
		{
			name:   "int64",
			field:  "MyOdometerCounter_test",
			input:  int64(123456789012),
			assert: func(t *testing.T, got interface{}) { assertInt64(t, got, 123456789012) },
		},
		{
			name:   "float32",
			field:  "BatteryLevel",
			input:  float32(72.5),
			assert: func(t *testing.T, got interface{}) { assertFloat32(t, got, 72.5) },
		},
		{
			name:   "float64",
			field:  "VehicleSpeed_test_double",
			input:  float64(88.25),
			assert: func(t *testing.T, got interface{}) { assertFloat64(t, got, 88.25) },
		},
		{
			name:   "enum (string disambiguated by metadata)",
			field:  "Gear", // protomodel: ValueKindEnum
			input:  "D",
			assert: func(t *testing.T, got interface{}) { assertString(t, got, "D") },
		},
		{
			name:   "time",
			field:  "GpsLastUpdate_test",
			input:  driveStart,
			assert: func(t *testing.T, got interface{}) { assertTime(t, got, driveStart) },
		},
		{
			name:  "compound (map)",
			field: "ScheduledChargingStartTime",
			input: composite,
			assert: func(t *testing.T, got interface{}) {
				m, ok := got.(map[string]interface{})
				if !ok {
					t.Fatalf("compound Raw = %T, want map[string]interface{}", got)
				}
				if !mapEquals(m, composite) {
					t.Fatalf("compound roundtrip = %v, want %v", m, composite)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			redisClient := newFakeRedisSignalClient()
			cache := &RedisSignalCache{rdb: redisClient}
			if err := cache.Update(ctx, vehicleID, map[string]interface{}{tc.field: tc.input}); err != nil {
				t.Fatalf("Update() error = %v", err)
			}
			got, err := cache.GetSignalValue(ctx, vehicleID, tc.field)
			if err != nil {
				t.Fatalf("GetSignalValue() error = %v", err)
			}
			if got == nil {
				t.Fatalf("GetSignalValue() returned nil for %s", tc.field)
			}
			tc.assert(t, got.Raw)

			// Verify the typed envelope wire shape.
			stored := redisClient.hashes[redisSignalKey(vehicleID)][tc.field]
			for _, want := range []string{`"kind":`, `"v":`, `"ts":`} {
				if !strings.Contains(stored, want) {
					t.Fatalf("stored value %q missing typed envelope field %q", stored, want)
				}
			}

			// Verify the kind matches the inferred ValueKind for this input.
			wantKind := inferValueKind(tc.field, tc.input)
			wantKindFragment := fmt.Sprintf(`"kind":%d`, int(wantKind))
			if !strings.Contains(stored, wantKindFragment) {
				t.Fatalf("stored value %q missing %q (ValueKind=%s)", stored, wantKindFragment, wantKind)
			}
		})
	}
}

func mapEquals(a, b map[string]interface{}) bool {
	if len(a) != len(b) {
		return false
	}
	for k, av := range a {
		bv, ok := b[k]
		if !ok {
			return false
		}
		// Loose equality: JSON-decoded numbers come back as float64, so
		// compare via fmt.Sprint for tolerance across numeric kinds.
		if fmt.Sprint(av) != fmt.Sprint(bv) {
			return false
		}
	}
	return true
}

// TestGetSignalValueFreshReturnsErrStaleAndAdvisoryValue verifies the
// stale-cache contract: when a value is older than the cache's
// staleAfter window, GetSignalValueFresh returns BOTH the value (so the
// caller has an advisory hint) AND ErrStale (so the caller knows it
// must re-resolve via signal.Store / signal_log). The metric
// tesla_signal_cache_stale_total{vehicle_id, field} MUST also be
// incremented exactly once.
func TestGetSignalValueFreshReturnsErrStaleAndAdvisoryValue(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(202)
	field := "Odometer"

	redisClient := newFakeRedisSignalClient()
	cache := NewRedisSignalCacheForTest(redisClient, 100*time.Millisecond)

	staleTimestamp := time.Now().UTC().Add(-1 * time.Hour)
	encoded, err := encodeTimestampedSignalValueForField(field, float64(125000), staleTimestamp)
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValueForField() error = %v", err)
	}
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{field: encoded}

	beforeMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))

	value, err := cache.GetSignalValueFresh(ctx, vehicleID, field)
	if !errors.Is(err, ErrStale) {
		t.Fatalf("GetSignalValueFresh() err = %v, want ErrStale (errors.Is)", err)
	}
	if value == nil {
		t.Fatal("GetSignalValueFresh() returned nil value with ErrStale; want advisory value preserved")
	}
	assertFloat64(t, value.Raw, 125000)
	if !value.Timestamp.Equal(staleTimestamp) {
		t.Fatalf("advisory value Timestamp = %v, want %v (preserved verbatim)", value.Timestamp, staleTimestamp)
	}

	afterMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))
	if afterMetric-beforeMetric != 1 {
		t.Fatalf("tesla_signal_cache_stale_total{%d, %s} delta = %v, want exactly 1", vehicleID, field, afterMetric-beforeMetric)
	}
}

// TestGetSignalValueFreshTreatsLegacyZeroTimestampAsStale asserts that a
// legacy scalar without a timestamp is treated as stale by the
// freshness-aware reader, since we cannot prove it is fresh. The
// advisory value still flows back so the caller can compare against an
// authoritative re-resolution.
func TestGetSignalValueFreshTreatsLegacyZeroTimestampAsStale(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(203)
	field := "legacy_speed"

	redisClient := newFakeRedisSignalClient()
	cache := NewRedisSignalCacheForTest(redisClient, 2*time.Minute)
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{field: "88.5"}

	beforeMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))

	value, err := cache.GetSignalValueFresh(ctx, vehicleID, field)
	if !errors.Is(err, ErrStale) {
		t.Fatalf("GetSignalValueFresh() err = %v, want ErrStale for legacy zero-Timestamp value", err)
	}
	if value == nil {
		t.Fatal("GetSignalValueFresh() returned nil value with ErrStale; want advisory value preserved")
	}
	assertFloat64(t, value.Raw, 88.5)
	if !value.Timestamp.IsZero() {
		t.Fatalf("legacy advisory Timestamp = %v, want zero (unknown freshness preserved)", value.Timestamp)
	}

	afterMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))
	if afterMetric-beforeMetric != 1 {
		t.Fatalf("stale_total delta = %v, want exactly 1", afterMetric-beforeMetric)
	}
}

// TestGetSignalValueFreshReturnsFreshValueWithoutError is the happy
// path: a value younger than staleAfter MUST come back with err == nil
// and the metric MUST NOT be incremented.
func TestGetSignalValueFreshReturnsFreshValueWithoutError(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(204)
	field := "Charging"

	redisClient := newFakeRedisSignalClient()
	cache := NewRedisSignalCacheForTest(redisClient, 5*time.Minute)
	if err := cache.Update(ctx, vehicleID, map[string]interface{}{field: true}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	beforeMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))

	value, err := cache.GetSignalValueFresh(ctx, vehicleID, field)
	if err != nil {
		t.Fatalf("GetSignalValueFresh() error = %v, want nil for fresh value", err)
	}
	if value == nil {
		t.Fatal("GetSignalValueFresh() returned nil for fresh value")
	}
	assertBool(t, value.Raw, true)

	afterMetric := readPromCounter(t, staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), field))
	if afterMetric != beforeMetric {
		t.Fatalf("stale_total incremented for fresh value: delta = %v", afterMetric-beforeMetric)
	}
}

// TestGetSignalValueFreshReturnsNilForMissingKey verifies that a missing
// key/field returns (nil, nil) rather than ErrStale.
func TestGetSignalValueFreshReturnsNilForMissingKey(t *testing.T) {
	ctx := context.Background()
	cache := NewRedisSignalCacheForTest(newFakeRedisSignalClient(), 2*time.Minute)

	value, err := cache.GetSignalValueFresh(ctx, 999, "Missing")
	if err != nil {
		t.Fatalf("GetSignalValueFresh() error = %v, want nil for missing key", err)
	}
	if value != nil {
		t.Fatalf("GetSignalValueFresh() value = %v, want nil for missing key", value)
	}
}

// TestGetSignalValueFreshDisabledWhenStaleAfterIsZero verifies that
// staleAfter == 0 disables the freshness check entirely (Fresh becomes
// equivalent to GetSignalValue, returning legacy/stale values without
// ErrStale). This is the backward-compat escape hatch tests use via
// direct struct construction.
func TestGetSignalValueFreshDisabledWhenStaleAfterIsZero(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(205)
	field := "Odometer"

	redisClient := newFakeRedisSignalClient()
	cache := &RedisSignalCache{rdb: redisClient} // staleAfter zero-value
	staleTimestamp := time.Now().UTC().Add(-2 * time.Hour)
	encoded, err := encodeTimestampedSignalValueForField(field, float64(99000), staleTimestamp)
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValueForField() error = %v", err)
	}
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{field: encoded}

	value, err := cache.GetSignalValueFresh(ctx, vehicleID, field)
	if err != nil {
		t.Fatalf("GetSignalValueFresh() with staleAfter=0 returned err = %v, want nil", err)
	}
	if value == nil {
		t.Fatal("GetSignalValueFresh() returned nil value with staleAfter=0")
	}
	assertFloat64(t, value.Raw, 99000)
}

// NewRedisSignalCacheForTest constructs a cache around a fake/miniredis
// client with a custom staleAfter. The production NewRedisSignalCache
// requires *redis.Client which the fake client doesn't satisfy, so this
// test-only helper bypasses that constraint while still exercising the
// staleAfter contract end-to-end.
func NewRedisSignalCacheForTest(rdb redisSignalClient, staleAfter time.Duration) *RedisSignalCache {
	return &RedisSignalCache{rdb: rdb, staleAfter: staleAfter}
}

// TestRedisSignalCacheKeyAndChannelInvariance verifies that the public
// Redis surface — the per-vehicle HSET key and the cross-pod Pub/Sub
// channel — has not drifted from the layered live-state contract:
//
//	HSET key:    vehicle:{vehicleID}:signals
//	Pub/Sub:     vehicle_signals
//
// A failure here means a different binary in the cluster (older, or
// running a different fork) will look in the wrong place.
func TestRedisSignalCacheKeyAndChannelInvariance(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(7)

	t.Run("HSET key shape preserved", func(t *testing.T) {
		redisClient := newFakeRedisSignalClient()
		cache := &RedisSignalCache{rdb: redisClient}
		if err := cache.Update(ctx, vehicleID, map[string]interface{}{"x": 1.0}); err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		wantKey := fmt.Sprintf("vehicle:%d:signals", vehicleID)
		if _, ok := redisClient.hashes[wantKey]; !ok {
			keys := make([]string, 0, len(redisClient.hashes))
			for k := range redisClient.hashes {
				keys = append(keys, k)
			}
			t.Fatalf("HSET key %q not present; got keys = %v", wantKey, keys)
		}
	})

	t.Run("Pub/Sub channel name preserved", func(t *testing.T) {
		got := vehicleSignalsChannel
		if got != "vehicle_signals" {
			t.Fatalf("vehicleSignalsChannel = %q, want %q", got, "vehicle_signals")
		}
	})
}

// TestRedisSignalCacheTypedEnvelopeMiniredisRoundTrip exercises the
// typed envelope through a real (in-process) Redis server instead of
// the fake client. This catches encode-side regressions that the fake
// client would mask (e.g. binary-unsafe field names, oversize values,
// HSET semantics drift). Mirrors the miniredis pattern already used by
// internal/api/devtools_handler_test.go.
func TestRedisSignalCacheTypedEnvelopeMiniredisRoundTrip(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cache := NewRedisSignalCache(rdb, WithStaleAfter(2*time.Minute))
	ctx := context.Background()
	vehicleID := int64(303)

	if err := cache.Update(ctx, vehicleID, map[string]interface{}{
		"BatteryLevel": float32(64.0),
		"Charging":     true,
		"Gear":         "D",
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	gotBattery, err := cache.GetSignalValueFresh(ctx, vehicleID, "BatteryLevel")
	if err != nil {
		t.Fatalf("GetSignalValueFresh(BatteryLevel) error = %v", err)
	}
	assertFloat32(t, gotBattery.Raw, 64.0)

	gotCharging, err := cache.GetSignalValueFresh(ctx, vehicleID, "Charging")
	if err != nil {
		t.Fatalf("GetSignalValueFresh(Charging) error = %v", err)
	}
	assertBool(t, gotCharging.Raw, true)

	gotGear, err := cache.GetSignalValueFresh(ctx, vehicleID, "Gear")
	if err != nil {
		t.Fatalf("GetSignalValueFresh(Gear) error = %v", err)
	}
	assertString(t, gotGear.Raw, "D")

	// Verify the on-wire JSON in miniredis includes the typed envelope.
	rawBattery := mr.HGet(fmt.Sprintf("vehicle:%d:signals", vehicleID), "BatteryLevel")
	wantKindFragment := fmt.Sprintf(`"kind":%d`, int(protomodel.ValueKindFloat))
	if !strings.Contains(rawBattery, wantKindFragment) {
		t.Fatalf("miniredis stored BatteryLevel %q missing %q", rawBattery, wantKindFragment)
	}
	for _, want := range []string{`"v":`, `"ts":`} {
		if !strings.Contains(rawBattery, want) {
			t.Fatalf("miniredis stored BatteryLevel %q missing typed envelope field %q", rawBattery, want)
		}
	}
}

// TestRedisSignalCacheStaleMiniredisRejection cross-validates the
// stale contract end-to-end against a real Redis server. Stores a
// value with a stale timestamp via HSET, then asserts GetSignalValueFresh
// returns the advisory value plus ErrStale.
func TestRedisSignalCacheStaleMiniredisRejection(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cache := NewRedisSignalCache(rdb, WithStaleAfter(50*time.Millisecond))
	ctx := context.Background()
	vehicleID := int64(304)
	field := "Odometer"

	staleTimestamp := time.Now().UTC().Add(-1 * time.Hour)
	encoded, err := encodeTimestampedSignalValueForField(field, float64(150000), staleTimestamp)
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValueForField() error = %v", err)
	}
	mr.HSet(fmt.Sprintf("vehicle:%d:signals", vehicleID), field, encoded)

	value, err := cache.GetSignalValueFresh(ctx, vehicleID, field)
	if !errors.Is(err, ErrStale) {
		t.Fatalf("GetSignalValueFresh() err = %v, want ErrStale", err)
	}
	if value == nil {
		t.Fatal("GetSignalValueFresh() returned nil value with ErrStale")
	}
	assertFloat64(t, value.Raw, 150000)
	if !value.Timestamp.Equal(staleTimestamp) {
		t.Fatalf("advisory Timestamp = %v, want %v", value.Timestamp, staleTimestamp)
	}
}

// TestNewRedisSignalCacheDefaultsStaleAfterTo2Minutes documents the
// constructor default — the live-state contract pins this at the
// LiveSignalFreshnessThreshold so distributed callers cannot accidentally
// miss the rejection path.
func TestNewRedisSignalCacheDefaultsStaleAfterTo2Minutes(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cache := NewRedisSignalCache(rdb)
	if cache.staleAfter != 2*time.Minute {
		t.Fatalf("default staleAfter = %v, want 2m", cache.staleAfter)
	}
	if cache.staleAfter != LiveSignalFreshnessThreshold {
		t.Fatalf("default staleAfter (%v) drifted from LiveSignalFreshnessThreshold (%v)", cache.staleAfter, LiveSignalFreshnessThreshold)
	}
}

// TestWithStaleAfterOverride verifies the constructor option.
func TestWithStaleAfterOverride(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cache := NewRedisSignalCache(rdb, WithStaleAfter(7*time.Second))
	if cache.staleAfter != 7*time.Second {
		t.Fatalf("WithStaleAfter override staleAfter = %v, want 7s", cache.staleAfter)
	}
}

func TestRedisSignalCacheUpdateValuesLuaRejectsOlderReplay(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	cache := NewRedisSignalCache(rdb)
	ctx := context.Background()
	newer := time.Date(2026, 8, 29, 10, 0, 0, 987654321, time.UTC)
	older := newer.Add(-7 * 24 * time.Hour)

	if err := cache.UpdateValues(ctx, 77, map[string]*Value{
		"BatteryLevel": {Raw: float32(81), Timestamp: newer},
	}); err != nil {
		t.Fatalf("UpdateValues(newer) error = %v", err)
	}
	if err := cache.UpdateValues(ctx, 77, map[string]*Value{
		"BatteryLevel": {Raw: float32(12), Timestamp: older},
	}); err != nil {
		t.Fatalf("UpdateValues(older) error = %v", err)
	}

	got, err := cache.GetSignalValue(ctx, 77, "BatteryLevel")
	if err != nil {
		t.Fatalf("GetSignalValue() error = %v", err)
	}
	if got == nil || !got.Timestamp.Equal(newer) {
		t.Fatalf("Redis value = %#v, want event time %v", got, newer)
	}
	assertFloat32(t, got.Raw, 81)
}
