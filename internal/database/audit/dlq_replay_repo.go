// Package audit persists every DLQ replay attempt to dlq_replay_audit (migration
// 000211). The DLQ inspector's in-memory ring buffer is volatile —
// entries rotate out and the ring is empty after restart. Audit rows
// survive both events so a post-incident forensic trail of
// "who replayed what and what happened" remains queryable indefinitely.
//
// Schema (migration 000211_dlq_and_feature_flag_audit.up.sql):
//
//	dlq_replay_audit(
//	  id BIGSERIAL PRIMARY KEY,
//	  replayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//	  actor TEXT NOT NULL,
//	  actor_ip INET,
//	  dlq_id TEXT NOT NULL,            -- inspector ring id (32-char hex)
//	  src_topic TEXT NOT NULL,         -- DLQ topic the entry arrived on
//	  dst_topic TEXT,                  -- replay target (NULL for non-ok results)
//	  payload JSONB,                   -- envelope as JSON
//	  reason TEXT,                     -- envelope's Reason field, if parsed
//	  result TEXT NOT NULL,            -- ok | publish_failed | rate_limited | disabled | not_found | unparseable
//	  error TEXT,                      -- non-empty when result != 'ok'
//	  trace_id TEXT                    -- W3C trace id for cross-correlation with Jaeger/Tempo
//	)
//
// The repo is intentionally tiny: Insert + Recent. There is no
// Update / Delete / Aggregate API — audit rows are immutable + read by
// operators via the inspector UI's "audit log" tab.

package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// DLQReplayResult is the closed set of outcomes recorded against a
// replay attempt. The values are written verbatim into the
// dlq_replay_audit.result column which has a CHECK constraint
// matching this set; any change here MUST be matched by a migration.
type DLQReplayResult string

const (
	DLQReplayResultOK            DLQReplayResult = "ok"
	DLQReplayResultPublishFailed DLQReplayResult = "publish_failed"
	DLQReplayResultRateLimited   DLQReplayResult = "rate_limited"
	DLQReplayResultDisabled      DLQReplayResult = "disabled"
	DLQReplayResultNotFound      DLQReplayResult = "not_found"
	DLQReplayResultUnparseable   DLQReplayResult = "unparseable"
)

// DLQReplayAuditRecord is one row read from dlq_replay_audit.
type DLQReplayAuditRecord struct {
	ID         int64           `json:"id"`
	ReplayedAt time.Time       `json:"replayed_at"`
	Actor      string          `json:"actor"`
	ActorIP    *netip.Addr     `json:"actor_ip,omitempty"`
	DLQID      string          `json:"dlq_id"`
	SrcTopic   string          `json:"src_topic"`
	DstTopic   *string         `json:"dst_topic,omitempty"`
	Payload    json.RawMessage `json:"payload,omitempty"`
	Reason     *string         `json:"reason,omitempty"`
	Result     DLQReplayResult `json:"result"`
	Error      *string         `json:"error,omitempty"`
	TraceID    *string         `json:"trace_id,omitempty"`
}

// DLQReplayAuditInsert groups the fields callers may set when writing
// a new audit row. ID + ReplayedAt are managed by the database.
type DLQReplayAuditInsert struct {
	Actor    string
	ActorIP  *netip.Addr
	DLQID    string
	SrcTopic string
	DstTopic string // may be empty for non-ok results
	Payload  []byte // raw envelope bytes; pass as-is if JSON (no re-marshal)
	Reason   string
	Result   DLQReplayResult
	Error    string
	TraceID  string
}

// DLQReplayAuditRepo persists + queries audit rows for the DLQ inspector.
//
// exec is the database.DBTX execution seam (satisfied by *pgxpool.Pool
// in production). Holding the interface rather than the concrete pool
// lets Insert/Recent be unit tested against the in-repo DBTX fake.
type DLQReplayAuditRepo struct {
	exec database.DBTX
}

// NewDLQReplayAuditRepo constructs a repo bound to db. Panics on nil
// to surface wiring mistakes at startup rather than at first write
// (audit writes happen on the request path; a silent nil would mean
// audit rows vanish without the operator noticing).
func NewDLQReplayAuditRepo(db *database.DB) *DLQReplayAuditRepo {
	if db == nil {
		panic("database: NewDLQReplayAuditRepo: db is nil")
	}
	return &DLQReplayAuditRepo{exec: db.Pool}
}

