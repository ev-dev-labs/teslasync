package system

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBuildAPICallLogStatsQuery(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	tests := []struct {
		name   string
		start  *time.Time
		end    *time.Time
		where  string
		params []any
	}{
		{"all time", nil, nil, "", nil},
		{"from only", &start, nil, "WHERE ts >= $1", []any{start}},
		{"until only", nil, &end, "WHERE ts < $1", []any{end}},
		{"bounded", &start, &end, "WHERE ts >= $1 AND ts < $2", []any{start, end}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			query, args := buildAPICallLogStatsQuery(tt.start, tt.end)
			if tt.where != "" && !strings.Contains(query, "FROM api_call_logs "+tt.where) {
				t.Errorf("query %q missing predicate %q", query, tt.where)
			}
			if tt.where == "" && strings.Contains(query, "FROM api_call_logs WHERE ts") {
				t.Errorf("unbounded query has time predicate: %q", query)
			}
			if strings.Contains(query, " IS NULL OR ") {
				t.Errorf("optional-parameter OR prevents chunk pruning: %q", query)
			}
			if !strings.Contains(query, "GROUP BY GROUPING SETS ((), (service), (http_method))") {
				t.Errorf("expected one scan for totals and both breakdowns: %q", query)
			}
			if len(args) != len(tt.params) {
				t.Fatalf("got %d parameters, want %d", len(args), len(tt.params))
			}
			for i, want := range tt.params {
				if args[i] != want {
					t.Errorf("parameter %d = %v, want %v", i+1, args[i], want)
				}
			}
		})
	}
}

func TestAPICallLogStatsAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_PERF_TEST_DSN")
	if dsn == "" {
		t.Skip("set TESLASYNC_PERF_TEST_DSN to run against an isolated PostgreSQL database")
	}
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	// The temporary table shadows any public table without modifying shared data.
	_, err = pool.Exec(ctx, `CREATE TEMP TABLE api_call_logs (
			ts timestamptz NOT NULL, service text NOT NULL, http_method text NOT NULL,
			status_code integer NOT NULL, error_message text, duration_ms integer NOT NULL
		)`)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for _, row := range []struct {
		ts      time.Time
		service string
		method  string
		status  int
		message *string
		ms      int
	}{
		{now.Add(-12 * time.Hour), "api", "GET", 200, nil, 100},
		{now.Add(-13 * time.Hour), "api", "POST", 503, nil, 300},
		{now.Add(-72 * time.Hour), "fleet", "GET", 200, nil, 200},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO api_call_logs VALUES ($1, $2, $3, $4, $5, $6)`,
			row.ts, row.service, row.method, row.status, row.message, row.ms); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewAPICallLogRepo(&database.DB{Pool: pool})
	start := now.Add(-48 * time.Hour)
	end := now.Add(time.Hour)
	early := now.Add(-96 * time.Hour)
	for _, tc := range []struct {
		name         string
		start, end   *time.Time
		total, errs  int
		avg          float64
		recent       int
		methods, svc map[string]int
	}{
		{"all", nil, nil, 3, 1, 200, 2, map[string]int{"GET": 2, "POST": 1}, map[string]int{"api": 2, "fleet": 1}},
		{"bounded", &start, &end, 2, 1, 200, 2, map[string]int{"GET": 1, "POST": 1}, map[string]int{"api": 2}},
		{"from only", &start, nil, 2, 1, 200, 2, map[string]int{"GET": 1, "POST": 1}, map[string]int{"api": 2}},
		{"until only", nil, &end, 3, 1, 200, 2, map[string]int{"GET": 2, "POST": 1}, map[string]int{"api": 2, "fleet": 1}},
		{"empty", nil, &early, 0, 0, 0, 0, map[string]int{}, map[string]int{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stats, err := repo.GetStats(ctx, tc.start, tc.end)
			if err != nil {
				t.Fatal(err)
			}
			errorRate := 0.0
			if tc.total > 0 {
				errorRate = float64(tc.errs) / float64(tc.total) * 100
			}
			for key, want := range map[string]interface{}{
				"total_calls": tc.total, "error_count": tc.errs, "avg_duration_ms": tc.avg,
				"last_24h": tc.recent, "error_rate": errorRate,
			} {
				if got := stats[key]; got != want {
					t.Errorf("%s = %v, want %v", key, got, want)
				}
			}
			for key, want := range map[string]map[string]int{"by_method": tc.methods, "by_service": tc.svc} {
				got := stats[key].(map[string]int)
				if len(got) != len(want) {
					t.Errorf("%s = %v, want %v", key, got, want)
				}
				for label, count := range want {
					if got[label] != count {
						t.Errorf("%s[%s] = %d, want %d", key, label, got[label], count)
					}
				}
			}
		})
	}
}
