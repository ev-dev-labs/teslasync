package signal

// Bulk live-read tests.
//
// The point of the bulk path is a ROUND-TRIP COUNT, so these tests assert the
// count directly (one batched call for N vehicles, never N calls) alongside
// the semantics that must survive batching: the ADR-007 merge rule, local-mode
// isolation from Redis, and per-vehicle attribution of partial failures.

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// batchCall records one HGetAllBatch invocation.
type batchCall struct {
	keys []string
}

// fakeHashBatchReader is an in-memory redisHashBatchReader. It records every
// call so a test can prove N vehicles cost ONE round trip.
type fakeHashBatchReader struct {
	hashes map[string]map[string]string
	// errs maps key → per-key command error (partial failure).
	errs map[string]error
	// callErr fails the whole pipeline (connection refused).
	callErr error
	calls   []batchCall
}

func (f *fakeHashBatchReader) HGetAllBatch(_ context.Context, keys []string) ([]RedisHashBatchReply, error) {
	f.calls = append(f.calls, batchCall{keys: append([]string(nil), keys...)})
	if f.callErr != nil {
		return nil, f.callErr
	}
	out := make([]RedisHashBatchReply, len(keys))
	for i, key := range keys {
		if err, ok := f.errs[key]; ok {
			out[i] = RedisHashBatchReply{Err: err}
			continue
		}
		out[i] = RedisHashBatchReply{Fields: f.hashes[key]}
	}
	return out, nil
}

func newBulkCache(reader *fakeHashBatchReader) *RedisSignalCache {
	return &RedisSignalCache{rdb: newFakeRedisSignalClient(), batch: reader, staleAfter: LiveSignalFreshnessThreshold}
}

func envelopeFor(t *testing.T, value interface{}, ts time.Time) string {
	t.Helper()
	encoded, err := encodeTimestampedSignalValue(value, ts)
	if err != nil {
		t.Fatalf("encode envelope: %v", err)
	}
	return encoded
}

func TestGetAllValuesBulkUsesOneRoundTripForEveryVehicle(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{}}
	for id := int64(1); id <= 25; id++ {
		reader.hashes[fmt.Sprintf("vehicle:%d:signals", id)] = map[string]string{
			"BatteryLevel": envelopeFor(t, float64(id), ts),
		}
	}
	cache := newBulkCache(reader)

	ids := make([]int64, 0, 25)
	for id := int64(1); id <= 25; id++ {
		ids = append(ids, id)
	}
	reads, err := cache.GetAllValuesBulk(context.Background(), ids)
	if err != nil {
		t.Fatalf("GetAllValuesBulk: %v", err)
	}
	if len(reader.calls) != 1 {
		t.Fatalf("round trips = %d, want exactly 1 pipelined call for 25 vehicles", len(reader.calls))
	}
	if got := len(reader.calls[0].keys); got != 25 {
		t.Fatalf("keys in the single call = %d, want 25", got)
	}
	if len(reads) != 25 {
		t.Fatalf("reads = %d, want one entry per requested vehicle", len(reads))
	}
	for id := int64(1); id <= 25; id++ {
		read := reads[id]
		if read.Err != nil {
			t.Fatalf("vehicle %d: unexpected error %v", id, read.Err)
		}
		value := read.Values["BatteryLevel"]
		if value == nil {
			t.Fatalf("vehicle %d: BatteryLevel missing from bulk read", id)
		}
		if !value.Timestamp.Equal(ts) {
			t.Fatalf("vehicle %d: timestamp = %v, want the stored observation %v", id, value.Timestamp, ts)
		}
	}
}

func TestGetAllValuesBulkDeduplicatesAndDropsInvalidIDs(t *testing.T) {
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{}}
	cache := newBulkCache(reader)

	reads, err := cache.GetAllValuesBulk(context.Background(), []int64{7, 7, 0, -3, 8})
	if err != nil {
		t.Fatalf("GetAllValuesBulk: %v", err)
	}
	if len(reader.calls) != 1 || len(reader.calls[0].keys) != 2 {
		t.Fatalf("keys = %v, want exactly the two distinct positive ids", reader.calls)
	}
	if len(reads) != 2 {
		t.Fatalf("reads = %d, want 2", len(reads))
	}
}

func TestGetAllValuesBulkAttributesPartialFailureToItsOwnVehicle(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{
		hashes: map[string]map[string]string{
			"vehicle:1:signals": {"BatteryLevel": envelopeFor(t, 61.0, ts)},
			"vehicle:3:signals": {"BatteryLevel": envelopeFor(t, 63.0, ts)},
		},
		errs: map[string]error{"vehicle:2:signals": errors.New("READONLY You can't write against a read only replica")},
	}
	cache := newBulkCache(reader)

	reads, err := cache.GetAllValuesBulk(context.Background(), []int64{1, 2, 3})
	if err != nil {
		t.Fatalf("one failing key must not fail the whole bulk read: %v", err)
	}
	if reads[1].Err != nil || reads[3].Err != nil {
		t.Fatalf("healthy vehicles carried errors: %v / %v", reads[1].Err, reads[3].Err)
	}
	if reads[2].Err == nil {
		t.Fatal("the failing vehicle must carry its own error, not an empty reading")
	}
	if reads[2].Values != nil {
		t.Fatalf("a failed read must not present values: %v", reads[2].Values)
	}
	if reads[1].Values["BatteryLevel"] == nil || reads[3].Values["BatteryLevel"] == nil {
		t.Fatal("a single failing key erased its siblings' values")
	}
}

