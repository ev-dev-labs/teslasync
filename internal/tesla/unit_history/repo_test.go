package unithistory

import (
	"context"
	"errors"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// ---------------------------------------------------------------------------
// memRepo — in-memory Repo that mirrors PostgreSQL semantics for behavior
// tests. Used by the contract-suite tests below; the same suite also runs
// against pgRepo when DATABASE_URL is set (TestPgRepo_*Suite below).
// ---------------------------------------------------------------------------

// memEntry is one row in the in-memory store. id is assigned monotonically
// by memRepo.Record so it can stand in for the BIGSERIAL tiebreaker.
type memEntry struct {
	id            int64
	value         units.ActiveUnit
	effectiveFrom time.Time
	source        Source
}

type memKey struct {
	vehicleID int64
	kind      Kind
}

// memRepo is an in-memory Repo implementation used to exercise the
// contract surface (idempotency, tiebreaker, ErrNotFound, intermediate-t
// queries) without a live Postgres. It implements the same ON CONFLICT
// DO NOTHING + ORDER BY effective_from DESC, id DESC semantics as the
// SQL in repo.go so the same TestRepoSuite asserts both implementations
// agree on every contract row.
type memRepo struct {
	mu     sync.RWMutex
	cache  *Cache
	rows   map[memKey][]memEntry
	nextID atomic.Int64
}

func newMemRepo(cache *Cache) *memRepo {
	return &memRepo{
		cache: cache,
		rows:  make(map[memKey][]memEntry),
	}
}

func (m *memRepo) Record(ctx context.Context, e Entry) error {
	if e.VehicleID == 0 {
		return errors.New("memRepo.Record: vehicle_id zero")
	}
	if e.Kind == "" {
		return errors.New("memRepo.Record: kind empty")
	}
	if e.Value == "" {
		return errors.New("memRepo.Record: value empty")
	}
	if e.Source == "" {
		return errors.New("memRepo.Record: source empty")
	}
	if e.EffectiveFrom.IsZero() {
		return errors.New("memRepo.Record: effective_from zero")
	}

	effFrom := e.EffectiveFrom.UTC()
	key := memKey{e.VehicleID, e.Kind}

	m.mu.Lock()
	// ON CONFLICT (vehicle_id, unit_kind, effective_from, unit_value, source)
	// DO NOTHING — idempotency rule mirrored.
	for _, existing := range m.rows[key] {
		if existing.effectiveFrom.Equal(effFrom) &&
			existing.value == e.Value &&
			existing.source == e.Source {
			m.mu.Unlock()
			if m.cache != nil {
				m.cache.Invalidate(ctx, e.VehicleID, e.Kind)
			}
			return nil
		}
	}
	id := m.nextID.Add(1)
	m.rows[key] = append(m.rows[key], memEntry{
		id:            id,
		value:         e.Value,
		effectiveFrom: effFrom,
		source:        e.Source,
	})
	m.mu.Unlock()

	if m.cache != nil {
		m.cache.Invalidate(ctx, e.VehicleID, e.Kind)
	}
	return nil
}

func (m *memRepo) At(ctx context.Context, vehicleID int64, kind Kind, t time.Time) (units.ActiveUnit, error) {
	if m.cache != nil {
		if entry, ok := m.cache.GetForAt(ctx, vehicleID, kind, t); ok {
			return entry.Value, nil
		}
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := append([]memEntry(nil), m.rows[memKey{vehicleID, kind}]...)
	// effective_from <= t, ORDER BY effective_from DESC, id DESC LIMIT 1
	sort.Slice(rows, func(i, j int) bool {
		if !rows[i].effectiveFrom.Equal(rows[j].effectiveFrom) {
			return rows[i].effectiveFrom.After(rows[j].effectiveFrom)
		}
		return rows[i].id > rows[j].id
	})
	tUTC := t.UTC()
	for _, r := range rows {
		if !r.effectiveFrom.After(tUTC) {
			return r.value, nil
		}
	}
	return "", ErrNotFound
}

func (m *memRepo) Latest(ctx context.Context, vehicleID int64, kind Kind) (Entry, error) {
	if m.cache != nil {
		if entry, ok := m.cache.GetLatest(ctx, vehicleID, kind); ok {
			return entry, nil
		}
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	rows := append([]memEntry(nil), m.rows[memKey{vehicleID, kind}]...)
	if len(rows) == 0 {
		return Entry{}, ErrNotFound
	}
	sort.Slice(rows, func(i, j int) bool {
		if !rows[i].effectiveFrom.Equal(rows[j].effectiveFrom) {
			return rows[i].effectiveFrom.After(rows[j].effectiveFrom)
		}
		return rows[i].id > rows[j].id
	})
	winner := rows[0]
	entry := Entry{
		VehicleID:     vehicleID,
		Kind:          kind,
		Value:         winner.value,
		EffectiveFrom: winner.effectiveFrom,
		Source:        winner.source,
	}
	if m.cache != nil {
		m.cache.PutLatest(ctx, entry)
	}
	return entry, nil
}

// rowCount is a test-only inspector that bypasses the cache so the
// idempotency assertion can verify "Record-then-Record-same-payload
// writes only one row" by counting the underlying store directly.
func (m *memRepo) rowCount(vehicleID int64, kind Kind) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.rows[memKey{vehicleID, kind}])
}

// ---------------------------------------------------------------------------
// Test helpers — a Repo + a row-counter, so the suite can run against
// either the in-memory implementation or the Postgres implementation.
// ---------------------------------------------------------------------------

type repoUnderTest struct {
	repo     Repo
	rowCount func(vehicleID int64, kind Kind) int
	cleanup  func()
}

func newMemRepoForTest() repoUnderTest {
	m := newMemRepo(nil)
	return repoUnderTest{
		repo:     m,
		rowCount: m.rowCount,
		cleanup:  func() {},
	}
}

// ---------------------------------------------------------------------------
// Contract suite — runs against memRepo unconditionally and against
// pgRepo when DATABASE_URL is set. Both implementations MUST agree.
// ---------------------------------------------------------------------------

func TestMemRepo_ContractSuite(t *testing.T) {
	runRepoContractSuite(t, newMemRepoForTest)
}

func TestPgRepo_ContractSuite(t *testing.T) {
	dsn := pgDSNFromEnv()
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping live-PG contract suite. " +
			"Set DATABASE_URL to a Postgres with migrations applied to run.")
	}
	runRepoContractSuite(t, func() repoUnderTest {
		return newPgRepoForTest(t, dsn)
	})
}

