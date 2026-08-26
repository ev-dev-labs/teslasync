package datarepair

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// CaseRepo provides data access for the data_repair_cases lifecycle,
// comments, and quarantine records introduced by migration
// 000231_data_repair_cases.
//
// Methods accept database.DBTX where atomic composition with other repos is
// necessary (e.g. quarantine + session delete in one transaction). Convenience
// methods that do not require external transactions delegate to the pool.
type CaseRepo struct {
	db *database.DB
}

// NewCaseRepo constructs the case management repo.
func NewCaseRepo(db *database.DB) *CaseRepo {
	return &CaseRepo{db: db}
}

// ErrNoCaseDatabase is returned when the repo was constructed without a pool.
var ErrNoCaseDatabase = fmt.Errorf("data-repair cases: no database configured")

// ErrConcurrentModification is returned when an optimistic-lock (updated_at CAS)
// check fails, indicating a concurrent modification.
var ErrConcurrentModification = fmt.Errorf("data-repair cases: concurrent modification detected")

// ErrCaseTransactionRequired prevents quarantine operations from being split
// across commits. Their snapshot/delete or restore/mark/audit steps must share
// one transaction.
var ErrCaseTransactionRequired = fmt.Errorf("data-repair cases: transaction is required")

// ErrActiveQuarantineExists is returned when a session already has a
// non-restored quarantine row. The partial unique index is the final
// concurrency guard; callers should map this expected race to HTTP 409.
var ErrActiveQuarantineExists = fmt.Errorf("data-repair cases: active quarantine already exists")

// ErrQuarantineNotActive is returned when a restore attempts to mark a
// quarantine row that is missing or was already restored.
var ErrQuarantineNotActive = fmt.Errorf("data-repair cases: quarantine is not active")

func (r *CaseRepo) ready() error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrNoCaseDatabase
	}
	return nil
}

func (r *CaseRepo) pool() database.DBTX {
	return r.db.Pool
}

// caseColumns is the canonical SELECT column list for data_repair_cases.
const caseColumns = `id, fingerprint, kind, session_id, related_session_id, vehicle_id, rule, confidence, status,
	suggested_ended_at,
	evidence_started_at, evidence_stored_ended_at,
	evidence_contradiction_ts, evidence_contradiction_src,
	evidence_contradiction_field, evidence_contradiction_value,
	evidence_last_in_session_ts, evidence_last_in_session_src,
	evidence_last_in_session_field, evidence_last_in_session_value,
	evidence_gap_s,
	assigned_to, resolution_note,
	applicable, blocked_reason,
	first_seen_at, last_seen_at,
	applied_at, dismissed_at, restored_at, quarantined_at, resolved_at,
	created_at, updated_at`

// scanCase scans the canonical column list into a RepairCase.
func scanCase(row interface{ Scan(dest ...any) error }) (*systemmodel.RepairCase, error) {
	c := &systemmodel.RepairCase{}
	err := row.Scan(
		&c.ID, &c.Fingerprint, &c.Kind, &c.SessionID, &c.RelatedSessionID, &c.VehicleID, &c.Rule, &c.Confidence, &c.Status,
		&c.SuggestedEndedAt,
		&c.EvidenceStartedAt, &c.EvidenceStoredEndedAt,
		&c.EvidenceContradictionTs, &c.EvidenceContradictionSrc,
		&c.EvidenceContradictionField, &c.EvidenceContradictionValue,
		&c.EvidenceLastInSessionTs, &c.EvidenceLastInSessionSrc,
		&c.EvidenceLastInSessionField, &c.EvidenceLastInSessionValue,
		&c.EvidenceGapS,
		&c.AssignedTo, &c.ResolutionNote,
		&c.Applicable, &c.BlockedReason,
		&c.FirstSeenAt, &c.LastSeenAt,
		&c.AppliedAt, &c.DismissedAt, &c.RestoredAt, &c.QuarantinedAt, &c.ResolvedAt,
		&c.CreatedAt, &c.UpdatedAt,
	)
	return c, err
}

