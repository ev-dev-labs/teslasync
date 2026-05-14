package redact

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestWithPolicy_RoundTrip(t *testing.T) {
	t.Parallel()
	want := Policy{Allow: []PIIClass{ClassVIN}, Mode: ModeRedactedTokens}
	ctx := WithPolicy(context.Background(), want)
	got, ok := PolicyFromContext(ctx)
	if !ok {
		t.Fatal("PolicyFromContext returned ok=false after WithPolicy")
	}
	if len(got.Allow) != 1 || got.Allow[0] != ClassVIN {
		t.Errorf("Allow = %v, want [vin]", got.Allow)
	}
	if got.Mode != ModeRedactedTokens {
		t.Errorf("Mode = %v", got.Mode)
	}
}

func TestPolicyFromContext_AbsentReturnsDefault(t *testing.T) {
	t.Parallel()
	got, ok := PolicyFromContext(context.Background())
	if ok {
		t.Error("ok must be false when no policy installed")
	}
	if len(got.Allow) != 0 || got.Mode != ModeRedactedTags {
		t.Errorf("absent policy should yield DefaultPolicy, got %+v", got)
	}
}

func TestPolicyFromContext_NilCtx(t *testing.T) {
	t.Parallel()
	_, ok := PolicyFromContext(nil)
	if ok {
		t.Error("nil ctx must yield ok=false")
	}
}

func TestRecordConsumeMeta_RoundTrip(t *testing.T) {
	ResetMeta()
	defer ResetMeta()
	key := MetaKey("test-feature", "deadbeef")
	want := Meta{Classes: []PIIClass{ClassVIN, ClassEmail}, Bypass: false}
	RecordMeta(key, want)
	got, ok := ConsumeMeta(key)
	if !ok {
		t.Fatal("Consume returned ok=false")
	}
	if len(got.Classes) != 2 {
		t.Errorf("Classes len = %d, want 2", len(got.Classes))
	}
	// After consume, second consume must miss.
	if _, ok := ConsumeMeta(key); ok {
		t.Error("second Consume should miss")
	}
}

func TestConsumeMeta_AbsentReturnsZero(t *testing.T) {
	ResetMeta()
	defer ResetMeta()
	got, ok := ConsumeMeta(MetaKey("nope", "nope"))
	if ok {
		t.Error("ok must be false for absent key")
	}
	if len(got.Classes) != 0 || got.Bypass {
		t.Errorf("absent key should yield zero Meta, got %+v", got)
	}
}

func TestRecordConsume_EmptyKeyIsNoop(t *testing.T) {
	ResetMeta()
	defer ResetMeta()
	RecordMeta("", Meta{Classes: []PIIClass{ClassVIN}})
	if SinkSize() != 0 {
		t.Errorf("empty key should not insert: SinkSize=%d", SinkSize())
	}
	if _, ok := ConsumeMeta(""); ok {
		t.Error("Consume on empty key should be false")
	}
}

func TestSink_Sweeper_EvictsStale(t *testing.T) {
	ResetMeta()
	defer ResetMeta()
	// Manually plant a stale entry by reaching into the sink.
	old := time.Now().Add(-2 * metaTTL)
	defaultMetaSink.mu.Lock()
	defaultMetaSink.entries["stale"] = metaEntry{
		meta: Meta{Classes: []PIIClass{ClassVIN}},
		at:   old,
	}
	defaultMetaSink.mu.Unlock()
	// A subsequent Record triggers sweepLocked which evicts the stale.
	RecordMeta(MetaKey("f", "h"), Meta{})
	defaultMetaSink.mu.Lock()
	_, present := defaultMetaSink.entries["stale"]
	defaultMetaSink.mu.Unlock()
	if present {
		t.Error("stale entry should have been swept")
	}
}

func TestSink_ConcurrentRecord(t *testing.T) {
	ResetMeta()
	defer ResetMeta()
	const writers = 32
	const each = 32
	var wg sync.WaitGroup
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func(w int) {
			defer wg.Done()
			for j := 0; j < each; j++ {
				key := MetaKey("feature", time.Now().String())
				RecordMeta(key, Meta{Classes: []PIIClass{ClassVIN}})
				_, _ = ConsumeMeta(key)
			}
		}(i)
	}
	wg.Wait()
	// Sink should be empty after all consumes.
	if got := SinkSize(); got != 0 {
		t.Errorf("SinkSize after parallel record/consume = %d, want 0", got)
	}
}

func TestMetaKey_Format(t *testing.T) {
	t.Parallel()
	k := MetaKey("feat", "hash")
	if k != "feat\x00hash" {
		t.Errorf("MetaKey = %q", k)
	}
	if a, b := MetaKey("a", "bc"), MetaKey("ab", "c"); a == b {
		t.Error("MetaKey produced identical keys for split-boundary inputs")
	}
}
