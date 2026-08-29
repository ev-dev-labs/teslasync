package teslabudget

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const budgetIntegrationAdvisoryLock int64 = 0x5445534c41425544

type budgetUsageRow struct {
	BudgetDate             time.Time
	TotalRequests          int64
	EstimatedCostMicroUSD  int64
	BackgroundRequests     int64
	BackgroundCostMicroUSD int64
	VehicleDataRequests    int64
	WakeUpRequests         int64
	CommandRequests        int64
	VehicleSpecsRequests   int64
	OtherRequests          int64
	UpdatedAt              time.Time
}

func TestRepoRejectsNilDatabase(t *testing.T) {
	repo := New(nil, tesla.BudgetPolicy{DailyLimitMicroUSD: 300_000})
	if _, err := repo.Snapshot(context.Background()); err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Fatalf("Snapshot error = %v, want initialization error", err)
	}
	if _, err := repo.Reserve(context.Background(), tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryOther,
		EstimatedCostMicroUSD: 1_000,
	}); err == nil || !strings.Contains(err.Error(), "not initialized") {
		t.Fatalf("Reserve error = %v, want initialization error", err)
	}
}

func TestRepoRejectedReservationKeepsAtomicPeriodAcrossUTCRollover(t *testing.T) {
	rejectedPeriod := time.Date(2026, time.August, 29, 0, 0, 0, 0, time.UTC)
	freshPeriod := rejectedPeriod.Add(24 * time.Hour)
	db := &scriptedBudgetDB{
		t: t,
		queries: []scriptedBudgetQuery{
			{
				assert: func(sql string, args []any) {
					if !strings.Contains(sql, "WITH budget_period AS") {
						t.Errorf("reservation query does not capture its UTC period")
					}
					if len(args) != 6 {
						t.Errorf("reservation arguments = %d, want 6", len(args))
					}
				},
				values: []any{
					rejectedPeriod,
					int64(0), int64(0), int64(0), int64(0),
					int64(0), int64(0), int64(0), int64(0), int64(0),
					false,
				},
			},
			{
				assert: func(sql string, args []any) {
					if !strings.Contains(sql, "SELECT $1::date AS budget_date") {
						t.Errorf("rejected snapshot query is not pinned to the reservation period")
					}
					if len(args) != 1 {
						t.Fatalf("rejected snapshot arguments = %d, want 1", len(args))
					}
					got, ok := args[0].(time.Time)
					if !ok || !got.Equal(rejectedPeriod) {
						t.Errorf("rejected snapshot period = %v, want %v (fresh wall-clock period would be %v)", args[0], rejectedPeriod, freshPeriod)
					}
				},
				values: []any{
					rejectedPeriod,
					int64(10), int64(10_000), int64(10), int64(10_000),
					int64(10), int64(0), int64(0), int64(0), int64(0),
				},
			},
		},
	}
	repo := New(db, tesla.BudgetPolicy{
		DailyLimitMicroUSD:     10_000,
		CommandReserveMicroUSD: 2_000,
	})

	snapshot, err := repo.Reserve(context.Background(), tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryVehicleData,
		EstimatedCostMicroUSD: 2_000,
	})
	if !errors.Is(err, tesla.ErrBudgetExceeded) {
		t.Fatalf("reservation error = %v, want ErrBudgetExceeded", err)
	}
	if !snapshot.PeriodStart.Equal(rejectedPeriod) {
		t.Fatalf("rejection period = %v, want %v", snapshot.PeriodStart, rejectedPeriod)
	}
	if !snapshot.ResetAt.Equal(freshPeriod) {
		t.Fatalf("rejection reset = %v, want %v", snapshot.ResetAt, freshPeriod)
	}
	if snapshot.TotalRequests != 10 || snapshot.EstimatedCostMicroUSD != 10_000 {
		t.Fatalf("rejection snapshot = %+v", snapshot)
	}
	if db.calls != 2 {
		t.Fatalf("database calls = %d, want reservation plus period-pinned snapshot", db.calls)
	}
}

func TestRepoAcceptedReservationReturnsAtomicPeriodWithoutSnapshotRead(t *testing.T) {
	period := time.Date(2026, time.August, 30, 0, 0, 0, 0, time.UTC)
	db := &scriptedBudgetDB{
		t: t,
		queries: []scriptedBudgetQuery{{
			values: []any{
				period,
				int64(1), int64(2_000), int64(1), int64(2_000),
				int64(1), int64(0), int64(0), int64(0), int64(0),
				true,
			},
		}},
	}
	repo := New(db, tesla.BudgetPolicy{DailyLimitMicroUSD: 10_000})

	snapshot, err := repo.Reserve(context.Background(), tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryVehicleData,
		EstimatedCostMicroUSD: 2_000,
	})
	if err != nil {
		t.Fatalf("reservation: %v", err)
	}
	if !snapshot.PeriodStart.Equal(period) || snapshot.TotalRequests != 1 {
		t.Fatalf("accepted snapshot = %+v", snapshot)
	}
	if db.calls != 1 {
		t.Fatalf("database calls = %d, want atomic reservation only", db.calls)
	}
}

func TestRepoReserveAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, cleanup := openIsolatedBudgetDatabase(t, ctx)
	defer func() { _ = conn.Close(ctx) }()
	defer cleanup()

	repo := New(conn, tesla.BudgetPolicy{
		DailyLimitMicroUSD:     300_000,
		CommandReserveMicroUSD: 50_000,
	})
	background := tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryVehicleData,
		EstimatedCostMicroUSD: 200_000,
	}
	first, err := repo.Reserve(ctx, background)
	if err != nil {
		t.Fatalf("first reservation: %v", err)
	}
	if first.BackgroundCostMicroUSD != 200_000 {
		t.Fatalf("background cost = %d, want 200000", first.BackgroundCostMicroUSD)
	}

	background.EstimatedCostMicroUSD = 60_000
	if _, err := repo.Reserve(ctx, background); !errors.Is(err, tesla.ErrBudgetExceeded) {
		t.Fatalf("background reservation error = %v, want ErrBudgetExceeded", err)
	}

	command := tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryCommand,
		EstimatedCostMicroUSD: 100_000,
		UsesCommandReserve:    true,
	}
	afterCommand, err := repo.Reserve(ctx, command)
	if err != nil {
		t.Fatalf("command reservation: %v", err)
	}
	if afterCommand.EstimatedCostMicroUSD != 300_000 || afterCommand.CommandRequests != 1 {
		t.Fatalf("snapshot after command = %+v", afterCommand)
	}

	command.EstimatedCostMicroUSD = 1
	if _, err := repo.Reserve(ctx, command); !errors.Is(err, tesla.ErrBudgetExceeded) {
		t.Fatalf("over-budget command error = %v, want ErrBudgetExceeded", err)
	}

	snapshot, err := repo.Snapshot(ctx)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snapshot.PeriodStart.Location() != time.UTC {
		t.Fatalf("period start location = %v, want UTC", snapshot.PeriodStart.Location())
	}
	if snapshot.TotalRequests != 2 || snapshot.BackgroundRequests != 1 {
		t.Fatalf("final snapshot = %+v", snapshot)
	}
}

func TestRepoCommandReservationSurvivesLoweredBackgroundLimit(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, cleanup := openIsolatedBudgetDatabase(t, ctx)
	defer func() { _ = conn.Close(ctx) }()
	defer cleanup()

	originalPolicy := tesla.BudgetPolicy{DailyLimitMicroUSD: 500_000}
	if _, err := New(conn, originalPolicy).Reserve(ctx, tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryVehicleData,
		EstimatedCostMicroUSD: 250_000,
	}); err != nil {
		t.Fatalf("record background spend under original policy: %v", err)
	}

	loweredPolicy := tesla.BudgetPolicy{
		DailyLimitMicroUSD:     300_000,
		CommandReserveMicroUSD: 100_000,
	}
	repo := New(conn, loweredPolicy)
	command := tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryCommand,
		EstimatedCostMicroUSD: 20_000,
		UsesCommandReserve:    true,
	}
	snapshot, err := repo.Reserve(ctx, command)
	if err != nil {
		t.Fatalf("command reservation after lowering background limit: %v", err)
	}
	if snapshot.BackgroundCostMicroUSD != 250_000 || snapshot.EstimatedCostMicroUSD != 270_000 {
		t.Fatalf("snapshot after command = %+v", snapshot)
	}

	if _, err := repo.Reserve(ctx, tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryOther,
		EstimatedCostMicroUSD: 1,
	}); !errors.Is(err, tesla.ErrBudgetExceeded) {
		t.Fatalf("new background reservation error = %v, want ErrBudgetExceeded", err)
	}

	command.EstimatedCostMicroUSD = 30_000
	if _, err := repo.Reserve(ctx, command); err != nil {
		t.Fatalf("command reaching absolute daily cap: %v", err)
	}
	command.EstimatedCostMicroUSD = 1
	if _, err := repo.Reserve(ctx, command); !errors.Is(err, tesla.ErrBudgetExceeded) {
		t.Fatalf("command beyond absolute daily cap error = %v, want ErrBudgetExceeded", err)
	}
}

func TestRepoConcurrentReservationsAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	control, cleanup := openIsolatedBudgetDatabase(t, ctx)
	defer func() { _ = control.Close(ctx) }()
	defer cleanup()

	dsn := budgetIntegrationDSN(t)
	firstConn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect first reservation connection: %v", err)
	}
	defer func() { _ = firstConn.Close(ctx) }()
	secondConn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect second reservation connection: %v", err)
	}
	defer func() { _ = secondConn.Close(ctx) }()

	var firstPID, secondPID int
	if err := firstConn.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&firstPID); err != nil {
		t.Fatalf("read first backend PID: %v", err)
	}
	if err := secondConn.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&secondPID); err != nil {
		t.Fatalf("read second backend PID: %v", err)
	}
	if firstPID == secondPID {
		t.Fatalf("reservation connections share backend PID %d", firstPID)
	}

	const (
		limitN            = int64(12)
		attemptsPerWorker = 12
	)
	policy := tesla.BudgetPolicy{
		DailyLimitMicroUSD:     limitN * 1_000,
		CommandReserveMicroUSD: limitN * 1_000,
	}
	charge := tesla.BudgetCharge{
		Category:              tesla.BudgetCategoryCommand,
		EstimatedCostMicroUSD: 1_000,
		UsesCommandReserve:    true,
	}

	start := make(chan struct{})
	errs := make(chan error, attemptsPerWorker*2)
	var successes atomic.Int64
	var wg sync.WaitGroup
	for _, repo := range []*Repo{New(firstConn, policy), New(secondConn, policy)} {
		wg.Add(1)
		go func(repo *Repo) {
			defer wg.Done()
			<-start
			for range attemptsPerWorker {
				_, reserveErr := repo.Reserve(ctx, charge)
				switch {
				case reserveErr == nil:
					successes.Add(1)
				case errors.Is(reserveErr, tesla.ErrBudgetExceeded):
				default:
					errs <- reserveErr
				}
			}
		}(repo)
	}
	close(start)
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("unexpected concurrent reservation error: %v", err)
	}
	if got := successes.Load(); got != limitN {
		t.Fatalf("successful reservations = %d, want exactly %d", got, limitN)
	}

	snapshot, err := New(control, policy).Snapshot(ctx)
	if err != nil {
		t.Fatalf("read concurrent reservation snapshot: %v", err)
	}
	if snapshot.TotalRequests != limitN || snapshot.EstimatedCostMicroUSD != limitN*1_000 {
		t.Fatalf("concurrent reservation snapshot = %+v", snapshot)
	}
}

func budgetIntegrationDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("TESLASYNC_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DSN or DATABASE_URL is required for PostgreSQL integration coverage")
	}
	return dsn
}

