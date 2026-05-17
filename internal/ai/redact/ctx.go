package redact

import (
	"context"
	"sync"
	"time"
)

// ctxKey is the unique type for redact's context.WithValue keys. Using
// a private type prevents key collisions between packages.
type ctxKey int

const (
	ctxKeyPolicy ctxKey = iota + 1
)

// WithPolicy returns a derived context that carries p. The redact
// decorator (internal/ai/provider/redact_decorator.go) reads this via
// [PolicyFromContext]. Setting a policy in ctx is the dispatcher's
// responsibility (set just before calling the provider chain).
func WithPolicy(ctx context.Context, p Policy) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, ctxKeyPolicy, p)
}

// PolicyFromContext returns the policy stored in ctx by [WithPolicy].
// Returns ([DefaultPolicy], false) when no policy has been installed —
// safer than zero-value because the decorator will then deny every
// class instead of letting everything through.
func PolicyFromContext(ctx context.Context) (Policy, bool) {
	if ctx == nil {
		return DefaultPolicy(), false
	}
	v := ctx.Value(ctxKeyPolicy)
	if v == nil {
		return DefaultPolicy(), false
	}
	p, ok := v.(Policy)
	if !ok {
		return DefaultPolicy(), false
	}
	return p, true
}

// Meta is the per-call redaction outcome the decorator records for
// later persistence into the ai_call_log row. Classes lists the
// distinct PII classes that were actually rewritten on this call;
// Bypass is true when the policy explicitly opted out of redaction
// (e.g. local loopback). An empty Classes + Bypass=false is the
// "nothing to redact" case for a clean prompt.
type Meta struct {
	Classes []PIIClass
	Bypass  bool
}

// MetaSink is the persistence-side view of the per-call meta. The
// decorator calls Record before returning to the caller; the repo
// calls Consume during ai_call_log Insert. Production wiring uses the
// process-global default sink; tests can substitute a fake.
type MetaSink interface {
	Record(key string, meta Meta)
	Consume(key string) (Meta, bool)
}

// metaEntry is one row in the global meta sink. at is recorded so the
// sweeper can evict entries whose Insert never landed (e.g. because
// the audit drainer was killed mid-flush).
type metaEntry struct {
	meta Meta
	at   time.Time
}

// metaTTL bounds how long an entry survives in the global sink before
// the sweeper evicts it. 60 seconds is generous for the typical
// async-audit drainer latency (≪ 1s) while preventing unbounded growth
// if the drainer wedges.
const metaTTL = 60 * time.Second

// processMetaSink is the default in-process implementation of
// [MetaSink]. Keyed by request hash + feature ID so two concurrent
// calls with the same prompt content but different features do not
// stomp on each other's bypass status.
type processMetaSink struct {
	mu      sync.Mutex
	entries map[string]metaEntry
}

func newProcessMetaSink() *processMetaSink {
	s := &processMetaSink{entries: make(map[string]metaEntry, 64)}
	return s
}

func (s *processMetaSink) Record(key string, meta Meta) {
	if key == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries[key] = metaEntry{meta: meta, at: time.Now()}
	s.sweepLocked(time.Now())
}

func (s *processMetaSink) Consume(key string) (Meta, bool) {
	if key == "" {
		return Meta{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[key]
	if !ok {
		return Meta{}, false
	}
	delete(s.entries, key)
	return e.meta, true
}

// sweepLocked removes entries older than metaTTL. Called opportunistically
// from Record so we never need a background goroutine. Linear in the
// map size; bounded by metaTTL × call rate.
func (s *processMetaSink) sweepLocked(now time.Time) {
	for k, e := range s.entries {
		if now.Sub(e.at) > metaTTL {
			delete(s.entries, k)
		}
	}
}

// Reset empties the sink. Test-only — production never invokes this.
func (s *processMetaSink) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = make(map[string]metaEntry, 64)
}

// defaultMetaSink is the process-global instance. Exposed via
// [RecordMeta] / [ConsumeMeta] / [SinkSize] so the decorator and the
// repo do not need to plumb a dependency through every constructor.
var defaultMetaSink = newProcessMetaSink()

// RecordMeta stores meta keyed by the per-call key. Called by the
// redact decorator immediately after applying redaction. The key is
// typically the canonical request hash so the repo's Insert can
// reverse-lookup deterministically.
func RecordMeta(key string, meta Meta) {
	defaultMetaSink.Record(key, meta)
}

// ConsumeMeta returns the meta previously recorded for key and
// removes it from the sink. Returns (zero, false) when no meta is
// registered (e.g. a non-AI call that somehow reached the repo, or
// the entry was swept).
func ConsumeMeta(key string) (Meta, bool) {
	return defaultMetaSink.Consume(key)
}

// ResetMeta clears the global sink. Test-only helper; production
// callers MUST NOT invoke it.
func ResetMeta() {
	defaultMetaSink.Reset()
}

// SinkSize returns the number of entries currently held in the global
// sink. Diagnostic; the bypass-report admin endpoint surfaces this so
// an operator can spot a stuck audit drainer.
func SinkSize() int {
	defaultMetaSink.mu.Lock()
	defer defaultMetaSink.mu.Unlock()
	return len(defaultMetaSink.entries)
}

// MetaKey returns the canonical key used by the decorator + repo to
// match a redaction record to an audit row. Centralising the formula
// here means a future change (e.g. include the model name) lands in
// one place.
func MetaKey(featureID, requestHash string) string {
	return featureID + "\x00" + requestHash
}
