package charging

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apibulk"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// chargingBulkStore is the narrow surface needed by BulkDelete; implemented
// by *chargingdb.ChargingRepo and substitutable in tests.
type chargingBulkStore interface {
	FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

type chargingBulkDeleteReturning interface {
	BulkDeleteReturning(ctx context.Context, ids []int64) ([]int64, error)
}

func (h *ChargingHandler) chargingBulkRepo() chargingBulkStore {
	if h.bulkOverride != nil {
		return h.bulkOverride
	}
	return h.chargingRepo
}

// BulkDelete removes multiple charging sessions in a single transaction.
//
// Contract:
//   - Body: {"ids":[1,2,3]}, capped at MaxBulkIDs (500). Empty or oversized → 400.
//   - Response: {"requested": <int>, "deleted": <int>, "failed": [{"id": <int>, "reason": "not_found"|"conflict"}]}.
//   - Pre-validates which IDs exist via FilterExistingIDs so the caller can
//     pair `failed[]` per id without parsing detail strings.
//   - All deletes happen in a single Postgres transaction; a failure
//     mid-batch rolls back any partially-applied writes.
//   - Audit-logged once with `bulk_delete count=N` in detail.
func (h *ChargingHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	ids, err := apibulk.DecodeIDsRequest(r)
	if err != nil {
		apibulk.WriteBadRequest(w, err)
		return
	}

	store := h.chargingBulkRepo()
	existing, err := store.FilterExistingIDs(r.Context(), ids)
	if err != nil {
		log.Error().Err(err).Msg("bulk delete charging sessions: filter existing ids")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to validate charging sessions for bulk delete")
		return
	}
	deletedIDs := existing
	var deleted int64
	if returningStore, ok := store.(chargingBulkDeleteReturning); ok {
		deletedIDs, err = returningStore.BulkDeleteReturning(r.Context(), existing)
		deleted = int64(len(deletedIDs))
	} else {
		deleted, err = store.BulkDelete(r.Context(), existing)
	}
	if err != nil {
		log.Error().Err(err).Msg("bulk delete charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to bulk delete charging sessions")
		return
	}
	failed := apibulk.ComputeDeleteFailures(ids, existing, deletedIDs)

	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "bulk_delete", "charging_session", nil,
			fmt.Sprintf("bulk_delete count=%d failed=%d", deleted, len(failed)))
	}

	httpx.WriteJSON(w, http.StatusOK, apibulk.OperationResult{
		Requested: int64(len(ids)),
		Deleted:   &deleted,
		Failed:    failed,
	})
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
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
	if db == nil || r == nil {
		return
	}
	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := db.Pool.Exec(r.Context(), query,
		time.Now().UTC(),
		actorFromRequest(r, headerName),
		action,
		resource,
		entityID,
		detail,
		nullableStr(clientIP(r)),
		nullableStr(r.UserAgent()),
	)
	if err != nil {
		log.Warn().Err(err).Str("action", action).Str("entity_type", resource).Msg("failed to write audit log")
	}
}
