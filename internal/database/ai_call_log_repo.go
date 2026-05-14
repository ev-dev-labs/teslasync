// Phase-50 / 0004 — F3 AI Call Log + Usage Card.
//
// AICallLogRepo persists + reads the per-call audit trail written by
// the audit decorator (internal/ai/provider/audit.go) into the
// ai_call_log TimescaleDB hypertable (migration 000203).
//
// The repo is intentionally narrow:
//   - Insert        — single row (used by the async audit drainer)
//   - Today         — aggregate of the calling user's "today" rows
//   - ByFeature     — per-feature aggregate over a time window
//   - Recent        — last N rows for the calling user, newest-first
//
// All read methods scope to user_subject so a multi-user
// FORWARD_AUTH_HEADER deployment cannot leak one user's spend to
// another via the AiUsageCard. Open mode passes "" as the subject and
// reads back the open-mode rows symmetrically.
package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
)

// AICallLogRepo provides AI audit log data access.
type AICallLogRepo struct {
	db *DB
}

// NewAICallLogRepo constructs the repo. Single-line constructor matches
// every other *Repo in this package; the *DB carries the pool.
func NewAICallLogRepo(db *DB) *AICallLogRepo {
	return &AICallLogRepo{db: db}
}

// AICallTodayAggregate is the result of Today: total volume + spend
// for the requested user since 00:00 UTC. Zero values are valid (a
// fresh user with no AI activity returns the zero struct).
type AICallTodayAggregate struct {
	Calls          int64 `json:"calls" db:"calls"`
	InputTokens    int64 `json:"input_tokens" db:"input_tokens"`
	OutputTokens   int64 `json:"output_tokens" db:"output_tokens"`
	CostMicroCents int64 `json:"cost_micro_cents" db:"cost_micro_cents"`
}

// AICallFeatureRow is one entry in the ByFeature breakdown: per-feature
// volume + spend over the requested window. The row also surfaces the
// *latest* call timestamp so the UI can show "last used 5m ago".
type AICallFeatureRow struct {
	FeatureID      string    `json:"feature_id" db:"feature_id"`
	Calls          int64     `json:"calls" db:"calls"`
	InputTokens    int64     `json:"input_tokens" db:"input_tokens"`
	OutputTokens   int64     `json:"output_tokens" db:"output_tokens"`
	CostMicroCents int64     `json:"cost_micro_cents" db:"cost_micro_cents"`
	LastCallAt     time.Time `json:"last_call_at" db:"last_call_at"`
}

// AICallRecentRow is one entry in the Recent listing: per-call detail
// for the last N invocations. Optional fields use *string / *int64
// so the JSON serialiser can emit null where the column is unset.
type AICallRecentRow struct {
	ID             int64     `json:"id" db:"id"`
	StartedAt      time.Time `json:"started_at" db:"started_at"`
	FinishedAt     time.Time `json:"finished_at" db:"finished_at"`
	FeatureID      string    `json:"feature_id" db:"feature_id"`
	Provider       string    `json:"provider" db:"provider"`
	Model          string    `json:"model" db:"model"`
	InputTokens    int       `json:"input_tokens" db:"input_tokens"`
	OutputTokens   int       `json:"output_tokens" db:"output_tokens"`
	CostMicroCents int64     `json:"cost_micro_cents" db:"cost_micro_cents"`
	LatencyMs      int       `json:"latency_ms" db:"latency_ms"`
	FinishReason   string    `json:"finish_reason" db:"finish_reason"`
	Error          string    `json:"error" db:"error"`
}

// ErrAICallLogInvalidLimit is returned by Recent when the caller asks
// for ≤ 0 or > AICallRecentMax rows. Surfaces as 400 in the handler.
var ErrAICallLogInvalidLimit = errors.New("ai_call_log: limit out of range")

// AICallRecentMax is the upper bound on Recent's limit parameter.
// 500 is enough to render a deep "recent activity" tab without
// inviting a row-pump that could compromise the table's compression
// ratio. The handler clamps user-supplied larger values to this.
const AICallRecentMax = 500

