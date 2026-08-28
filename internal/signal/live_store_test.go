package signal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
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

func TestHybridLiveSignalStoreUpdateNonBlockingWritesL1AndAttemptsL2(t *testing.T) {
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if err := liveStore.UpdateNonBlocking(ctx, 8, map[string]interface{}{
		"BatteryLevel": 45.0,
	}); err != nil {
		t.Fatalf("UpdateNonBlocking() error = %v", err)
	}

	assertFloat64(t, local.Get(8, "BatteryLevel").Raw, 45)
	redisValue := waitForRedisSignalValue(t, redisCache, 8, "BatteryLevel")
	assertFloat64(t, redisValue.Raw, 45)
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
	// Under the per-signal merge rule, the value with the newer non-zero
	// Timestamp wins. The L1 update happens before the L2 update, so the L2
	// envelope carries a strictly later timestamp and wins by the merge rule
	// (not by unconditional Redis preference). See the dedicated merge tests
	// below for the full contract.
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

func TestHybridLiveSignalStoreUpdateNonBlockingRedisFailureStillUpdatesL1(t *testing.T) {
	ctx := context.Background()
	local := New()
	redisErr := errors.New("redis unavailable")
	redisCache := &RedisSignalCache{rdb: failingRedisSignalClient{err: redisErr}}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if err := liveStore.UpdateNonBlocking(ctx, 14, map[string]interface{}{"Gear": "D"}); err != nil {
		t.Fatalf("UpdateNonBlocking() error = %v", err)
	}
	assertString(t, local.Get(14, "Gear").Raw, "D")
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
	if local.Get(15, "BatteryLevel").TimestampSynthetic {
		t.Fatal("ordinary Redis cache write was marked synthetic after Warm")
	}
}

func TestHybridLiveSignalStoreWarmRestampsLegacyScalarsToEnvelopes(t *testing.T) {
	// Warm rewrites legacy scalar Redis values as envelope JSON with a
	// synthetic time.Now() timestamp. Values round-trip through
	// decodeLegacySignalValue -> encodeTimestampedSignalValue without type
	// coercion (number stays float64, bool stays bool).
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	vehicleID := int64(41)
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"Odometer":   "100",
		"InsideTemp": "22.5",
		"Locked":     "true",
	}
	redisCache := &RedisSignalCache{rdb: redisClient}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	before := time.Now().UTC()
	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}
	after := time.Now().UTC()

	values, err := redisCache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	if len(values) != 3 {
		t.Fatalf("GetAllValues() returned %d entries, want 3", len(values))
	}
	assertFloat64(t, values["Odometer"].Raw, 100)
	assertFloat64(t, values["InsideTemp"].Raw, 22.5)
	assertBool(t, values["Locked"].Raw, true)
	for name, value := range values {
		if value.Timestamp.IsZero() {
			t.Fatalf("%s Timestamp is zero after restamp, want non-zero envelope timestamp", name)
		}
		if !value.TimestampSynthetic {
			t.Fatalf("%s timestamp was presented as an observation after legacy restamp", name)
		}
		if value.Timestamp.Before(before) || value.Timestamp.After(after) {
			t.Fatalf("%s Timestamp = %v, want within [%v, %v]", name, value.Timestamp, before, after)
		}
	}

	rawHash := redisClient.hashes[redisSignalKey(vehicleID)]
	for _, field := range []string{"Odometer", "InsideTemp", "Locked"} {
		raw := rawHash[field]
		for _, want := range []string{
			`"encoding":"teslasync.signal.v1"`,
			`"observed":false`,
			`"timestamp"`,
			`"source":"redis_signal_cache"`,
		} {
			if !strings.Contains(raw, want) {
				t.Fatalf("restamped %s raw = %q does not contain %q", field, raw, want)
			}
		}
	}
}

