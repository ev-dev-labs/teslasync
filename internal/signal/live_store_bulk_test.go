package signal

// Bulk L1+L2 live-read tests.
//
// GetAllBulk must be indistinguishable from calling GetAll once per vehicle —
// same merge rule, same retained legacy/stale values, same local-mode
// isolation — while costing ONE Redis round trip for the whole set.

import (
	"context"
	"errors"
	"testing"
	"time"
)

func newBulkHybridStore(t *testing.T, reader *fakeHashBatchReader, mode LiveSignalStoreMode) (*HybridLiveSignalStore, *Store) {
	t.Helper()
	local := New()
	// The fake client mirrors the batch reader's hashes so the single-vehicle
	// and bulk paths read the SAME stored data and can be compared directly.
	client := newFakeRedisSignalClient()
	for key, hash := range reader.hashes {
		copied := make(map[string]string, len(hash))
		for field, raw := range hash {
			copied[field] = raw
		}
		client.hashes[key] = copied
	}
	cache := &RedisSignalCache{rdb: client, batch: reader, staleAfter: LiveSignalFreshnessThreshold}
	store, err := NewHybridLiveSignalStore(local, cache, mode)
	if err != nil {
		t.Fatalf("NewHybridLiveSignalStore: %v", err)
	}
	return store, local
}

func TestHybridGetAllBulkReadsEveryVehicleInOneRoundTrip(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{
		"vehicle:1:signals": {"L2Only": envelopeFor(t, 12.5, ts)},
		"vehicle:2:signals": {"L2Only": envelopeFor(t, 13.5, ts)},
		"vehicle:3:signals": {"L2Only": envelopeFor(t, 14.5, ts)},
	}}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeHybrid)
	local.Update(1, map[string]interface{}{"L1Only": "from_l1"})

	reads, err := store.GetAllBulk(context.Background(), []int64{1, 2, 3}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	if len(reader.calls) != 1 {
		t.Fatalf("Redis round trips = %d, want 1 for 3 vehicles", len(reader.calls))
	}
	if reads[1].Values["L1Only"] == nil || reads[1].Values["L2Only"] == nil {
		t.Fatalf("bulk read must be the union of L1 and L2: %#v", reads[1].Values)
	}
	for _, id := range []int64{2, 3} {
		if reads[id].Values["L2Only"] == nil {
			t.Fatalf("vehicle %d lost its L2 value in the bulk read", id)
		}
	}
}

func TestHybridGetAllBulkAppliesTheMergeRule(t *testing.T) {
	older := time.Date(2026, 8, 27, 11, 0, 0, 0, time.UTC)
	newer := time.Date(2026, 8, 27, 11, 59, 0, 0, time.UTC)
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{
		"vehicle:1:signals": {"Odometer": envelopeFor(t, 200.0, newer)},
		"vehicle:2:signals": {"Odometer": envelopeFor(t, 100.0, older)},
	}}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeHybrid)
	local.HydrateValues(1, map[string]*Value{"Odometer": {Raw: 100.0, Timestamp: older}})
	local.HydrateValues(2, map[string]*Value{"Odometer": {Raw: 200.0, Timestamp: newer}})

	reads, err := store.GetAllBulk(context.Background(), []int64{1, 2}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	// Vehicle 1: L2 is newer → L2 wins. Vehicle 2: L1 is newer → L1 wins.
	assertFloat64(t, reads[1].Values["Odometer"].Raw, 200.0)
	assertFloat64(t, reads[2].Values["Odometer"].Raw, 200.0)
	if !reads[1].Values["Odometer"].Timestamp.Equal(newer) || !reads[2].Values["Odometer"].Timestamp.Equal(newer) {
		t.Fatal("merge rule must keep the newer observation timestamp")
	}
}

func TestHybridGetAllBulkLocalModeNeverReadsRedis(t *testing.T) {
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{
		"vehicle:1:signals": {"L2Only": envelopeFor(t, 1.0, time.Now().UTC())},
	}}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeLocal)
	local.Update(1, map[string]interface{}{"L1Only": "from_l1"})

	reads, err := store.GetAllBulk(context.Background(), []int64{1}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	if len(reader.calls) != 0 {
		t.Fatalf("local mode issued %d Redis calls, want 0 — it is the rollback switch", len(reader.calls))
	}
	if reads[1].Values["L1Only"] == nil {
		t.Fatal("local mode must still answer from L1")
	}
	if reads[1].Values["L2Only"] != nil {
		t.Fatal("local mode leaked an L2 value")
	}
}

