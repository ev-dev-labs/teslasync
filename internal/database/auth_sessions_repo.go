// Phase-46 / Prompt 42 — Auth-sessions repository.
//
// Stores TeslaSync's own per-cookie session bindings so the Settings
// page can list active devices and revoke individual sessions
// independently of the upstream ForwardAuth provider's IdP state. The
// proxy is still the identity authority; this layer is purely a local
// audit + revocation primitive.
//
// Threat model
// ------------
//   - The cookie value handed to the browser is unguessable (32 bytes
//     from crypto/rand, 256 bits of entropy). We never store the raw
//     value, only HMAC-SHA256 of it; a leaked database row alone cannot
//     mint a forged cookie because the HMAC secret stays in process
//     memory.
//   - Revoking a row is a soft delete (revoked_at timestamp) so the
//     tracker middleware can distinguish "unknown cookie" from
//     "explicitly revoked" and surface a clearer 401 to the client.
//   - The subject column is treated as opaque; comparison is exact
//     (no trimming, no case folding) for the same reason as the sudo
//     token store: any normalisation drift would break the cross-table
//     join with audit_logs and the future RBAC layer.
package database

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AuthSessionRow is the in-memory projection of a row in auth_sessions.
//
// IP / UserAgent are nullable because a request from a unix socket or a
// proxy that strips UA may legitimately omit them; we record an empty
// string in that case and let the SPA render an em-dash.
type AuthSessionRow struct {
	ID          uuid.UUID
	Subject     string
	UserAgent   string
	IP          string
	CreatedAt   time.Time
	LastSeenAt  time.Time
	RevokedAt   *time.Time
}

// ErrAuthSessionNotFound is returned by the lookup methods when no row
// matches the supplied cookie hash or id. Callers map this to the
// appropriate HTTP status — 401 for the middleware, 404 for the
// management endpoint.
var ErrAuthSessionNotFound = errors.New("auth_session: not found")

// AuthSessionTokenLength is the byte-length of the random cookie value
// we mint and hand to the browser. 32 bytes (256 bits) of crypto/rand is
// far beyond any realistic guessing budget.
const AuthSessionTokenLength = 32

// AuthSessionsRepo is the data-access layer for auth_sessions.
//
// The HMAC signing secret lives in process memory (32 random bytes
// generated on construction); restarting the binary invalidates every
// outstanding cookie. That is the desired semantic for a "local
// session" primitive — operators that want cross-restart persistence
// across a Helm rollout already get it from the upstream IdP, and we
// don't want a stolen DB dump alone to be useful.
type AuthSessionsRepo struct {
	db     *DB
	secret []byte
}

// NewAuthSessionsRepo wires the repo to a database pool and generates a
// fresh HMAC signing secret from crypto/rand.
//
// rand.Read is documented to never fail on supported platforms; if it
// ever does we'd rather panic at construction than silently mint
// predictable-secret cookies.
func NewAuthSessionsRepo(db *DB) *AuthSessionsRepo {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic(fmt.Sprintf("auth_sessions: cannot read crypto/rand: %v", err))
	}
	return &AuthSessionsRepo{db: db, secret: secret}
}

// HashCookie returns the storage key for a raw cookie value. Exposed so
// the session-tracker middleware can compute the same key without
// reaching into unexported state.
func (r *AuthSessionsRepo) HashCookie(token string) []byte {
	mac := hmac.New(sha256.New, r.secret)
	mac.Write([]byte(token))
	return mac.Sum(nil)
}

// MintCookieToken returns a fresh random cookie value (hex-encoded) and
// the corresponding storage hash. The caller is responsible for
// persisting via Create + setting the Set-Cookie header.
func (r *AuthSessionsRepo) MintCookieToken() (token string, hash []byte, err error) {
	raw := make([]byte, AuthSessionTokenLength)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("auth_sessions: mint token: %w", err)
	}
	token = encodeCookieToken(raw)
	hash = r.HashCookie(token)
	return token, hash, nil
}

