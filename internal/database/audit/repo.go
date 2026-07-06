// Package audit contains focused writers for audit_logs events that need
// repository-level contracts. The legacy `insertAuditLog` helper in
// `internal/api/audit.go` covers broad mutation auditing; this repo keeps
// masked-value reveal and impersonation events narrow and typed.
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
//     to mock the broader audit.go helper surface.
package audit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditRevealAction is the canonical `action` string written to the
// `audit_logs.action` column when a `<MaskedValue>` reveal fires.
// The frontend audit script and any Grafana dashboards filtering by
// action MUST use this exact constant.
const AuditRevealAction = "masked_reveal"

// AuditImpersonationStartAction is the canonical `action` string
// written when an admin begins an impersonation session. Dashboard
// filters depend on this stable token even if the human-facing label
// changes.
const AuditImpersonationStartAction = "impersonation.start"

// AuditImpersonationEndAction is the canonical `action` string
// written when an admin ends an impersonation session. Cookie expiry
// does NOT write this row; only an explicit POST /admin/impersonate/end
// call does, so the row count is a precise "manually ended" metric.
const AuditImpersonationEndAction = "impersonation.end"

// MaxAuditImpersonationSubjectLen caps the length of the actor and
// target subject strings written into the audit row. The proxy emits
// short opaque tokens (typically <128 bytes) but a misbehaving header
// injection could send arbitrary text — the cap keeps a single audit
// row from ballooning to multi-megabyte size.
const MaxAuditImpersonationSubjectLen = 256

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
//
// exec is the database.DBTX execution seam (satisfied by *pgxpool.Pool
// in production and by pgx.Tx). Holding the narrow interface rather than
// the concrete pool lets the reveal/impersonation write paths be unit
// tested against the in-repo DBTX fake without a live PostgreSQL, in the
// same style as internal/database/drive's txRecorder.
type AuditRepo struct {
	exec database.DBTX
	now  func() time.Time
}

// NewAuditRepo constructs a repo backed by the provided pgx pool.
// The `now` function is overridable so tests can pin timestamps; in
// production callers pass `time.Now` (via the convenience wrapper
// NewAuditRepoWithDB).
//
// A nil pool yields a repo whose write methods return the "not
// configured" error rather than panicking — the open-mode wiring path
// depends on that guard. The nil check is deliberate: assigning a typed
// nil *pgxpool.Pool straight into the database.DBTX interface would
// produce a non-nil interface value wrapping a nil pointer, defeating
// the `exec == nil` guards in the write methods.
func NewAuditRepo(pool *pgxpool.Pool, now func() time.Time) *AuditRepo {
	if now == nil {
		now = time.Now
	}
	var exec database.DBTX
	if pool != nil {
		exec = pool
	}
	return &AuditRepo{exec: exec, now: now}
}