// Insert writes a single audit row and returns its assigned ID. The
// returned ID is for tests + diagnostics; production code typically
// ignores it.
//
// Result must be one of the DLQReplayResult* constants — the CHECK
// constraint on the column rejects unknown values at the DB layer.
//
// Payload is stored as JSONB. We do NOT re-marshal: if the inspector
// captured a malformed envelope, the raw bytes are stored verbatim by
// going through the `payload::jsonb` cast which will reject non-JSON
// — falling back to NULL via json.Valid check below.
func (r *DLQReplayAuditRepo) Insert(ctx context.Context, in DLQReplayAuditInsert) (int64, error) {
	if r == nil || r.exec == nil {
		return 0, errors.New("database: DLQReplayAuditRepo: nil repo or db")
	}
	if in.Actor == "" {
		return 0, errors.New("database: DLQReplayAuditRepo.Insert: actor must be non-empty")
	}
	if in.DLQID == "" {
		return 0, errors.New("database: DLQReplayAuditRepo.Insert: dlq_id must be non-empty")
	}
	if in.SrcTopic == "" {
		return 0, errors.New("database: DLQReplayAuditRepo.Insert: src_topic must be non-empty")
	}
	if !knownDLQReplayResult(in.Result) {
		return 0, fmt.Errorf("database: DLQReplayAuditRepo.Insert: unknown result %q", string(in.Result))
	}

	// Payload nullability: only write JSONB when the bytes parse as
	// valid JSON. Malformed envelopes (codec wedged on garbage) become
	// NULL — the inspector still surfaces them via `error` + `dlq_id`.
	var payloadArg any
	if len(in.Payload) > 0 && json.Valid(in.Payload) {
		payloadArg = in.Payload
	}
	var dstTopicArg any
	if in.DstTopic != "" {
		dstTopicArg = in.DstTopic
	}
	var reasonArg any
	if in.Reason != "" {
		reasonArg = in.Reason
	}
	var errorArg any
	if in.Error != "" {
		errorArg = in.Error
	}
	var traceArg any
	if in.TraceID != "" {
		traceArg = in.TraceID
	}
	var ipArg any
	if in.ActorIP != nil {
		ipArg = in.ActorIP.String()
	}

	var id int64
	err := r.exec.QueryRow(ctx,
		`INSERT INTO dlq_replay_audit
		   (actor, actor_ip, dlq_id, src_topic, dst_topic, payload, reason, result, error, trace_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 RETURNING id`,
		in.Actor, ipArg, in.DLQID, in.SrcTopic, dstTopicArg, payloadArg,
		reasonArg, string(in.Result), errorArg, traceArg,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("database: DLQReplayAuditRepo.Insert: %w", err)
	}
	return id, nil
}

// Recent returns up to limit most-recent audit rows, newest first.
// Limit is clamped to [1, 500]. Filter by dlq_id when only-recent-for-
// this-message is desired; pass empty string for the global view.
func (r *DLQReplayAuditRepo) Recent(ctx context.Context, dlqID string, limit int) ([]DLQReplayAuditRecord, error) {
	if r == nil || r.exec == nil {
		return nil, errors.New("database: DLQReplayAuditRepo: nil repo or db")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	var rows pgx.Rows
	var err error
	if dlqID == "" {
		rows, err = r.exec.Query(ctx,
			`SELECT id, replayed_at, actor, actor_ip::text, dlq_id, src_topic, dst_topic,
			        payload, reason, result, error, trace_id
			   FROM dlq_replay_audit
			   ORDER BY id DESC
			   LIMIT $1`, limit)
	} else {
		rows, err = r.exec.Query(ctx,
			`SELECT id, replayed_at, actor, actor_ip::text, dlq_id, src_topic, dst_topic,
			        payload, reason, result, error, trace_id
			   FROM dlq_replay_audit
			  WHERE dlq_id = $1
			   ORDER BY id DESC
			   LIMIT $2`, dlqID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("database: DLQReplayAuditRepo.Recent: query: %w", err)
	}
	defer rows.Close()

	out := make([]DLQReplayAuditRecord, 0, limit)
	for rows.Next() {
		var rec DLQReplayAuditRecord
		var ipStr *string
		var dstTopic, reason, errorMsg, traceID *string
		var payload []byte
		var resultStr string
		if err := rows.Scan(&rec.ID, &rec.ReplayedAt, &rec.Actor, &ipStr, &rec.DLQID,
			&rec.SrcTopic, &dstTopic, &payload, &reason, &resultStr, &errorMsg, &traceID); err != nil {
			return nil, fmt.Errorf("database: DLQReplayAuditRepo.Recent: scan: %w", err)
		}
		if ipStr != nil && *ipStr != "" {
			if addr, perr := netip.ParseAddr(*ipStr); perr == nil {
				rec.ActorIP = &addr
			}
		}
		rec.DstTopic = dstTopic
		rec.Reason = reason
		rec.Result = DLQReplayResult(resultStr)
		rec.Error = errorMsg
		rec.TraceID = traceID
		if len(payload) > 0 {
			rec.Payload = payload
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("database: DLQReplayAuditRepo.Recent: rows: %w", err)
	}
	return out, nil
}

func knownDLQReplayResult(r DLQReplayResult) bool {
	switch r {
	case DLQReplayResultOK, DLQReplayResultPublishFailed, DLQReplayResultRateLimited,
		DLQReplayResultDisabled, DLQReplayResultNotFound, DLQReplayResultUnparseable:
		return true
	}
	return false
}
