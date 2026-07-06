package adminobssvc

// White-box tests for the admin-observability application service.
//
// The service is a thin orchestrator: for every subsystem it either
// returns ErrNotConfigured (nil receiver or nil backing repo), forwards
// the call to the backing port, or maps a subsystem-absence sentinel
// (pg_stat_statements / timescaledb missing) onto ErrNotConfigured. The
// tests exercise each of those branches with in-memory fakes for the
// four ports plus a driver-free schemacheck.Querier, so nothing here
// touches a live PostgreSQL, network, or the Tesla API. Everything runs
// clean under -race.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	"github.com/ev-dev-labs/teslasync/internal/rotation"
	"github.com/ev-dev-labs/teslasync/internal/schemacheck"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// Port fakes
// ---------------------------------------------------------------------------

// fakeSlowQueries records the arguments TopLive was called with and
// returns the canned out/err pair.
type fakeSlowQueries struct {
	out        []dbobs.SlowQuery
	err        error
	calls      int
	gotOrderBy dbobs.SlowQueryOrderBy
	gotLimit   int
}

func (f *fakeSlowQueries) TopLive(_ context.Context, orderBy dbobs.SlowQueryOrderBy, limit int) ([]dbobs.SlowQuery, error) {
	f.calls++
	f.gotOrderBy = orderBy
	f.gotLimit = limit
	return f.out, f.err
}

// fakeHypertable records the quota Forecast was called with.
type fakeHypertable struct {
	out      []dbobs.HypertableSize
	err      error
	calls    int
	gotQuota int64
}

func (f *fakeHypertable) Forecast(_ context.Context, quotaBytes int64) ([]dbobs.HypertableSize, error) {
	f.calls++
	f.gotQuota = quotaBytes
	return f.out, f.err
}

// fakeIngestXRay records the since/limit VehicleCostReport was called
// with — the since is what the since.IsZero() defaulting test asserts on.
type fakeIngestXRay struct {
	out      *dbobs.VehicleCostReport
	err      error
	calls    int
	gotSince time.Time
	gotLimit int
}

func (f *fakeIngestXRay) VehicleCostReport(_ context.Context, since time.Time, limit int) (*dbobs.VehicleCostReport, error) {
	f.calls++
	f.gotSince = since
	f.gotLimit = limit
	return f.out, f.err
}

// fakeRotation returns the canned status slice / error.
type fakeRotation struct {
	out   []rotation.Status
	err   error
	calls int
}

func (f *fakeRotation) Status(_ context.Context) ([]rotation.Status, error) {
	f.calls++
	return f.out, f.err
}

// ---------------------------------------------------------------------------
// schemacheck.Querier fake + driver-free pgx.Rows
// ---------------------------------------------------------------------------

// fakeQuerier is a FIFO schemacheck.Querier. schemacheck.Compute issues
// exactly three Query calls (tables, columns, indexes); each pops the
// next queued result. A queued error short-circuits Compute.
type fakeQuerier struct {
	results []querierResult
	calls   int
}

type querierResult struct {
	rows pgx.Rows
	err  error
}

func (q *fakeQuerier) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	q.calls++
	if len(q.results) == 0 {
		return &stringRows{}, nil
	}
	r := q.results[0]
	q.results = q.results[1:]
	if r.err != nil {
		return nil, r.err
	}
	if r.rows != nil {
		return r.rows, nil
	}
	return &stringRows{}, nil
}

// stringRows is a minimal pgx.Rows over a [][]string. Every scan
// destination must be a *string, which is exactly what schemacheck's
// three projections use.
type stringRows struct {
	data [][]string
	pos  int
	err  error
}

func (r *stringRows) Next() bool {
	if r.pos >= len(r.data) {
		return false
	}
	r.pos++
	return true
}