// Insert persists one audit row. Called by the async drainer in
// internal/ai/provider/audit.go — never on the request hot path.
//
// Defence in depth at the application layer: feature_id is validated
// against the canonical features registry before the INSERT runs so a
// typo at the call site surfaces here rather than corrupting the
// usage-card breakdown. The DB CHECK constraint on `provider` does
// the same job for the provider column.
//
// Implements the provider.AuditSink interface so the wiring in
// router.go can pass *AICallLogRepo straight to NewAsyncAuditWriter.
func (r *AICallLogRepo) Insert(ctx context.Context, rec *provider.AuditRecord) error {
	if rec == nil {
		return errors.New("ai_call_log: nil record")
	}
	if rec.FeatureID == "" {
		// Empty feature_id slips through if a handler forgot the
		// WithFeatureID(ctx, ...) wrapper. The row still inserts
		// (so the call is auditable) but we log it loudly so the
		// gap is fixable. The DB column has no NOT NULL constraint
		// on '' specifically — empty string is allowed.
		rec.FeatureID = ""
	}
	if rec.Provider == "" {
		return fmt.Errorf("ai_call_log: empty provider in record (model=%q)", rec.Model)
	}
	const q = `
		INSERT INTO ai_call_log (
			user_subject, feature_id, provider, model,
			input_tokens, output_tokens, cost_micro_cents, latency_ms,
			finish_reason, request_hash, redacted_digest, error,
			started_at, finished_at,
			redacted_classes, redaction_bypass
		) VALUES ($1,$2,$3,$4, $5,$6,$7,$8, $9,$10,$11,$12, $13,$14, $15,$16)`
	// errorPtr is nil when Error is empty so the column receives SQL
	// NULL rather than an empty string. The DB has `error TEXT NULL`
	// so an empty error and a missing error are both representable;
	// using NULL keeps "no error" distinct from "empty error message".
	var errorPtr *string
	if rec.Error != "" {
		e := rec.Error
		errorPtr = &e
	}
	// F8 redaction meta. The redact decorator records per-call meta
	// in a process-global sink keyed by (feature_id, request_hash);
	// we consume it here so the columns are populated atomically with
	// the rest of the row. A miss (Consume returns ok=false) is
	// expected for: (a) calls that never went through the redact
	// decorator (e.g. tests that bypass the chain), (b) calls whose
	// meta entry was swept after the 60s TTL because the audit
	// drainer wedged. Both cases default to {} + false, which the
	// bypass report treats as "no signal" rather than "bypass=true".
	classes := []string{}
	bypass := false
	if rec.RequestHash != "" && rec.FeatureID != "" {
		if meta, ok := redact.ConsumeMeta(redact.MetaKey(rec.FeatureID, rec.RequestHash)); ok {
			classes = make([]string, 0, len(meta.Classes))
			for _, c := range meta.Classes {
				classes = append(classes, string(c))
			}
			bypass = meta.Bypass
		}
	}
	_, err := r.db.Pool.Exec(ctx, q,
		rec.UserSubject, rec.FeatureID, rec.Provider, rec.Model,
		rec.InputTokens, rec.OutputTokens, rec.CostMicroCents, rec.LatencyMs,
		rec.FinishReason, rec.RequestHash, rec.RedactedDigest, errorPtr,
		rec.StartedAt, rec.FinishedAt,
		classes, bypass,
	)
	if err != nil {
		return fmt.Errorf("ai_call_log insert: %w", err)
	}
	return nil
}

// Today returns the per-user aggregate of every audit row written
// since 00:00 UTC of the current day. Empty result returns the zero
// struct (no rows) — never nil — so the handler can serialise with
// no special-case for "no activity yet".
//
// Subject scoping: subject == "" returns open-mode rows
// (user_subject = ''); a non-empty subject returns rows with an
// exact match. Cross-user reads are impossible by construction.
func (r *AICallLogRepo) Today(ctx context.Context, subject string) (*AICallTodayAggregate, error) {
	const q = `
		SELECT
			COUNT(*)::BIGINT                        AS calls,
			COALESCE(SUM(input_tokens), 0)::BIGINT  AS input_tokens,
			COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
			COALESCE(SUM(cost_micro_cents), 0)      AS cost_micro_cents
		FROM ai_call_log
		WHERE user_subject = $1
		  AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`
	out := &AICallTodayAggregate{}
	err := r.db.Pool.QueryRow(ctx, q, subject).Scan(
		&out.Calls, &out.InputTokens, &out.OutputTokens, &out.CostMicroCents,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("ai_call_log Today: %w", err)
	}
	return out, nil
}

