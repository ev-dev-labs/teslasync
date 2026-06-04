package alerts

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
	"github.com/rs/zerolog/log"
)

// EventBroadcaster is the narrow SSE hub contract used by alert test notifications.
type EventBroadcaster interface {
	BroadcastWithContext(ctx context.Context, eventType string, data interface{})
}

type ComputedMetricEvaluator = computed.Evaluator

var ComputedMetrics = computed.ComputedMetrics

func NewComputedMetricEvaluator(db *database.DB) *ComputedMetricEvaluator {
	return computed.New(db)
}

func ListMetricSummaries() []computed.MetricSummary {
	return computed.ListMetricSummaries()
}

func IsValidComputedMetricOp(op string) bool {
	return computed.IsValidComputedMetricOp(op)
}

func IsPercentChangeOp(op string) bool {
	return computed.IsPercentChangeOp(op)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func pagination(r *http.Request) (limit, offset int) {
	return apiparams.Pagination(r)
}

func urlParamInt64(r *http.Request, key string) (int64, error) {
	return apiparams.URLParamInt64(r, key)
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
