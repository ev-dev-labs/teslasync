// Package audit persists every write to the dynamic feature-flag store
// (internal/flags) — both `set` and `delete` — to feature_flag_changes
// (migration 000211). Read paths are NOT audited (they're hot-path
// in-process lookups served from a local cache).
//
// The audit row captures BOTH old + new values (text-stringified by
// the handler) so a post-mortem "who toggled this hour-before-incident
// and what did it change from?" question is answerable from a single
// SELECT. Generic request-audit middleware only captures the HTTP
// envelope — without before/after values it can't answer that question.

package audit

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// FeatureFlagOperation is the closed set of write operations recorded
// against the flag store. Matches the operation column's CHECK
// constraint exactly.
type FeatureFlagOperation string

const (
	FeatureFlagOpSet    FeatureFlagOperation = "set"
	FeatureFlagOpDelete FeatureFlagOperation = "delete"
)

// FeatureFlagChange is one row read from feature_flag_changes.
type FeatureFlagChange struct {
	ID        int64                `json:"id"`
	ChangedAt time.Time            `json:"changed_at"`
	Actor     string               `json:"actor"`
	ActorIP   *netip.Addr          `json:"actor_ip,omitempty"`
	FlagKey   string               `json:"flag_key"`
	Operation FeatureFlagOperation `json:"operation"`
	OldValue  *string              `json:"old_value,omitempty"`
	NewValue  *string              `json:"new_value,omitempty"`
	Reason    *string              `json:"reason,omitempty"`
	TraceID   *string              `json:"trace_id,omitempty"`
}

// FeatureFlagChangeInsert groups the fields callers may set when
// writing a new audit row.
type FeatureFlagChangeInsert struct {
	Actor     string
	ActorIP   *netip.Addr
	FlagKey   string
	Operation FeatureFlagOperation
	OldValue  string // empty → NULL
	NewValue  string // empty → NULL (always empty for Operation=delete)
	Reason    string // empty → NULL
	TraceID   string // empty → NULL
}

// FeatureFlagChangesRepo persists + queries audit rows for the flag
// store admin endpoints.
//
// exec is the database.DBTX execution seam (satisfied by *pgxpool.Pool
// in production). Holding the interface rather than the concrete pool
// lets Insert/Recent be unit tested against the in-repo DBTX fake.
type FeatureFlagChangesRepo struct {
	exec database.DBTX
}

// NewFeatureFlagChangesRepo constructs a repo bound to db. Panics on
// nil to surface wiring mistakes at startup.
func NewFeatureFlagChangesRepo(db *database.DB) *FeatureFlagChangesRepo {
	if db == nil {
		panic("database: NewFeatureFlagChangesRepo: db is nil")
	}
	return &FeatureFlagChangesRepo{exec: db.Pool}
}

// Insert writes a single audit row and returns its assigned ID.
// Operation must be one of the FeatureFlagOp* constants — the CHECK
// constraint on the column rejects unknown values at the DB layer.
func (r *FeatureFlagChangesRepo) Insert(ctx context.Context, in FeatureFlagChangeInsert) (int64, error) {
	if r == nil || r.exec == nil {
		return 0, errors.New("database: FeatureFlagChangesRepo: nil repo or db")
	}
	if in.Actor == "" {
		return 0, errors.New("database: FeatureFlagChangesRepo.Insert: actor must be non-empty")
	}
	if in.FlagKey == "" {
		return 0, errors.New("database: FeatureFlagChangesRepo.Insert: flag_key must be non-empty")
	}
	if in.Operation != FeatureFlagOpSet && in.Operation != FeatureFlagOpDelete {
		return 0, fmt.Errorf("database: FeatureFlagChangesRepo.Insert: unknown operation %q", string(in.Operation))
	}
	if in.Operation == FeatureFlagOpDelete && in.NewValue != "" {
		// Defensive: a delete-with-new-value is a wiring bug, not a valid state.
		return 0, errors.New("database: FeatureFlagChangesRepo.Insert: delete operation must not carry new_value")
	}

	var ipArg any
	if in.ActorIP != nil {
		ipArg = in.ActorIP.String()
	}
	var oldArg, newArg, reasonArg, traceArg any
	if in.OldValue != "" {
		oldArg = in.OldValue
	}
	if in.NewValue != "" {
		newArg = in.NewValue
	}
	if in.Reason != "" {
		reasonArg = in.Reason
	}
	if in.TraceID != "" {
		traceArg = in.TraceID
	}

	var id int64
	err := r.exec.QueryRow(ctx,
		`INSERT INTO feature_flag_changes
		   (actor, actor_ip, flag_key, operation, old_value, new_value, reason, trace_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id`,
		in.Actor, ipArg, in.FlagKey, string(in.Operation),
		oldArg, newArg, reasonArg, traceArg,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("database: FeatureFlagChangesRepo.Insert: %w", err)
	}
	return id, nil
}

// Recent returns up to limit most-recent change rows, newest first.
// Limit is clamped to [1, 500]. Filter by flagKey when only-recent-for-
// this-flag is desired; pass empty string for the global view.
func (r *FeatureFlagChangesRepo) Recent(ctx context.Context, flagKey string, limit int) ([]FeatureFlagChange, error) {
	if r == nil || r.exec == nil {
		return nil, errors.New("database: FeatureFlagChangesRepo: nil repo or db")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	var rows pgx.Rows
	var err error
	if flagKey == "" {
		rows, err = r.exec.Query(ctx,
			`SELECT id, changed_at, actor, actor_ip::text, flag_key, operation, old_value, new_value, reason, trace_id
			   FROM feature_flag_changes
			   ORDER BY id DESC
			   LIMIT $1`, limit)
	} else {
		rows, err = r.exec.Query(ctx,
			`SELECT id, changed_at, actor, actor_ip::text, flag_key, operation, old_value, new_value, reason, trace_id
			   FROM feature_flag_changes
			  WHERE flag_key = $1
			   ORDER BY id DESC
			   LIMIT $2`, flagKey, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("database: FeatureFlagChangesRepo.Recent: query: %w", err)
	}
	defer rows.Close()

	out := make([]FeatureFlagChange, 0, limit)
	for rows.Next() {
		var rec FeatureFlagChange
		var ipStr, oldVal, newVal, reason, traceID *string
		var opStr string
		if err := rows.Scan(&rec.ID, &rec.ChangedAt, &rec.Actor, &ipStr, &rec.FlagKey, &opStr,
			&oldVal, &newVal, &reason, &traceID); err != nil {
			return nil, fmt.Errorf("database: FeatureFlagChangesRepo.Recent: scan: %w", err)
		}
		if ipStr != nil && *ipStr != "" {
			if addr, perr := netip.ParseAddr(*ipStr); perr == nil {
				rec.ActorIP = &addr
			}
		}
		rec.Operation = FeatureFlagOperation(opStr)
		rec.OldValue = oldVal
		rec.NewValue = newVal
		rec.Reason = reason
		rec.TraceID = traceID
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: FeatureFlagChangesRepo.Recent: rows: %w", err)
	}
	return out, nil
}
