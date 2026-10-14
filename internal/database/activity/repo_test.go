package activity

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	activitymodel "github.com/ev-dev-labs/teslasync/internal/models/activity"
	"github.com/jackc/pgx/v5"
)

type activityTestRows struct {
	pgx.Rows
	values  [][]any
	index   int
	closed  bool
	err     error
	scanErr error
}

func (r *activityTestRows) Next() bool {
	if r.index >= len(r.values) {
		r.Close()
		return false
	}
	r.index++
	return true
}

func (r *activityTestRows) Close()     { r.closed = true }
func (r *activityTestRows) Err() error { return r.err }
func (r *activityTestRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	for i, value := range r.values[r.index-1] {
		target := reflect.ValueOf(dest[i]).Elem()
		if value == nil {
			target.SetZero()
		} else {
			target.Set(reflect.ValueOf(value))
		}
	}
	return nil
}

type activityCountRow struct {
	total int64
	err   error
}

func (r activityCountRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*int64) = r.total
	return nil
}

type activityTestPool struct {
	t          *testing.T
	rows       *activityTestRows
	queryErr   error
	count      activityCountRow
	countCalls int
	countSQL   string
	countArgs  []any
}

func (p *activityTestPool) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return p.rows, p.queryErr
}

func (p *activityTestPool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if !p.rows.closed {
		p.t.Error("page rows must be closed before the count query")
	}
	p.countCalls++
	p.countSQL = sql
	p.countArgs = args
	return p.count
}

func TestListEmptyPageReturnsAuthoritativeScopedTotal(t *testing.T) {
	t.Parallel()
	vehicleID := int64(42)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	for _, tc := range []struct {
		name   string
		offset int
		total  int64
	}{
		{"offset beyond results", 100, 23},
		{"scoped recovery offset", 50, 3},
		{"empty scope", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := Filters{
				VehicleID: &vehicleID, Start: start, End: end,
				Kinds: []activitymodel.Kind{activitymodel.KindDrive, activitymodel.KindAnnotation},
				Limit: 10, Offset: tc.offset,
			}
			pool := &activityTestPool{t: t, rows: &activityTestRows{}, count: activityCountRow{total: tc.total}}
			items, total, err := (&Repo{pool: pool}).List(context.Background(), f)
			if err != nil || items == nil || len(items) != 0 || total != tc.total {
				t.Fatalf("List() = %#v, %d, %v; want non-nil empty items and total %d", items, total, err, tc.total)
			}
			cte, args := buildActivityCTE(f)
			if pool.countCalls != 1 || pool.countSQL != cte+"\nSELECT count(*) FROM activity" {
				t.Fatalf("count must query the identical filtered activity CTE: %q", pool.countSQL)
			}
			if !reflect.DeepEqual(pool.countArgs, args) || len(pool.countArgs) != 3 {
				t.Fatalf("count args = %#v, want scoped args %#v without pagination", pool.countArgs, args)
			}
			if strings.Contains(pool.countSQL, "LIMIT") || strings.Contains(pool.countSQL, "OFFSET") {
				t.Fatal("authoritative count must not be paginated")
			}
		})
	}
}

func TestListPopulatedPagePreservesWindowCountAndItem(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	pool := &activityTestPool{t: t, rows: &activityTestRows{values: [][]any{{
		"drives", int64(7), activitymodel.KindDrive, at, nil,
		"", "", nil, "completed", nil, nil, nil, nil, nil, nil, int64(23),
	}}}}
	items, total, err := (&Repo{pool: pool}).List(context.Background(), Filters{Offset: 10})
	if err != nil || len(items) != 1 || total != 23 {
		t.Fatalf("List() = %#v, %d, %v", items, total, err)
	}
	if items[0].ID != "drives:7" || !items[0].OccurredAt.Equal(at) || items[0].Status != "completed" {
		t.Fatalf("populated activity changed: %#v", items[0])
	}
	if pool.countCalls != 0 {
		t.Fatal("populated pages must use the window count without a second query")
	}
}

func TestListDatabaseErrorsAreNotSuccessfulEmptyPages(t *testing.T) {
	t.Parallel()
	boom := errors.New("database failure")
	for _, tc := range []struct {
		name       string
		pool       *activityTestPool
		countCalls int
	}{
		{"query", &activityTestPool{queryErr: boom}, 0},
		{"iteration", &activityTestPool{rows: &activityTestRows{err: boom}}, 0},
		{"scan", &activityTestPool{rows: &activityTestRows{values: [][]any{{}}, scanErr: boom}}, 0},
		{"count", &activityTestPool{rows: &activityTestRows{}, count: activityCountRow{err: boom}}, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.pool.t = t
			items, total, err := (&Repo{pool: tc.pool}).List(context.Background(), Filters{Offset: 100})
			if !errors.Is(err, boom) || items != nil || total != 0 || tc.pool.countCalls != tc.countCalls {
				t.Fatalf("List() = %#v, %d, %v; count calls = %d", items, total, err, tc.pool.countCalls)
			}
		})
	}
}

