package chargeopt

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------- fake pgx plumbing (no pgxmock vendored) ----------

// fakeRows is a configurable pgx.Rows. It yields n rows; scan(i, dest)
// fills the destinations for row i. scanErr forces Scan to fail; errVal
// is returned by Err() to simulate a mid-stream iteration failure.
type fakeRows struct {
	n       int
	idx     int
	scan    func(i int, dest []any) error
	scanErr error
	errVal  error
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= r.n {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	return r.scan(r.idx-1, dest)
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errVal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

// fakeChargingPool records the SQL + args it was asked to run and returns
// the pre-loaded rows (or a query error).
type fakeChargingPool struct {
	rows     pgx.Rows
	queryErr error
	gotSQL   string
	gotArgs  []any
	calls    int
}

func (p *fakeChargingPool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.calls++
	p.gotSQL = sql
	p.gotArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

var _ chargingPool = (*fakeChargingPool)(nil)

// ---------- SQL shape ----------

func TestSessionsSelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM charging_sessions",
		"vehicle_id = $1",
		"ORDER BY started_at DESC",
		"cost_decimal",
		"total_energy_added_wh",
		"peak_power_w",
		"end_soc_pct",
		"start_soc_pct",
		"/ 1000.0", // Wh -> kWh and W -> kW conversions
		"COALESCE(",
	}
	for _, frag := range mustContain {
		if !strings.Contains(sessionsSelectSQL, frag) {
			t.Errorf("sessionsSelectSQL missing %q\nfull SQL:\n%s", frag, sessionsSelectSQL)
		}
	}
	// Phase-48 / mig 000184: charging columns are SI canonical. Legacy
	// display-unit column names must never reappear.
	mustNotContain := []string{
		"energy_used_kwh",
		"total_energy_added_kwh",
		"peak_power_kw",
		"ORDER BY started_at ASC", // newest-first contract
	}
	for _, frag := range mustNotContain {
		if strings.Contains(sessionsSelectSQL, frag) {
			t.Errorf("sessionsSelectSQL must not contain %q (SI drift / ordering regression)\nfull SQL:\n%s", frag, sessionsSelectSQL)
		}
	}
}

func TestLocationEnrichSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM charging_sessions cs",
		"signal_log",
		"field = 'Latitude'",
		"field = 'Longitude'",
		"field = 'OutsideTemp'",
		"LEFT JOIN LATERAL",
		"ORDER BY ts DESC LIMIT 1",
		"ts <= cs.started_at",
		"cs.vehicle_id = $1",
		"INTERVAL '90 days'",
		"COALESCE(float_value, int_value::float8)",
	}
	for _, frag := range mustContain {
		if !strings.Contains(locationEnrichSQL, frag) {
			t.Errorf("locationEnrichSQL missing %q\nfull SQL:\n%s", frag, locationEnrichSQL)
		}
	}
	// Snapshot tables must never back a "latest current value" read
	// (layered live-state contract). Enrichment reads history from
	// signal_log only.
	for _, frag := range []string{"FROM positions", "FROM climate_snapshots"} {
		if strings.Contains(locationEnrichSQL, frag) {
			t.Errorf("locationEnrichSQL must not read snapshot table %q\nfull SQL:\n%s", frag, locationEnrichSQL)
		}
	}
}

// ---------- construction ----------

func TestNewPgxOptimizerRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on nil pool")
		}
	}()
	_ = newPgxOptimizerRepo(nil)
}

// ---------- Sessions scan loop ----------

func TestPgxOptimizerRepo_Sessions_Success(t *testing.T) {
	t.Parallel()
	want := []sessionRow{
		{id: 1, startDate: at(2026, time.June, 7, 23), cost: 5, kwh: 10, power: 11, endBattery: 80, startBattery: 20},
		{id: 2, startDate: at(2026, time.June, 3, 8), cost: 3, kwh: 8, power: 150, endBattery: 95, startBattery: 30},
	}
	rows := &fakeRows{
		n: len(want),
		scan: func(i int, dest []any) error {
			r := want[i]
			*(dest[0].(*int64)) = r.id
			*(dest[1].(*time.Time)) = r.startDate
			*(dest[2].(*float64)) = r.cost
			*(dest[3].(*float64)) = r.kwh
			*(dest[4].(*float64)) = r.power
			*(dest[5].(*int)) = r.endBattery
			*(dest[6].(*int)) = r.startBattery
			return nil
		},
	}
	pool := &fakeChargingPool{rows: rows}
	repo := &pgxOptimizerRepo{pool: pool}

	got, err := repo.Sessions(context.Background(), 42)
	if err != nil {
		t.Fatalf("Sessions: unexpected err: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Sessions rows = %+v, want %+v", got, want)
	}
	if pool.gotSQL != sessionsSelectSQL {
		t.Errorf("Sessions used unexpected SQL:\n%s", pool.gotSQL)
	}
	if len(pool.gotArgs) != 1 || pool.gotArgs[0] != int64(42) {
		t.Errorf("Sessions args = %v, want [42]", pool.gotArgs)
	}
	if !rows.closed {
		t.Error("Sessions must Close() the rows")
	}
}