func (r *stringRows) Scan(dest ...any) error {
	if r.pos == 0 || r.pos > len(r.data) {
		return fmt.Errorf("stringRows: Scan out of range")
	}
	row := r.data[r.pos-1]
	if len(dest) != len(row) {
		return fmt.Errorf("stringRows: %d dest for %d columns", len(dest), len(row))
	}
	for i := range dest {
		p, ok := dest[i].(*string)
		if !ok {
			return fmt.Errorf("stringRows: dest[%d] is %T, want *string", i, dest[i])
		}
		*p = row[i]
	}
	return nil
}

func (r *stringRows) Close()                                       {}
func (r *stringRows) Err() error                                   { return r.err }
func (r *stringRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *stringRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *stringRows) Values() ([]any, error)                       { return nil, nil }
func (r *stringRows) RawValues() [][]byte                          { return nil }
func (r *stringRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*stringRows)(nil)

// schemaFixture returns a fakeQuerier pre-loaded with a small but
// realistic public schema. schema_migrations is included so a test can
// prove excludeTables filters it out of the fingerprint counts.
//
// After excluding schema_migrations: 2 tables, 2 columns, 1 index.
func schemaFixture() *fakeQuerier {
	return &fakeQuerier{results: []querierResult{
		{rows: &stringRows{data: [][]string{
			{"vehicles"}, {"trips"}, {"schema_migrations"},
		}}},
		{rows: &stringRows{data: [][]string{
			{"vehicles", "id", "bigint", "NO"},
			{"trips", "id", "bigint", "NO"},
			{"schema_migrations", "version", "bigint", "NO"},
		}}},
		{rows: &stringRows{data: [][]string{
			{"vehicles", "vehicles_pkey", "CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id)"},
		}}},
	}}
}

var excludeMigrations = []string{"schema_migrations"}

// ---------------------------------------------------------------------------
// New
// ---------------------------------------------------------------------------

func TestNew_Defaults(t *testing.T) {
	t.Run("quota defaults and now is set", func(t *testing.T) {
		tests := []struct {
			name      string
			inQuota   int64
			wantQuota int64
		}{
			{"zero quota uses default", 0, 100 * 1024 * 1024 * 1024},
			{"negative quota uses default", -1, 100 * 1024 * 1024 * 1024},
			{"positive quota preserved", 4096, 4096},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				s := New(Options{QuotaBytes: tc.inQuota})
				if s.quotaBytes != tc.wantQuota {
					t.Errorf("quotaBytes = %d, want %d", s.quotaBytes, tc.wantQuota)
				}
				if s.now == nil {
					t.Fatal("now must default to a non-nil clock")
				}
				if got := s.now(); time.Since(got) > time.Minute || time.Since(got) < -time.Minute {
					t.Errorf("default now() = %v, want ~time.Now()", got)
				}
			})
		}
	})

	t.Run("custom now is preserved", func(t *testing.T) {
		fixed := time.Date(2031, 3, 4, 5, 6, 7, 0, time.UTC)
		s := New(Options{Now: func() time.Time { return fixed }})
		if got := s.now(); !got.Equal(fixed) {
			t.Errorf("now() = %v, want %v", got, fixed)
		}
	})
}

// TestNew_NilReposLeaveNilInterfaces is the regression guard for the
// typed-nil-into-interface hazard: passing nil *Repo values must leave
// each port as a genuinely-nil interface so the methods still report
// ErrNotConfigured (rather than dereferencing a nil pointer or silently
// returning empty data).
func TestNew_NilReposLeaveNilInterfaces(t *testing.T) {
	s := New(Options{}) // every repo pointer is a nil *Repo

	if s.rotation != nil {
		t.Error("rotation port should be a nil interface when Rotation is nil")
	}
	if s.slowQueries != nil {
		t.Error("slowQueries port should be a nil interface when SlowQueries is nil")
	}
	if s.hypertable != nil {
		t.Error("hypertable port should be a nil interface when Hypertable is nil")
	}
	if s.ingestXRay != nil {
		t.Error("ingestXRay port should be a nil interface when IngestXRay is nil")
	}
	if s.schemaRepo != nil {
		t.Error("schemaRepo should be nil when SchemaPool is nil")
	}

	ctx := context.Background()
	if _, err := s.SlowQueries(ctx, OrderByMeanTime, 10); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("SlowQueries err = %v, want ErrNotConfigured", err)
	}
	if _, err := s.DiskForecast(ctx); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("DiskForecast err = %v, want ErrNotConfigured", err)
	}
	if _, err := s.VehicleCost(ctx, time.Time{}, 10); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("VehicleCost err = %v, want ErrNotConfigured", err)
	}
	if _, err := s.SecretRotation(ctx); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("SecretRotation err = %v, want ErrNotConfigured", err)
	}
	if _, err := s.SchemaDrift(ctx); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("SchemaDrift err = %v, want ErrNotConfigured", err)
	}
}