func TestRedisEnvelopeWithoutObservationMarkerIsConservativelySynthetic(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisSignalClient()
	vehicleID := int64(46)
	encoded, err := encodeTimestampedSignalValueForField(
		"BatteryLevel",
		72.0,
		time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("encode envelope: %v", err)
	}
	var envelope map[string]interface{}
	if err := json.Unmarshal([]byte(encoded), &envelope); err != nil {
		t.Fatalf("decode envelope fixture: %v", err)
	}
	delete(envelope, "observed")
	legacyBytes, err := json.Marshal(envelope)
	if err != nil {
		t.Fatalf("encode pre-marker envelope: %v", err)
	}
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"BatteryLevel": string(legacyBytes),
	}

	cache := &RedisSignalCache{rdb: redisClient}
	values, err := cache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	value := values["BatteryLevel"]
	if value == nil || !value.TimestampSynthetic {
		t.Fatalf("pre-marker envelope = %#v, want conservative synthetic provenance", value)
	}
}

func TestHybridLiveSignalStoreWarmDoesNotOverwriteFreshEnvelopes(t *testing.T) {
	// W2 (R2, R7): Fresh envelope entries are NOT re-encoded by the
	// restamp path. Only legacy fields appear in the post-Warm HSET
	// payload. Existing fresh envelope bytes remain unchanged across Warm.
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(42)
	if err := redisCache.Update(ctx, vehicleID, map[string]interface{}{"BatteryLevel": 64.0}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	hsetCallsAfterSeed := len(redisClient.snapshotHSetCalls())

	redisClient.mu.Lock()
	redisClient.hashes[redisSignalKey(vehicleID)]["Odometer"] = "100"
	freshEnvelopeBefore := redisClient.hashes[redisSignalKey(vehicleID)]["BatteryLevel"]
	redisClient.mu.Unlock()

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}

	freshEnvelopeAfter := redisClient.hashes[redisSignalKey(vehicleID)]["BatteryLevel"]
	if freshEnvelopeAfter != freshEnvelopeBefore {
		t.Fatalf("fresh envelope bytes mutated by Warm:\n  before=%q\n  after =%q", freshEnvelopeBefore, freshEnvelopeAfter)
	}

	odometer, err := redisCache.GetSignalValue(ctx, vehicleID, "Odometer")
	if err != nil {
		t.Fatalf("GetSignalValue(Odometer) error = %v", err)
	}
	assertFloat64(t, odometer.Raw, 100)
	if odometer.Timestamp.IsZero() {
		t.Fatal("Odometer Timestamp is zero after Warm, want envelope-stamped value")
	}

	hsetCalls := redisClient.snapshotHSetCalls()
	if len(hsetCalls) != hsetCallsAfterSeed+1 {
		t.Fatalf("Warm issued %d new HSet calls, want exactly 1 (restamp only)", len(hsetCalls)-hsetCallsAfterSeed)
	}
	restampCall := hsetCalls[len(hsetCalls)-1]
	for i := 0; i < len(restampCall.Fields); i += 2 {
		fieldName := fmt.Sprint(restampCall.Fields[i])
		if fieldName == "BatteryLevel" {
			t.Fatalf("restamp HSet payload contains fresh envelope field BatteryLevel; want only legacy fields")
		}
	}
	if len(restampCall.Fields) != 2 || fmt.Sprint(restampCall.Fields[0]) != "Odometer" {
		t.Fatalf("restamp HSet payload = %v, want only [Odometer, <envelope>]", restampCall.Fields)
	}
}

func TestHybridLiveSignalStoreWarmIsIdempotentOnSecondCall(t *testing.T) {
	// W3 (R3): Warm twice in a row produces the same hash bytes as
	// Warm once. The second call detects zero legacy entries and issues
	// no additional HSet writes.
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	vehicleID := int64(43)
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{"Odometer": "100"}
	redisCache := &RedisSignalCache{rdb: redisClient}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() first error = %v", err)
	}
	c1 := len(redisClient.snapshotHSetCalls())
	if c1 < 1 {
		t.Fatalf("first Warm issued %d HSet calls, want >= 1 restamp write", c1)
	}
	odometerSnapshot1 := redisClient.hashes[redisSignalKey(vehicleID)]["Odometer"]

	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() second error = %v", err)
	}
	c2 := len(redisClient.snapshotHSetCalls())
	if c2 != c1 {
		t.Fatalf("second Warm issued %d additional HSet calls; want zero (idempotent)", c2-c1)
	}
	odometerSnapshot2 := redisClient.hashes[redisSignalKey(vehicleID)]["Odometer"]
	if odometerSnapshot1 != odometerSnapshot2 {
		t.Fatalf("Odometer envelope bytes mutated on second Warm:\n  first =%q\n  second=%q", odometerSnapshot1, odometerSnapshot2)
	}
}

