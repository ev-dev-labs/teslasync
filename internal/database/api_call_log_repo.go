package database

import (
	"context"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// APICallLogRepo provides API call log data access operations.
type APICallLogRepo struct {
	db *DB
}

func NewAPICallLogRepo(db *DB) *APICallLogRepo {
	return &APICallLogRepo{db: db}
}

func (r *APICallLogRepo) Create(ctx context.Context, l *models.APICallLog) error {
	if l.Source == "" {
		l.Source = "tesla_api"
	}
	query := `INSERT INTO api_call_logs (method, url, status_code, request_body, response_body, duration_ms, error, source, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query, l.Method, l.URL, l.StatusCode, l.RequestBody, l.ResponseBody, l.DurationMs, l.Error, l.Source, now).Scan(&l.ID)
}

func (r *APICallLogRepo) GetAll(ctx context.Context, limit, offset int, method, statusFilter, endpoint, startDate, endDate string) ([]*models.APICallLog, int, error) {
	// Build dynamic query with filters
	query := `SELECT id, method, url, status_code, request_body, response_body, duration_ms, error, source, created_at FROM api_call_logs WHERE 1=1`
	countQuery := `SELECT COUNT(*) FROM api_call_logs WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if method != "" {
		query += ` AND method = $` + itoa(argIdx)
		countQuery += ` AND method = $` + itoa(argIdx)
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
		query += ` AND url ILIKE $` + itoa(argIdx)
		countQuery += ` AND url ILIKE $` + itoa(argIdx)
		args = append(args, "%"+endpoint+"%")
		argIdx++
	}
	if startDate != "" {
		query += ` AND created_at >= $` + itoa(argIdx)
		countQuery += ` AND created_at >= $` + itoa(argIdx)
		args = append(args, startDate)
		argIdx++
	}
	if endDate != "" {
		query += ` AND created_at <= $` + itoa(argIdx)
		countQuery += ` AND created_at <= $` + itoa(argIdx)
		args = append(args, endDate)
		argIdx++
	}

	// Get total count
	var total int
	err := r.db.Pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Add ordering and pagination
	query += ` ORDER BY created_at DESC LIMIT $` + itoa(argIdx) + ` OFFSET $` + itoa(argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []*models.APICallLog
	for rows.Next() {
		l := &models.APICallLog{}
		if err := rows.Scan(&l.ID, &l.Method, &l.URL, &l.StatusCode, &l.RequestBody, &l.ResponseBody, &l.DurationMs, &l.Error, &l.Source, &l.CreatedAt); err != nil {
			return nil, 0, err
		}
		logs = append(logs, l)
	}
	return logs, total, rows.Err()
}

func (r *APICallLogRepo) GetStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Total calls
	var total int
	err := r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_call_logs`).Scan(&total)
	if err != nil {
		return nil, err
	}
	stats["total_calls"] = total

	// Calls by method
	rows, err := r.db.Pool.Query(ctx, `SELECT method, COUNT(*) as count FROM api_call_logs GROUP BY method ORDER BY count DESC`)
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

	// Error rate
	var errorCount int
	err = r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_call_logs WHERE status_code >= 400 OR error IS NOT NULL`).Scan(&errorCount)
	if err != nil {
		return nil, err
	}
	if total > 0 {
		stats["error_rate"] = float64(errorCount) / float64(total) * 100
	} else {
		stats["error_rate"] = 0.0
	}
	stats["error_count"] = errorCount

	// Avg duration
	var avgDuration float64
	err = r.db.Pool.QueryRow(ctx, `SELECT COALESCE(AVG(duration_ms), 0) FROM api_call_logs`).Scan(&avgDuration)
	if err != nil {
		return nil, err
	}
	stats["avg_duration_ms"] = avgDuration

	// Calls last 24h
	var last24h int
	err = r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_call_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`).Scan(&last24h)
	if err != nil {
		return nil, err
	}
	stats["last_24h"] = last24h

	return stats, nil
}

func itoa(i int) string {
	return strconv.Itoa(i)
}