// TestNew_NonNilReposAreWired proves the constructor copies non-nil
// concrete repos into the interface fields.
func TestNew_NonNilReposAreWired(t *testing.T) {
	s := New(Options{
		Rotation:    &rotation.Tracker{},
		SchemaPool:  &fakeQuerier{},
		SlowQueries: &dbobs.SlowQueriesRepo{},
		Hypertable:  &dbobs.HypertableMetricsRepo{},
		IngestXRay:  &dbobs.IngestXRayRepo{},
	})
	if s.rotation == nil {
		t.Error("rotation port not wired")
	}
	if s.schemaRepo == nil {
		t.Error("schemaRepo not wired")
	}
	if s.slowQueries == nil {
		t.Error("slowQueries port not wired")
	}
	if s.hypertable == nil {
		t.Error("hypertable port not wired")
	}
	if s.ingestXRay == nil {
		t.Error("ingestXRay port not wired")
	}
}

// ---------------------------------------------------------------------------
// SchemaDrift
// ---------------------------------------------------------------------------

func TestService_SchemaDrift_NotConfigured(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name string
		svc  *Service
	}{
		{"nil receiver", nil},
		{"nil schemaRepo", &Service{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.svc.SchemaDrift(ctx)
			if !errors.Is(err, ErrNotConfigured) {
				t.Errorf("err = %v, want ErrNotConfigured", err)
			}
			if got != nil {
				t.Errorf("result = %+v, want nil", got)
			}
		})
	}
}

func TestService_SchemaDrift_ComputeError(t *testing.T) {
	boom := errors.New("connection reset")
	s := &Service{
		schemaRepo: &fakeQuerier{results: []querierResult{{err: boom}}},
	}
	got, err := s.SchemaDrift(context.Background())
	if got != nil {
		t.Errorf("result = %+v, want nil on error", got)
	}
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want it to wrap boom", err)
	}
	if err.Error() == "" || !strings.Contains(err.Error(), "compute current fingerprint") {
		t.Errorf("err = %q, want it to mention compute current fingerprint", err)
	}
}