func TestHybridLiveSignalStoreWarmRestampPartialFailureDoesNotCorrupt(t *testing.T) {
	// W4 (R4, R7): When the restamp HSet fails mid-run, no field is
	// deleted, fresh envelopes remain byte-identical, legacy entries
	// remain readable as legacy scalars, and L1 is NOT mutated.
	ctx := context.Background()
	local := New()
	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	vehicleID := int64(44)
	if err := redisCache.Update(ctx, vehicleID, map[string]interface{}{"BatteryLevel": 64.0}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	redisClient.mu.Lock()
	redisClient.hashes[redisSignalKey(vehicleID)]["Odometer"] = "100"
	redisClient.hashes[redisSignalKey(vehicleID)]["InsideTemp"] = "22.5"
	freshEnvelopeBefore := redisClient.hashes[redisSignalKey(vehicleID)]["BatteryLevel"]
	odometerBefore := redisClient.hashes[redisSignalKey(vehicleID)]["Odometer"]
	insideTempBefore := redisClient.hashes[redisSignalKey(vehicleID)]["InsideTemp"]
	redisClient.mu.Unlock()

	sentinel := errors.New("restamp HSet sentinel failure")
	redisClient.mu.Lock()
	redisClient.hsetErr = sentinel
	redisClient.mu.Unlock()

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	warmErr := liveStore.Warm(ctx, vehicleID)
	if warmErr == nil {
		t.Fatal("Warm() error = nil, want restamp HSet failure surfaced")
	}
	if !errors.Is(warmErr, sentinel) {
		t.Fatalf("Warm() error = %v, want errors.Is(err, sentinel)", warmErr)
	}
	if !strings.Contains(warmErr.Error(), "warm live signals from Redis for vehicle 44") {
		t.Fatalf("Warm() error = %q, want wrapped via existing 'warm live signals from Redis for vehicle %%d' format", warmErr.Error())
	}

	hash := redisClient.hashes[redisSignalKey(vehicleID)]
	if _, ok := hash["Odometer"]; !ok {
		t.Fatal("Odometer field deleted after partial-failure Warm; restamp must not DEL")
	}
	if _, ok := hash["InsideTemp"]; !ok {
		t.Fatal("InsideTemp field deleted after partial-failure Warm; restamp must not DEL")
	}
	if _, ok := hash["BatteryLevel"]; !ok {
		t.Fatal("BatteryLevel field deleted after partial-failure Warm; restamp must not DEL")
	}
	if hash["BatteryLevel"] != freshEnvelopeBefore {
		t.Fatalf("fresh envelope bytes mutated on partial-failure path:\n  before=%q\n  after =%q", freshEnvelopeBefore, hash["BatteryLevel"])
	}
	if hash["Odometer"] != odometerBefore {
		t.Fatalf("Odometer raw bytes mutated on partial-failure path:\n  before=%q\n  after =%q", odometerBefore, hash["Odometer"])
	}
	if hash["InsideTemp"] != insideTempBefore {
		t.Fatalf("InsideTemp raw bytes mutated on partial-failure path:\n  before=%q\n  after =%q", insideTempBefore, hash["InsideTemp"])
	}

	if got := local.Get(vehicleID, "Odometer"); got != nil {
		t.Fatalf("L1 Odometer = %#v after partial-failure Warm; want nil (no L1 mutation on failure)", got)
	}
	if got := local.Get(vehicleID, "InsideTemp"); got != nil {
		t.Fatalf("L1 InsideTemp = %#v after partial-failure Warm; want nil (no L1 mutation on failure)", got)
	}
}

func TestHybridLiveSignalStoreWarmHydratesL1AfterRestamp(t *testing.T) {
	// W5 (R5): After restamp, previously-skipped legacy entries flow
	// through hydrateMissingValues into L1. Pre-existing L1 entries
	// win over restamped Redis entries (live-wins / skip-when-exists).
	ctx := context.Background()
	local := New()
	vehicleID := int64(45)
	redisClient := newFakeRedisSignalClient()
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"Odometer":     "100",
		"BatteryLevel": "72",
	}
	redisCache := &RedisSignalCache{rdb: redisClient}
	local.Update(vehicleID, map[string]interface{}{"BatteryLevel": 80.0})

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}

	ids := liveStore.LocalVehicleIDs()
	found := false
	for _, id := range ids {
		if id == vehicleID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("LocalVehicleIDs() = %v, want vehicle %d present", ids, vehicleID)
	}

	odometer := local.Get(vehicleID, "Odometer")
	if odometer == nil {
		t.Fatal("local.Get(Odometer) = nil after Warm; want hydrated from restamped legacy entry")
	}
	assertFloat64(t, odometer.Raw, 100)

	battery := local.Get(vehicleID, "BatteryLevel")
	if battery == nil {
		t.Fatal("local.Get(BatteryLevel) = nil; want pre-existing L1 entry preserved")
	}
	assertFloat64(t, battery.Raw, 80)

	values, err := redisCache.GetAllValues(ctx, vehicleID)
	if err != nil {
		t.Fatalf("GetAllValues() error = %v", err)
	}
	if values["Odometer"] == nil || values["Odometer"].Timestamp.IsZero() {
		t.Fatalf("Odometer in Redis = %#v, want envelope-stamped after restamp", values["Odometer"])
	}
	if values["BatteryLevel"] == nil || values["BatteryLevel"].Timestamp.IsZero() {
		t.Fatalf("BatteryLevel in Redis = %#v, want envelope-stamped after restamp", values["BatteryLevel"])
	}
}