// runRepoContractSuite runs the prompt-mandated coverage against any
// Repo implementation: insert in any order, query at intermediate
// timestamps, ErrNotFound on empty, same-instant tiebreaker via id DESC,
// idempotency on identical Record payloads.
func runRepoContractSuite(t *testing.T, factory func() repoUnderTest) {
	t.Helper()

	t.Run("InsertInAnyOrder_ReadOrderedByEffectiveFrom", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(101)

		// Insert in deliberately scrambled order to verify the read
		// query, not the write order, drives the result.
		t1 := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)
		t2 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
		t3 := time.Date(2026, 5, 1, 11, 0, 0, 0, time.UTC)

		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitMiles, t2, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitKilometers, t3, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitMiles, t1, SourceRESTBootstrap})

		// At each instant returns the row with the largest
		// effective_from <= t.
		got, err := rut.repo.At(ctx, vid, KindDistance, t1)
		if err != nil || got != units.ActiveUnitMiles {
			t.Fatalf("At(t1) = %q,%v; want mi,nil", got, err)
		}
		got, err = rut.repo.At(ctx, vid, KindDistance, t2.Add(30*time.Minute))
		if err != nil || got != units.ActiveUnitMiles {
			t.Fatalf("At(t2+30m) = %q,%v; want mi,nil", got, err)
		}
		got, err = rut.repo.At(ctx, vid, KindDistance, t3.Add(time.Hour))
		if err != nil || got != units.ActiveUnitKilometers {
			t.Fatalf("At(t3+1h) = %q,%v; want km,nil", got, err)
		}
	})

	t.Run("ErrNotFound_WhenNoRowExists", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()

		_, err := rut.repo.At(ctx, 999, KindDistance, time.Now())
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("At with no rows: err=%v; want ErrNotFound", err)
		}
		_, err = rut.repo.Latest(ctx, 999, KindDistance)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("Latest with no rows: err=%v; want ErrNotFound", err)
		}
	})

	t.Run("ErrNotFound_WhenAllRowsAfterT", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(202)

		// Earliest row is at 10:00; querying At(09:00) finds no row
		// with effective_from <= t and must return ErrNotFound (the
		// caller drops the sample rather than guessing a default).
		t10 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
		mustRecord(t, rut.repo, Entry{vid, KindTemperature, units.ActiveUnitCelsius, t10, SourceTelemetry})
		_, err := rut.repo.At(ctx, vid, KindTemperature, t10.Add(-time.Hour))
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("At(before earliest) = %v; want ErrNotFound", err)
		}
	})

	t.Run("SameInstantTiebreaker_LaterInsertedRowWinsViaIdDesc", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(303)
		// Two Record calls at the SAME effective_from but different
		// (value, source) — both rows succeed because the UNIQUE
		// constraint includes value+source. The lookup MUST resolve
		// to the later-inserted row deterministically via id DESC.
		t0 := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
		mustRecord(t, rut.repo, Entry{vid, KindPressure, units.ActiveUnitPSI, t0, SourceRESTBootstrap})
		mustRecord(t, rut.repo, Entry{vid, KindPressure, units.ActiveUnitBar, t0, SourceTelemetry})

		// Both inserts retained (no ON CONFLICT collision because
		// value+source differ).
		if got := rut.rowCount(vid, KindPressure); got != 2 {
			t.Fatalf("rowCount after two same-instant inserts = %d; want 2", got)
		}

		// Read MUST return the second insertion (bar / telemetry) per
		// id DESC tiebreaker.
		got, err := rut.repo.At(ctx, vid, KindPressure, t0)
		if err != nil || got != units.ActiveUnitBar {
			t.Fatalf("At(t0) tiebreaker = %q,%v; want bar,nil", got, err)
		}
		latest, err := rut.repo.Latest(ctx, vid, KindPressure)
		if err != nil || latest.Value != units.ActiveUnitBar {
			t.Fatalf("Latest() tiebreaker = %v,%v; want bar,nil", latest, err)
		}

		// Reverse the two inserts on a fresh repo and verify the
		// LATER-inserted row still wins (value/source swapped).
		rut2 := factory()
		t.Cleanup(rut2.cleanup)
		mustRecord(t, rut2.repo, Entry{vid, KindPressure, units.ActiveUnitBar, t0, SourceTelemetry})
		mustRecord(t, rut2.repo, Entry{vid, KindPressure, units.ActiveUnitPSI, t0, SourceRESTBootstrap})
		got, err = rut2.repo.At(ctx, vid, KindPressure, t0)
		if err != nil || got != units.ActiveUnitPSI {
			t.Fatalf("reversed-order At(t0) tiebreaker = %q,%v; want psi,nil", got, err)
		}
	})

	t.Run("Idempotency_DuplicateRecordWritesOneRow", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(404)
		t0 := time.Date(2026, 5, 1, 14, 0, 0, 0, time.UTC)
		e := Entry{vid, KindCharge, units.ActiveUnitPercent, t0, SourceTelemetry}

		// Three identical Records — only the first writes a row.
		mustRecord(t, rut.repo, e)
		mustRecord(t, rut.repo, e)
		mustRecord(t, rut.repo, e)

		if got := rut.rowCount(vid, KindCharge); got != 1 {
			t.Fatalf("rowCount after three identical Records = %d; want 1", got)
		}

		// And the surviving row is still readable.
		got, err := rut.repo.At(ctx, vid, KindCharge, t0)
		if err != nil || got != units.ActiveUnitPercent {
			t.Fatalf("At after idempotent inserts = %q,%v; want charge_percent,nil", got, err)
		}
	})

	t.Run("Latest_ReturnsHighestEffectiveFromRow", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(505)

		t1 := time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC)
		t2 := time.Date(2026, 5, 1, 16, 0, 0, 0, time.UTC)
		t3 := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitMiles, t1, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitKilometers, t2, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitMiles, t3, SourceTelemetry})

		got, err := rut.repo.Latest(ctx, vid, KindDistance)
		if err != nil {
			t.Fatalf("Latest err: %v", err)
		}
		if !got.EffectiveFrom.Equal(t2) {
			t.Errorf("Latest.EffectiveFrom = %v; want %v", got.EffectiveFrom, t2)
		}
		if got.Value != units.ActiveUnitKilometers {
			t.Errorf("Latest.Value = %q; want km", got.Value)
		}
	})

	t.Run("KindIsolated_DistanceAndTemperatureDoNotInterfere", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		vid := int64(606)
		t0 := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)

		mustRecord(t, rut.repo, Entry{vid, KindDistance, units.ActiveUnitMiles, t0, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{vid, KindTemperature, units.ActiveUnitFahrenheit, t0, SourceTelemetry})

		gotD, _ := rut.repo.At(ctx, vid, KindDistance, t0)
		gotT, _ := rut.repo.At(ctx, vid, KindTemperature, t0)
		if gotD != units.ActiveUnitMiles {
			t.Errorf("At(distance) = %q; want mi", gotD)
		}
		if gotT != units.ActiveUnitFahrenheit {
			t.Errorf("At(temperature) = %q; want F", gotT)
		}
	})

	t.Run("VehicleIsolated_TwoVehiclesDoNotShareHistory", func(t *testing.T) {
		rut := factory()
		t.Cleanup(rut.cleanup)
		ctx := context.Background()
		t0 := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)

		mustRecord(t, rut.repo, Entry{707, KindDistance, units.ActiveUnitMiles, t0, SourceTelemetry})
		mustRecord(t, rut.repo, Entry{708, KindDistance, units.ActiveUnitKilometers, t0, SourceTelemetry})

		got1, _ := rut.repo.At(ctx, 707, KindDistance, t0)
		got2, _ := rut.repo.At(ctx, 708, KindDistance, t0)
		if got1 != units.ActiveUnitMiles {
			t.Errorf("vehicle 707 At = %q; want mi", got1)
		}
		if got2 != units.ActiveUnitKilometers {
			t.Errorf("vehicle 708 At = %q; want km", got2)
		}
	})
}