// Create inserts a new active session and returns the assigned id. ip
// and userAgent may be empty; both columns are nullable.
func (r *AuthSessionsRepo) Create(ctx context.Context, subject string, cookieHash []byte, userAgent, ip string) (uuid.UUID, error) {
	if subject == "" {
		return uuid.Nil, errors.New("auth_sessions: subject required")
	}
	if len(cookieHash) == 0 {
		return uuid.Nil, errors.New("auth_sessions: cookie hash required")
	}
	const q = `
		INSERT INTO auth_sessions (subject, cookie_hash, user_agent, ip, created_at, last_seen_at)
		VALUES ($1, $2, $3, $4, now(), now())
		RETURNING id`
	var id uuid.UUID
	err := r.db.Pool.QueryRow(ctx, q, subject, cookieHash, nullIfEmpty(userAgent), nullIfEmptyIP(ip)).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("auth_sessions: create: %w", err)
	}
	return id, nil
}

// GetByCookieHash looks up the session bound to a given cookie hash.
// Returns ErrAuthSessionNotFound when no row matches; the caller is
// responsible for distinguishing "row exists but revoked" from "row
// missing" via the RevokedAt field.
func (r *AuthSessionsRepo) GetByCookieHash(ctx context.Context, cookieHash []byte) (*AuthSessionRow, error) {
	const q = `
		SELECT id, subject, COALESCE(user_agent, ''), COALESCE(host(ip), ''),
		       created_at, last_seen_at, revoked_at
		FROM auth_sessions
		WHERE cookie_hash = $1`
	var row AuthSessionRow
	err := r.db.Pool.QueryRow(ctx, q, cookieHash).Scan(
		&row.ID, &row.Subject, &row.UserAgent, &row.IP,
		&row.CreatedAt, &row.LastSeenAt, &row.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAuthSessionNotFound
		}
		return nil, fmt.Errorf("auth_sessions: get by cookie: %w", err)
	}
	return &row, nil
}