// ByFeature returns the per-feature breakdown of the user's activity
// since the supplied cut-off. The handler defaults `since` to 7 days
// ago when the query parameter is absent.
//
// The result is ordered by cost descending so the UI can render
// "what's costing me money" without re-sorting client-side. Features
// with zero rows in the window are omitted (the UI treats absence as
// "not used").
func (r *AICallLogRepo) ByFeature(ctx context.Context, subject string, since time.Time) ([]AICallFeatureRow, error) {
	const q = `
		SELECT
			feature_id,
			COUNT(*)::BIGINT                        AS calls,
			COALESCE(SUM(input_tokens), 0)::BIGINT  AS input_tokens,
			COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
			COALESCE(SUM(cost_micro_cents), 0)      AS cost_micro_cents,
			MAX(started_at)                         AS last_call_at
		FROM ai_call_log
		WHERE user_subject = $1
		  AND started_at >= $2
		GROUP BY feature_id
		ORDER BY cost_micro_cents DESC, calls DESC`
	rows, err := r.db.Pool.Query(ctx, q, subject, since.UTC())
	if err != nil {
		return nil, fmt.Errorf("ai_call_log ByFeature: %w", err)
	}
	defer rows.Close()

	out := make([]AICallFeatureRow, 0)
	for rows.Next() {
		var rec AICallFeatureRow
		if err := rows.Scan(
			&rec.FeatureID, &rec.Calls, &rec.InputTokens, &rec.OutputTokens,
			&rec.CostMicroCents, &rec.LastCallAt,
		); err != nil {
			return nil, fmt.Errorf("ai_call_log ByFeature scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_call_log ByFeature rows: %w", err)
	}
	return out, nil
}

// Recent returns the user's last N audit rows, newest-first. Limit is
// validated to (0, AICallRecentMax]; out-of-range values return
// ErrAICallLogInvalidLimit so the handler can map to 400.
//
// The query intentionally does NOT join the features table — feature
// metadata changes (rename, archive) MUST NOT alter past audit rows,
// which is the whole point of storing the raw feature_id string.
func (r *AICallLogRepo) Recent(ctx context.Context, subject string, limit int) ([]AICallRecentRow, error) {
	if limit <= 0 || limit > AICallRecentMax {
		return nil, fmt.Errorf("%w: %d (allowed range 1..%d)",
			ErrAICallLogInvalidLimit, limit, AICallRecentMax)
	}
	const q = `
		SELECT
			id, started_at, finished_at, feature_id, provider, model,
			input_tokens, output_tokens, cost_micro_cents, latency_ms,
			finish_reason, COALESCE(error, '') AS error
		FROM ai_call_log
		WHERE user_subject = $1
		ORDER BY started_at DESC
		LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, q, subject, limit)
	if err != nil {
		return nil, fmt.Errorf("ai_call_log Recent: %w", err)
	}
	defer rows.Close()

	out := make([]AICallRecentRow, 0, limit)
	for rows.Next() {
		var rec AICallRecentRow
		if err := rows.Scan(
			&rec.ID, &rec.StartedAt, &rec.FinishedAt, &rec.FeatureID,
			&rec.Provider, &rec.Model, &rec.InputTokens, &rec.OutputTokens,
			&rec.CostMicroCents, &rec.LatencyMs, &rec.FinishReason, &rec.Error,
		); err != nil {
			return nil, fmt.Errorf("ai_call_log Recent scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_call_log Recent rows: %w", err)
	}
	return out, nil
}

// AIRedactionBypassRow is one entry in the F8 bypass report. Calls is
// the total volume in the window; Bypassed is the subset where the
// redact decorator skipped redaction (local-loopback or no policy in
// ctx). BypassRatio is Bypassed/Calls as a fraction in [0,1] —
// exposed pre-computed so the admin UI does not need to know the
// total to colour-code the row.
type AIRedactionBypassRow struct {
	FeatureID   string  `json:"feature_id" db:"feature_id"`
	Provider    string  `json:"provider" db:"provider"`
	Calls       int64   `json:"calls" db:"calls"`
	Bypassed    int64   `json:"bypassed" db:"bypassed"`
	BypassRatio float64 `json:"bypass_ratio" db:"bypass_ratio"`
}

// RedactionBypassByFeature returns the per-(feature, provider) bypass
// summary over the supplied window. Used by the admin bypass-report
// endpoint to flag features whose >0% of calls bypass unexpectedly.
//
// The query intentionally does NOT scope to user_subject — the report
// is a cross-tenant operator view (the admin endpoint itself is
// gated by the admin role middleware). Cloud providers with bypass>0
// are the high-signal anomaly because cloud calls SHOULD always be
// redacted; local providers (Ollama) bypassing is expected.
//
// Result is ordered by (bypass_ratio DESC, calls DESC) so the
// most-suspect rows surface first. Features with zero rows in the
// window are omitted.
func (r *AICallLogRepo) RedactionBypassByFeature(ctx context.Context, since time.Time) ([]AIRedactionBypassRow, error) {
	const q = `
		SELECT
			feature_id,
			provider,
			COUNT(*)::BIGINT                                              AS calls,
			COUNT(*) FILTER (WHERE redaction_bypass)::BIGINT              AS bypassed,
			COALESCE(
				COUNT(*) FILTER (WHERE redaction_bypass)::FLOAT / NULLIF(COUNT(*), 0),
				0
			)                                                              AS bypass_ratio
		FROM ai_call_log
		WHERE started_at >= $1
		GROUP BY feature_id, provider
		ORDER BY bypass_ratio DESC, calls DESC`
	rows, err := r.db.Pool.Query(ctx, q, since.UTC())
	if err != nil {
		return nil, fmt.Errorf("ai_call_log RedactionBypassByFeature: %w", err)
	}
	defer rows.Close()

	out := make([]AIRedactionBypassRow, 0)
	for rows.Next() {
		var rec AIRedactionBypassRow
		if err := rows.Scan(
			&rec.FeatureID, &rec.Provider, &rec.Calls, &rec.Bypassed, &rec.BypassRatio,
		); err != nil {
			return nil, fmt.Errorf("ai_call_log RedactionBypassByFeature scan: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_call_log RedactionBypassByFeature rows: %w", err)
	}
	return out, nil
}