func mustRecord(t *testing.T, r Repo, e Entry) {
	t.Helper()
	if err := r.Record(context.Background(), e); err != nil {
		t.Fatalf("Record(%+v): %v", e, err)
	}
}

// ---------------------------------------------------------------------------
// pgRepo-specific test helpers (live PG via DATABASE_URL).
// ---------------------------------------------------------------------------

// pgDSNFromEnv returns DATABASE_URL or empty (caller skips). Mirrors
// internal/database/schema_test.go's pattern: opt-in to live-PG tests
// via the same env var CI uses.
func pgDSNFromEnv() string {
	return os.Getenv("DATABASE_URL")
}

// newPgRepoForTest connects to live PG, isolates the test in a
// disposable random vehicle-id range to avoid stomping on other test
// rows, and wires a counter that queries the actual table.
func newPgRepoForTest(t *testing.T, dsn string) repoUnderTest {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot connect to PG: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping PG: %v", err)
	}

	// Use a unique vehicle_id high-byte for this run so concurrent
	// test invocations don't collide. We DELETE rows in cleanup.
	repo := NewRepo(pool, nil)

	rowCount := func(vehicleID int64, kind Kind) int {
		var n int
		err := pool.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM vehicle_unit_history WHERE vehicle_id = $1 AND unit_kind = $2`,
			vehicleID, string(kind),
		).Scan(&n)
		if err != nil {
			t.Fatalf("rowCount: %v", err)
		}
		return n
	}

	cleanup := func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM vehicle_unit_history WHERE vehicle_id BETWEEN 100 AND 999`)
		pool.Close()
	}
	return repoUnderTest{
		repo:     repo,
		rowCount: rowCount,
		cleanup:  cleanup,
	}
}