// TestBuildQuery_AllKindsByDefault pins the default (no kind filter) shape:
// every domain's UNION ALL branch is present, in the fixed order AllKinds
// declares them, and the shared three positional filters ($1 vehicle_id,
// $2 start, $3 end) are referenced by every branch.
func TestBuildQuery_AllKindsByDefault(t *testing.T) {
	t.Parallel()
	query, args := buildQuery(Filters{})

	mustContain := []string{
		"FROM drives d",
		"FROM charging_sessions c",
		"FROM notification_logs nl",
		"FROM software_updates su",
		"FROM chart_annotations ca",
		"UNION ALL",
		"count(*) OVER() AS total_count",
		"duration_s, start_soc_pct, end_soc_pct, energy_added_wh, version",
		"ORDER BY occurred_at DESC, source_table ASC, source_id DESC",
		"LIMIT $4 OFFSET $5",
		"$1::bigint IS NULL",
		"$2::timestamptz IS NULL",
		"$3::timestamptz IS NULL",
	}
	for _, frag := range mustContain {
		if !strings.Contains(query, frag) {
			t.Errorf("buildQuery() missing %q\nfull SQL:\n%s", frag, query)
		}
	}

	// Default limit/offset land in args[3]/args[4] when Filters leaves them
	// unset (mirrors apiparams.Pagination defaults).
	if len(args) != 5 {
		t.Fatalf("expected 5 positional args, got %d: %#v", len(args), args)
	}
	if args[0] != nil {
		t.Errorf("expected nil vehicle_id arg when unset, got %v", args[0])
	}
	if args[1] != nil || args[2] != nil {
		t.Errorf("expected nil start/end args when unset, got %v / %v", args[1], args[2])
	}
	if got := args[3]; got != 50 {
		t.Errorf("expected default limit 50, got %v", got)
	}
	if got := args[4]; got != 0 {
		t.Errorf("expected default offset 0, got %v", got)
	}
}

// TestBuildQuery_KindFilterOmitsOtherBranches asserts the repository does
// not even query tables the caller didn't ask for — required for the
// "no N+1 / efficient composition" contract when a page only wants, say,
// drive + charging activity.
func TestBuildQuery_KindFilterOmitsOtherBranches(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{Kinds: []activitymodel.Kind{activitymodel.KindDrive}})

	if !strings.Contains(query, "FROM drives d") {
		t.Errorf("expected drives branch present:\n%s", query)
	}
	mustNotContain := []string{
		"FROM charging_sessions c",
		"FROM notification_logs nl",
		"FROM software_updates su",
		"FROM chart_annotations ca",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("expected %q to be omitted when Kinds=[drive]\nfull SQL:\n%s", frag, query)
		}
	}
}

// TestBuildQuery_VehicleAndDateArgsPropagate pins that a supplied
// VehicleID/Start/End land in args[0..2] verbatim (UTC-normalized for
// times), since every branch binds the same three placeholders.
func TestBuildQuery_VehicleAndDateArgsPropagate(t *testing.T) {
	t.Parallel()
	vehicleID := int64(42)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.FixedZone("PST", -8*3600))
	end := time.Date(2026, 1, 31, 23, 59, 59, 0, time.UTC)

	_, args := buildQuery(Filters{
		VehicleID: &vehicleID,
		Start:     start,
		End:       end,
		Limit:     10,
		Offset:    5,
	})

	if args[0] != vehicleID {
		t.Errorf("expected vehicle_id arg %d, got %v", vehicleID, args[0])
	}
	gotStart, ok := args[1].(time.Time)
	if !ok || !gotStart.Equal(start) {
		t.Errorf("expected start arg %v, got %v", start, args[1])
	}
	if gotStart.Location() != time.UTC {
		t.Errorf("expected start arg normalized to UTC, got location %v", gotStart.Location())
	}
	gotEnd, ok := args[2].(time.Time)
	if !ok || gotEnd != end.UTC() {
		t.Errorf("expected exact exclusive end arg %v, got %v", end.UTC(), args[2])
	}
	if args[3] != 10 || args[4] != 5 {
		t.Errorf("expected limit=10 offset=5, got %v / %v", args[3], args[4])
	}
}

func TestBuildQuery_HalfOpenRangeAcrossAllKinds(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		kind activitymodel.Kind
		at   string
	}{
		{activitymodel.KindDrive, "d.started_at"},
		{activitymodel.KindCharging, "c.started_at"},
		{activitymodel.KindAlert, "nl.created_at"},
		{activitymodel.KindSoftwareUpdate, "COALESCE(su.installed_at, su.scheduled_at, su.created_at)"},
		{activitymodel.KindAnnotation, "ca.occurred_at"},
	} {
		t.Run(string(tc.kind), func(t *testing.T) {
			query, _ := buildQuery(Filters{Kinds: []activitymodel.Kind{tc.kind}})
			for _, predicate := range []string{
				"($2::timestamptz IS NULL OR " + tc.at + " >= $2::timestamptz)",
				"($3::timestamptz IS NULL OR " + tc.at + " < $3::timestamptz)",
			} {
				if !strings.Contains(query, predicate) {
					t.Errorf("missing half-open range predicate %q", predicate)
				}
			}
			if strings.Contains(query, "<= $3::timestamptz") {
				t.Fatal("an event at the exact upper bound must be excluded")
			}
		})
	}
}

