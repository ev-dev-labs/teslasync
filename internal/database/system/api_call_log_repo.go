package system

import (
	"context"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// APICallLogRepo provides API call log data access operations.
type APICallLogRepo struct {
	db *database.DB
}

func NewAPICallLogRepo(db *database.DB) *APICallLogRepo {
	return &APICallLogRepo{db: db}
}

func (r *APICallLogRepo) Create(ctx context.Context, l *teslamodel.APICallLog) error {
	if l.Service == "" {
		l.Service = "tesla-api"
	}
	query := `INSERT INTO api_call_logs (ts, vehicle_id, service, http_method, endpoint, status_code, duration_ms, error_message, rate_limited, request_body, response_body)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, now, l.VehicleID, l.Service, l.HTTPMethod, l.Endpoint, l.StatusCode, l.DurationMs, l.ErrorMessage, l.RateLimited, l.RequestBody, l.ResponseBody).Scan(&l.ID)
}

// CreateBatch inserts a slice of api_call_logs in a single pgx.CopyFrom call.
// This is the high-throughput write path used by the inbound APICallLog
// middleware's async writer; it MUST be safe for concurrent callers, which
// pgxpool.Pool already guarantees. Empty batches are no-ops. Each entry's
// Ts field is honored (the middleware sets it to the request start time);
// entries with a zero Ts fall back to the current UTC instant.
func (r *APICallLogRepo) CreateBatch(ctx context.Context, batch []*teslamodel.APICallLog) error {
	if len(batch) == 0 {
		return nil
	}
	now := time.Now().UTC()
	rows := pgx.CopyFromSlice(len(batch), func(i int) ([]any, error) {
		l := batch[i]
		ts := l.Ts
		if ts.IsZero() {
			ts = now
		}
		svc := l.Service
		if svc == "" {
			svc = "tesla-api"
		}
		return []any{
			ts,
			l.VehicleID,
			svc,
			l.HTTPMethod,
			l.Endpoint,
			l.StatusCode,
			l.DurationMs,
			l.ErrorMessage,
			l.RateLimited,
			l.RequestBody,
			l.ResponseBody,
		}, nil
	})
	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"api_call_logs"},
		[]string{"ts", "vehicle_id", "service", "http_method", "endpoint", "status_code", "duration_ms", "error_message", "rate_limited", "request_body", "response_body"},
		rows,
	)
	return err
}

func (r *APICallLogRepo) GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, startDate, endDate string) ([]*teslamodel.APICallLog, int, error) {
	query := `SELECT id, ts, vehicle_id, service, http_method, endpoint, status_code, duration_ms, error_message, rate_limited, request_body, response_body FROM api_call_logs WHERE 1=1`
	countQuery := `SELECT COUNT(*) FROM api_call_logs WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if method != "" {
		query += ` AND http_method = $` + itoa(argIdx)
		countQuery += ` AND http_method = $` + itoa(argIdx)
		args = append(args, method)
		argIdx++
	}
	if statusFilter != "" {
		// statusFilter can be "2xx", "4xx", "5xx" or a specific code like "200"
		if len(statusFilter) == 3 && statusFilter[1] == 'x' && statusFilter[2] == 'x' {
			low := (int(statusFilter[0]-'0') * 100)
			high := low + 99
			query += ` AND status_code >= $` + itoa(argIdx) + ` AND status_code <= $` + itoa(argIdx+1)
			countQuery += ` AND status_code >= $` + itoa(argIdx) + ` AND status_code <= $` + itoa(argIdx+1)
			args = append(args, low, high)
			argIdx += 2
		} else {
			query += ` AND status_code = $` + itoa(argIdx)
			countQuery += ` AND status_code = $` + itoa(argIdx)
			args = append(args, statusFilter)
			argIdx++
		}
	}
	if endpoint != "" {
		query += ` AND endpoint ILIKE $` + itoa(argIdx)
		countQuery += ` AND endpoint ILIKE $` + itoa(argIdx)
		args = append(args, "%"+endpoint+"%")
		argIdx++
	}
	if service != "" {
		query += ` AND service = $` + itoa(argIdx)
		countQuery += ` AND service = $` + itoa(argIdx)
		args = append(args, service)
		argIdx++
	}
	if startDate != "" {
		query += ` AND ts >= $` + itoa(argIdx)
		countQuery += ` AND ts >= $` + itoa(argIdx)
		args = append(args, startDate)
		argIdx++
	}
	if endDate != "" {
		query += ` AND ts <= $` + itoa(argIdx)
		countQuery += ` AND ts <= $` + itoa(argIdx)
		args = append(args, endDate)
		argIdx++
	}

	var total int
	err := r.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query += ` ORDER BY ts DESC LIMIT $` + itoa(argIdx) + ` OFFSET $` + itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []*teslamodel.APICallLog
	for rows.Next() {
		l := &teslamodel.APICallLog{}
		if err := rows.Scan(&l.ID, &l.Ts, &l.VehicleID, &l.Service, &l.HTTPMethod, &l.Endpoint, &l.StatusCode, &l.DurationMs, &l.ErrorMessage, &l.RateLimited, &l.RequestBody, &l.ResponseBody); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

func (r *APICallLogRepo) GetStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	var total, errorCount, last24h int
	var avgDuration float64
	err := r.db.Pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL),
			COALESCE(AVG(duration_ms), 0),
			COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '24 hours')
		FROM api_call_logs
	`).Scan(&total, &errorCount, &avgDuration, &last24h)
	if err != nil {
		return nil, err
	}
	stats["total_calls"] = total
	stats["error_count"] = errorCount
	if total > 0 {
		stats["error_rate"] = float64(errorCount) / float64(total) * 100
	} else {
		stats["error_rate"] = 0.0
	}
	stats["avg_duration_ms"] = avgDuration
	stats["last_24h"] = last24h

	// Grouped result needs its own query.
	rows, err := r.db.Pool.Query(ctx, `SELECT http_method, COUNT(*) as count FROM api_call_logs GROUP BY http_method ORDER BY count DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	methodCounts := make(map[string]int)
	for rows.Next() {
		var method string
		var count int
		if err := rows.Scan(&method, &count); err != nil {
			return nil, err
		}
		methodCounts[method] = count
	}
	stats["by_method"] = methodCounts

	svcRows, err := r.db.Pool.Query(ctx, `SELECT service, COUNT(*) as count FROM api_call_logs GROUP BY service ORDER BY count DESC`)
	if err != nil {
		return nil, err
	}
	defer svcRows.Close()
	serviceCounts := make(map[string]int)
	for svcRows.Next() {
		var svc string
		var count int
		if err := svcRows.Scan(&svc, &count); err != nil {
			return nil, err
		}
		serviceCounts[svc] = count
	}
	if err := svcRows.Err(); err != nil {
		return nil, err
	}
	stats["by_service"] = serviceCounts

	return stats, nil
}

func itoa(i int) string {
	return strconv.Itoa(i)
}