func TestHybridLiveSignalStoreWarmRestampRefreshesKeyTTL(t *testing.T) {
	// W6 (R6): The restamp path goes through RedisSignalCache.Update
	// (or its TTL-refreshing equivalent) so EXPIRE is issued for the
	// vehicle key with signalKeyTTL == 7 * 24 * time.Hour.
	ctx := context.Background()
	local := New()
	vehicleID := int64(46)
	redisClient := newFakeRedisSignalClient()
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{"Odometer": "100"}
	redisCache := &RedisSignalCache{rdb: redisClient}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	if err := liveStore.Warm(ctx, vehicleID); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}

	expireCalls := redisClient.snapshotExpireCalls()
	want := signalKeyTTL
	wantKey := redisSignalKey(vehicleID)
	matched := false
	for _, call := range expireCalls {
		if call.Key == wantKey && call.Duration == want {
			matched = true
			break
		}
	}
	if !matched {
		t.Fatalf("Expire calls = %#v, want at least one with key=%q duration=%v (signalKeyTTL)", expireCalls, wantKey, want)
	}
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

func (f failingRedisSignalClient) HLen(ctx context.Context, key string) *redis.IntCmd {
	return redis.NewIntResult(0, f.err)
}

func (f failingRedisSignalClient) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	return redis.NewIntResult(0, f.err)
}

