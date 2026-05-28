// Phase-46 / Prompt 42 — AuthSessionsRepo unit tests.
//
// The repo's queries themselves require a live PostgreSQL connection so
// the bulk of integration coverage lives in the API handler tests
// (which use an in-memory fake store). These tests cover the parts that
// are pure-Go and easily verifiable without a database round-trip:
//
//   - HashCookie is deterministic per repo instance and changes between
//     instances (the HMAC secret is fresh on every NewAuthSessionsRepo).
//   - MintCookieToken yields hex-encoded values of the expected length
//     and is non-repeating.
//   - The debounced-bumper only allows one bump per id per window.
//   - nullIfEmptyIP rejects malformed input rather than letting it
//     through to the INET column.
package auth

import (
	"bytes"
	"net"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHashCookieDeterministicWithinRepo(t *testing.T) {
	repo := newTestAuthSessionsRepo()
	a := repo.HashCookie("abc")
	b := repo.HashCookie("abc")
	if !bytes.Equal(a, b) {
		t.Fatalf("HashCookie not deterministic for same repo: %x vs %x", a, b)
	}
	c := repo.HashCookie("abcd")
	if bytes.Equal(a, c) {
		t.Fatalf("HashCookie collided across distinct inputs")
	}
}

func TestHashCookieDifferentAcrossRepos(t *testing.T) {
	a := newTestAuthSessionsRepo()
	b := newTestAuthSessionsRepo()
	if bytes.Equal(a.HashCookie("abc"), b.HashCookie("abc")) {
		t.Fatalf("HashCookie should differ across repo instances (HMAC secret rotated)")
	}
}

func TestMintCookieTokenShape(t *testing.T) {
	repo := newTestAuthSessionsRepo()
	token, hash, err := repo.MintCookieToken()
	if err != nil {
		t.Fatalf("MintCookieToken: %v", err)
	}
	// Hex of 32 bytes.
	if want := AuthSessionTokenLength * 2; len(token) != want {
		t.Fatalf("token length: got %d, want %d", len(token), want)
	}
	for _, ch := range token {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')) {
			t.Fatalf("token contains non-lowercase-hex char %q", ch)
		}
	}
	want := repo.HashCookie(token)
	if !bytes.Equal(want, hash) {
		t.Fatalf("returned hash does not match HashCookie(token)")
	}
}

func TestMintCookieTokenUnique(t *testing.T) {
	repo := newTestAuthSessionsRepo()
	seen := make(map[string]struct{}, 100)
	for i := 0; i < 100; i++ {
		token, _, err := repo.MintCookieToken()
		if err != nil {
			t.Fatalf("MintCookieToken: %v", err)
		}
		if _, dup := seen[token]; dup {
			t.Fatalf("duplicate token %q after %d mints", token, i)
		}
		seen[token] = struct{}{}
	}
}

func TestDebouncedBumperWindow(t *testing.T) {
	b := NewDebouncedBumper(60 * time.Second)
	id := uuid.New()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)

	if !b.ShouldBump(id, now) {
		t.Fatalf("first call must bump")
	}
	if b.ShouldBump(id, now.Add(30*time.Second)) {
		t.Fatalf("call within window must NOT bump")
	}
	if !b.ShouldBump(id, now.Add(61*time.Second)) {
		t.Fatalf("call after window must bump")
	}
	other := uuid.New()
	if !b.ShouldBump(other, now.Add(30*time.Second)) {
		t.Fatalf("distinct id must bump independently")
	}
}

func TestDebouncedBumperForget(t *testing.T) {
	b := NewDebouncedBumper(60 * time.Second)
	id := uuid.New()
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	if !b.ShouldBump(id, now) {
		t.Fatalf("first call must bump")
	}
	b.Forget(id)
	if !b.ShouldBump(id, now) {
		t.Fatalf("post-Forget call must bump even within window")
	}
}

func TestDebouncedBumperZeroThresholdDefault(t *testing.T) {
	b := NewDebouncedBumper(0)
	if b.threshold != 60*time.Second {
		t.Fatalf("zero threshold should default to 60s; got %v", b.threshold)
	}
}

func TestNullIfEmptyIP(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want any
	}{
		{"empty string yields NULL", "", nil},
		{"malformed yields NULL", "not-an-ip", nil},
		{"IPv4 round-trips", "10.0.0.1", "10.0.0.1"},
		{"IPv6 round-trips", "::1", "::1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := nullIfEmptyIP(tt.in)
			if tt.want == nil {
				if got != nil {
					t.Fatalf("got %v, want nil", got)
				}
				return
			}
			gotStr, ok := got.(string)
			if !ok {
				t.Fatalf("got %T, want string", got)
			}
			// net.ParseIP normalises so compare against ParseIP'd want.
			if !net.ParseIP(gotStr).Equal(net.ParseIP(tt.want.(string))) {
				t.Fatalf("got %q, want %q", gotStr, tt.want)
			}
		})
	}
}

// newTestAuthSessionsRepo returns a repo with a fresh HMAC secret but
// no live database pool. Suitable for tests that exercise only the
// in-memory helpers (HashCookie / MintCookieToken / debouncedBumper).
func newTestAuthSessionsRepo() *AuthSessionsRepo {
	// NewAuthSessionsRepo only reads from db lazily inside Create /
	// GetByCookieHash / etc., so leaving db nil is safe here.
	return NewAuthSessionsRepo(nil)
}
