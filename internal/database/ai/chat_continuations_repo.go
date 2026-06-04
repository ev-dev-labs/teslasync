// AIChatContinuationsRepo persists and reads paused dispatcher state
// (internal/ai/dispatch.ContinuationState) into the
// ai_chat_continuations table (migration 000204).
//
// The repo is intentionally narrow:
//   - Save             — insert one continuation row with a 24h expiry
//   - Load             — read a row by id (returns ErrContinuationNotFound
//     if the row is missing OR expired)
//   - Delete           — remove a row after the dispatcher resumes
//   - CleanupExpired   — bulk delete rows whose expires_at < now(), for use
//     by a periodic worker tick
//
// Subject scoping: every call carries the FORWARD_AUTH_HEADER subject
// so a multi-user deployment can attribute paused conversations to a
// principal. A continuation looked up with the wrong subject behaves
// the same as one that doesn't exist (constant-time defence against
// id enumeration).
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// DefaultContinuationTTL is the hard expiry the repo applies to
// every Save. Rows older than this MUST NOT be resumable: the user
// has had no recent contextual reason to approve whatever mutation
// was queued, and the dispatcher state may reference data the user
// has since changed.
//
// Mirrors the migration's CHECK (expires_at > created_at) and 24h cap.
const DefaultContinuationTTL = 24 * time.Hour

// ErrContinuationNotFound is returned by Load when the requested
// continuation does not exist OR has expired. The two cases are
// indistinguishable to the caller by design: the resume endpoint
// surfaces the same "session no longer available" message either
// way, denying an attacker the side-channel of "this id existed
// once".
var ErrContinuationNotFound = errors.New("ai_chat_continuations: not found or expired")

// ContinuationRow is the typed shape of one row in
// ai_chat_continuations. Callers receive State as a json.RawMessage
// so they can decode it into the dispatcher's typed
// ContinuationState in the dispatch package (no import cycle).
type ContinuationRow struct {
	ID          string          `db:"id"            json:"id"`
	UserSubject string          `db:"user_subject"  json:"user_subject"`
	FeatureID   string          `db:"feature_id"    json:"feature_id"`
	State       json.RawMessage `db:"state"         json:"state"`
	CreatedAt   time.Time       `db:"created_at"    json:"created_at"`
	ExpiresAt   time.Time       `db:"expires_at"    json:"expires_at"`
}

// AIChatContinuationsRepo is the data access layer for paused
// dispatcher runs.
type AIChatContinuationsRepo struct {
	db *database.DB
	// nowFn is the time source. Tests inject a fixed clock so
	// expiry-window assertions are deterministic; production wires
	// time.Now via the constructor default.
	nowFn func() time.Time
}

// NewAIChatContinuationsRepo constructs the repo with the default
// (real-clock) time source. Tests use NewAIChatContinuationsRepoFor
// to inject a deterministic clock.
func NewAIChatContinuationsRepo(db *database.DB) *AIChatContinuationsRepo {
	return &AIChatContinuationsRepo{db: db, nowFn: time.Now}
}

// NewAIChatContinuationsRepoFor is a test-only constructor that
// pins the repo's clock. Production code MUST use
// NewAIChatContinuationsRepo.
func NewAIChatContinuationsRepoFor(db *database.DB, now func() time.Time) *AIChatContinuationsRepo {
	return &AIChatContinuationsRepo{db: db, nowFn: now}
}

// Save inserts a new continuation row with expiry = now +
// DefaultContinuationTTL. id is the dispatcher-issued handle; if a
// row already exists with the same id the call returns an error
// (continuation IDs are intended to be UUID-shaped and globally
// unique).
//
// state MUST be a valid JSON object — the repo does not validate
// the shape (the dispatcher owns that contract via
// dispatch.ContinuationState).
func (r *AIChatContinuationsRepo) Save(ctx context.Context, id, userSubject, featureID string, state json.RawMessage) (*ContinuationRow, error) {
	if id == "" {
		return nil, errors.New("ai_chat_continuations: empty id")
	}
	if featureID == "" {
		return nil, errors.New("ai_chat_continuations: empty feature_id")
	}
	if len(state) == 0 {
		return nil, errors.New("ai_chat_continuations: empty state")
	}
	now := r.nowFn().UTC()
	expires := now.Add(DefaultContinuationTTL)
	const q = `
		INSERT INTO ai_chat_continuations (
			id, user_subject, feature_id, state, created_at, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, user_subject, feature_id, state, created_at, expires_at`
	row := &ContinuationRow{}
	err := r.db.Pool.QueryRow(ctx, q, id, userSubject, featureID, state, now, expires).Scan(
		&row.ID, &row.UserSubject, &row.FeatureID, &row.State, &row.CreatedAt, &row.ExpiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("ai_chat_continuations save: %w", err)
	}
	return row, nil
}

// Load returns the continuation row for (id, subject) if it exists
// AND has not expired. If the row is missing, expired, or owned by
// a different subject, returns ErrContinuationNotFound — these are
// indistinguishable by design.
//
// Subject scoping is enforced in SQL so a typo in the resume
// handler can't leak another user's continuation.
func (r *AIChatContinuationsRepo) Load(ctx context.Context, id, userSubject string) (*ContinuationRow, error) {
	if id == "" {
		return nil, ErrContinuationNotFound
	}
	now := r.nowFn().UTC()
	const q = `
		SELECT id, user_subject, feature_id, state, created_at, expires_at
		FROM ai_chat_continuations
		WHERE id = $1 AND user_subject = $2 AND expires_at > $3
		LIMIT 1`
	row := &ContinuationRow{}
	err := r.db.Pool.QueryRow(ctx, q, id, userSubject, now).Scan(
		&row.ID, &row.UserSubject, &row.FeatureID, &row.State, &row.CreatedAt, &row.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrContinuationNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("ai_chat_continuations load: %w", err)
	}
	return row, nil
}

// Delete removes a continuation row. Idempotent: deleting a missing
// row is not an error (so the resume handler can call this in a
// defer without a special-case for "already cleaned up").
//
// Subject scoping in SQL: a Delete with the wrong subject is a
// no-op rather than a leak.
func (r *AIChatContinuationsRepo) Delete(ctx context.Context, id, userSubject string) error {
	const q = `DELETE FROM ai_chat_continuations WHERE id = $1 AND user_subject = $2`
	_, err := r.db.Pool.Exec(ctx, q, id, userSubject)
	if err != nil {
		return fmt.Errorf("ai_chat_continuations delete: %w", err)
	}
	return nil
}

// CleanupExpired bulk-deletes every row whose expires_at is in the
// past relative to the repo's clock. Returns the number of rows
// removed so the caller can record a metric.
//
// Intended for invocation by a periodic worker tick (every few
// minutes). The expires_at index makes the WHERE clause an O(log n)
// range scan even with 1000s of rows.
func (r *AIChatContinuationsRepo) CleanupExpired(ctx context.Context) (int64, error) {
	now := r.nowFn().UTC()
	const q = `DELETE FROM ai_chat_continuations WHERE expires_at < $1`
	tag, err := r.db.Pool.Exec(ctx, q, now)
	if err != nil {
		return 0, fmt.Errorf("ai_chat_continuations cleanup: %w", err)
	}
	return tag.RowsAffected(), nil
}
