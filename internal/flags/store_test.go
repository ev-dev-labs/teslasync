package flags

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Most production-realistic tests use miniredis to exercise actual
// Redis protocol. We use the same approach as
// internal/tesla/unit_history/cache_test.go.

func TestStore_NilRedis_FallbackPath(t *testing.T) {
	s := NewStore(nil)
	t.Cleanup(s.Start(context.Background()))

	if got := s.GetString(context.Background(), "k", "def"); got != "def" {
		t.Errorf("GetString fallback = %q, want %q", got, "def")
	}
	if got := s.GetBool(context.Background(), "k", true); !got {
		t.Errorf("GetBool fallback = %v, want true", got)
	}
	if got := s.GetInt(context.Background(), "k", 42); got != 42 {
		t.Errorf("GetInt fallback = %d, want 42", got)
	}
	if got := s.GetFloat(context.Background(), "k", 3.14); got != 3.14 {
		t.Errorf("GetFloat fallback = %v, want 3.14", got)
	}
	if _, _, err := s.Set(context.Background(), "k", "v"); err == nil {
		t.Error("Set on nil-redis returned nil error, want non-nil")
	}
	if _, _, err := s.Delete(context.Background(), "k"); err == nil {
		t.Error("Delete on nil-redis returned nil error, want non-nil")
	}
	if all, err := s.All(context.Background()); err != nil || all == nil {
		t.Errorf("All on nil-redis = (%v, %v), want (non-nil map, nil)", all, err)
	}
}

func TestStore_TypedGetters_ParseAndFallback(t *testing.T) {
	s := NewStore(nil)
	// Inject cache entries directly to test parsing without needing redis.
	s.cache["str"] = cacheEntry{value: "hello", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["bool_true"] = cacheEntry{value: "yes", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["bool_false"] = cacheEntry{value: "off", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["bool_bad"] = cacheEntry{value: "maybe", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["int"] = cacheEntry{value: " 42 ", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["int_bad"] = cacheEntry{value: "forty-two", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["float"] = cacheEntry{value: "3.14", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["absent"] = cacheEntry{value: "", present: false, expiry: time.Now().Add(time.Hour)} // negative cache

	ctx := context.Background()
	if got := s.GetString(ctx, "str", "def"); got != "hello" {
		t.Errorf("GetString str = %q", got)
	}
	if got := s.GetBool(ctx, "bool_true", false); !got {
		t.Errorf("GetBool true = false")
	}
	if got := s.GetBool(ctx, "bool_false", true); got {
		t.Errorf("GetBool false = true")
	}
	if got := s.GetBool(ctx, "bool_bad", true); !got {
		t.Errorf("GetBool malformed = %v, want default true", got)
	}
	if got := s.GetInt(ctx, "int", 0); got != 42 {
		t.Errorf("GetInt = %d", got)
	}
	if got := s.GetInt(ctx, "int_bad", 99); got != 99 {
		t.Errorf("GetInt malformed = %d, want default 99", got)
	}
	if got := s.GetFloat(ctx, "float", 0); got != 3.14 {
		t.Errorf("GetFloat = %v", got)
	}
	if got := s.GetString(ctx, "absent", "def"); got != "def" {
		t.Errorf("GetString absent = %q, want default", got)
	}
}

func TestStore_Get_EmptyKey(t *testing.T) {
	s := NewStore(nil)
	if _, err := s.Get(context.Background(), ""); err == nil {
		t.Error("Get(empty) returned nil error")
	}
	if _, err := s.Get(context.Background(), "   "); err == nil {
		t.Error("Get(whitespace) returned nil error")
	}
}

func TestStore_NotFoundSentinel(t *testing.T) {
	s := NewStore(nil)
	_, err := s.Get(context.Background(), "missing")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Get(missing) err = %v, want ErrNotFound", err)
	}
}

func TestStore_Stats_Increment(t *testing.T) {
	s := NewStore(nil)
	s.cache["hit"] = cacheEntry{value: "v", present: true, expiry: time.Now().Add(time.Hour)}

	_, _ = s.Get(context.Background(), "hit")
	_, _ = s.Get(context.Background(), "miss") // returns ErrNotFound; no redis available
	_, _ = s.Get(context.Background(), "miss") // counted as miss again

	h, m := s.Stats()
	if h != 1 {
		t.Errorf("hits = %d, want 1", h)
	}
	if m != 2 {
		t.Errorf("misses = %d, want 2", m)
	}
}

func TestStore_PutCache_StaleExpiry(t *testing.T) {
	s := NewStore(nil, WithLocalCacheTTL(10*time.Millisecond))
	s.putCache("k", "v", true)
	got, err := s.Get(context.Background(), "k")
	if err != nil || got != "v" {
		t.Fatalf("Get fresh = (%q, %v)", got, err)
	}
	time.Sleep(30 * time.Millisecond)
	_, err = s.Get(context.Background(), "k")
	// Stale: cache entry is no longer fresh; with no redis, miss → ErrNotFound
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Get stale = %v, want ErrNotFound (stale eviction + no redis fallback)", err)
	}
}

func TestStore_EvictLocal(t *testing.T) {
	s := NewStore(nil)
	s.cache["a"] = cacheEntry{value: "1", present: true, expiry: time.Now().Add(time.Hour)}
	s.cache["b"] = cacheEntry{value: "2", present: true, expiry: time.Now().Add(time.Hour)}

	s.evictLocal("a")
	if _, ok := s.cache["a"]; ok {
		t.Error("evictLocal(a) did not remove cache entry")
	}
	if _, ok := s.cache["b"]; !ok {
		t.Error("evictLocal(a) removed unrelated entry b")
	}

	s.evictLocal("*")
	if len(s.cache) != 0 {
		t.Errorf("evictLocal(*) left %d entries, want 0", len(s.cache))
	}
}

func TestStore_Shutdown_NoSubscriber(t *testing.T) {
	// shutdown on a never-started store is a no-op.
	s := NewStore(nil)
	s.shutdown()
}
