package achievement

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Fake pgx plumbing.
//
// The codebase vendors no pgxmock/testcontainers harness (see
// internal/api/routeeff/handler_test.go, guard_repo_test.go, and
// trip/detail_repo_test.go for the same precedent). UnlockRepo talks to the
// unexported unlockQuerier seam, so these fakes supply a scripted row source
// without a live database.
// ---------------------------------------------------------------------------

// fakeRows is a scripted pgx.Rows for ListByVehicle. Each element of data is
// one row's (achievement_id, vehicle_id, unlocked_at) values, positionally
// matching the Scan destinations.
type fakeRows struct {
	data      [][]any
	idx       int
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	errVal    error // returned by Err() to simulate mid-stream iteration failure
	closed    bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.idx == r.scanErrAt {
		return r.scanErr
	}
	return assignScan(dest, r.data[r.idx-1])
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errVal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// assignScan copies scripted values into the caller's Scan destinations,
// mimicking pgx's per-type scanning. Only the column types projected by
// listByVehicleSQL are supported.
func assignScan(dest []any, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i, d := range dest {
		v := vals[i]
		switch p := d.(type) {
		case *string:
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *string", i, v)
			}
			*p = s
		case *int64:
			n, ok := v.(int64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int64", i, v)
			}
			*p = n
		case *time.Time:
			t, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *time.Time", i, v)
			}
			*p = t
		default:
			return fmt.Errorf("col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// fakeRow is a scripted pgx.Row for RecordUnlock. It populates the
// (inserted bool, unlocked_at time.Time) destinations, or returns err to
// exercise the scan/query failure branch.
type fakeRow struct {
	inserted   bool
	unlockedAt time.Time
	err        error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != 2 {
		return fmt.Errorf("fakeRow.Scan: expected 2 destinations, got %d", len(dest))
	}
	bp, ok := dest[0].(*bool)
	if !ok {
		return fmt.Errorf("fakeRow.Scan: dest[0] is %T, want *bool", dest[0])
	}
	tp, ok := dest[1].(*time.Time)
	if !ok {
		return fmt.Errorf("fakeRow.Scan: dest[1] is %T, want *time.Time", dest[1])
	}
	*bp = r.inserted
	*tp = r.unlockedAt
	return nil
}

var _ pgx.Row = fakeRow{}

// fakePool records the SQL + args it was asked to run and returns the scripted
// rows/row (or a query error). It satisfies the repo's unlockQuerier seam.
type fakePool struct {
	rows     pgx.Rows
	queryErr error
	row      pgx.Row

	gotQuerySQL     string
	gotQueryArgs    []any
	gotQueryRowSQL  string
	gotQueryRowArgs []any
	queryCalls      int
	queryRowCalls   int
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.queryCalls++
	p.gotQuerySQL = sql
	p.gotQueryArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.queryRowCalls++
	p.gotQueryRowSQL = sql
	p.gotQueryRowArgs = args
	return p.row
}

var _ unlockQuerier = (*fakePool)(nil)

func newRepo(q unlockQuerier) *UnlockRepo { return &UnlockRepo{q: q} }

// ---------------------------------------------------------------------------
// NewUnlockRepo — construction contract.
// ---------------------------------------------------------------------------

func TestNewUnlockRepo_NilInputsPanic(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		db   *database.DB
	}{
		{"nil_db", nil},
		{"nil_pool", &database.DB{Pool: nil}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			defer func() {
				if recover() == nil {
					t.Fatalf("NewUnlockRepo(%s) did not panic; a nil pool is a wiring bug that must fail fast", c.name)
				}
			}()
			_ = NewUnlockRepo(c.db)
		})
	}
}

// TestNewUnlockRepo_WiresPool proves the happy path: a non-nil pool is stored
// on the repo unchanged. The pool is created lazily (pgxpool.NewWithConfig does
// not connect) so no live database is required.
func TestNewUnlockRepo_WiresPool(t *testing.T) {
	t.Parallel()
	cfg, err := pgxpool.ParseConfig("postgres://user:pass@127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig (should be lazy, no connect): %v", err)
	}
	defer pool.Close()

	repo := NewUnlockRepo(&database.DB{Pool: pool})
	if repo == nil {
		t.Fatal("NewUnlockRepo returned nil")
	}
	if repo.q != unlockQuerier(pool) {
		t.Error("NewUnlockRepo did not wire db.Pool into the querier seam")
	}
}

// ---------------------------------------------------------------------------
// ListByVehicle.
// ---------------------------------------------------------------------------