// scanCaseFromRows scans one row from an open Rows into a RepairCase value.
func scanCaseFromRows(rows pgx.Rows) (systemmodel.RepairCase, error) {
	var c systemmodel.RepairCase
	err := rows.Scan(
		&c.ID, &c.Fingerprint, &c.Kind, &c.SessionID, &c.RelatedSessionID, &c.VehicleID, &c.Rule, &c.Confidence, &c.Status,
		&c.SuggestedEndedAt,
		&c.EvidenceStartedAt, &c.EvidenceStoredEndedAt,
		&c.EvidenceContradictionTs, &c.EvidenceContradictionSrc,
		&c.EvidenceContradictionField, &c.EvidenceContradictionValue,
		&c.EvidenceLastInSessionTs, &c.EvidenceLastInSessionSrc,
		&c.EvidenceLastInSessionField, &c.EvidenceLastInSessionValue,
		&c.EvidenceGapS,
		&c.AssignedTo, &c.ResolutionNote,
		&c.Applicable, &c.BlockedReason,
		&c.FirstSeenAt, &c.LastSeenAt,
		&c.AppliedAt, &c.DismissedAt, &c.RestoredAt, &c.QuarantinedAt, &c.ResolvedAt,
		&c.CreatedAt, &c.UpdatedAt,
	)
	return c, err
}

// quarantineColumns is the canonical SELECT column list for data_repair_quarantine.
const quarantineColumns = `id, case_id, kind, session_id, vehicle_id,
	original_row, schema_version, checksum,
	reason, quarantined_by, quarantined_at,
	restored_by, restored_at`

// quarantineMetadataColumns deliberately excludes original_row. List
// responses never need the potentially large, location-bearing recovery
// payload, and RepairQuarantine hides it from JSON as defense in depth.
const quarantineMetadataColumns = `id, case_id, kind, session_id, vehicle_id,
	schema_version, checksum,
	reason, quarantined_by, quarantined_at,
	restored_by, restored_at`

// scanQuarantine scans the canonical column list into a RepairQuarantine.
func scanQuarantine(row interface{ Scan(dest ...any) error }) (*systemmodel.RepairQuarantine, error) {
	q := &systemmodel.RepairQuarantine{}
	err := row.Scan(
		&q.ID, &q.CaseID, &q.Kind, &q.SessionID, &q.VehicleID,
		&q.OriginalRow, &q.SchemaVersion, &q.Checksum,
		&q.Reason, &q.QuarantinedBy, &q.QuarantinedAt,
		&q.RestoredBy, &q.RestoredAt,
	)
	return q, err
}

// scanQuarantineFromRows scans one row from an open Rows into a RepairQuarantine value.
func scanQuarantineFromRows(rows pgx.Rows) (systemmodel.RepairQuarantine, error) {
	var q systemmodel.RepairQuarantine
	err := rows.Scan(
		&q.ID, &q.CaseID, &q.Kind, &q.SessionID, &q.VehicleID,
		&q.OriginalRow, &q.SchemaVersion, &q.Checksum,
		&q.Reason, &q.QuarantinedBy, &q.QuarantinedAt,
		&q.RestoredBy, &q.RestoredAt,
	)
	return q, err
}

func scanQuarantineMetadata(row interface{ Scan(dest ...any) error }) (*systemmodel.RepairQuarantine, error) {
	q := &systemmodel.RepairQuarantine{}
	err := row.Scan(
		&q.ID, &q.CaseID, &q.Kind, &q.SessionID, &q.VehicleID,
		&q.SchemaVersion, &q.Checksum,
		&q.Reason, &q.QuarantinedBy, &q.QuarantinedAt,
		&q.RestoredBy, &q.RestoredAt,
	)
	return q, err
}

// ---------------------------------------------------------------------------
// queryBuilder is a small helper for building dynamic WHERE clauses with
// sequential $N parameters. Not exported — internal to this file.
// ---------------------------------------------------------------------------

type queryBuilder struct {
	clauses []string
	args    []interface{}
}

func newQueryBuilder() *queryBuilder {
	return &queryBuilder{
		clauses: make([]string, 0, 8),
		args:    make([]interface{}, 0, 8),
	}
}

func (qb *queryBuilder) add(clause string, arg interface{}) {
	qb.args = append(qb.args, arg)
	// Replace the single "?" placeholder in clause with $N.
	n := len(qb.args)
	qb.clauses = append(qb.clauses, strings.Replace(clause, "?", fmt.Sprintf("$%d", n), 1))
}

