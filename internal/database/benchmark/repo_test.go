package benchmark

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeRow func(...any) error

func (f fakeRow) Scan(dest ...any) error { return f(dest...) }

type fakeDBTX struct {
	row       pgx.Row
	rows      pgx.Rows
	querySQL  string
	queryArgs []any
	rowSQL    string
	rowArgs   []any
}

func (f *fakeDBTX) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (f *fakeDBTX) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.querySQL, f.queryArgs = sql, args
	return f.rows, nil
}
func (f *fakeDBTX) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.rowSQL, f.rowArgs = sql, args
	return f.row
}

type oneCandidateRows struct {
	next   bool
	closed bool
	err    error
}

func (r *oneCandidateRows) Close()                                       { r.closed = true }
func (r *oneCandidateRows) Err() error                                   { return r.err }
func (r *oneCandidateRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *oneCandidateRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *oneCandidateRows) Next() bool {
	if r.next {
		return false
	}
	r.next = true
	return true
}
func (r *oneCandidateRows) Scan(dest ...any) error {
	if len(dest) != 5 {
		return errors.New("unexpected destination count")
	}
	*dest[0].(*int64) = 11
	*dest[1].(*int64) = 22
	*dest[2].(*float64) = 4
	model := "Model Y"
	*dest[3].(**string) = &model
	*dest[4].(*string) = "5YJYGDEE0P0000001"
	return nil
}
func (r *oneCandidateRows) Values() ([]any, error) { return nil, nil }
func (r *oneCandidateRows) RawValues() [][]byte    { return nil }
func (r *oneCandidateRows) Conn() *pgx.Conn        { return nil }

func TestListActiveCandidatesClosesRowsAndUsesBoundedQuery(t *testing.T) {
	rows := &oneCandidateRows{}
	db := &fakeDBTX{rows: rows}
	repo := &Repo{q: db}
	got, err := repo.ListActiveCandidates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !rows.closed {
		t.Fatal("rows were not closed")
	}
	if len(got) != 1 || got[0].ConsentID != 11 || got[0].VehicleID != 22 {
		t.Fatalf("unexpected candidates: %+v", got)
	}
	if !strings.Contains(db.querySQL, "LIMIT $1") {
		t.Fatalf("candidate query is not parameterized/bounded: %s", db.querySQL)
	}
	if len(db.queryArgs) != 1 || db.queryArgs[0] != 1000 {
		t.Fatalf("candidate query args=%v want [1000]", db.queryArgs)
	}
}

func TestDeriveSourceAggregatesUsesOnlyAggregateArguments(t *testing.T) {
	db := &fakeDBTX{row: fakeRow(func(dest ...any) error {
		*dest[0].(*int) = 4
		early, recent := 75_000.0, 73_000.0
		*dest[1].(**float64) = &early
		*dest[2].(**float64) = &recent
		for _, index := range []int{3, 6, 7, 8, 9, 10, 11} {
			*dest[index].(*int) = 5
		}
		energy, distance := 20_000.0, 100_000.0
		*dest[4].(**float64) = &energy
		*dest[5].(**float64) = &distance
		return nil
	})}
	repo := &Repo{q: db}
	start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	got, err := repo.DeriveSourceAggregates(context.Background(), 42, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if got.CapacitySampleCount != 4 || got.DriveSampleCount != 5 {
		t.Fatalf("unexpected aggregate projection: %+v", got)
	}
	if len(db.rowArgs) != 3 || db.rowArgs[0] != int64(42) {
		t.Fatalf("query args=%v want vehicle/start/end", db.rowArgs)
	}
	for _, token := range []string{"FROM drives", "FROM charging_sessions", "FROM notifications", "FROM command_executions"} {
		if !strings.Contains(db.rowSQL, token) {
			t.Fatalf("aggregate query missing canonical source %q", token)
		}
	}
	if strings.Contains(strings.ToLower(db.rowSQL), "select *") {
		t.Fatal("aggregate query uses SELECT *")
	}
}