// ListActiveBySubject returns every non-revoked session for subject,
// most-recently-seen first. The list endpoint paginates via the index
// `idx_auth_sessions_active`.
func (r *AuthSessionsRepo) ListActiveBySubject(ctx context.Context, subject string) ([]AuthSessionRow, error) {
	if subject == "" {
		return nil, errors.New("auth_sessions: subject required")
	}
	const q = `
		SELECT id, subject, COALESCE(user_agent, ''), COALESCE(host(ip), ''),
		       created_at, last_seen_at, revoked_at
		FROM auth_sessions
		WHERE subject = $1
		  AND revoked_at IS NULL
		ORDER BY last_seen_at DESC`
	rows, err := r.db.Pool.Query(ctx, q, subject)
	if err != nil {
		return nil, fmt.Errorf("auth_sessions: list by subject: %w", err)
	}
	defer rows.Close()
	var out []AuthSessionRow
	for rows.Next() {
		var row AuthSessionRow
		if err := rows.Scan(
			&row.ID, &row.Subject, &row.UserAgent, &row.IP,
			&row.CreatedAt, &row.LastSeenAt, &row.RevokedAt,
		); err != nil {
			return nil, fmt.Errorf("auth_sessions: scan row: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth_sessions: iterate rows: %w", err)
	}
	return out, nil
}

// Revoke marks a single session row as revoked. Subject is required so
// principal-A cannot revoke principal-B's session by guessing an id —
// we filter on (id, subject) atomically. Returns ErrAuthSessionNotFound
// when no matching row was found OR the row was already revoked (the
// caller should treat both as a soft-success and 204 the response).
func (r *AuthSessionsRepo) Revoke(ctx context.Context, id uuid.UUID, subject string) error {
	if subject == "" {
		return errors.New("auth_sessions: subject required")
	}
	const q = `
		UPDATE auth_sessions
		SET revoked_at = now()
		WHERE id = $1
		  AND subject = $2
		  AND revoked_at IS NULL`
	tag, err := r.db.Pool.Exec(ctx, q, id, subject)
	if err != nil {
		return fmt.Errorf("auth_sessions: revoke: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAuthSessionNotFound
	}
	return nil
}

// RevokeAllOthers marks every active session for subject as revoked,
// EXCEPT the one identified by exceptID (the caller's current
// session — typically resolved from the inbound TS cookie). Returns the
// number of rows revoked so the handler can include it in the response.
//
// exceptID may be uuid.Nil when the caller wants to revoke every
// active session for the subject (no current-session exception).
func (r *AuthSessionsRepo) RevokeAllOthers(ctx context.Context, subject string, exceptID uuid.UUID) (int64, error) {
	if subject == "" {
		return 0, errors.New("auth_sessions: subject required")
	}
	const q = `
		UPDATE auth_sessions
		SET revoked_at = now()
		WHERE subject = $1
		  AND revoked_at IS NULL
		  AND ($2::uuid IS NULL OR id <> $2::uuid)`
	var keep any
	if exceptID != uuid.Nil {
		keep = exceptID
	}
	tag, err := r.db.Pool.Exec(ctx, q, subject, keep)
	if err != nil {
		return 0, fmt.Errorf("auth_sessions: revoke all others: %w", err)
	}
	return tag.RowsAffected(), nil
}

// BumpLastSeen updates the last_seen_at column to NOW() for the given
// row. Idempotent and safe to call from the hot path; the middleware
// debounces calls per session id so this query runs at most once per
// minute per active cookie.
func (r *AuthSessionsRepo) BumpLastSeen(ctx context.Context, id uuid.UUID) error {
	const q = `
		UPDATE auth_sessions
		SET last_seen_at = now()
		WHERE id = $1
		  AND revoked_at IS NULL`
	if _, err := r.db.Pool.Exec(ctx, q, id); err != nil {
		return fmt.Errorf("auth_sessions: bump last seen: %w", err)
	}
	return nil
}

// nullIfEmptyIP returns nil when the IP string is empty or unparseable
// so the database column gets a SQL NULL rather than a malformed INET
// that would 500 the request.
func nullIfEmptyIP(ip string) any {
	if ip == "" {
		return nil
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return nil
	}
	return parsed.String()
}

// encodeCookieToken renders the random bytes as a URL-safe hex string.
// We deliberately avoid base64 padding because the cookie may be
// reflected into HTTP headers where '=' triggers some buggy proxies.
func encodeCookieToken(raw []byte) string {
	const hexChars = "0123456789abcdef"
	out := make([]byte, len(raw)*2)
	for i, b := range raw {
		out[i*2] = hexChars[b>>4]
		out[i*2+1] = hexChars[b&0x0f]
	}
	return string(out)
}

// debouncedBumper is a per-process map of last-bump timestamps used by
// the middleware to keep BumpLastSeen off the hot path. We expose a
// concrete type rather than a constructor so the tracker can stay
// allocation-free in steady state.
type debouncedBumper struct {
	mu        sync.Mutex
	last      map[uuid.UUID]time.Time
	threshold time.Duration
}

// NewDebouncedBumper returns a debouncer with the given quiet window.
// Zero or negative thresholds collapse to the default (60 seconds).
func NewDebouncedBumper(threshold time.Duration) *debouncedBumper {
	if threshold <= 0 {
		threshold = 60 * time.Second
	}
	return &debouncedBumper{
		last:      make(map[uuid.UUID]time.Time),
		threshold: threshold,
	}
}

// ShouldBump reports whether enough time has elapsed since the last bump
// for id. Records the new timestamp atomically when it returns true.
func (b *debouncedBumper) ShouldBump(id uuid.UUID, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	last, ok := b.last[id]
	if ok && now.Sub(last) < b.threshold {
		return false
	}
	b.last[id] = now
	return true
}

// Forget drops the cached timestamp for id. The middleware calls this
// when a session is revoked or rejected so a re-issued cookie for the
// same id is bumped immediately.
func (b *debouncedBumper) Forget(id uuid.UUID) {
	b.mu.Lock()
	delete(b.last, id)
	b.mu.Unlock()
}