func (f failingRedisSignalClient) Scan(ctx context.Context, cursor uint64, match string, count int64) *redis.ScanCmd {
	return redis.NewScanCmdResult(nil, 0, f.err)
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

func waitForRedisSignalValue(t *testing.T, redisCache *RedisSignalCache, vehicleID int64, name string) *Value {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		value, err := redisCache.GetSignalValue(context.Background(), vehicleID, name)
		if err != nil {
			t.Fatalf("GetSignalValue() error = %v", err)
		}
		if value != nil {
			return value
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for Redis signal %d/%s", vehicleID, name)
	return nil
}

// Merge contract tests cover the per-signal merge rule introduced when
// GetAll/GetSignal stopped silently dropping legacy and stale Redis values.

func TestHybridLiveSignalStoreGetAllReturnsL2OnlyAndL1OnlySignalsTogether(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(42)

	local := New()
	local.Update(vehicleID, map[string]interface{}{"L1Only": "from_l1"})

	redisClient := newFakeRedisSignalClient()
	redisCache := &RedisSignalCache{rdb: redisClient}
	if err := redisCache.Update(ctx, vehicleID, map[string]interface{}{"L2Only": 12.5}); err != nil {
		t.Fatalf("RedisSignalCache.Update() error = %v", err)
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	values, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	if values["L1Only"] == nil {
		t.Fatal("L1-only signal dropped from distributed GetAll, want union of L1 and L2")
	}
	assertString(t, values["L1Only"].Raw, "from_l1")
	if values["L2Only"] == nil {
		t.Fatal("L2-only signal missing from distributed GetAll, want union of L1 and L2")
	}
	assertFloat64(t, values["L2Only"].Raw, 12.5)
}

func TestHybridLiveSignalStoreGetAllReturnsLegacyScalarL2Values(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(7)

	local := New()
	redisClient := newFakeRedisSignalClient()
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"legacy_speed": "88.5",
		"legacy_state": "asleep",
	}
	redisCache := &RedisSignalCache{rdb: redisClient}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	values, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	if values["legacy_speed"] == nil {
		t.Fatal("legacy scalar L2 value silently dropped, want returned with zero Timestamp")
	}
	assertFloat64(t, values["legacy_speed"].Raw, 88.5)
	if !values["legacy_speed"].Timestamp.IsZero() {
		t.Fatalf("legacy_speed Timestamp = %v, want zero (unknown freshness preserved)", values["legacy_speed"].Timestamp)
	}
	if values["legacy_state"] == nil {
		t.Fatal("legacy scalar string L2 value silently dropped, want returned with zero Timestamp")
	}
	assertString(t, values["legacy_state"].Raw, "asleep")
	if !values["legacy_state"].Timestamp.IsZero() {
		t.Fatalf("legacy_state Timestamp = %v, want zero (unknown freshness preserved)", values["legacy_state"].Timestamp)
	}

	now := time.Now().UTC()
	if IsLiveSignalFresh(values["legacy_speed"], now) {
		t.Fatal("legacy scalar value reported fresh; freshness oracle must still mark zero-Timestamp as not fresh")
	}
	if IsLiveSignalFresh(values["legacy_state"], now) {
		t.Fatal("legacy scalar string value reported fresh; freshness oracle must still mark zero-Timestamp as not fresh")
	}
}

func TestHybridLiveSignalStoreGetAllReturnsStaleL2EnvelopesWithTimestampPreserved(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(11)
	now := time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC)
	staleTimestamp := now.Add(-LiveSignalFreshnessThreshold - 5*time.Minute)

	encoded, err := encodeTimestampedSignalValue(125000.0, staleTimestamp)
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue() error = %v", err)
	}

	redisClient := newFakeRedisSignalClient()
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{"Odometer": encoded}
	redisCache := &RedisSignalCache{rdb: redisClient}

	local := New()
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	liveStore.now = func() time.Time { return now }

	values, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}
	if values["Odometer"] == nil {
		t.Fatal("stale L2 envelope silently dropped, want returned with original Timestamp preserved")
	}
	assertFloat64(t, values["Odometer"].Raw, 125000)
	if !values["Odometer"].Timestamp.Equal(staleTimestamp) {
		t.Fatalf("stale Odometer Timestamp = %v, want %v (preserved verbatim, not zeroed and not restamped)", values["Odometer"].Timestamp, staleTimestamp)
	}
	if IsLiveSignalFresh(values["Odometer"], now) {
		t.Fatal("stale L2 value reported fresh; freshness oracle must still flag age beyond LiveSignalFreshnessThreshold")
	}
}