// addRaw appends a clause with two positional args (for tuple comparisons).
func (qb *queryBuilder) addTuple(clauseFmt string, arg1, arg2 interface{}) {
	qb.args = append(qb.args, arg1)
	n1 := len(qb.args)
	qb.args = append(qb.args, arg2)
	n2 := len(qb.args)
	qb.clauses = append(qb.clauses, fmt.Sprintf(clauseFmt, n1, n2))
}

func (qb *queryBuilder) addLimit(limit int) string {
	qb.args = append(qb.args, limit)
	return fmt.Sprintf("$%d", len(qb.args))
}

func (qb *queryBuilder) where() string {
	if len(qb.clauses) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(qb.clauses, " AND ")
}

// ---------------------------------------------------------------------------
// Upsert / Refresh
// ---------------------------------------------------------------------------

// UpsertCase inserts a new case or refreshes an existing
// open/in_review/dismissed case by fingerprint. Keeping dismissed cases in the
// conflict set prevents a repeatedly detected false positive from reopening
// itself without an operator decision.
//
// Returns the case ID (newly created or existing).
func (r *CaseRepo) UpsertCase(ctx context.Context, tx database.DBTX, c *systemmodel.RepairCase) (int64, error) {
	id, _, err := r.UpsertCaseWithOutcome(ctx, tx, c)
	return id, err
}