func TestHybridGetAllBulkLocalPreferenceNeverReadsRedis(t *testing.T) {
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{}}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeHybrid)
	local.Update(1, map[string]interface{}{"L1Only": "from_l1"})

	if _, err := store.GetAllBulk(context.Background(), []int64{1}, LiveSignalReadLocal); err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	if len(reader.calls) != 0 {
		t.Fatalf("local preference issued %d Redis calls, want 0", len(reader.calls))
	}
}

func TestHybridGetAllBulkIsolatesOneVehiclesRedisFailure(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{
		hashes: map[string]map[string]string{
			"vehicle:1:signals": {"BatteryLevel": envelopeFor(t, 61.0, ts)},
		},
		errs: map[string]error{"vehicle:2:signals": errors.New("i/o timeout")},
	}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeHybrid)
	local.Update(2, map[string]interface{}{"L1Only": "from_l1"})

	reads, err := store.GetAllBulk(context.Background(), []int64{1, 2}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("one bad vehicle must not fail the bulk read: %v", err)
	}
	if reads[1].Err != nil {
		t.Fatalf("healthy vehicle carried an error: %v", reads[1].Err)
	}
	if reads[2].Err == nil {
		t.Fatal("the failing vehicle must surface its error so the caller degrades to signal_log")
	}
	if reads[2].Values != nil {
		t.Fatalf("a failed L2 read must not silently answer from L1 alone: %#v", reads[2].Values)
	}
}

func TestHybridGetAllBulkRejectsInvalidInput(t *testing.T) {
	store, _ := newBulkHybridStore(t, &fakeHashBatchReader{}, LiveSignalStoreModeHybrid)

	if _, err := store.GetAllBulk(context.Background(), []int64{1, 0}, LiveSignalReadDistributed); !errors.Is(err, ErrInvalidLiveSignalVehicleID) {
		t.Fatalf("err = %v, want ErrInvalidLiveSignalVehicleID", err)
	}
	//nolint:staticcheck // deliberately passing a nil context to exercise the guard
	if _, err := store.GetAllBulk(nil, []int64{1}, LiveSignalReadDistributed); !errors.Is(err, ErrNilLiveSignalContext) {
		t.Fatalf("err = %v, want ErrNilLiveSignalContext", err)
	}
}

func TestHybridGetAllBulkMatchesPerVehicleGetAll(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{
		"vehicle:1:signals": {"Odometer": envelopeFor(t, 42.0, ts), "Legacy": "88.5"},
	}}
	store, local := newBulkHybridStore(t, reader, LiveSignalStoreModeHybrid)
	local.Update(1, map[string]interface{}{"Speed": 12.0})

	single, err := store.GetAll(context.Background(), 1, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	bulk, err := store.GetAllBulk(context.Background(), []int64{1}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	if len(single) != len(bulk[1].Values) {
		t.Fatalf("bulk returned %d signals, single returned %d — the two paths must agree", len(bulk[1].Values), len(single))
	}
	for name, want := range single {
		got := bulk[1].Values[name]
		if got == nil {
			t.Fatalf("signal %q missing from the bulk read", name)
		}
		if !got.Timestamp.Equal(want.Timestamp) {
			t.Fatalf("signal %q timestamp = %v, want %v", name, got.Timestamp, want.Timestamp)
		}
	}
}

func TestNoopLiveSignalStoreGetAllBulkAnswersEmptyPerVehicle(t *testing.T) {
	reads, err := NewNoopLiveSignalStore().GetAllBulk(context.Background(), []int64{1, 2}, LiveSignalReadDistributed)
	if err != nil {
		t.Fatalf("GetAllBulk: %v", err)
	}
	if len(reads) != 2 {
		t.Fatalf("reads = %d, want one entry per vehicle", len(reads))
	}
	for id, read := range reads {
		if read.Err != nil {
			t.Fatalf("vehicle %d: a no-op store has no failures, got %v", id, read.Err)
		}
		if len(read.Values) != 0 {
			t.Fatalf("vehicle %d: want an empty reading", id)
		}
	}
}
