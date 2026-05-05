// Package database — Phase-46 / Prompt 32.
//
// AuditRepo wraps the small set of audit_logs writes that need a
// repository abstraction. The legacy `insertAuditLog` helper in
// `internal/api/audit.go` covers the bulk of mutation auditing; this
// repo is dedicated to the new "masked-value reveal" event so the
// surface stays narrow and the next prompt that registers the
// reveal route does not have to reach back into a sprawling helper.
//
// Why a repo and not a free function:
//
//   - Reveal events are append-only and need exactly one shape; a
//     dedicated method documents the contract (no detail string
//     interpretation, no entity_id, no ip propagation).
//   - The existing audit.go writer accepts arbitrary action strings
//     and entity types. A typo there would silently desync the
//     frontend's audit-recognition logic; a dedicated method makes
//     the constants the only source of truth.
//   - Tests can swap the writer behind an interface without having
//     to fake the entire audit.go pile.
package database

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditRevealAction is the canonical `action` string written to the
// `audit_logs.action` column when a `<MaskedValue>` reveal fires.
// The frontend audit script and any Grafana dashboards filtering by
// action MUST use this exact constant.
const AuditRevealAction = "masked_reveal"

// MaxAuditRevealVariantLen caps the variant label written into the
// `entity_type` column. The variant comes from a short enum on the
// frontend (`token`, `vin`, `coords`, `email`, `generic`) but a
// misbehaving caller could send arbitrary text — this guard keeps
// the column from ever holding a multi-MB blob.
const MaxAuditRevealVariantLen = 64

// MaxAuditRevealKindLen caps the optional event-kind detail string.
// Same rationale as MaxAuditRevealVariantLen.
const MaxAuditRevealKindLen = 128

// ErrAuditRevealVariantRequired indicates the caller did not supply a
// variant label. The handler must surface this as a 400, not a 500 —
// it is a client-side bug, not a server failure.
var ErrAuditRevealVariantRequired = errors.New("variant is required")

// AuditRevealEvent is the canonical write-shape for a masked-value
// reveal audit entry. Actor and IP are derived by the handler from
// the request; this struct only holds the reveal-specific payload.
type AuditRevealEvent struct {
	// Actor is the per-user identity recorded in `audit_logs.actor`.
	// May be empty when the install is in open mode (no
	// FORWARD_AUTH_HEADER); the row is still written so admins can
	// see "someone revealed N tokens" on dev installs.
	Actor string

	// Variant is the masked-value variant the operator revealed
	// (`token`, `vin`, `coords`, `email`, `generic`). Stored in
	// `audit_logs.entity_type` so existing queries that group by
	// entity_type can break out reveal events by sensitivity class.
	Variant string

	// Kind is an optional sub-classifier for the reveal (e.g.
	// `masked_reveal`). Stored in `audit_logs.detail` because there
	// is no dedicated kind column. Empty kind writes NULL.
	Kind string

	// IP and UserAgent are written into the metadata columns added by
	// migration 000163. Empty strings are persisted as NULL so the
	// existing IP-redaction maintenance worker does not have to
	// distinguish "unknown" from "redacted".
	IP        string
	UserAgent string
}

// AuditRepo wraps the database pool with a narrow, well-typed surface
// for the reveal-audit write path.
type AuditRepo struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewAuditRepo constructs a repo backed by the provided pgx pool.
// The `now` function is overridable so tests can pin timestamps; in
// production callers pass `time.Now` (via the convenience wrapper
// NewAuditRepoWithDB).
func NewAuditRepo(pool *pgxpool.Pool, now func() time.Time) *AuditRepo {
	if now == nil {
		now = time.Now
	}
	return &AuditRepo{pool: pool, now: now}
}

// NewAuditRepoWithDB is the convenience constructor for production
// wiring. It reaches into the *DB struct that the rest of the
// package uses so callers do not have to know about pgxpool details.
func NewAuditRepoWithDB(db *DB) *AuditRepo {
	if db == nil {
		return nil
	}
	return NewAuditRepo(db.Pool, time.Now)
}

// WriteRevealEvent persists a single reveal-audit row. Returns the
// validated event or an error for callers that want to surface a 400
// vs. 500 distinction. The DB write itself is best-effort logged in
// the same family as `insertAuditLog`: on failure the error is
// returned (NOT swallowed) so the handler can decide whether to
// silently drop or 500.
//
// Validation:
//   - Variant is required (ErrAuditRevealVariantRequired on empty).
//   - Variant and Kind are trimmed and length-capped.
//   - IP/UserAgent are persisted as NULL when empty (matching the
//     redaction maintenance worker's existing convention).
func (r *AuditRepo) WriteRevealEvent(ctx context.Context, evt AuditRevealEvent) error {
	if r == nil || r.pool == nil {
		return errors.New("audit repo not configured")
	}

	variant := strings.TrimSpace(evt.Variant)
	if variant == "" {
		return ErrAuditRevealVariantRequired
	}
	if len(variant) > MaxAuditRevealVariantLen {
		variant = variant[:MaxAuditRevealVariantLen]
	}

	kind := strings.TrimSpace(evt.Kind)
	if len(kind) > MaxAuditRevealKindLen {
		kind = kind[:MaxAuditRevealKindLen]
	}

	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`

	_, err := r.pool.Exec(ctx, query,
		r.now().UTC(),
		evt.Actor,
		AuditRevealAction,
		variant,
		nullIfEmpty(kind),
		nullIfEmpty(evt.IP),
		nullIfEmpty(evt.UserAgent),
	)
	if err != nil {
		return fmt.Errorf("audit_logs insert: %w", err)
	}
	return nil
}

// nullIfEmpty mirrors the `nullableStr` helper in audit.go but lives
// in this file so the repo has zero cross-file dependencies. The
// returned `any` is what pgx expects for a NULL-able TEXT bind.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
