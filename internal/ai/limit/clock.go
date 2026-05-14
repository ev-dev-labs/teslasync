package limit

import "time"

// Clock is the narrow time-source the limiter + cost cap consult.
// Production wiring uses [SystemClock]; tests pass a [*FakeClock] so
// the token-bucket refill, the per-day reset, the cost-cap TTL, and
// the suspend-until logic all run deterministically.
//
// The interface is intentionally minimal — Now() is the only method
// every code path needs.
type Clock interface {
	Now() time.Time
}

// SystemClock is the production clock; returns time.Now().UTC() so
// every quota window is aligned to UTC and a deployment that runs in
// a non-UTC TZ does not double-roll on midnight.
type SystemClock struct{}

// Now returns the current UTC time.
func (SystemClock) Now() time.Time { return time.Now().UTC() }

// FakeClock is the test-only clock. Safe for concurrent reads via
// [Now]; Advance + Set must NOT race with reads — tests serialise
// the two by convention (advance from the test goroutine before the
// limiter goroutine reads).
type FakeClock struct {
	t time.Time
}

// NewFakeClock seeds a FakeClock at t. A zero t produces a clock at
// the Go zero time; tests typically pass a fixed RFC3339 timestamp
// so failures can be reproduced deterministically.
func NewFakeClock(t time.Time) *FakeClock {
	return &FakeClock{t: t.UTC()}
}

// Now returns the current fake time.
func (c *FakeClock) Now() time.Time { return c.t }

// Advance moves the clock forward by d. Used by tests to drive
// token-bucket refill + per-day reset + cost-cap TTL expiry.
func (c *FakeClock) Advance(d time.Duration) { c.t = c.t.Add(d) }

// Set rewinds or fast-forwards the clock to t. Used by suspend tests
// that want to land exactly on a 00:00 UTC tick.
func (c *FakeClock) Set(t time.Time) { c.t = t.UTC() }
