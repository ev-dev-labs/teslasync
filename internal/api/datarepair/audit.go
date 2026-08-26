package datarepair

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Audit trail for data-repair mutations.
//
// The shape mirrors internal/api/audit.go and internal/api/drives/bulk.go: one
// append-only row in `audit_logs` per applied mutation, carrying the actor
// resolved from the configured ForwardAuth header plus the originating IP and
// User-Agent. It is duplicated here (rather than exported from internal/api)
// for the same reason the drives bulk handler duplicates it — internal/api
// imports this package, so the dependency cannot run the other way.
//
// Audit rows are inserted through the same transaction as their mutation.
// Any audit failure therefore rolls the mutation back.

// Canonical action tokens. These are matched by audit dashboards and by the
// frontend's audit-recognition logic, so they must stay stable.
const (
	maxHTTPActorChars = 255

	// AuditActionCloseDrive is written when a drive's ended_at is set through
	// the data-repair close endpoint.
	AuditActionCloseDrive = "data_repair.close_drive"
	// AuditActionCloseCharging is written when a charging session's ended_at is
	// set through the data-repair close endpoint.
	AuditActionCloseCharging = "data_repair.close_charging"
	// AuditActionUpdateDrive is written for a non-boundary drive correction.
	AuditActionUpdateDrive = "data_repair.update_drive"
	// AuditActionUpdateCharging is written for a non-boundary charging correction.
	AuditActionUpdateCharging = "data_repair.update_charging"
	// AuditActionDeleteDrive identifies historical permanent-delete audit rows.
	// New removals use AuditActionQuarantineDrive.
	AuditActionDeleteDrive = "data_repair.delete_drive"
	// AuditActionDeleteCharging identifies historical permanent-delete audit rows.
	// New removals use AuditActionQuarantineCharging.
	AuditActionDeleteCharging = "data_repair.delete_charging"
	// AuditActionCaseTransition is written for one operator lifecycle change.
	AuditActionCaseTransition = "data_repair.case_transition"
	// AuditActionCaseAssignment is written when a case is assigned or unassigned.
	AuditActionCaseAssignment = "data_repair.case_assignment"
	// AuditActionCaseComment is written when a case comment is appended.
	AuditActionCaseComment = "data_repair.case_comment"
	// AuditActionCaseBulkTransition is written once per case changed by a bulk request.
	AuditActionCaseBulkTransition = "data_repair.case_bulk_transition"
	// AuditActionQuarantineDrive records removal of a drive into reversible quarantine.
	AuditActionQuarantineDrive = "data_repair.quarantine_drive"
	// AuditActionQuarantineCharging records removal of a charging session into reversible quarantine.
	AuditActionQuarantineCharging = "data_repair.quarantine_charging"
	// AuditActionCaseQuarantine records the matching durable case outcome.
	AuditActionCaseQuarantine = "data_repair.case_quarantine"
	// AuditActionRestoreDrive records restoration of a quarantined drive.
	AuditActionRestoreDrive = "data_repair.restore_drive"
	// AuditActionRestoreCharging records restoration of a quarantined charging session.
	AuditActionRestoreCharging = "data_repair.restore_charging"
	// AuditActionCaseRestore records the matching durable case outcome.
	AuditActionCaseRestore = "data_repair.case_restore"
	// AuditActionCaseApply records a case transition performed with its source mutation.
	AuditActionCaseApply = "data_repair.case_apply"
)

// Canonical entity_type tokens.
const (
	auditEntityDrive           = "drive"
	auditEntityChargingSession = "charging_session"
	auditEntityDataRepairCase  = "data_repair_case"
)

// auditEntry is the canonical write-shape for audit_logs.
type auditEntry struct {
	Actor      string
	Action     string
	EntityType string
	EntityID   *int64
	Detail     string
	IP         string
	UserAgent  string
}

// auditFunc is the injection seam used by tests to observe or fail audit
// writes without a database.
type auditFunc func(ctx context.Context, tx database.DBTX, e auditEntry) error

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// insertAuditLog writes one row into audit_logs through the mutation
// transaction. Errors propagate so the transaction can roll back.
func insertAuditLog(tx database.DBTX, ctx context.Context, now time.Time, e auditEntry) error {
	if tx == nil {
		return errors.New("data-repair audit transaction is not configured")
	}
	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := tx.Exec(ctx, query,
		now.UTC(),
		e.Actor,
		e.Action,
		e.EntityType,
		e.EntityID,
		e.Detail,
		nullableStr(e.IP),
		nullableStr(e.UserAgent),
	)
	return err
}

// actorFromRequest resolves the HTTP operator identity from the configured
// ForwardAuth header. Open-mode requests still receive a durable, non-empty
// attribution rather than violating actor constraints or masquerading as a
// scheduled system action.
func actorFromRequest(r *http.Request, headerName string) string {
	actor := ""
	if r != nil && headerName != "" {
		actor = strings.TrimSpace(r.Header.Get(headerName))
	}
	if actor == "" || !utf8.ValidString(actor) || strings.ContainsRune(actor, '\x00') {
		return "anonymous"
	}
	runes := []rune(actor)
	if len(runes) > maxHTTPActorChars {
		return string(runes[:maxHTTPActorChars])
	}
	return actor
}

// clientIP prefers the first X-Forwarded-For hop, then RemoteAddr with the
// port stripped so values are comparable across requests.
func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	if r.RemoteAddr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// writeAudit records one repair mutation. Routed through the handler so tests
// can substitute the sink via WithAuditFunc.
func (h *DataRepairHandler) writeAudit(
	r *http.Request,
	tx database.DBTX,
	action, entityType string,
	entityID int64,
	detail string,
) error {
	entry := auditEntry{
		Actor:      actorFromRequest(r, h.forwardAuthHeader),
		Action:     action,
		EntityType: entityType,
		EntityID:   &entityID,
		Detail:     detail,
		IP:         clientIP(r),
		UserAgent:  r.UserAgent(),
	}
	if h.audit != nil {
		return h.audit(r.Context(), tx, entry)
	}
	return insertAuditLog(tx, r.Context(), h.now(), entry)
}