// NewAuditRepoWithDB is the convenience constructor for production
// wiring. It reaches into the *database.DB struct that the rest of the
// package uses so callers do not have to know about pgxpool details.
func NewAuditRepoWithDB(db *database.DB) *AuditRepo {
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
	if r == nil || r.exec == nil {
		return errors.New("audit repo not configured")
	}

	variant := strings.TrimSpace(evt.Variant)
	if variant == "" {
		return ErrAuditRevealVariantRequired
	}
	variant = capText(variant, MaxAuditRevealVariantLen)

	kind := capText(strings.TrimSpace(evt.Kind), MaxAuditRevealKindLen)

	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`

	_, err := r.exec.Exec(ctx, query,
		r.now().UTC(),
		evt.Actor,
		AuditRevealAction,
		variant,
		database.NullIfEmpty(kind),
		database.NullIfEmpty(evt.IP),
		database.NullIfEmpty(evt.UserAgent),
	)
	if err != nil {
		return fmt.Errorf("audit_logs insert: %w", err)
	}
	return nil
}

// AuditImpersonationEvent is the shared write-shape for both the
// start and end audit rows. The handler chooses the action constant;
// the row layout is identical so the dashboards can union the two
// actions and group by (actor, target) without per-row schema
// surprises.
//
// Both Actor (the admin) and Target (the impersonated subject) are
// always recorded — the dashboard's "who did what to whom" query
// joins on actor + entity_type + detail without needing a JSONB
// payload.
type AuditImpersonationEvent struct {
	// Actor is the original admin subject — the operator who started
	// (or is ending) the impersonation. Stored in `audit_logs.actor`
	// so the per-actor index keeps "every action by this admin"
	// queries fast.
	Actor string

	// Target is the subject being impersonated. Stored in
	// `audit_logs.detail` so the entity_type column stays a stable
	// canonical token ("impersonation") and the detail captures the
	// per-row variable (the target identity). This mirrors how the
	// reveal-event variant uses entity_type vs. detail.
	Target string

	// IP and UserAgent come from the originating HTTP request so a
	// post-incident audit can confirm the device that initiated the
	// impersonation. Empty strings persist as NULL.
	IP        string
	UserAgent string
}

// WriteImpersonationStart persists an `impersonation.start` audit row.
// Returns an error so the handler can decide whether to surface a 5xx;
// in practice the handler logs and continues — the impersonation cookie
// is the source of truth for the in-flight session, the audit row is
// best-effort accountability.
func (r *AuditRepo) WriteImpersonationStart(ctx context.Context, evt AuditImpersonationEvent) error {
	return r.writeImpersonationEvent(ctx, AuditImpersonationStartAction, evt)
}

// WriteImpersonationEnd persists an `impersonation.end` audit row.
// Cookie expiry does NOT call this method — only an explicit
// POST /admin/impersonate/end does — so the count of these rows is a
// precise "manually ended" metric.
func (r *AuditRepo) WriteImpersonationEnd(ctx context.Context, evt AuditImpersonationEvent) error {
	return r.writeImpersonationEvent(ctx, AuditImpersonationEndAction, evt)
}

// writeImpersonationEvent is the shared implementation between Start
// and End. Centralising the validation + INSERT keeps the two action
// constants the only divergence between the two write paths.
func (r *AuditRepo) writeImpersonationEvent(ctx context.Context, action string, evt AuditImpersonationEvent) error {
	if r == nil || r.exec == nil {
		return errors.New("audit repo not configured")
	}

	actor := strings.TrimSpace(evt.Actor)
	target := strings.TrimSpace(evt.Target)
	if actor == "" {
		return errors.New("audit_logs impersonation: actor required")
	}
	if target == "" {
		return errors.New("audit_logs impersonation: target required")
	}
	actor = capText(actor, MaxAuditImpersonationSubjectLen)
	target = capText(target, MaxAuditImpersonationSubjectLen)

	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, 'impersonation', NULL, $4, $5, $6)`

	_, err := r.exec.Exec(ctx, query,
		r.now().UTC(),
		actor,
		action,
		target,
		database.NullIfEmpty(evt.IP),
		database.NullIfEmpty(evt.UserAgent),
	)
	if err != nil {
		return fmt.Errorf("audit_logs impersonation insert: %w", err)
	}
	return nil
}

// capText returns s unchanged when it already fits within maxBytes;
// otherwise it truncates to at most maxBytes bytes, backing off to the
// nearest whole UTF-8 rune boundary. A naive s[:maxBytes] slice can cut
// a multi-byte rune in half, producing invalid UTF-8 that PostgreSQL's
// UTF-8 TEXT columns reject at INSERT time — the length caps exist to
// stop a misbehaving caller ballooning a row, so they must not
// themselves corrupt an otherwise-writable value.
func capText(s string, maxBytes int) string {
	if maxBytes <= 0 || len(s) <= maxBytes {
		return s
	}
	truncated := s[:maxBytes]
	for len(truncated) > 0 && !utf8.ValidString(truncated) {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated
}

// ListDistinctActiveSubjects returns the set of subjects that have at
// least one non-revoked auth_sessions row, sorted alphabetically for
// stable rendering. Used by the impersonation candidates endpoint until
// it can read directly from `auth_subjects`.
//
// The query intentionally does NOT exclude the actor — that filtering
// is the handler's job because the handler also has to enforce
// "exclude self when impersonating" semantics.
func (r *AuditRepo) ListDistinctActiveSubjects(ctx context.Context) ([]string, error) {
	if r == nil || r.exec == nil {
		return nil, errors.New("audit repo not configured")
	}
	const query = `
		SELECT DISTINCT subject
		FROM auth_sessions
		WHERE revoked_at IS NULL
		ORDER BY subject ASC`
	rows, err := r.exec.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("auth_sessions distinct subjects: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0, 8)
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, fmt.Errorf("auth_sessions scan: %w", err)
		}
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth_sessions iterate: %w", err)
	}
	return out, nil
}