func TestGetAllValuesBulkReportsPipelineFailurePerVehicle(t *testing.T) {
	reader := &fakeHashBatchReader{callErr: errors.New("dial tcp 127.0.0.1:6379: connect: connection refused")}
	cache := newBulkCache(reader)

	reads, err := cache.GetAllValuesBulk(context.Background(), []int64{4, 5})
	if err != nil {
		t.Fatalf("a transport failure belongs to the vehicles, not the call: %v", err)
	}
	for _, id := range []int64{4, 5} {
		if reads[id].Err == nil {
			t.Fatalf("vehicle %d: want the transport error recorded so it degrades to the durable fallback", id)
		}
	}
}

func TestGetAllValuesBulkRecoversImmediatelyAfterRedisReturns(t *testing.T) {
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	reader := &fakeHashBatchReader{
		hashes: map[string]map[string]string{
			"vehicle:4:signals": {"BatteryLevel": envelopeFor(t, 74.0, ts)},
		},
		callErr: errors.New("dial tcp 127.0.0.1:6379: connect: connection refused"),
	}
	cache := newBulkCache(reader)

	outage, err := cache.GetAllValuesBulk(context.Background(), []int64{4})
	if err != nil {
		t.Fatalf("outage read: %v", err)
	}
	if outage[4].Err == nil {
		t.Fatal("outage must remain visible on the affected vehicle")
	}

	reader.callErr = nil
	recovered, err := cache.GetAllValuesBulk(context.Background(), []int64{4})
	if err != nil {
		t.Fatalf("recovery read: %v", err)
	}
	if recovered[4].Err != nil {
		t.Fatalf("recovered Redis read retained stale error: %v", recovered[4].Err)
	}
	if got := recovered[4].Values["BatteryLevel"]; got == nil || got.Raw != 74.0 {
		t.Fatalf("recovered value = %#v, want BatteryLevel 74", got)
	}
	if len(reader.calls) != 2 {
		t.Fatalf("pipeline calls = %d, want one outage attempt and one recovery attempt", len(reader.calls))
	}
}

func TestGetAllValuesBulkKeepsLegacyAndStaleValues(t *testing.T) {
	stale := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	reader := &fakeHashBatchReader{hashes: map[string]map[string]string{
		"vehicle:9:signals": {
			"Odometer":     "123456.7", // legacy scalar: unknown freshness
			"BatteryLevel": envelopeFor(t, 42.0, stale),
		},
	}}
	cache := newBulkCache(reader)

	reads, err := cache.GetAllValuesBulk(context.Background(), []int64{9})
	if err != nil {
		t.Fatalf("GetAllValuesBulk: %v", err)
	}
	values := reads[9].Values
	if values["Odometer"] == nil || !values["Odometer"].Timestamp.IsZero() {
		t.Fatalf("legacy scalar must survive with unknown freshness, got %#v", values["Odometer"])
	}
	if values["BatteryLevel"] == nil || !values["BatteryLevel"].Timestamp.Equal(stale) {
		t.Fatalf("stale envelope must survive with its real timestamp, got %#v", values["BatteryLevel"])
	}
}

func TestGetAllValuesBulkFallsBackToPerVehicleReadsWithoutABatchSeam(t *testing.T) {
	client := newFakeRedisSignalClient()
	ts := time.Date(2026, 8, 27, 11, 59, 30, 0, time.UTC)
	client.hashes["vehicle:1:signals"] = map[string]string{"BatteryLevel": envelopeFor(t, 55.0, ts)}
	cache := &RedisSignalCache{rdb: client, staleAfter: LiveSignalFreshnessThreshold}

	reads, err := cache.GetAllValuesBulk(context.Background(), []int64{1, 2})
	if err != nil {
		t.Fatalf("GetAllValuesBulk: %v", err)
	}
	if len(reads) != 2 {
		t.Fatalf("reads = %d, want an entry per vehicle even on the unbatched path", len(reads))
	}
	if reads[1].Values["BatteryLevel"] == nil {
		t.Fatal("unbatched fallback lost the stored value")
	}
	if reads[2].Err != nil || len(reads[2].Values) != 0 {
		t.Fatalf("a vehicle with no key is an absence, not a failure: %#v", reads[2])
	}
}

func TestGetAllValuesBulkRejectsNilContext(t *testing.T) {
	cache := newBulkCache(&fakeHashBatchReader{})
	//nolint:staticcheck // deliberately passing a nil context to exercise the guard
	if _, err := cache.GetAllValuesBulk(nil, []int64{1}); !errors.Is(err, ErrNilLiveSignalContext) {
		t.Fatalf("err = %v, want ErrNilLiveSignalContext", err)
	}
}
