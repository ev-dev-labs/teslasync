package system

import (
	"context"
	"fmt"
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
	query := `INSERT INTO api_call_logs (ts, vehicle_id, service, http_method, endpoint, status_code, duration_ms, error_message, rate_limited, request_body, response_body, request_headers, response_headers)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, now, l.VehicleID, l.Service, l.HTTPMethod, l.Endpoint, l.StatusCode, l.DurationMs, l.ErrorMessage, l.RateLimited, l.RequestBody, l.ResponseBody, l.RequestHeaders, l.ResponseHeaders).Scan(&l.ID)
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
			l.RequestHeaders,
			l.ResponseHeaders,
		}, nil
	})
	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"api_call_logs"},
		[]string{"ts", "vehicle_id", "service", "http_method", "endpoint", "status_code", "duration_ms", "error_message", "rate_limited", "request_body", "response_body", "request_headers", "response_headers"},
		rows,
	)
	return err
}

func (r *APICallLogRepo) GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, service, client, key, startDate, endDate, endExclusive string) ([]*teslamodel.APICallLog, int, error) {
	query := `SELECT id, ts, vehicle_id, service, http_method, endpoint, status_code, duration_ms, error_message, rate_limited, request_body, response_body, request_headers, response_headers FROM api_call_logs WHERE 1=1`
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
	if client != "" {
		query += ` AND request_headers ->> 'X-Teslasync-App' ILIKE '%' || $` + itoa(argIdx) + ` || '%'`
		countQuery += ` AND request_headers ->> 'X-Teslasync-App' ILIKE '%' || $` + itoa(argIdx) + ` || '%'`
		args = append(args, client)
		argIdx++
	}
	if key != "" {
		predicate := ` AND (strpos(lower(request_headers ->> 'App-Key-Name'), lower($` + itoa(argIdx) + `)) > 0 OR strpos(request_headers ->> 'App-Key-ID', $` + itoa(argIdx) + `) > 0)`
		query += predicate
		countQuery += predicate
		args = append(args, key)
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
	if endExclusive != "" {
		query += ` AND ts < $` + itoa(argIdx)
		countQuery += ` AND ts < $` + itoa(argIdx)
		args = append(args, endExclusive)
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
		if err := rows.Scan(&l.ID, &l.Ts, &l.VehicleID, &l.Service, &l.HTTPMethod, &l.Endpoint, &l.StatusCode, &l.DurationMs, &l.ErrorMessage, &l.RateLimited, &l.RequestBody, &l.ResponseBody, &l.RequestHeaders, &l.ResponseHeaders); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

func (r *APICallLogRepo) GetStats(ctx context.Context, start, endExclusive *time.Time) (map[string]interface{}, error) {
	query, args := buildAPICallLogStatsQuery(start, endExclusive)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query API call log stats: %w", err)
	}
	defer rows.Close()
	stats := map[string]interface{}{
		"total_calls":     0,
		"error_count":     0,
		"error_rate":      0.0,
		"avg_duration_ms": 0.0,
		"last_24h":        0,
	}
	methodCounts := make(map[string]int)
	serviceCounts := make(map[string]int)
	stats["by_method"] = methodCounts
	stats["by_service"] = serviceCounts

	hasTotal := false
	for rows.Next() {
		var service, method string
		var serviceGrouped, methodGrouped, count, errorCount, last24h int
		var avgDuration float64
		if err := rows.Scan(&service, &method, &serviceGrouped, &methodGrouped, &count, &errorCount, &avgDuration, &last24h); err != nil {
			return nil, fmt.Errorf("scan API call log stats: %w", err)
		}
		switch {
		case serviceGrouped == 1 && methodGrouped == 1:
			hasTotal = true
			stats["total_calls"] = count
			stats["error_count"] = errorCount
			stats["avg_duration_ms"] = avgDuration
			stats["last_24h"] = last24h
			if count > 0 {
				stats["error_rate"] = float64(errorCount) / float64(count) * 100
			}
		case serviceGrouped == 0 && methodGrouped == 1:
			serviceCounts[service] = count
		case serviceGrouped == 1 && methodGrouped == 0:
			methodCounts[method] = count
		default:
			return nil, fmt.Errorf("unexpected API call log stats grouping: service=%d method=%d", serviceGrouped, methodGrouped)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate API call log stats: %w", err)
	}
	if !hasTotal {
		return nil, fmt.Errorf("API call log stats query returned no total")
	}

	return stats, nil
}

func buildAPICallLogStatsQuery(start, endExclusive *time.Time) (string, []any) {
	// Grouping sets produce the total and both breakdowns in one hypertable scan.
	query := `SELECT COALESCE(service, ''), COALESCE(http_method, ''),
		GROUPING(service), GROUPING(http_method),
		COUNT(*),
		COUNT(*) FILTER (WHERE status_code >= 400 OR error_message IS NOT NULL),
		COALESCE(AVG(duration_ms), 0),
		COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '24 hours')
		FROM api_call_logs`
	var args []any
	if start != nil {
		args = append(args, *start)
		query += ` WHERE ts >= $1`
	}
	if endExclusive != nil {
		args = append(args, *endExclusive)
		if start == nil {
			query += ` WHERE ts < $1`
		} else {
			query += ` AND ts < $2`
		}
	}
	query += ` GROUP BY GROUPING SETS ((), (service), (http_method))`
	return query, args
}

func itoa(i int) string {
	return strconv.Itoa(i)
}
