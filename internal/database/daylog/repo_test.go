package daylog

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type dayLogBoundsPool struct {
	sql  string
	args []any
	err  error
}

func (p *dayLogBoundsPool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.sql, p.args = sql, args
	return nil, p.err
}

func (p *dayLogBoundsPool) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected QueryRow")
}

func TestDayLogRepo_DSTBoundsPassedUnchanged(t *testing.T) {
	t.Parallel()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		date  string
		hours int
	}{
		{"2026-03-08", 23},
		{"2026-11-01", 25},
	} {
		t.Run(tt.date, func(t *testing.T) {
			t.Parallel()
			day, err := time.ParseInLocation("2006-01-02", tt.date, loc)
			if err != nil {
				t.Fatal(err)
			}
			start, end := day.UTC(), day.AddDate(0, 0, 1).UTC()
			if end.Sub(start) != time.Duration(tt.hours)*time.Hour {
				t.Fatalf("day span = %v, want %dh", end.Sub(start), tt.hours)
			}
			queryErr := errors.New("bounds probe")
			pool := &dayLogBoundsPool{err: queryErr}
			repo := &DayLogRepo{pool: pool}
			for _, query := range []struct {
				name string
				sql  string
				args []any
				run  func() error
			}{
				{"drives", dayLogDrivesSQL, []any{int64(1), end, start}, func() error {
					_, err := repo.DrivesOverlapping(context.Background(), 1, start, end)
					return err
				}},
				{"charges", dayLogChargesSQL, []any{int64(1), end, start}, func() error {
					_, err := repo.ChargesOverlapping(context.Background(), 1, start, end)
					return err
				}},
				{"fsm", dayLogFSMSQL, []any{int64(1), start, end}, func() error {
					_, err := repo.FSMTransitions(context.Background(), 1, start, end)
					return err
				}},
				{"security", dayLogSecuritySQL, []any{int64(1), start, end}, func() error {
					_, err := repo.SecurityEvents(context.Background(), 1, start, end)
					return err
				}},
				{"signals", dayLogSignalSQL, []any{int64(1), []string{"RemoteStartActive"}, start, end, 10}, func() error {
					_, err := repo.SignalRows(context.Background(), 1, []string{"RemoteStartActive"}, start, end, 10)
					return err
				}},
				{"gear", dayLogGearSQL, []any{int64(1), start, end, 10}, func() error {
					_, err := repo.GearTicks(context.Background(), 1, start, end, 10)
					return err
				}},
				{"software", dayLogSoftwareSQL, []any{int64(1), start, end}, func() error {
					_, err := repo.SoftwareUpdates(context.Background(), 1, start, end)
					return err
				}},
			} {
				t.Run(query.name, func(t *testing.T) {
					if err := query.run(); !errors.Is(err, queryErr) {
						t.Fatalf("query error = %v, want wrapped probe error", err)
					}
					if pool.sql != query.sql || !reflect.DeepEqual(pool.args, query.args) {
						t.Errorf("query/bounds = %s / %v, want %s / %v", pool.sql, pool.args, query.sql, query.args)
					}
				})
			}
		})
	}
}

// This package has no pgxmock or testcontainers harness, so these tests
// assert SQL shape (tables, columns, time bounds, caps, parameterisation)
// plus constructor guards. Query execution is covered by handler tests
// with a fake repo and by the pure event-assembly tests in
// internal/api/daylog.

func TestDayLogSQL_TimeBoundsAndCaps(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		sql      string
		wantCols []string
	}{
		{"drives", dayLogDrivesSQL, []string{"FROM drives", "started_at < $2", "(ended_at IS NULL OR ended_at > $3)", "vehicle_id = $1", "ORDER BY started_at ASC"}},
		{"charges", dayLogChargesSQL, []string{"FROM charging_sessions", "started_at < $2", "(ended_at IS NULL OR ended_at > $3)", "vehicle_id = $1", "ORDER BY started_at ASC"}},
		{"fsm", dayLogFSMSQL, []string{"FROM fsm_transitions", "fsm_name = 'vehicle'", "ts >= $2", "ts < $3", "ORDER BY ts ASC"}},
		{"security", dayLogSecuritySQL, []string{"FROM security_events", "ts >= $2", "ts < $3", "ORDER BY ts ASC"}},
		{"securityPrev", dayLogSecurityPrevSQL, []string{"FROM security_events", "DISTINCT ON (event_type)", "ts <", "event_type = ANY($3)", "ORDER BY event_type, ts DESC"}},
		{"signal", dayLogSignalSQL, []string{"FROM signal_log", "field = ANY($2)", "ts >= $3", "ts < $4", "LIMIT $5", "ORDER BY ts ASC"}},
		{"gear", dayLogGearSQL, []string{"FROM drive_telemetry", "gear IS NOT NULL", "ts >= $2", "ts < $3", "LIMIT $4", "ORDER BY ts ASC"}},
		{"software", dayLogSoftwareSQL, []string{"FROM software_updates", "created_at >= $2 AND created_at < $3", "installed_at >= $2 AND installed_at < $3", "ORDER BY created_at ASC"}},
		{"vehicleExists", dayLogVehicleExistsSQL, []string{"FROM vehicles", "id = $1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if strings.Contains(tt.sql, "SELECT *") {
				t.Errorf("query must not SELECT *")
			}
			if strings.Contains(tt.sql, "%s") || strings.Contains(tt.sql, "%d") {
				t.Errorf("query must be fully parameterized, no fmt interpolation")
			}
			lower := strings.ToLower(tt.sql)
			if strings.Contains(lower, "<=") || strings.Contains(lower, "between") {
				t.Errorf("query must not include the exclusive window end\n%s", tt.sql)
			}
			for _, want := range tt.wantCols {
				if !strings.Contains(lower, strings.ToLower(want)) {
					t.Errorf("query missing %q\n%s", want, tt.sql)
				}
			}
		})
	}
}

func TestNewDayLogRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Errorf("NewDayLogRepo(nil) must panic (wiring bug)")
		}
	}()
	_ = NewDayLogRepo(nil)
}