func TestPgxOptimizerRepo_Sessions_Empty(t *testing.T) {
	t.Parallel()
	pool := &fakeChargingPool{rows: &fakeRows{n: 0}}
	repo := &pgxOptimizerRepo{pool: pool}
	got, err := repo.Sessions(context.Background(), 42)
	if err != nil {
		t.Fatalf("Sessions: unexpected err: %v", err)
	}
	if got == nil {
		t.Fatal("Sessions returned nil, want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

func TestPgxOptimizerRepo_Sessions_Errors(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")

	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakeChargingPool{queryErr: sentinel}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.Sessions(context.Background(), 42)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "sessions query") {
			t.Errorf("err = %q, want context 'sessions query'", err.Error())
		}
	})

	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{n: 1, scanErr: sentinel}
		pool := &fakeChargingPool{rows: rows}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.Sessions(context.Background(), 42)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "row scan") {
			t.Errorf("err = %q, want context 'row scan'", err.Error())
		}
		if !rows.closed {
			t.Error("rows must be closed even on scan error")
		}
	})

	t.Run("rows_iter_error", func(t *testing.T) {
		t.Parallel()
		// One row scans fine, then Err() reports a mid-stream failure —
		// the pre-refactor handler ignored this and returned partial data.
		rows := &fakeRows{
			n:      1,
			errVal: sentinel,
			scan: func(_ int, dest []any) error {
				*(dest[0].(*int64)) = 1
				*(dest[1].(*time.Time)) = at(2026, time.June, 3, 8)
				*(dest[2].(*float64)) = 1
				*(dest[3].(*float64)) = 1
				*(dest[4].(*float64)) = 1
				*(dest[5].(*int)) = 1
				*(dest[6].(*int)) = 1
				return nil
			},
		}
		pool := &fakeChargingPool{rows: rows}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.Sessions(context.Background(), 42)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "rows iter") {
			t.Errorf("err = %q, want context 'rows iter'", err.Error())
		}
	})
}

// ---------- LocationEnrichment scan loop ----------

func TestPgxOptimizerRepo_LocationEnrichment_Success(t *testing.T) {
	t.Parallel()
	type row struct {
		id             int64
		lat, lon, temp *float64
	}
	rowsData := []row{
		{id: 1, lat: fptr(37.7749), lon: fptr(-122.4194), temp: fptr(18)},
		{id: 2, lat: nil, lon: nil, temp: fptr(20)}, // no coords, temp only
	}
	rows := &fakeRows{
		n: len(rowsData),
		scan: func(i int, dest []any) error {
			w := rowsData[i]
			*(dest[0].(*int64)) = w.id
			*(dest[1].(**float64)) = w.lat
			*(dest[2].(**float64)) = w.lon
			*(dest[3].(**float64)) = w.temp
			return nil
		},
	}
	pool := &fakeChargingPool{rows: rows}
	repo := &pgxOptimizerRepo{pool: pool}

	got, err := repo.LocationEnrichment(context.Background(), 7)
	if err != nil {
		t.Fatalf("LocationEnrichment: unexpected err: %v", err)
	}
	if pool.gotSQL != locationEnrichSQL {
		t.Errorf("used unexpected SQL:\n%s", pool.gotSQL)
	}
	if len(pool.gotArgs) != 1 || pool.gotArgs[0] != int64(7) {
		t.Errorf("args = %v, want [7]", pool.gotArgs)
	}
	if len(got) != 2 {
		t.Fatalf("len(map) = %d, want 2", len(got))
	}
	l1 := got[1]
	if l1.lat == nil || *l1.lat != 37.7749 || l1.lon == nil || *l1.lon != -122.4194 || l1.temp == nil || *l1.temp != 18 {
		t.Errorf("id 1 = %+v, want full lat/lon/temp", l1)
	}
	l2 := got[2]
	if l2.lat != nil || l2.lon != nil {
		t.Errorf("id 2 lat/lon = %v/%v, want nil (no coords)", l2.lat, l2.lon)
	}
	if l2.temp == nil || *l2.temp != 20 {
		t.Errorf("id 2 temp = %v, want 20", l2.temp)
	}
	if !rows.closed {
		t.Error("LocationEnrichment must Close() the rows")
	}
}

func TestPgxOptimizerRepo_LocationEnrichment_Errors(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("kaboom")

	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakeChargingPool{queryErr: sentinel}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.LocationEnrichment(context.Background(), 7)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "location query") {
			t.Errorf("err = %q, want context 'location query'", err.Error())
		}
	})

	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{n: 1, scanErr: sentinel}
		pool := &fakeChargingPool{rows: rows}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.LocationEnrichment(context.Background(), 7)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "location row scan") {
			t.Errorf("err = %q, want context 'location row scan'", err.Error())
		}
	})

	t.Run("rows_iter_error", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{
			n:      1,
			errVal: sentinel,
			scan: func(_ int, dest []any) error {
				*(dest[0].(*int64)) = 1
				*(dest[1].(**float64)) = nil
				*(dest[2].(**float64)) = nil
				*(dest[3].(**float64)) = nil
				return nil
			},
		}
		pool := &fakeChargingPool{rows: rows}
		repo := &pgxOptimizerRepo{pool: pool}
		_, err := repo.LocationEnrichment(context.Background(), 7)
		if !errors.Is(err, sentinel) {
			t.Fatalf("err = %v, want wrap of sentinel", err)
		}
		if !strings.Contains(err.Error(), "location rows iter") {
			t.Errorf("err = %q, want context 'location rows iter'", err.Error())
		}
	})
}