func TestHybridLiveSignalStoreGetAllMergesL1AndL2WithNewerTimestampWinning(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(13)
	now := time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC)

	encodedANewer, err := encodeTimestampedSignalValue("l2_a_newer", now.Add(-10*time.Second))
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(A) error = %v", err)
	}
	encodedBOlder, err := encodeTimestampedSignalValue("l2_b_older", now.Add(-60*time.Second))
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(B) error = %v", err)
	}
	encodedDTie, err := encodeTimestampedSignalValue("l2_d_tie", now.Add(-20*time.Second))
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(D) error = %v", err)
	}

	redisClient := newFakeRedisSignalClient()
	redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{
		"signalA": encodedANewer,
		"signalB": encodedBOlder,
		"signalC": "12.0", // legacy scalar — zero Timestamp on decode
		"signalD": encodedDTie,
	}
	redisCache := &RedisSignalCache{rdb: redisClient}

	local := New()
	// Inject L1 values with deterministic, controlled timestamps. Same package
	// so we can write directly to the unexported map. No concurrent access here.
	local.vehicles[vehicleID] = map[string]*Value{
		"signalA": {Raw: "l1_a_older", Timestamp: now.Add(-30 * time.Second)},
		"signalB": {Raw: "l1_b_newer", Timestamp: now.Add(-10 * time.Second)},
		"signalC": {Raw: "l1_c", Timestamp: now.Add(-45 * time.Second)},
		"signalD": {Raw: "l1_d_tie", Timestamp: now.Add(-20 * time.Second)},
	}

	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}
	liveStore.now = func() time.Time { return now }

	values, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll() error = %v", err)
	}

	// signalA: L2 has the newer non-zero Timestamp, so L2 wins.
	assertString(t, values["signalA"].Raw, "l2_a_newer")
	// signalB: L1 has the newer non-zero Timestamp, so L1 wins.
	assertString(t, values["signalB"].Raw, "l1_b_newer")
	// signalC: L2 is a legacy zero-Timestamp scalar; L1 has a non-zero
	// Timestamp; legacy loses to any non-zero Timestamp regardless of layer.
	assertString(t, values["signalC"].Raw, "l1_c")
	// signalD: identical non-zero Timestamps; tie-break prefers L2 (cross-pod
	// authoritative cache).
	assertString(t, values["signalD"].Raw, "l2_d_tie")
}

func TestHybridLiveSignalStoreGetSignalAppliesSameMergeRuleAsGetAll(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(17)
	now := time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC)
	veryStaleTS := now.Add(-LiveSignalFreshnessThreshold - 5*time.Minute)

	encodedNewer, err := encodeTimestampedSignalValue("l2_x_newer", now.Add(-5*time.Second))
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(newer) error = %v", err)
	}
	encodedOlder, err := encodeTimestampedSignalValue("l2_x_older", now.Add(-30*time.Second))
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(older) error = %v", err)
	}
	encodedStale, err := encodeTimestampedSignalValue("l2_x_stale", veryStaleTS)
	if err != nil {
		t.Fatalf("encodeTimestampedSignalValue(stale) error = %v", err)
	}

	type subTest struct {
		name       string
		l1         *Value
		l2         string // raw value to inject into hash; "" means absent
		wantRaw    interface{}
		wantTS     time.Time
		wantTSZero bool
	}

	cases := []subTest{
		{
			name:    "L2 newer wins",
			l1:      &Value{Raw: "l1_x", Timestamp: now.Add(-30 * time.Second)},
			l2:      encodedNewer,
			wantRaw: "l2_x_newer",
			wantTS:  now.Add(-5 * time.Second),
		},
		{
			name:    "L1 newer wins",
			l1:      &Value{Raw: "l1_x_newer", Timestamp: now.Add(-5 * time.Second)},
			l2:      encodedOlder,
			wantRaw: "l1_x_newer",
			wantTS:  now.Add(-5 * time.Second),
		},
		{
			name:    "L2 stale envelope returned not dropped",
			l1:      nil,
			l2:      encodedStale,
			wantRaw: "l2_x_stale",
			wantTS:  veryStaleTS,
		},
		{
			name:       "L2 legacy scalar returned not dropped",
			l1:         nil,
			l2:         "42.5",
			wantRaw:    42.5,
			wantTSZero: true,
		},
		{
			name:    "L1 only",
			l1:      &Value{Raw: "l1_only", Timestamp: now.Add(-15 * time.Second)},
			l2:      "",
			wantRaw: "l1_only",
			wantTS:  now.Add(-15 * time.Second),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			redisClient := newFakeRedisSignalClient()
			if tc.l2 != "" {
				redisClient.hashes[redisSignalKey(vehicleID)] = map[string]string{"X": tc.l2}
			}
			redisCache := &RedisSignalCache{rdb: redisClient}

			local := New()
			if tc.l1 != nil {
				local.vehicles[vehicleID] = map[string]*Value{"X": tc.l1}
			}

			liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
			if err != nil {
				t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
			}
			liveStore.now = func() time.Time { return now }

			value, err := liveStore.GetSignal(ctx, vehicleID, "X", LiveSignalReadDistributed)
			if err != nil {
				t.Fatalf("GetSignal() error = %v", err)
			}
			if value == nil {
				t.Fatal("GetSignal() returned nil; merge contract requires non-nil when either layer has the signal")
			}
			switch want := tc.wantRaw.(type) {
			case string:
				assertString(t, value.Raw, want)
			case float64:
				assertFloat64(t, value.Raw, want)
			default:
				t.Fatalf("unsupported wantRaw type %T", tc.wantRaw)
			}
			if tc.wantTSZero {
				if !value.Timestamp.IsZero() {
					t.Fatalf("Timestamp = %v, want zero (legacy unknown freshness preserved)", value.Timestamp)
				}
				if IsLiveSignalFresh(value, now) {
					t.Fatal("legacy scalar reported fresh by IsLiveSignalFresh")
				}
			} else if !value.Timestamp.Equal(tc.wantTS) {
				t.Fatalf("Timestamp = %v, want %v (preserved verbatim from winning layer)", value.Timestamp, tc.wantTS)
			}
		})
	}
}