func TestUnlockRepo_ListByVehicle(t *testing.T) {
	t.Parallel()

	t1 := time.Date(2026, 3, 1, 8, 30, 0, 0, time.UTC)
	t2 := time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC)
	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("bad column type")
	iterBoom := errors.New("stream aborted")

	cases := []struct {
		name       string
		vehicleID  int64
		rows       *fakeRows
		queryErr   error
		wantLen    int
		wantErr    error  // errors.Is target; nil means no error
		wantErrSub string // substring the wrapped error must contain
		want       []Unlock
	}{
		{
			name:      "two_rows_success",
			vehicleID: 7,
			rows: &fakeRows{data: [][]any{
				{"first_1000_km", int64(7), t1},
				{"night_owl", int64(7), t2},
			}},
			wantLen: 2,
			want: []Unlock{
				{AchievementID: "first_1000_km", VehicleID: 7, UnlockedAt: t1},
				{AchievementID: "night_owl", VehicleID: 7, UnlockedAt: t2},
			},
		},
		{
			name:      "fleet_wide_bucket_zero",
			vehicleID: 0,
			rows: &fakeRows{data: [][]any{
				{"road_warrior", int64(0), t1},
			}},
			wantLen: 1,
			want: []Unlock{
				{AchievementID: "road_warrior", VehicleID: 0, UnlockedAt: t1},
			},
		},
		{
			name:      "empty_no_rows",
			vehicleID: 42,
			rows:      &fakeRows{data: nil},
			wantLen:   0,
		},
		{
			name:       "query_error_wrapped",
			vehicleID:  7,
			queryErr:   queryBoom,
			wantErr:    queryBoom,
			wantErrSub: "achievement_unlocks list",
		},
		{
			name:      "scan_error_wrapped",
			vehicleID: 7,
			rows: &fakeRows{
				data:      [][]any{{"a", int64(7), t1}, {"b", int64(7), t2}},
				scanErr:   scanBoom,
				scanErrAt: 1,
			},
			wantErr:    scanBoom,
			wantErrSub: "achievement_unlocks scan",
		},
		{
			name:      "rows_err_wrapped",
			vehicleID: 7,
			rows: &fakeRows{
				data:   [][]any{{"a", int64(7), t1}},
				errVal: iterBoom,
			},
			wantErr:    iterBoom,
			wantErrSub: "achievement_unlocks rows",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: c.rows, queryErr: c.queryErr}
			repo := newRepo(pool)

			got, err := repo.ListByVehicle(context.Background(), c.vehicleID)

			// Query is always attempted with the canonical SQL + the
			// vehicle id as the sole positional argument.
			if pool.queryCalls != 1 {
				t.Fatalf("queryCalls = %d, want 1", pool.queryCalls)
			}
			if pool.gotQuerySQL != listByVehicleSQL {
				t.Errorf("SQL passed to Query = %q, want listByVehicleSQL constant", pool.gotQuerySQL)
			}
			if len(pool.gotQueryArgs) != 1 || pool.gotQueryArgs[0] != any(c.vehicleID) {
				t.Errorf("Query args = %v, want [%d]", pool.gotQueryArgs, c.vehicleID)
			}

			if c.wantErr != nil {
				if err == nil {
					t.Fatalf("expected error, got nil (result=%v)", got)
				}
				if !errors.Is(err, c.wantErr) {
					t.Errorf("error %v does not wrap sentinel %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err.Error(), c.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != c.wantLen {
				t.Fatalf("len(result) = %d, want %d", len(got), c.wantLen)
			}
			for i := range c.want {
				if got[i] != c.want[i] {
					t.Errorf("result[%d] = %+v, want %+v", i, got[i], c.want[i])
				}
			}
			// Rows must be closed exactly once (defer rows.Close()).
			if c.rows != nil && !c.rows.closed {
				t.Error("rows.Close() was not called")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// RecordUnlock.
// ---------------------------------------------------------------------------

func TestUnlockRepo_RecordUnlock(t *testing.T) {
	t.Parallel()

	unlockedAt := time.Date(2026, 5, 20, 9, 0, 0, 0, time.UTC)
	existingAt := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)
	scanBoom := errors.New("smallint out of range")

	cases := []struct {
		name           string
		achievementID  string
		vehicleID      int64
		row            fakeRow
		wantInserted   bool
		wantUnlockedAt time.Time
		wantErr        error
		wantErrSub     string
	}{
		{
			name:           "fresh_insert_reports_true",
			achievementID:  "first_supercharge",
			vehicleID:      7,
			row:            fakeRow{inserted: true, unlockedAt: unlockedAt},
			wantInserted:   true,
			wantUnlockedAt: unlockedAt,
		},
		{
			name:           "conflict_reports_false_and_existing_ts",
			achievementID:  "first_supercharge",
			vehicleID:      7,
			row:            fakeRow{inserted: false, unlockedAt: existingAt},
			wantInserted:   false,
			wantUnlockedAt: existingAt,
		},
		{
			name:           "fleet_wide_bucket_zero",
			achievementID:  "fleet_10000_km",
			vehicleID:      0,
			row:            fakeRow{inserted: true, unlockedAt: unlockedAt},
			wantInserted:   true,
			wantUnlockedAt: unlockedAt,
		},
		{
			name:          "scan_error_wrapped",
			achievementID: "first_supercharge",
			vehicleID:     7,
			row:           fakeRow{err: scanBoom},
			wantErr:       scanBoom,
			wantErrSub:    "achievement_unlocks record",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{row: c.row}
			repo := newRepo(pool)
			when := time.Date(2026, 5, 20, 9, 0, 0, 0, time.UTC)

			inserted, at, err := repo.RecordUnlock(context.Background(), c.achievementID, c.vehicleID, when)

			// One round trip with the canonical SQL + ordered args.
			if pool.queryRowCalls != 1 {
				t.Fatalf("queryRowCalls = %d, want 1", pool.queryRowCalls)
			}
			if pool.gotQueryRowSQL != recordUnlockSQL {
				t.Errorf("SQL passed to QueryRow = %q, want recordUnlockSQL constant", pool.gotQueryRowSQL)
			}
			if len(pool.gotQueryRowArgs) != 3 {
				t.Fatalf("QueryRow args = %v, want 3 (achievement_id, vehicle_id, unlocked_at)", pool.gotQueryRowArgs)
			}
			if pool.gotQueryRowArgs[0] != any(c.achievementID) {
				t.Errorf("arg[0] = %v, want achievement_id %q", pool.gotQueryRowArgs[0], c.achievementID)
			}
			if pool.gotQueryRowArgs[1] != any(c.vehicleID) {
				t.Errorf("arg[1] = %v, want vehicle_id %d", pool.gotQueryRowArgs[1], c.vehicleID)
			}

			if c.wantErr != nil {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				if !errors.Is(err, c.wantErr) {
					t.Errorf("error %v does not wrap sentinel %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err.Error(), c.wantErrSub)
				}
				if inserted {
					t.Error("inserted = true on error, want false")
				}
				if !at.IsZero() {
					t.Errorf("timestamp = %v on error, want zero time", at)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if inserted != c.wantInserted {
				t.Errorf("inserted = %v, want %v", inserted, c.wantInserted)
			}
			if !at.Equal(c.wantUnlockedAt) {
				t.Errorf("unlocked_at = %v, want %v", at, c.wantUnlockedAt)
			}
		})
	}
}

// TestUnlockRepo_RecordUnlock_NormalisesToUTC pins that a caller-supplied
// wall-clock in a non-UTC zone is persisted as UTC, so the stored timestamp is
// location-independent regardless of where the API process runs.
func TestUnlockRepo_RecordUnlock_NormalisesToUTC(t *testing.T) {
	t.Parallel()
	est := time.FixedZone("EST", -5*60*60)
	when := time.Date(2026, 6, 1, 7, 0, 0, 0, est) // 12:00 UTC
	pool := &fakePool{row: fakeRow{inserted: true, unlockedAt: when.UTC()}}
	repo := newRepo(pool)

	if _, _, err := repo.RecordUnlock(context.Background(), "midnight_drive", 3, when); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	got, ok := pool.gotQueryRowArgs[2].(time.Time)
	if !ok {
		t.Fatalf("arg[2] is %T, want time.Time", pool.gotQueryRowArgs[2])
	}
	if got.Location() != time.UTC {
		t.Errorf("persisted timestamp location = %v, want UTC", got.Location())
	}
	if !got.Equal(when) {
		t.Errorf("persisted instant %v is not equal to the supplied instant %v", got, when)
	}
	if h := got.Hour(); h != 12 {
		t.Errorf("persisted hour = %d, want 12 (07:00 EST == 12:00 UTC)", h)
	}
}

// ---------------------------------------------------------------------------
// SQL-shape guards. Pin the critical fragments so a column/table/clause typo
// is caught at test time rather than at runtime (matches the sibling repos'
// pure-Go SQL-shape precedent).
// ---------------------------------------------------------------------------

func TestListByVehicleSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"SELECT achievement_id, vehicle_id, unlocked_at",
		"FROM achievement_unlocks",
		"WHERE vehicle_id = $1",
	}
	for _, frag := range mustContain {
		if !strings.Contains(listByVehicleSQL, frag) {
			t.Errorf("listByVehicleSQL missing %q\nfull SQL:\n%s", frag, listByVehicleSQL)
		}
	}
	for _, frag := range []string{"INSERT", "UPDATE ", "DELETE"} {
		if strings.Contains(listByVehicleSQL, frag) {
			t.Errorf("listByVehicleSQL must be a pure SELECT but contains %q", frag)
		}
	}
}

func TestRecordUnlockSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// Upsert body keyed on the natural PK (mig 000167).
		"INSERT INTO achievement_unlocks (achievement_id, vehicle_id, unlocked_at)",
		"VALUES ($1, $2, $3)",
		"ON CONFLICT (achievement_id, vehicle_id) DO NOTHING",
		"RETURNING unlocked_at",
		// The two UNION-ALL branches distinguish a fresh insert from an
		// idempotent conflict in a single round trip.
		"SELECT TRUE AS inserted, unlocked_at FROM ins",
		"UNION ALL",
		"SELECT FALSE AS inserted, unlocked_at",
		"WHERE achievement_id = $1 AND vehicle_id = $2",
		"LIMIT 1",
	}
	for _, frag := range mustContain {
		if !strings.Contains(recordUnlockSQL, frag) {
			t.Errorf("recordUnlockSQL missing %q\nfull SQL:\n%s", frag, recordUnlockSQL)
		}
	}
}