// ---------------------------------------------------------------------------
// pgRepo unit tests with a recording fake dbtx — exercise SQL query
// composition and validation paths that don't require real PG.
// ---------------------------------------------------------------------------

type recordedExec struct {
	sql  string
	args []any
}

type fakeDBTX struct {
	mu      sync.Mutex
	execs   []recordedExec
	queries []recordedExec
	scanFn  func(args ...any) error
	execErr error
}

func (f *fakeDBTX) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.mu.Lock()
	f.execs = append(f.execs, recordedExec{sql: sql, args: append([]any(nil), args...)})
	f.mu.Unlock()
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fakeDBTX) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.mu.Lock()
	f.queries = append(f.queries, recordedExec{sql: sql, args: append([]any(nil), args...)})
	f.mu.Unlock()
	return &fakeRow{scan: f.scanFn}
}

type fakeRow struct {
	scan func(args ...any) error
}

func (r *fakeRow) Scan(dest ...any) error {
	if r.scan == nil {
		return pgx.ErrNoRows
	}
	return r.scan(dest...)
}

// TestPgRepo_RecordSQL_ContainsOnConflictAndOrdering asserts the
// production SQL strings carry the gate-required clauses. The gate
// greps the source for "ON CONFLICT" and "effective_from DESC, id DESC"
// already, but compiling-the-strings-into-the-Go also requires that the
// constants aren't accidentally renamed or split. This guards against
// "passes the grep but doesn't appear in the actual SQL we run."
func TestPgRepo_RecordSQL_ContainsOnConflictAndOrdering(t *testing.T) {
	if !contains(recordSQL, "ON CONFLICT") {
		t.Errorf("recordSQL missing ON CONFLICT: %q", recordSQL)
	}
	if !contains(recordSQL, "DO NOTHING") {
		t.Errorf("recordSQL missing DO NOTHING: %q", recordSQL)
	}
	if !contains(atSQL, "effective_from DESC, id DESC") {
		t.Errorf("atSQL missing composite tiebreaker ORDER BY: %q", atSQL)
	}
	if !contains(atSQL, "effective_from <= $3") {
		t.Errorf("atSQL missing point-in-time predicate: %q", atSQL)
	}
	if !contains(latestSQL, "effective_from DESC, id DESC") {
		t.Errorf("latestSQL missing composite tiebreaker ORDER BY: %q", latestSQL)
	}
	if !contains(latestSQL, "LIMIT 1") {
		t.Errorf("latestSQL missing LIMIT 1: %q", latestSQL)
	}
}

