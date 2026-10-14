package regen

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestRegenSQLInstantScope(t *testing.T) {
	for name, query := range map[string]string{
		"drives": driveRegenSQL, "monthly": monthlyRegenSQL, "energy": lifetimeEnergySQL,
	} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(query, "::timestamptz IS NULL OR started_at BETWEEN") {
				t.Fatal("query must filter start instants with the parser's inclusive bounds")
			}
			for _, forbidden := range []string{"::date", "LIMIT ", "cagg_fleet_stats"} {
				if strings.Contains(query, forbidden) {
					t.Fatalf("query must not round or cap the population: %s", forbidden)
				}
			}
		})
	}
	if !strings.Contains(lifetimeEnergySQL, "ended_at IS NOT NULL") {
		t.Fatal("energy must preserve the completed-drive rollup population")
	}
	if !strings.Contains(monthlyRegenSQL, "started_at AT TIME ZONE 'UTC'") {
		t.Fatal("monthly buckets must not depend on the database session timezone")
	}
}

func TestStatsInstantRangeAndLegacyDates(t *testing.T) {
	for _, tc := range []struct {
		name, start, end string
		bounded          bool
	}{
		{"west day boundary", "2026-03-08T00:00:00-08:00", "2026-03-09T00:00:00-07:00", true},
		{"east month boundary", "2026-05-01T00:00:00+05:30", "2026-05-02T00:00:00+05:30", true},
		{"fractional instants", "2026-05-01T12:34:56.123456Z", "2026-05-01T13:34:56.654321Z", true},
		{"missing dates", "", "", false},
		// The legacy handler intentionally treats incomplete/invalid filters
		// as absent. Changing request validation is outside this repo item.
		{"missing end", "2026-05-01", "", false},
		{"invalid date", "01/05/2026", "2026-05-02", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRegenRepo{}
			values := url.Values{"vehicle_id": {"42"}, "start": {tc.start}, "end": {tc.end},
				"locale": {"de-DE"}, "timezone": {"Asia/Kolkata"}}
			req := httptest.NewRequest(http.MethodGet, "/analytics/regen?"+values.Encode(), nil)
			req.Header.Set("Accept-Language", "de-DE")
			rec := httptest.NewRecorder()
			newRegenHandlerForTest(repo).Stats(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
			}
			for _, calls := range [][]regenCall{repo.driveCalls, repo.monthlyCalls, repo.energyCalls} {
				if len(calls) != 1 || calls[0].hasRange != tc.bounded {
					t.Fatalf("unexpected scope: %+v", calls)
				}
				if tc.bounded {
					start, err := time.Parse(time.RFC3339Nano, tc.start)
					if err != nil {
						t.Fatal(err)
					}
					end, err := time.Parse(time.RFC3339Nano, tc.end)
					if err != nil {
						t.Fatal(err)
					}
					if !calls[0].start.Equal(start) || !calls[0].end.Equal(end.Add(-time.Microsecond)) {
						t.Fatalf("instant bounds changed: %+v", calls[0])
					}
				}
			}
		})
	}
}

func TestLifetimeEnergySQLPostgresBoundaries(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DSN")
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DSN not set; PostgreSQL boundary verification not run")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE drives (
			vehicle_id bigint, started_at timestamptz, ended_at timestamptz,
			regen_energy_wh float8, energy_used_wh float8
		) ON COMMIT DROP;
		INSERT INTO drives VALUES
			(42, '2026-04-30T18:29:59.999999Z', now(), 1, 10),
			(42, '2026-04-30T18:30:00Z', now(), 2, 20),
			(42, '2026-05-01T18:29:59.999999Z', now(), 3, 30),
			(42, '2026-05-01T18:30:00Z', now(), 4, 40),
			(42, '2026-05-01T12:00:00Z', NULL, 100, 1000),
			(7, '2026-05-01T12:00:00Z', now(), 100, 1000);
	`)
	if err != nil {
		t.Fatal(err)
	}
	start, _ := time.Parse(time.RFC3339, "2026-05-01T00:00:00+05:30")
	end := start.Add(24*time.Hour - time.Microsecond)
	for _, zone := range []string{"UTC", "America/Los_Angeles", "Asia/Kolkata"} {
		t.Run(zone, func(t *testing.T) {
			if _, err := tx.Exec(ctx, "SELECT set_config('TimeZone', $1, true)", zone); err != nil {
				t.Fatal(err)
			}
			for _, tc := range []struct {
				name       string
				start, end interface{}
				want       float64
			}{
				{"bounded", start, end, 5},
				{"full history", nil, nil, 10},
			} {
				var regenWh, driveWh float64
				if err := tx.QueryRow(ctx, lifetimeEnergySQL, int64(42), tc.start, tc.end).
					Scan(&regenWh, &driveWh); err != nil {
					t.Fatal(err)
				}
				if regenWh != tc.want || driveWh != tc.want*10 {
					t.Fatalf("%s: energy = %v/%v, want %v/%v", tc.name, regenWh, driveWh, tc.want, tc.want*10)
				}
			}
		})
	}
}