func TestBuildQuery_PreservesExactRangeInstants(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		start string
		end   string
	}{
		{"rolling 24 hours", "2026-10-13T13:28:00.123456789-07:00", "2026-10-14T13:28:00.123456789-07:00"},
		{"custom spring DST day", "2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00"},
		{"custom fall DST day", "2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00"},
		{"custom fractional offset", "2026-10-01T00:00:00+05:45", "2026-10-15T00:00:00+05:45"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start, err := time.Parse(time.RFC3339Nano, tc.start)
			if err != nil {
				t.Fatal(err)
			}
			end, err := time.Parse(time.RFC3339Nano, tc.end)
			if err != nil {
				t.Fatal(err)
			}
			f := Filters{Start: start, End: end}
			_, args := buildQuery(f)
			_, countArgs := buildActivityCTE(f)
			if args[1] != start.UTC() || args[2] != end.UTC() {
				t.Fatalf("range args = %v / %v; want exact UTC instants %v / %v", args[1], args[2], start.UTC(), end.UTC())
			}
			if !reflect.DeepEqual(args[:3], countArgs) {
				t.Fatalf("page and total bounds differ: %v / %v", args[:3], countArgs)
			}
			_, changedStartArgs := buildQuery(Filters{Start: start.Add(time.Second), End: end})
			_, changedEndArgs := buildQuery(Filters{Start: start, End: end.Add(time.Second)})
			if reflect.DeepEqual(args, changedStartArgs) || reflect.DeepEqual(args, changedEndArgs) {
				t.Fatal("changing either range bound must change the query arguments")
			}
		})
	}
}

// TestBuildQuery_LimitClampedToDefault pins the >500 / <=0 clamp behavior.
func TestBuildQuery_LimitClampedToDefault(t *testing.T) {
	t.Parallel()
	for _, limit := range []int{0, -1, 501, 10000} {
		_, args := buildQuery(Filters{Limit: limit})
		if args[3] != 50 {
			t.Errorf("limit=%d: expected clamp to default 50, got %v", limit, args[3])
		}
	}
}

// TestBuildQuery_NoUnitSuffixedFields guards against regressing Phase-48's
// SI-canonical rule: the composed query must never reference legacy
// unit-suffixed column names on the SI tables it reads from.
func TestBuildQuery_NoUnitSuffixedFields(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	mustNotContain := []string{
		"distance_mi", "duration_min", "energy_used_kwh", "avg_speed_mph",
		"max_speed_mph", "avg_power_kw", "energy_added_kwh",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("buildQuery() must not reference legacy unit-suffixed column %q\nfull SQL:\n%s", frag, query)
		}
	}
}

func TestBuildQuery_KeepsSessionMeasurementsTypedAndSI(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	for _, fragment := range []string{
		"d.duration_s AS duration_s",
		"c.total_energy_added_wh::double precision AS energy_added_wh",
		"su.version::text AS version",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("buildQuery() missing typed activity projection %q\nfull SQL:\n%s", fragment, query)
		}
	}
	for _, fragment := range []string{"' min'", "' kWh'", " / 60.0", " / 1000.0"} {
		if strings.Contains(query, fragment) {
			t.Errorf("buildQuery() must not pre-format SI values at the API boundary; found %q\nfull SQL:\n%s", fragment, query)
		}
	}
}

func TestBuildQuery_AlertVehicleProjectionIsNotArbitrary(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{Kinds: []activitymodel.Kind{activitymodel.KindAlert}})
	for _, fragment := range []string{
		"WHEN $1::bigint IS NOT NULL AND ar.id IS NOT NULL THEN $1::bigint",
		"CASE WHEN COUNT(*) = 1 THEN MIN(arv.vehicle_id)",
		"COALESCE(NULLIF(nl.severity, ''), ar.severity, 'info')",
	} {
		if !strings.Contains(query, fragment) {
			t.Errorf("alert activity query missing %q\nfull SQL:\n%s", fragment, query)
		}
	}
	if strings.Contains(query, "LIMIT 1) AS vehicle_id") {
		t.Errorf("alert activity must not attribute a multi-vehicle rule to an arbitrary first target\nfull SQL:\n%s", query)
	}
}

// TestBuildQuery_NeverLeaksAddressOrCoordinateColumns pins the "avoid
// leaking sensitive location data" requirement: none of the address/lat/
// lng columns from drives or charging_sessions may be selected.
func TestBuildQuery_NeverLeaksAddressOrCoordinateColumns(t *testing.T) {
	t.Parallel()
	query, _ := buildQuery(Filters{})
	mustNotContain := []string{
		"start_place", "end_place", "start_lat", "start_lng", "start_lon",
		"end_lat", "end_lng", "end_lon",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(query, frag) {
			t.Errorf("buildQuery() must not select location column %q\nfull SQL:\n%s", frag, query)
		}
	}
}