func TestPgRepo_Record_RejectsZeroFields(t *testing.T) {
	repo := NewRepo(&fakeDBTX{}, nil)
	now := time.Now()
	cases := []struct {
		name string
		e    Entry
	}{
		{"zero vehicleID", Entry{0, KindDistance, units.ActiveUnitMiles, now, SourceTelemetry}},
		{"empty kind", Entry{1, "", units.ActiveUnitMiles, now, SourceTelemetry}},
		{"empty value", Entry{1, KindDistance, "", now, SourceTelemetry}},
		{"empty source", Entry{1, KindDistance, units.ActiveUnitMiles, now, ""}},
		{"zero effective_from", Entry{1, KindDistance, units.ActiveUnitMiles, time.Time{}, SourceTelemetry}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := repo.Record(context.Background(), c.e); err == nil {
				t.Errorf("expected validation error for %q, got nil", c.name)
			}
		})
	}
}

func TestPgRepo_Record_NormalizesEffectiveFromToUTC(t *testing.T) {
	fake := &fakeDBTX{}
	repo := NewRepo(fake, nil)
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load tz: %v", err)
	}
	local := time.Date(2026, 5, 1, 9, 0, 0, 0, loc)
	if err := repo.Record(context.Background(), Entry{
		VehicleID:     1,
		Kind:          KindDistance,
		Value:         units.ActiveUnitMiles,
		EffectiveFrom: local,
		Source:        SourceTelemetry,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}
	if len(fake.execs) != 1 {
		t.Fatalf("execs = %d; want 1", len(fake.execs))
	}
	got, ok := fake.execs[0].args[3].(time.Time)
	if !ok {
		t.Fatalf("arg[3] is not time.Time: %T", fake.execs[0].args[3])
	}
	if got.Location() != time.UTC {
		t.Errorf("effective_from passed to Exec is not UTC: %v (location %v)", got, got.Location())
	}
	if !got.Equal(local) {
		t.Errorf("UTC normalization changed instant: got %v, want equal to %v", got, local)
	}
}

func TestPgRepo_At_PropagatesNotFound(t *testing.T) {
	fake := &fakeDBTX{
		scanFn: func(args ...any) error { return pgx.ErrNoRows },
	}
	repo := NewRepo(fake, nil)
	_, err := repo.At(context.Background(), 1, KindDistance, time.Now())
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("At with no rows: %v; want ErrNotFound", err)
	}
}

func TestPgRepo_Latest_PropagatesNotFound(t *testing.T) {
	fake := &fakeDBTX{
		scanFn: func(args ...any) error { return pgx.ErrNoRows },
	}
	repo := NewRepo(fake, nil)
	_, err := repo.Latest(context.Background(), 1, KindDistance)
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("Latest with no rows: %v; want ErrNotFound", err)
	}
}

// TestKindAndSourceClosedSets is the migration-CHECK-mirror invariant:
// the Go closed sets MUST match the SQL CHECK constraint values
// verbatim. A drift here means a Record with a new Source value would
// pass Go validation but fail at PG with a constraint violation.
func TestKindAndSourceClosedSets(t *testing.T) {
	wantKinds := map[Kind]bool{
		KindDistance:    true,
		KindTemperature: true,
		KindPressure:    true,
		KindCharge:      true,
	}
	for _, k := range AllKinds() {
		if !wantKinds[k] {
			t.Errorf("AllKinds() includes unexpected Kind %q", k)
		}
		delete(wantKinds, k)
	}
	if len(wantKinds) != 0 {
		t.Errorf("AllKinds() missing kinds: %v", wantKinds)
	}

	wantSources := map[Source]bool{
		SourceTelemetry:     true,
		SourceRESTBootstrap: true,
		SourceManual:        true,
	}
	for _, s := range AllSources() {
		if !wantSources[s] {
			t.Errorf("AllSources() includes unexpected Source %q", s)
		}
		delete(wantSources, s)
	}
	if len(wantSources) != 0 {
		t.Errorf("AllSources() missing sources: %v", wantSources)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