func openIsolatedBudgetDatabase(t *testing.T, ctx context.Context) (*pgx.Conn, func()) {
	t.Helper()
	conn, err := pgx.Connect(ctx, budgetIntegrationDSN(t))
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, budgetIntegrationAdvisoryLock); err != nil {
		_ = conn.Close(ctx)
		t.Fatalf("acquire budget integration advisory lock: %v", err)
	}
	verifyMigratedBudgetTable(t, ctx, conn)

	var budgetDate time.Time
	if err := conn.QueryRow(ctx, `SELECT (NOW() AT TIME ZONE 'UTC')::date`).Scan(&budgetDate); err != nil {
		_ = conn.Close(ctx)
		t.Fatalf("read current UTC budget date: %v", err)
	}

	previous, hadPrevious := readBudgetUsageRow(t, ctx, conn, budgetDate)
	if _, err := conn.Exec(ctx,
		`DELETE FROM tesla_api_budget_usage WHERE budget_date = $1`,
		budgetDate,
	); err != nil {
		_ = conn.Close(ctx)
		t.Fatalf("clear isolated budget row: %v", err)
	}
	assertMigratedBudgetConstraints(t, ctx, conn, budgetDate)

	cleanup := func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := conn.Exec(cleanupCtx,
			`DELETE FROM tesla_api_budget_usage WHERE budget_date = $1`,
			budgetDate,
		); err != nil {
			t.Errorf("remove isolated budget row: %v", err)
		}
		if hadPrevious {
			if _, err := conn.Exec(cleanupCtx, `
				INSERT INTO tesla_api_budget_usage (
					budget_date, total_requests, estimated_cost_microusd,
					background_requests, background_cost_microusd,
					vehicle_data_requests, wake_up_requests, command_requests,
					vehicle_specs_requests, other_requests, updated_at
				) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				previous.BudgetDate,
				previous.TotalRequests,
				previous.EstimatedCostMicroUSD,
				previous.BackgroundRequests,
				previous.BackgroundCostMicroUSD,
				previous.VehicleDataRequests,
				previous.WakeUpRequests,
				previous.CommandRequests,
				previous.VehicleSpecsRequests,
				previous.OtherRequests,
				previous.UpdatedAt,
			); err != nil {
				t.Errorf("restore pre-test budget row: %v", err)
			}
		}
		if _, err := conn.Exec(cleanupCtx, `SELECT pg_advisory_unlock($1)`, budgetIntegrationAdvisoryLock); err != nil {
			t.Errorf("release budget integration advisory lock: %v", err)
		}
	}
	return conn, cleanup
}

func assertMigratedBudgetConstraints(t *testing.T, ctx context.Context, conn *pgx.Conn, budgetDate time.Time) {
	t.Helper()
	invalidRows := []struct {
		name               string
		totalRequests      int64
		backgroundRequests int64
	}{
		{name: "nonnegative counts", totalRequests: -1},
		{name: "background subset", totalRequests: 0, backgroundRequests: 1},
	}
	for _, invalid := range invalidRows {
		tx, err := conn.Begin(ctx)
		if err != nil {
			t.Fatalf("begin %s constraint transaction: %v", invalid.name, err)
		}
		_, insertErr := tx.Exec(ctx, `
			INSERT INTO tesla_api_budget_usage (
				budget_date, total_requests, background_requests
			) VALUES ($1, $2, $3)`,
			budgetDate,
			invalid.totalRequests,
			invalid.backgroundRequests,
		)
		if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
			t.Fatalf("rollback %s constraint transaction: %v", invalid.name, rollbackErr)
		}
		if insertErr == nil {
			t.Fatalf("migration 000233 did not enforce %s constraint", invalid.name)
		}
	}
}

func verifyMigratedBudgetTable(t *testing.T, ctx context.Context, conn *pgx.Conn) {
	t.Helper()
	var persistence string
	var checkConstraints int
	err := conn.QueryRow(ctx, `
		SELECT c.relpersistence::text,
		       COUNT(con.oid) FILTER (WHERE con.contype = 'c')
		FROM pg_catalog.pg_class AS c
		JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
		LEFT JOIN pg_catalog.pg_constraint AS con ON con.conrelid = c.oid
		WHERE n.nspname = 'public' AND c.relname = 'tesla_api_budget_usage'
		GROUP BY c.relpersistence`).Scan(&persistence, &checkConstraints)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("public.tesla_api_budget_usage is absent; apply migration 000233 before running integration tests")
	}
	if err != nil {
		t.Fatalf("inspect migrated budget table: %v", err)
	}
	if persistence != "p" {
		t.Fatalf("public.tesla_api_budget_usage persistence = %q, want permanent migrated table", persistence)
	}
	if checkConstraints < 11 {
		t.Fatalf("public.tesla_api_budget_usage has %d CHECK constraints, want migration 000233 constraints", checkConstraints)
	}
}

func readBudgetUsageRow(t *testing.T, ctx context.Context, conn *pgx.Conn, budgetDate time.Time) (budgetUsageRow, bool) {
	t.Helper()
	var row budgetUsageRow
	err := conn.QueryRow(ctx, `
		SELECT budget_date, total_requests, estimated_cost_microusd,
		       background_requests, background_cost_microusd,
		       vehicle_data_requests, wake_up_requests, command_requests,
		       vehicle_specs_requests, other_requests, updated_at
		FROM tesla_api_budget_usage
		WHERE budget_date = $1`,
		budgetDate,
	).Scan(
		&row.BudgetDate,
		&row.TotalRequests,
		&row.EstimatedCostMicroUSD,
		&row.BackgroundRequests,
		&row.BackgroundCostMicroUSD,
		&row.VehicleDataRequests,
		&row.WakeUpRequests,
		&row.CommandRequests,
		&row.VehicleSpecsRequests,
		&row.OtherRequests,
		&row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return budgetUsageRow{}, false
	}
	if err != nil {
		t.Fatalf("read pre-test budget row: %v", err)
	}
	return row, true
}

type scriptedBudgetQuery struct {
	assert func(sql string, args []any)
	values []any
	err    error
}

type scriptedBudgetDB struct {
	t       *testing.T
	queries []scriptedBudgetQuery
	calls   int
}

func (db *scriptedBudgetDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	db.t.Helper()
	if db.calls >= len(db.queries) {
		db.t.Errorf("unexpected QueryRow call %d: %s", db.calls+1, sql)
		return scriptedBudgetRow{err: errors.New("unexpected QueryRow call")}
	}
	query := db.queries[db.calls]
	db.calls++
	if query.assert != nil {
		query.assert(sql, args)
	}
	return scriptedBudgetRow{values: query.values, err: query.err}
}

func (db *scriptedBudgetDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec call")
}

func (db *scriptedBudgetDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query call")
}

type scriptedBudgetRow struct {
	values []any
	err    error
}

func (row scriptedBudgetRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("scripted budget row destination count mismatch")
	}
	for i, value := range row.values {
		target := reflect.ValueOf(dest[i])
		if target.Kind() != reflect.Pointer || target.IsNil() {
			return errors.New("scripted budget row destination is not a pointer")
		}
		target.Elem().Set(reflect.ValueOf(value))
	}
	return nil
}