// UpsertCaseWithOutcome is UpsertCase plus an inserted flag for scan-run
// accounting. PostgreSQL exposes xmax=0 for the INSERT arm and a non-zero
// xmax for the ON CONFLICT UPDATE arm of this statement.
func (r *CaseRepo) UpsertCaseWithOutcome(
	ctx context.Context,
	tx database.DBTX,
	c *systemmodel.RepairCase,
) (int64, bool, error) {
	if err := r.ready(); err != nil {
		return 0, false, err
	}
	if tx == nil {
		tx = r.pool()
	}
	ctx, span := tracing.DBSpan(ctx, "upsert", "data_repair_cases")
	defer span.End()

	const query = `
		INSERT INTO data_repair_cases (
			fingerprint, kind, session_id, related_session_id, vehicle_id, rule, confidence, status,
			suggested_ended_at,
			evidence_started_at, evidence_stored_ended_at,
			evidence_contradiction_ts, evidence_contradiction_src,
			evidence_contradiction_field, evidence_contradiction_value,
			evidence_last_in_session_ts, evidence_last_in_session_src,
			evidence_last_in_session_field, evidence_last_in_session_value,
			evidence_gap_s,
			applicable, blocked_reason,
			first_seen_at, last_seen_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8,
			$9,
			$10, $11,
			$12, $13, $14, $15,
			$16, $17, $18, $19,
			$20,
			$21, $22,
			NOW(), NOW(), NOW(), NOW()
		)
		ON CONFLICT (fingerprint) WHERE status IN ('open', 'in_review', 'dismissed')
		DO UPDATE SET
			last_seen_at    = NOW(),
			confidence      = EXCLUDED.confidence,
			suggested_ended_at = EXCLUDED.suggested_ended_at,
			evidence_started_at          = EXCLUDED.evidence_started_at,
			evidence_stored_ended_at     = EXCLUDED.evidence_stored_ended_at,
			evidence_contradiction_ts    = EXCLUDED.evidence_contradiction_ts,
			evidence_contradiction_src   = EXCLUDED.evidence_contradiction_src,
			evidence_contradiction_field = EXCLUDED.evidence_contradiction_field,
			evidence_contradiction_value = EXCLUDED.evidence_contradiction_value,
			evidence_last_in_session_ts    = EXCLUDED.evidence_last_in_session_ts,
			evidence_last_in_session_src   = EXCLUDED.evidence_last_in_session_src,
			evidence_last_in_session_field = EXCLUDED.evidence_last_in_session_field,
			evidence_last_in_session_value = EXCLUDED.evidence_last_in_session_value,
			evidence_gap_s              = EXCLUDED.evidence_gap_s,
			applicable                  = EXCLUDED.applicable,
			blocked_reason              = EXCLUDED.blocked_reason,
			updated_at                  = NOW()
		RETURNING id, (xmax = 0) AS inserted`

	var id int64
	var inserted bool
	err := tx.QueryRow(ctx, query,
		c.Fingerprint, c.Kind, c.SessionID, c.RelatedSessionID, c.VehicleID, c.Rule, c.Confidence, c.Status,
		c.SuggestedEndedAt,
		c.EvidenceStartedAt, c.EvidenceStoredEndedAt,
		c.EvidenceContradictionTs, c.EvidenceContradictionSrc,
		c.EvidenceContradictionField, c.EvidenceContradictionValue,
		c.EvidenceLastInSessionTs, c.EvidenceLastInSessionSrc,
		c.EvidenceLastInSessionField, c.EvidenceLastInSessionValue,
		c.EvidenceGapS,
		c.Applicable, c.BlockedReason,
	).Scan(&id, &inserted)
	if err != nil {
		return 0, false, fmt.Errorf("data-repair: upsert case fingerprint=%s: %w", c.Fingerprint, err)
	}
	return id, inserted, nil
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

// GetCase returns a single case by ID, or (nil, nil) if not found.
func (r *CaseRepo) GetCase(ctx context.Context, id int64) (*systemmodel.RepairCase, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_cases")
	defer span.End()

	query := "SELECT " + caseColumns + " FROM data_repair_cases WHERE id = $1"

	c, err := scanCase(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: get case %d: %w", id, err)
	}
	return c, nil
}

// GetCaseForUpdate returns and row-locks a case inside the caller's
// transaction. It is used by multi-table repair orchestration where a
// lifecycle decision must remain stable until commit.
func (r *CaseRepo) GetCaseForUpdate(
	ctx context.Context,
	tx database.DBTX,
	id int64,
) (*systemmodel.RepairCase, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if tx == nil {
		return nil, ErrCaseTransactionRequired
	}
	ctx, span := tracing.DBSpan(ctx, "select_for_update", "data_repair_cases")
	defer span.End()

	query := "SELECT " + caseColumns + " FROM data_repair_cases WHERE id = $1 FOR UPDATE"
	c, err := scanCase(tx.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: lock case %d: %w", id, err)
	}
	return c, nil
}

// FindActiveCaseByFingerprint returns the open/in-review case for a
// deterministic suggestion fingerprint, or (nil, nil) if there is no case to
// advance. Dismissed cases are deliberately excluded: an explicit operator
// dismissal must not be silently undone by the legacy suggestion apply path.
func (r *CaseRepo) FindActiveCaseByFingerprint(
	ctx context.Context,
	fingerprint string,
) (*systemmodel.RepairCase, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_cases")
	defer span.End()

	query := "SELECT " + caseColumns + `
		FROM data_repair_cases
		WHERE fingerprint = $1
		  AND status IN ('open', 'in_review')`
	c, err := scanCase(r.db.Pool.QueryRow(ctx, query, fingerprint))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: find active case by fingerprint: %w", err)
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// List with keyset pagination
// ---------------------------------------------------------------------------

// ListCases returns cases matching the given filter with keyset pagination.
// Results are ordered by (last_seen_at DESC, id DESC) for a stable worklist.
// The cursor is the (last_seen_at, id) pair of the last row on the previous page.
func (r *CaseRepo) ListCases(ctx context.Context, f systemmodel.RepairCaseListFilter) ([]systemmodel.RepairCase, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_cases")
	defer span.End()

	f.ClampLimit(50, 200)

	qb := newQueryBuilder()
	if f.Status != nil {
		qb.add("status = ?", string(*f.Status))
	}
	if f.VehicleID != nil {
		qb.add("vehicle_id = ?", *f.VehicleID)
	}
	if f.Kind != nil {
		qb.add("kind = ?", string(*f.Kind))
	}
	if f.Confidence != nil {
		qb.add("confidence = ?", string(*f.Confidence))
	}
	if f.AssignedTo != nil {
		qb.add("assigned_to = ?", *f.AssignedTo)
	}
	if f.CursorLastSeenAt != nil && f.CursorID != nil {
		qb.addTuple("(last_seen_at, id) < ($%d, $%d)", *f.CursorLastSeenAt, *f.CursorID)
	}
	limitParam := qb.addLimit(f.Limit)

	query := fmt.Sprintf("SELECT %s FROM data_repair_cases %s ORDER BY last_seen_at DESC, id DESC LIMIT %s",
		caseColumns, qb.where(), limitParam)

	rows, err := r.db.Pool.Query(ctx, query, qb.args...)
	if err != nil {
		return nil, fmt.Errorf("data-repair: list cases: %w", err)
	}
	defer rows.Close()

	out := make([]systemmodel.RepairCase, 0, f.Limit)
	for rows.Next() {
		c, err := scanCaseFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("data-repair: scan case row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate cases: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Status transitions (optimistic concurrency via updated_at CAS)
// ---------------------------------------------------------------------------

// TransitionStatus atomically moves a case from its current status to newStatus,
// using optimistic concurrency control on updated_at. If the row's updated_at
// does not match expectedUpdatedAt, ErrConcurrentModification is returned.
//
// Terminal-state timestamps (applied_at, dismissed_at, restored_at,
// quarantined_at, resolved_at) are set automatically based on newStatus.
func (r *CaseRepo) TransitionStatus(
	ctx context.Context,
	tx database.DBTX,
	caseID int64,
	newStatus systemmodel.RepairCaseStatus,
	resolutionNote *string,
	expectedUpdatedAt time.Time,
) error {
	if err := r.ready(); err != nil {
		return err
	}
	if tx == nil {
		tx = r.pool()
	}
	ctx, span := tracing.DBSpan(ctx, "update", "data_repair_cases")
	defer span.End()

	// Determine which terminal timestamp to set.
	var appliedAt, dismissedAt, restoredAt, quarantinedAt, resolvedAt *time.Time
	now := time.Now().UTC()
	switch newStatus {
	case systemmodel.RepairCaseStatusApplied:
		appliedAt = &now
	case systemmodel.RepairCaseStatusDismissed:
		dismissedAt = &now
	case systemmodel.RepairCaseStatusRestored:
		restoredAt = &now
	case systemmodel.RepairCaseStatusQuarantined:
		quarantinedAt = &now
	case systemmodel.RepairCaseStatusResolved:
		resolvedAt = &now
	}

	const query = `
		UPDATE data_repair_cases
		SET status          = $1,
		    resolution_note = COALESCE($2, resolution_note),
		    applied_at      = COALESCE($3, applied_at),
		    dismissed_at    = COALESCE($4, dismissed_at),
		    restored_at     = COALESCE($5, restored_at),
		    quarantined_at  = COALESCE($6, quarantined_at),
		    resolved_at     = COALESCE($7, resolved_at),
		    updated_at      = NOW()
		WHERE id = $8
		  AND updated_at = $9`

	tag, err := tx.Exec(ctx, query,
		string(newStatus), resolutionNote,
		appliedAt, dismissedAt, restoredAt, quarantinedAt, resolvedAt,
		caseID, expectedUpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("data-repair: transition case %d to %s: %w", caseID, newStatus, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConcurrentModification
	}
	return nil
}

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------

// AssignCase sets the assigned_to field on a case.
func (r *CaseRepo) AssignCase(ctx context.Context, tx database.DBTX, caseID int64, assignee *string) error {
	if err := r.ready(); err != nil {
		return err
	}
	if tx == nil {
		tx = r.pool()
	}
	ctx, span := tracing.DBSpan(ctx, "update", "data_repair_cases")
	defer span.End()

	const query = `
		UPDATE data_repair_cases
		SET assigned_to = $1, updated_at = NOW()
		WHERE id = $2`

	tag, err := tx.Exec(ctx, query, assignee, caseID)
	if err != nil {
		return fmt.Errorf("data-repair: assign case %d: %w", caseID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("data-repair: assign case %d: not found", caseID)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

// AddComment inserts a new comment on a case.
func (r *CaseRepo) AddComment(ctx context.Context, tx database.DBTX, comment *systemmodel.RepairCaseComment) (int64, error) {
	if err := r.ready(); err != nil {
		return 0, err
	}
	if tx == nil {
		tx = r.pool()
	}
	ctx, span := tracing.DBSpan(ctx, "insert", "data_repair_case_comments")
	defer span.End()

	const query = `
		INSERT INTO data_repair_case_comments (case_id, actor, body, created_at)
		VALUES ($1, $2, $3, NOW())
		RETURNING id, created_at`

	err := tx.QueryRow(ctx, query, comment.CaseID, comment.Actor, comment.Body).
		Scan(&comment.ID, &comment.CreatedAt)
	if err != nil {
		return 0, fmt.Errorf("data-repair: add comment to case %d: %w", comment.CaseID, err)
	}
	return comment.ID, nil
}

// ListComments returns the newest 500 comments for a case in chronological
// order. The hard cap prevents a long-lived case from producing an unbounded
// detail response while keeping the review trail easy to read.
func (r *CaseRepo) ListComments(ctx context.Context, caseID int64) ([]systemmodel.RepairCaseComment, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_case_comments")
	defer span.End()

	const query = `
		SELECT id, case_id, actor, body, created_at
		FROM (
			SELECT id, case_id, actor, body, created_at
			FROM data_repair_case_comments
			WHERE case_id = $1
			ORDER BY created_at DESC, id DESC
			LIMIT 500
		) recent
		ORDER BY created_at ASC, id ASC`

	rows, err := r.db.Pool.Query(ctx, query, caseID)
	if err != nil {
		return nil, fmt.Errorf("data-repair: list comments for case %d: %w", caseID, err)
	}
	defer rows.Close()

	out := make([]systemmodel.RepairCaseComment, 0, 8)
	for rows.Next() {
		var c systemmodel.RepairCaseComment
		if err := rows.Scan(&c.ID, &c.CaseID, &c.Actor, &c.Body, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("data-repair: scan comment row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate comments: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Quarantine
// ---------------------------------------------------------------------------

// CreateQuarantine inserts a quarantine record. Must be called within a
// transaction that also deletes the session row from its source table.
func (r *CaseRepo) CreateQuarantine(ctx context.Context, tx database.DBTX, q *systemmodel.RepairQuarantine) (int64, error) {
	if err := r.ready(); err != nil {
		return 0, err
	}
	if tx == nil {
		return 0, ErrCaseTransactionRequired
	}
	ctx, span := tracing.DBSpan(ctx, "insert", "data_repair_quarantine")
	defer span.End()

	const query = `
		INSERT INTO data_repair_quarantine (
			case_id, kind, session_id, vehicle_id,
			original_row, schema_version, checksum,
			reason, quarantined_by, quarantined_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
		RETURNING id, quarantined_at`

	err := tx.QueryRow(ctx, query,
		q.CaseID, q.Kind, q.SessionID, q.VehicleID,
		q.OriginalRow, q.SchemaVersion, q.Checksum,
		q.Reason, q.QuarantinedBy,
	).Scan(&q.ID, &q.QuarantinedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) &&
			pgErr.Code == "23505" &&
			pgErr.ConstraintName == "idx_data_repair_quarantine_active_session" {
			return 0, fmt.Errorf(
				"data-repair: create quarantine for session %s/%d: %w",
				q.Kind,
				q.SessionID,
				ErrActiveQuarantineExists,
			)
		}
		return 0, fmt.Errorf("data-repair: create quarantine for session %s/%d: %w", q.Kind, q.SessionID, err)
	}
	return q.ID, nil
}

// GetQuarantine returns a quarantine record by ID, or (nil, nil) if not found.
func (r *CaseRepo) GetQuarantine(ctx context.Context, id int64) (*systemmodel.RepairQuarantine, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_quarantine")
	defer span.End()

	query := "SELECT " + quarantineColumns + " FROM data_repair_quarantine WHERE id = $1"

	q, err := scanQuarantine(r.db.Pool.QueryRow(ctx, query, id))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: get quarantine %d: %w", id, err)
	}
	return q, nil
}

// GetQuarantineForUpdate returns the full recovery payload and row-locks the
// quarantine record inside the caller's transaction. Loading through the pool
// would split restore validation from the atomic restore transaction.
func (r *CaseRepo) GetQuarantineForUpdate(
	ctx context.Context,
	tx database.DBTX,
	id int64,
) (*systemmodel.RepairQuarantine, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	if tx == nil {
		return nil, ErrCaseTransactionRequired
	}
	ctx, span := tracing.DBSpan(ctx, "select_for_update", "data_repair_quarantine")
	defer span.End()

	query := "SELECT " + quarantineColumns + " FROM data_repair_quarantine WHERE id = $1 FOR UPDATE"
	q, err := scanQuarantine(tx.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: lock quarantine %d: %w", id, err)
	}
	return q, nil
}

// GetQuarantineByCase returns the active (non-restored) quarantine record for
// a given case, or (nil, nil) if not found.
func (r *CaseRepo) GetQuarantineByCase(ctx context.Context, caseID int64) (*systemmodel.RepairQuarantine, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_quarantine")
	defer span.End()

	query := "SELECT " + quarantineMetadataColumns + " FROM data_repair_quarantine WHERE case_id = $1 AND restored_at IS NULL"

	q, err := scanQuarantineMetadata(r.db.Pool.QueryRow(ctx, query, caseID))
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("data-repair: get quarantine by case %d: %w", caseID, err)
	}
	return q, nil
}

// ListQuarantines returns quarantine records matching the filter with keyset
// pagination ordered by (quarantined_at DESC, id DESC).
func (r *CaseRepo) ListQuarantines(ctx context.Context, f systemmodel.RepairQuarantineListFilter) ([]systemmodel.RepairQuarantine, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_quarantine")
	defer span.End()

	f.ClampLimit(50, 200)

	qb := newQueryBuilder()
	if f.Kind != nil {
		qb.add("kind = ?", string(*f.Kind))
	}
	if f.VehicleID != nil {
		qb.add("vehicle_id = ?", *f.VehicleID)
	}
	if f.Restored != nil {
		if *f.Restored {
			qb.clauses = append(qb.clauses, "restored_at IS NOT NULL")
		} else {
			qb.clauses = append(qb.clauses, "restored_at IS NULL")
		}
	}
	if f.CursorQuarantinedAt != nil && f.CursorID != nil {
		qb.addTuple("(quarantined_at, id) < ($%d, $%d)", *f.CursorQuarantinedAt, *f.CursorID)
	}
	limitParam := qb.addLimit(f.Limit)

	query := fmt.Sprintf("SELECT %s FROM data_repair_quarantine %s ORDER BY quarantined_at DESC, id DESC LIMIT %s",
		quarantineMetadataColumns, qb.where(), limitParam)

	rows, err := r.db.Pool.Query(ctx, query, qb.args...)
	if err != nil {
		return nil, fmt.Errorf("data-repair: list quarantines: %w", err)
	}
	defer rows.Close()

	out := make([]systemmodel.RepairQuarantine, 0, f.Limit)
	for rows.Next() {
		q, err := scanQuarantineMetadata(rows)
		if err != nil {
			return nil, fmt.Errorf("data-repair: scan quarantine row: %w", err)
		}
		out = append(out, *q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("data-repair: iterate quarantines: %w", err)
	}
	return out, nil
}

// MarkQuarantineRestored marks a quarantine record as restored. Must be called
// within a transaction that also re-inserts the original session row.
func (r *CaseRepo) MarkQuarantineRestored(ctx context.Context, tx database.DBTX, quarantineID int64, restoredBy string) error {
	if err := r.ready(); err != nil {
		return err
	}
	if tx == nil {
		return ErrCaseTransactionRequired
	}
	ctx, span := tracing.DBSpan(ctx, "update", "data_repair_quarantine")
	defer span.End()

	const query = `
		UPDATE data_repair_quarantine
		SET restored_by = $1, restored_at = NOW()
		WHERE id = $2 AND restored_at IS NULL`

	tag, err := tx.Exec(ctx, query, restoredBy, quarantineID)
	if err != nil {
		return fmt.Errorf("data-repair: mark quarantine %d restored: %w", quarantineID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("data-repair: quarantine %d: %w", quarantineID, ErrQuarantineNotActive)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

// GetStats returns aggregate counts by status and kind, plus the oldest open
// case timestamp and the most recent scanner run time. The optional vehicleID
// scopes all counts to a single vehicle; pass nil for fleet-wide stats.
func (r *CaseRepo) GetStats(ctx context.Context, vehicleID *int64) (*systemmodel.RepairCaseStats, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_cases")
	defer span.End()

	// Single bounded aggregation query using conditional counts.
	const query = `
		SELECT
			COUNT(*)                                           AS total,
			COUNT(*) FILTER (WHERE status = 'open')         AS open_count,
			COUNT(*) FILTER (WHERE status = 'in_review')    AS in_review_count,
			COUNT(*) FILTER (WHERE status = 'applied')      AS applied_count,
			COUNT(*) FILTER (WHERE status = 'dismissed')    AS dismissed_count,
			COUNT(*) FILTER (WHERE status = 'restored')     AS restored_count,
			COUNT(*) FILTER (WHERE status = 'quarantined')  AS quarantined_count,
			COUNT(*) FILTER (WHERE status = 'resolved')     AS resolved_count,
			COUNT(*) FILTER (WHERE kind = 'drive')          AS drive_count,
			COUNT(*) FILTER (WHERE kind = 'charging')       AS charging_count,
			MIN(first_seen_at) FILTER (WHERE status = 'open') AS oldest_open_at,
			(
				SELECT MAX(sr.completed_at)
				FROM data_repair_scan_runs sr
				WHERE sr.status = 'completed'
				  AND ($1::bigint IS NULL OR sr.vehicle_id IS NULL OR sr.vehicle_id = $1)
			) AS last_scan_at
		FROM data_repair_cases
		WHERE ($1::bigint IS NULL OR vehicle_id = $1)`

	s := &systemmodel.RepairCaseStats{}
	err := r.db.Pool.QueryRow(ctx, query, nullableVehicleID(vehicleID)).Scan(
		&s.Total,
		&s.OpenCount, &s.InReviewCount, &s.AppliedCount,
		&s.DismissedCount, &s.RestoredCount, &s.QuarantinedCount, &s.ResolvedCount,
		&s.DriveCount, &s.ChargingCount,
		&s.OldestOpenAt, &s.LastScanAt,
	)
	if err != nil {
		return nil, fmt.Errorf("data-repair: get stats: %w", err)
	}
	return s, nil
}

// ---------------------------------------------------------------------------
// Scan execution history
// ---------------------------------------------------------------------------

// StartScanRun creates a durable running record before discovery begins.
func (r *CaseRepo) StartScanRun(
	ctx context.Context,
	trigger systemmodel.RepairScanTrigger,
	vehicleID *int64,
	initiatedBy string,
) (*systemmodel.RepairScanRun, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	ctx, span := tracing.DBSpan(ctx, "insert", "data_repair_scan_runs")
	defer span.End()

	const query = `
		INSERT INTO data_repair_scan_runs (trigger, status, vehicle_id, initiated_by)
		VALUES ($1, 'running', $2, $3)
		RETURNING id, started_at`

	run := &systemmodel.RepairScanRun{
		Trigger:     trigger,
		Status:      systemmodel.RepairScanStatusRunning,
		VehicleID:   vehicleID,
		InitiatedBy: initiatedBy,
	}
	if err := r.db.Pool.QueryRow(ctx, query, trigger, vehicleID, initiatedBy).
		Scan(&run.ID, &run.StartedAt); err != nil {
		return nil, fmt.Errorf("data-repair: start scan run: %w", err)
	}
	return run, nil
}

// FinishScanRun records the terminal outcome of a running scan.
func (r *CaseRepo) FinishScanRun(
	ctx context.Context,
	runID int64,
	status systemmodel.RepairScanStatus,
	discovered, refreshed int,
	truncated bool,
	failureReason *string,
) error {
	if err := r.ready(); err != nil {
		return err
	}
	ctx, span := tracing.DBSpan(ctx, "update", "data_repair_scan_runs")
	defer span.End()

	const query = `
		UPDATE data_repair_scan_runs
		SET status = $1,
		    discovered = $2,
		    refreshed = $3,
		    truncated = $4,
		    failure_reason = $5,
		    completed_at = NOW()
		WHERE id = $6
		  AND status = 'running'
		  AND completed_at IS NULL`

	tag, err := r.db.Pool.Exec(
		ctx, query,
		status, discovered, refreshed, truncated, failureReason, runID,
	)
	if err != nil {
		return fmt.Errorf("data-repair: finish scan run %d: %w", runID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("data-repair: scan run %d not found or already completed", runID)
	}
	return nil
}
