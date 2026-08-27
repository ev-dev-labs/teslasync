package drives

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// DrivesBulkHandler is a compatibility alias for callers that wire the bulk
// endpoint separately from the main DriveHandler.
type DrivesBulkHandler = DriveHandler

// NewDrivesBulkHandler constructs the bulk-capable drive handler.
func NewDrivesBulkHandler(db *database.DB) *DrivesBulkHandler {
	return NewDriveHandler(db, nil)
}

// driveBulkStore is the narrow surface needed by BulkDelete; implemented by
// *drivedb.DriveRepo and substitutable in tests.
type driveBulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

// driveBulkDeleteReturning is implemented by the production repository. The
// narrower legacy store remains supported for existing tests and adapters,
// while this optional interface lets the handler report a concurrent deletion
// as a deterministic conflict instead of guessing from a row count.
type driveBulkDeleteReturning interface {
	BulkDeleteReturning(ctx context.Context, ids []int64) ([]int64, error)
}

// driveBulkRepo returns the active driveBulkStore. Production wiring uses the
// concrete *drivedb.DriveRepo via NewDriveHandler; tests can swap it on the
// handler before invoking BulkDelete.
func (h *DriveHandler) driveBulkRepo() driveBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	return h.driveRepo
}

// BulkDelete removes multiple drives in a single transaction.
//
// Standardized bulk-action endpoint contract:
//   - Body: {"ids":[1,2,3]}, capped at apibulk.MaxIDs (500). Empty or oversized → 400.
//   - Response: {"requested": <int>, "deleted": <int>, "failed": [{"id": <int>, "reason": "not_found"|"conflict"}]}.
//   - Pre-validates which IDs exist via FilterExistingIDs so the caller can
//     pair `failed[]` per id without parsing detail strings.
//   - All deletes happen in a single Postgres transaction; a failure
//     mid-batch rolls back any partially-applied writes.
//   - Audit-logged once with `bulk_delete count=N` in detail.
func (h *DriveHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	ids, err := apibulk.DecodeIDsRequest(r)
	if err != nil {
		apibulk.WriteBadRequest(w, err)
		return
	}

	store := h.driveBulkRepo()
	existing, err := store.FilterExistingIDs(r.Context(), ids)
	if err != nil {
		log.Error().Err(err).Msg("bulk delete drives: filter existing ids")
		writeError(w, http.StatusInternalServerError, "failed to validate drives for bulk delete")
		return
	}
	deletedIDs := existing
	var deleted int64
	if returningStore, ok := store.(driveBulkDeleteReturning); ok {
		deletedIDs, err = returningStore.BulkDeleteReturning(r.Context(), existing)
		deleted = int64(len(deletedIDs))
	} else {
		deleted, err = store.BulkDelete(r.Context(), existing)
	}
	if err != nil {
		log.Error().Err(err).Msg("bulk delete drives")
		writeError(w, http.StatusInternalServerError, "failed to bulk delete drives")
		return
	}
	failed := apibulk.ComputeDeleteFailures(ids, existing, deletedIDs)

	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "bulk_delete", "drive", nil,
			fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
	}

	writeJSON(w, http.StatusOK, apibulk.OperationResult{
		Requested: int64(len(ids)),
		Deleted:   &deleted,
		Failed:    failed,
	})
}

type auditEntry struct {
	Actor      string
	Action     string
	EntityType string
	EntityID   *int64
	Detail     string
	IP         string
	UserAgent  string
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func insertAuditLog(db *database.DB, ctx context.Context, e auditEntry) {
	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := db.Pool.Exec(ctx, query,
		time.Now().UTC(),
		e.Actor,
		e.Action,
		e.EntityType,
		e.EntityID,
		e.Detail,
		nullableStr(e.IP),
		nullableStr(e.UserAgent),
	)
	if err != nil {
		log.Warn().Err(err).Str("action", e.Action).Str("entity_type", e.EntityType).Msg("failed to write audit log")
	}
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

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

func logAuditFromRequest(db *database.DB, r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
	insertAuditLog(db, r.Context(), auditEntry{
		Actor:      actorFromRequest(r, headerName),
		Action:     action,
		EntityType: resource,
		EntityID:   entityID,
		Detail:     detail,
		IP:         clientIP(r),
		UserAgent:  r.UserAgent(),
	})
}