func TestHybridLiveSignalStoreGetAllLocalModeUnchangedAndNeverReadsRedis(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(23)

	local := New()
	local.Update(vehicleID, map[string]interface{}{"BatteryLevel": 21.0})

	// Failing client errors on every call; if any local-preference or
	// local-mode read path touches Redis, the test fails immediately.
	redisErr := errors.New("redis must not be called by local-preference reads")
	redisCache := &RedisSignalCache{rdb: failingRedisSignalClient{err: redisErr}}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	// Action 1: hybrid mode + LiveSignalReadLocal preference — must NOT read Redis.
	values, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadLocal)
	if err != nil {
		t.Fatalf("GetAll(local pref, hybrid mode) error = %v", err)
	}
	if values["BatteryLevel"] == nil {
		t.Fatal("local-preference GetAll returned nil for known L1 signal")
	}
	assertFloat64(t, values["BatteryLevel"].Raw, 21)

	// Action 2: GetSignal with local preference — must NOT read Redis.
	value, err := liveStore.GetSignal(ctx, vehicleID, "BatteryLevel", LiveSignalReadLocal)
	if err != nil {
		t.Fatalf("GetSignal(local pref, hybrid mode) error = %v", err)
	}
	assertFloat64(t, value.Raw, 21)

	// Action 3: switch mode to local; even with distributed preference, reads
	// must stay L1-only because mode overrides preference (ADR-007 rollback).
	if err := liveStore.SetMode(LiveSignalStoreModeLocal); err != nil {
		t.Fatalf("SetMode(local) error = %v", err)
	}
	values, err = liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll(distributed pref, local mode) error = %v", err)
	}
	if values["BatteryLevel"] == nil {
		t.Fatal("local-mode GetAll returned nil for known L1 signal")
	}
	assertFloat64(t, values["BatteryLevel"].Raw, 21)

	value, err = liveStore.GetSignal(ctx, vehicleID, "BatteryLevel", LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetSignal(distributed pref, local mode) error = %v", err)
	}
	assertFloat64(t, value.Raw, 21)
}

func TestHybridLiveSignalStoreDistributedReadsSurfaceRedisErrors(t *testing.T) {
	ctx := context.Background()
	vehicleID := int64(29)

	local := New()
	local.Update(vehicleID, map[string]interface{}{"BatteryLevel": 7.0})

	sentinel := errors.New("redis-sentinel-failure")
	redisCache := &RedisSignalCache{rdb: failingRedisSignalClient{err: sentinel}}
	liveStore, err := NewHybridLiveSignalStore(local, redisCache, LiveSignalStoreModeHybrid)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore() error = %v", err)
	}

	if _, err := liveStore.GetAll(ctx, vehicleID, LiveSignalReadDistributed); err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("GetAll() error = %v, want sentinel surfaced via errors.Is (no silent swallow)", err)
	}
	if _, err := liveStore.GetSignal(ctx, vehicleID, "BatteryLevel", LiveSignalReadDistributed); err == nil || !errors.Is(err, sentinel) {
		t.Fatalf("GetSignal() error = %v, want sentinel surfaced via errors.Is (no silent swallow)", err)
	}
}
