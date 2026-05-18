// Package database — Phase-46 / Prompt 31.
//
// In-memory sudo-token store for sensitive-action step-up reauth.
//
// Why in-memory and not a SQL table:
//
//   - Sudo tokens have a 5-minute TTL by default (see [SudoTokenStore.TTL])
//     and never need to outlive a process restart — the worst-case UX on
//     restart is "user re-confirms the destructive action they were about
//     to take", which is exactly the same outcome RequireSudo is designed
//     to enforce.
//   - Round-tripping every destructive POST through Postgres for a token
//     lookup adds a hot-path query that we don't need.
//   - A future multi-pod deployment will move this to Redis behind the
//     same Lookup/Mint interface; until then a sync.Map keyed by token
//     hash is sufficient.
//
// The store is intentionally placed under internal/database (not
// internal/api) so that a Redis-backed implementation can drop into the
// same package without churning the api package's import graph.
package database

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"
)

// DefaultSudoTokenTTL is the default lifetime of a minted sudo token.
// Industry sudo-style step-up patterns (sudo(8), GitHub sudo mode) use
// 5 minutes; anything shorter is annoying, anything longer dilutes the
// step-up guarantee. Operators can override via TESLASYNC_SUDO_TTL_SECONDS
// surfaced on [SudoTokenStore.TTL].
const DefaultSudoTokenTTL = 5 * time.Minute

// ErrSudoTokenInvalid is returned when a token is unknown, expired, or
// belongs to a different subject than the caller. Callers MUST surface
// this as a 401 with code=SUDO_REQUIRED so the SPA's interceptor can
// re-prompt; never as a 500.
var ErrSudoTokenInvalid = errors.New("sudo token invalid or expired")

// sudoTokenEntry is the in-memory record kept per minted token.
//
// Subject is recorded so a token minted for user A cannot be replayed
// against user B's session — even if both pods share the same store
// (e.g. via a future Redis backing). NonceHex is unused at the API
// layer but kept on the entry for future audit-log enrichment without
// changing the wire format.
type sudoTokenEntry struct {
	Subject   string
	NonceHex  string
	ExpiresAt time.Time
}

// SudoTokenStore mints, looks up, and prunes short-lived step-up tokens.
//
// Concurrency: every public method holds the per-store mutex for the
// minimum window required (mint = compute then insert; validate = read
// then delete-if-expired). A sweep goroutine could prune lazily but
// today each Validate call also opportunistically deletes expired
// entries it touches — that is sufficient for the in-memory single-pod
// case and avoids a goroutine that the test harness would have to stop.
type SudoTokenStore struct {
	// TTL is how long a minted token remains valid. Zero falls back to
	// [DefaultSudoTokenTTL].
	TTL time.Duration

	// now is injectable for deterministic tests. Defaults to time.Now.
	now func() time.Time

	mu      sync.Mutex
	entries map[string]sudoTokenEntry // keyed by hex-encoded SHA-256 of token

	// secret signs the issued token so a leaked DB row alone cannot mint
	// a forged token. 32 random bytes generated on construction.
	secret []byte
}

// NewSudoTokenStore returns a ready-to-use store with the given TTL.
// A zero ttl is replaced with [DefaultSudoTokenTTL].
//
// The HMAC signing secret is generated from crypto/rand and stays in
// process memory only; restarting the binary invalidates every
// outstanding token, which is exactly the desired semantics for a
// step-up cache.
func NewSudoTokenStore(ttl time.Duration) *SudoTokenStore {
	if ttl <= 0 {
		ttl = DefaultSudoTokenTTL
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		// rand.Read is documented to never fail on supported platforms.
		// If it ever does, we'd rather crash here than silently mint
		// predictable-secret tokens.
		panic(fmt.Sprintf("sudo token store: cannot read crypto/rand: %v", err))
	}
	return &SudoTokenStore{
		TTL:     ttl,
		now:     time.Now,
		entries: make(map[string]sudoTokenEntry),
		secret:  secret,
	}
}

// withClock is a test seam letting unit tests freeze time without
// reaching into unexported state from another package.
//nolint:unused // pre-existing func retained pending follow-up cleanup
func (s *SudoTokenStore) withClock(now func() time.Time) *SudoTokenStore {
	s.now = now
	return s
}

// hashKey returns the storage key for a raw token. We never store the
// token itself; only its hash, so a memory dump of the process can't be
// trivially replayed against the API.
func (s *SudoTokenStore) hashKey(token string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

// Mint issues a new token bound to subject. Returns the opaque token
// string the SPA must echo in X-Sudo-Token, and the absolute expiry the
// SPA can use to gray-out the in-memory cache without polling the API.
//
// Subject MUST be the same identity Validate will be called with —
// typically the trimmed value of the configured FORWARD_AUTH_HEADER.
// Empty subject is permitted ONLY as a marker for open-mode token
// minting (where there is no upstream credential). RequireSudo
// short-circuits in open mode anyway, so empty-subject tokens are
// never actually validated.
func (s *SudoTokenStore) Mint(subject string) (string, time.Time, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", time.Time{}, fmt.Errorf("sudo token mint: %w", err)
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", time.Time{}, fmt.Errorf("sudo nonce: %w", err)
	}
	token := hex.EncodeToString(raw)
	nonceHex := hex.EncodeToString(nonce)
	exp := s.now().Add(s.TTL)
	key := s.hashKey(token)

	s.mu.Lock()
	s.entries[key] = sudoTokenEntry{
		Subject:   subject,
		NonceHex:  nonceHex,
		ExpiresAt: exp,
	}
	s.mu.Unlock()

	return token, exp, nil
}

// Validate returns nil iff the token is currently valid AND was minted
// for the supplied subject. Expired entries are GC'd opportunistically.
//
// Subject equality is exact (no trimming, no case folding) because the
// subject is whatever value the proxy sets on the configured header —
// the audit log and the per-user activity feed already join on the
// exact same string, and any normalisation drift would silently break
// the cross-pod safety guarantee.
func (s *SudoTokenStore) Validate(token, subject string) error {
	if token == "" {
		return ErrSudoTokenInvalid
	}
	key := s.hashKey(token)

	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.entries[key]
	if !ok {
		return ErrSudoTokenInvalid
	}
	if !s.now().Before(entry.ExpiresAt) {
		delete(s.entries, key)
		return ErrSudoTokenInvalid
	}
	if entry.Subject != subject {
		return ErrSudoTokenInvalid
	}
	return nil
}

// Revoke removes a token from the store. Used by the logout/disconnect
// flow so a sudo grant doesn't survive an explicit sign-out. Safe to
// call on an unknown token (returns nil).
func (s *SudoTokenStore) Revoke(token string) error {
	if token == "" {
		return nil
	}
	key := s.hashKey(token)
	s.mu.Lock()
	delete(s.entries, key)
	s.mu.Unlock()
	return nil
}

// Sweep removes every entry whose ExpiresAt has passed. Safe to call
// from a background ticker; today this is wired only from tests. Returns
// the number of entries removed for observability.
func (s *SudoTokenStore) Sweep() int {
	now := s.now()
	removed := 0
	s.mu.Lock()
	for k, v := range s.entries {
		if !now.Before(v.ExpiresAt) {
			delete(s.entries, k)
			removed++
		}
	}
	s.mu.Unlock()
	return removed
}

// Len returns the current number of stored entries (live or expired-
// but-not-yet-pruned). Exported for test instrumentation only.
func (s *SudoTokenStore) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}
