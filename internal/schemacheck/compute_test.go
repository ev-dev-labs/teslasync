package schemacheck

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeRows struct {
	data    [][]any
	idx     int
	scanErr error
	iterErr error
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	row := r.data[r.idx-1]
	if len(dest) != len(row) {
		return fmt.Errorf("scan dest %d row %d", len(dest), len(row))
	}
	for i := range dest {
		switch d := dest[i].(type) {
		case *string:
			*d = row[i].(string)
		default:
			return fmt.Errorf("unsupported dest %T", dest[i])
		}
	}
	return nil
}

func (r *fakeRows) Close()                        {}
func (r *fakeRows) Err() error                    { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}
func (r *fakeRows) Values() ([]any, error) { return nil, nil }
func (r *fakeRows) RawValues() [][]byte    { return nil }
func (r *fakeRows) Conn() *pgx.Conn        { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

type scriptedQuerier struct {
	tables, columns, indexes pgx.Rows
	tableErr, colErr, idxErr error
}

func (q *scriptedQuerier) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	switch {
	case strings.Contains(sql, "information_schema.tables"):
		if q.tableErr != nil {
			return nil, q.tableErr
		}
		return q.tables, nil
	case strings.Contains(sql, "information_schema.columns"):
		if q.colErr != nil {
			return nil, q.colErr
		}
		return q.columns, nil
	case strings.Contains(sql, "pg_indexes"):
		if q.idxErr != nil {
			return nil, q.idxErr
		}
		return q.indexes, nil
	default:
		return nil, fmt.Errorf("unexpected sql: %s", sql)
	}
}

func TestCompute_FingerprintAndExclude(t *testing.T) {
	t.Parallel()
	q := &scriptedQuerier{
		tables: &fakeRows{data: [][]any{{"vehicles"}, {"schema_migrations"}}},
		columns: &fakeRows{data: [][]any{
			{"vehicles", "id", "bigint", "NO"},
			{"schema_migrations", "version", "bigint", "NO"},
		}},
		indexes: &fakeRows{data: [][]any{
			{"vehicles", "vehicles_pkey", "CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id)"},
			{"schema_migrations", "schema_migrations_pkey", "CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version)"},
		}},
	}
	fp, err := Compute(context.Background(), q, []string{"schema_migrations"})
	if err != nil {
		t.Fatalf("Compute: %v", err)
	}
	if fp.TableCount != 1 || fp.ColumnCount != 1 || fp.IndexCount != 1 {
		t.Fatalf("counts tables=%d cols=%d idx=%d", fp.TableCount, fp.ColumnCount, fp.IndexCount)
	}
	if fp.SHA256 == "" {
		t.Fatal("empty sha")
	}

	// Same inputs without exclude must produce a different fingerprint.
	q2 := &scriptedQuerier{
		tables: &fakeRows{data: [][]any{{"vehicles"}, {"schema_migrations"}}},
		columns: &fakeRows{data: [][]any{
			{"vehicles", "id", "bigint", "NO"},
			{"schema_migrations", "version", "bigint", "NO"},
		}},
		indexes: &fakeRows{data: [][]any{
			{"vehicles", "vehicles_pkey", "CREATE UNIQUE INDEX vehicles_pkey ON public.vehicles USING btree (id)"},
			{"schema_migrations", "schema_migrations_pkey", "CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version)"},
		}},
	}
	fp2, err := Compute(context.Background(), q2, nil)
	if err != nil {
		t.Fatalf("Compute no exclude: %v", err)
	}
	if fp2.SHA256 == fp.SHA256 {
		t.Fatal("exclude must change fingerprint")
	}
	if fp2.TableCount != 2 || fp2.ColumnCount != 2 || fp2.IndexCount != 2 {
		t.Fatalf("unfiltered counts tables=%d cols=%d idx=%d", fp2.TableCount, fp2.ColumnCount, fp2.IndexCount)
	}
}

func TestCompute_QueryErrors(t *testing.T) {
	t.Parallel()
	boom := errors.New("db down")
	if _, err := Compute(context.Background(), &scriptedQuerier{tableErr: boom}, nil); err == nil || !strings.Contains(err.Error(), "list tables") {
		t.Fatalf("tables err=%v", err)
	}
	if _, err := Compute(context.Background(), &scriptedQuerier{
		tables: &fakeRows{},
		colErr: boom,
	}, nil); err == nil || !strings.Contains(err.Error(), "list columns") {
		t.Fatalf("columns err=%v", err)
	}
	if _, err := Compute(context.Background(), &scriptedQuerier{
		tables:  &fakeRows{},
		columns: &fakeRows{},
		idxErr:  boom,
	}, nil); err == nil || !strings.Contains(err.Error(), "list indexes") {
		t.Fatalf("indexes err=%v", err)
	}
}

func TestCompute_ScanAndIterErrors(t *testing.T) {
	t.Parallel()
	if _, err := Compute(context.Background(), &scriptedQuerier{
		tables: &fakeRows{data: [][]any{{"vehicles"}}, scanErr: errors.New("scan tables")},
	}, nil); err == nil {
		t.Fatal("want table scan error")
	}
	if _, err := Compute(context.Background(), &scriptedQuerier{
		tables:  &fakeRows{data: [][]any{{"vehicles"}}},
		columns: &fakeRows{data: [][]any{{"vehicles", "id", "bigint", "NO"}}, scanErr: errors.New("scan cols")},
	}, nil); err == nil {
		t.Fatal("want column scan error")
	}
	if _, err := Compute(context.Background(), &scriptedQuerier{
		tables:  &fakeRows{data: [][]any{{"vehicles"}}},
		columns: &fakeRows{data: [][]any{{"vehicles", "id", "bigint", "NO"}}},
		indexes: &fakeRows{data: [][]any{{"vehicles", "idx", "CREATE INDEX"}}, scanErr: errors.New("scan idx")},
	}, nil); err == nil {
		t.Fatal("want index scan error")
	}
}

func TestNormaliseIndexDef(t *testing.T) {
	t.Parallel()
	got := normaliseIndexDef("  CREATE   UNIQUE  INDEX  Foo ")
	if got != "create unique index foo" {
		t.Fatalf("got %q", got)
	}
}