func TestService_SchemaDrift_DriftDetected(t *testing.T) {
	// Seed deliberately mismatches the fixture so HasDrift is true and
	// the deltas are exercised.
	seed := schemacheck.Fingerprint{
		SHA256:      "0000000000000000000000000000000000000000000000000000000000000000",
		TableCount:  5,
		ColumnCount: 10,
		IndexCount:  4,
	}
	s := &Service{
		schemaRepo:    schemaFixture(),
		schemaSeed:    seed,
		excludeTables: excludeMigrations,
	}
	got, err := s.SchemaDrift(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !got.IsDifferent || !got.Drift.HasDrift {
		t.Errorf("IsDifferent=%v HasDrift=%v, want both true", got.IsDifferent, got.Drift.HasDrift)
	}
	// schema_migrations must be excluded from all three counts.
	if got.Drift.Current.TableCount != 2 {
		t.Errorf("current TableCount = %d, want 2 (schema_migrations excluded)", got.Drift.Current.TableCount)
	}
	if got.Drift.Current.ColumnCount != 2 {
		t.Errorf("current ColumnCount = %d, want 2 (schema_migrations column excluded)", got.Drift.Current.ColumnCount)
	}
	if got.Drift.Current.IndexCount != 1 {
		t.Errorf("current IndexCount = %d, want 1", got.Drift.Current.IndexCount)
	}
	if got.Drift.TableCountDelta != -3 {
		t.Errorf("TableCountDelta = %d, want -3", got.Drift.TableCountDelta)
	}
	if got.Drift.ColumnCountDelta != -8 {
		t.Errorf("ColumnCountDelta = %d, want -8", got.Drift.ColumnCountDelta)
	}
	if got.Drift.IndexCountDelta != -3 {
		t.Errorf("IndexCountDelta = %d, want -3", got.Drift.IndexCountDelta)
	}
}

func TestService_SchemaDrift_NoDrift(t *testing.T) {
	// Compute the seed from an identical fixture so the fingerprint
	// hashes match exactly and HasDrift is false.
	seed, err := schemacheck.Compute(context.Background(), schemaFixture(), excludeMigrations)
	if err != nil {
		t.Fatalf("precompute seed: %v", err)
	}
	s := &Service{
		schemaRepo:    schemaFixture(),
		schemaSeed:    seed,
		excludeTables: excludeMigrations,
	}
	got, err := s.SchemaDrift(context.Background())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got.IsDifferent || got.Drift.HasDrift {
		t.Errorf("IsDifferent=%v HasDrift=%v, want both false", got.IsDifferent, got.Drift.HasDrift)
	}
	if got.Drift.TableCountDelta != 0 || got.Drift.ColumnCountDelta != 0 || got.Drift.IndexCountDelta != 0 {
		t.Errorf("deltas = (%d,%d,%d), want all zero",
			got.Drift.TableCountDelta, got.Drift.ColumnCountDelta, got.Drift.IndexCountDelta)
	}
}

// ---------------------------------------------------------------------------
// SlowQueries
// ---------------------------------------------------------------------------

func TestService_SlowQueries(t *testing.T) {
	ctx := context.Background()
	rows := []dbobs.SlowQuery{{QueryID: 7, Fingerprint: "SELECT 1", Calls: 3}}
	boom := errors.New("syntax error")

	tests := []struct {
		name      string
		svc       *Service
		orderBy   dbobs.SlowQueryOrderBy
		limit     int
		wantErrIs error
	}{
		{
			name:      "nil receiver",
			svc:       nil,
			orderBy:   OrderByMeanTime,
			limit:     10,
			wantErrIs: ErrNotConfigured,
		},
		{
			name:      "nil repo",
			svc:       &Service{},
			orderBy:   OrderByMeanTime,
			limit:     10,
			wantErrIs: ErrNotConfigured,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.svc.SlowQueries(ctx, tc.orderBy, tc.limit)
			if !errors.Is(err, tc.wantErrIs) {
				t.Fatalf("err = %v, want Is %v", err, tc.wantErrIs)
			}
			if got != nil {
				t.Errorf("rows = %+v, want nil", got)
			}
		})
	}

	t.Run("success forwards order_by and limit", func(t *testing.T) {
		fake := &fakeSlowQueries{out: rows}
		s := &Service{slowQueries: fake}
		got, err := s.SlowQueries(ctx, OrderByCallCount, 42)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].QueryID != 7 {
			t.Errorf("rows = %+v, want the canned row", got)
		}
		if fake.gotOrderBy != OrderByCallCount || fake.gotLimit != 42 {
			t.Errorf("forwarded (order_by=%q, limit=%d), want (%q, 42)", fake.gotOrderBy, fake.gotLimit, OrderByCallCount)
		}
	})

	t.Run("pg_stat_statements unavailable maps to ErrNotConfigured", func(t *testing.T) {
		s := &Service{slowQueries: &fakeSlowQueries{err: dbobs.ErrPgStatStatementsUnavailable}}
		got, err := s.SlowQueries(ctx, OrderByMeanTime, 10)
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("err = %v, want ErrNotConfigured", err)
		}
		if got != nil {
			t.Errorf("rows = %+v, want nil", got)
		}
	})

	t.Run("wrapped pg_stat_statements sentinel still maps", func(t *testing.T) {
		wrapped := fmt.Errorf("repo layer: %w", dbobs.ErrPgStatStatementsUnavailable)
		s := &Service{slowQueries: &fakeSlowQueries{err: wrapped}}
		if _, err := s.SlowQueries(ctx, OrderByMeanTime, 10); !errors.Is(err, ErrNotConfigured) {
			t.Errorf("err = %v, want ErrNotConfigured", err)
		}
	})

	t.Run("generic error is passed through untouched", func(t *testing.T) {
		s := &Service{slowQueries: &fakeSlowQueries{err: boom}}
		got, err := s.SlowQueries(ctx, OrderByMeanTime, 10)
		if !errors.Is(err, boom) {
			t.Errorf("err = %v, want boom", err)
		}
		if errors.Is(err, ErrNotConfigured) {
			t.Error("generic error must not be mapped to ErrNotConfigured")
		}
		if got != nil {
			t.Errorf("rows = %+v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// VehicleCost
// ---------------------------------------------------------------------------

func TestService_VehicleCost(t *testing.T) {
	ctx := context.Background()
	fixedNow := time.Date(2031, 1, 15, 12, 0, 0, 0, time.UTC)
	report := &dbobs.VehicleCostReport{
		Vehicles: []dbobs.VehicleCostRow{{VehicleID: 1, SignalRowCount: 100}},
		Totals:   dbobs.VehicleCostTotals{TotalRows: 100},
	}

	t.Run("not configured", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			svc  *Service
		}{
			{"nil receiver", nil},
			{"nil repo", &Service{now: time.Now}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				got, err := tc.svc.VehicleCost(ctx, time.Time{}, 10)
				if !errors.Is(err, ErrNotConfigured) {
					t.Errorf("err = %v, want ErrNotConfigured", err)
				}
				if got != nil {
					t.Errorf("report = %+v, want nil", got)
				}
			})
		}
	})

	t.Run("zero since defaults to now minus 30 days", func(t *testing.T) {
		fake := &fakeIngestXRay{out: report}
		s := &Service{now: func() time.Time { return fixedNow }, ingestXRay: fake}
		got, err := s.VehicleCost(ctx, time.Time{}, 25)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got != report {
			t.Errorf("report = %+v, want the canned report", got)
		}
		wantSince := fixedNow.Add(-30 * 24 * time.Hour)
		if !fake.gotSince.Equal(wantSince) {
			t.Errorf("since = %v, want %v", fake.gotSince, wantSince)
		}
		if fake.gotLimit != 25 {
			t.Errorf("limit = %d, want 25", fake.gotLimit)
		}
	})

	t.Run("explicit since is forwarded unchanged", func(t *testing.T) {
		fake := &fakeIngestXRay{out: report}
		s := &Service{now: func() time.Time { return fixedNow }, ingestXRay: fake}
		since := time.Date(2030, 6, 1, 0, 0, 0, 0, time.UTC)
		if _, err := s.VehicleCost(ctx, since, 5); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !fake.gotSince.Equal(since) {
			t.Errorf("since = %v, want %v (must not be defaulted)", fake.gotSince, since)
		}
	})

	t.Run("repo error is propagated", func(t *testing.T) {
		boom := errors.New("query timeout")
		fake := &fakeIngestXRay{err: boom}
		s := &Service{now: func() time.Time { return fixedNow }, ingestXRay: fake}
		got, err := s.VehicleCost(ctx, time.Now(), 10)
		if !errors.Is(err, boom) {
			t.Errorf("err = %v, want boom", err)
		}
		if got != nil {
			t.Errorf("report = %+v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// DiskForecast
// ---------------------------------------------------------------------------

func TestService_DiskForecast(t *testing.T) {
	ctx := context.Background()
	sizes := []dbobs.HypertableSize{{HypertableName: "signal_log", TotalBytes: 2048, Severity: "ok"}}

	t.Run("not configured", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			svc  *Service
		}{
			{"nil receiver", nil},
			{"nil repo", &Service{}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				got, err := tc.svc.DiskForecast(ctx)
				if !errors.Is(err, ErrNotConfigured) {
					t.Errorf("err = %v, want ErrNotConfigured", err)
				}
				if got != nil {
					t.Errorf("sizes = %+v, want nil", got)
				}
			})
		}
	})

	t.Run("success forwards the configured quota", func(t *testing.T) {
		fake := &fakeHypertable{out: sizes}
		s := &Service{hypertable: fake, quotaBytes: 9999}
		got, err := s.DiskForecast(ctx)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].HypertableName != "signal_log" {
			t.Errorf("sizes = %+v, want the canned size", got)
		}
		if fake.gotQuota != 9999 {
			t.Errorf("forwarded quota = %d, want 9999", fake.gotQuota)
		}
	})

	t.Run("timescale unavailable maps to ErrNotConfigured", func(t *testing.T) {
		s := &Service{hypertable: &fakeHypertable{err: dbobs.ErrTimescaleUnavailable}}
		got, err := s.DiskForecast(ctx)
		if !errors.Is(err, ErrNotConfigured) {
			t.Errorf("err = %v, want ErrNotConfigured", err)
		}
		if got != nil {
			t.Errorf("sizes = %+v, want nil", got)
		}
	})

	t.Run("wrapped timescale sentinel still maps", func(t *testing.T) {
		wrapped := fmt.Errorf("forecast: %w", dbobs.ErrTimescaleUnavailable)
		s := &Service{hypertable: &fakeHypertable{err: wrapped}}
		if _, err := s.DiskForecast(ctx); !errors.Is(err, ErrNotConfigured) {
			t.Errorf("err = %v, want ErrNotConfigured", err)
		}
	})

	t.Run("generic error is passed through untouched", func(t *testing.T) {
		boom := errors.New("disk read failed")
		s := &Service{hypertable: &fakeHypertable{err: boom}}
		got, err := s.DiskForecast(ctx)
		if !errors.Is(err, boom) {
			t.Errorf("err = %v, want boom", err)
		}
		if errors.Is(err, ErrNotConfigured) {
			t.Error("generic error must not be mapped to ErrNotConfigured")
		}
		if got != nil {
			t.Errorf("sizes = %+v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// SecretRotation
// ---------------------------------------------------------------------------

func TestService_SecretRotation(t *testing.T) {
	ctx := context.Background()
	statuses := []rotation.Status{{Kind: rotation.KindMQTTMTLSCert, Severity: rotation.SeverityWarn}}

	t.Run("not configured", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			svc  *Service
		}{
			{"nil receiver", nil},
			{"nil repo", &Service{}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				got, err := tc.svc.SecretRotation(ctx)
				if !errors.Is(err, ErrNotConfigured) {
					t.Errorf("err = %v, want ErrNotConfigured", err)
				}
				if got != nil {
					t.Errorf("statuses = %+v, want nil", got)
				}
			})
		}
	})

	t.Run("success returns the tracker statuses", func(t *testing.T) {
		fake := &fakeRotation{out: statuses}
		s := &Service{rotation: fake}
		got, err := s.SecretRotation(ctx)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].Kind != rotation.KindMQTTMTLSCert {
			t.Errorf("statuses = %+v, want the canned status", got)
		}
		if fake.calls != 1 {
			t.Errorf("Status called %d times, want 1", fake.calls)
		}
	})

	t.Run("error is propagated", func(t *testing.T) {
		boom := errors.New("rotation query failed")
		s := &Service{rotation: &fakeRotation{err: boom}}
		got, err := s.SecretRotation(ctx)
		if !errors.Is(err, boom) {
			t.Errorf("err = %v, want boom", err)
		}
		if got != nil {
			t.Errorf("statuses = %+v, want nil", got)
		}
	})
}
