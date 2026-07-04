package audit

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------- constructor ----------

func TestNewAuditLogQueryRepo(t *testing.T) {
	t.Parallel()
	if r := NewAuditLogQueryRepo(nil); r != nil {
		t.Error("nil db should yield a nil repo")
	}
	if r := NewAuditLogQueryRepo(&database.DB{}); r != nil {
		t.Error("nil pool should yield a nil repo")
	}
	r := NewAuditLogQueryRepo(&database.DB{Pool: &pgxpool.Pool{}})
	if r == nil || r.exec == nil {
		t.Fatal("db with pool should yield a wired repo")
	}
}

// runList executes List against a recording fake and returns the single
// captured Query call for SQL/arg assertions.
func runList(t *testing.T, q AuditLogQuery) dbCall {
	t.Helper()
	f := &fakeDBTX{}
	r := &AuditLogQueryRepo{exec: f}
	if _, err := r.List(context.Background(), q); err != nil {
		t.Fatalf("List: unexpected err: %v", err)
	}
	if len(f.queryCalls) != 1 {
		t.Fatalf("want exactly 1 Query, got %d", len(f.queryCalls))
	}
	return f.queryCalls[0]
}

// ---------- List guards + clamping ----------

func TestList_NilRepo(t *testing.T) {
	t.Parallel()
	var r *AuditLogQueryRepo
	got, err := r.List(context.Background(), AuditLogQuery{})
	if err != nil || got != nil {
		t.Errorf("nil repo List = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestList_LimitOffsetClamp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                  string
		limit, offset         int
		wantLimit, wantOffset int
	}{
		{"zero limit → 100", 0, 0, 100, 0},
		{"negative limit → 100", -7, 0, 100, 0},
		{"over max limit → 100", 1001, 0, 100, 0},
		{"boundary 1000 kept", 1000, 0, 1000, 0},
		{"negative offset → 0", 50, -3, 50, 0},
		{"valid pass-through", 50, 25, 50, 25},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := runList(t, AuditLogQuery{Limit: tt.limit, Offset: tt.offset})
			// With no filters, args are exactly [limit, offset].
			if len(c.Args) != 2 {
				t.Fatalf("want 2 args, got %d: %v", len(c.Args), c.Args)
			}
			if c.Args[0] != tt.wantLimit {
				t.Errorf("limit arg = %v, want %d", c.Args[0], tt.wantLimit)
			}
			if c.Args[1] != tt.wantOffset {
				t.Errorf("offset arg = %v, want %d", c.Args[1], tt.wantOffset)
			}
		})
	}
}

// ---------- List dynamic WHERE assembly + placeholder renumbering ----------

func TestList_WhereAssembly(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	until := time.Date(2026, 7, 4, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name            string
		q               AuditLogQuery
		wantContains    []string
		wantNotContains []string
		wantArgsLen     int
	}{
		{
			name:            "no filters",
			q:               AuditLogQuery{},
			wantContains:    []string{"FROM audit_logs", "ORDER BY ts DESC, id DESC", "LIMIT $1 OFFSET $2"},
			wantNotContains: []string{"WHERE"},
			wantArgsLen:     2,
		},
		{
			name:         "since only",
			q:            AuditLogQuery{Since: since},
			wantContains: []string{"WHERE ts >= $1", "LIMIT $2 OFFSET $3"},
			wantArgsLen:  3,
		},
		{
			name:         "until only",
			q:            AuditLogQuery{Until: until},
			wantContains: []string{"WHERE ts < $1", "LIMIT $2 OFFSET $3"},
			wantArgsLen:  3,
		},
		{
			name:         "categories only",
			q:            AuditLogQuery{Categories: []string{"auth", "admin"}},
			wantContains: []string{"WHERE category = ANY($1::text[])", "LIMIT $2 OFFSET $3"},
			wantArgsLen:  3,
		},
		{
			name:         "actors only",
			q:            AuditLogQuery{Actors: []string{"alice"}},
			wantContains: []string{"WHERE actor = ANY($1::text[])"},
			wantArgsLen:  3,
		},
		{
			name:         "actions only",
			q:            AuditLogQuery{Actions: []string{"masked_reveal"}},
			wantContains: []string{"WHERE action = ANY($1::text[])"},
			wantArgsLen:  3,
		},
		{
			name:         "entity_type only",
			q:            AuditLogQuery{EntityType: "drive"},
			wantContains: []string{"WHERE entity_type = $1"},
			wantArgsLen:  3,
		},
		{
			name:         "entity_id only",
			q:            AuditLogQuery{EntityID: ptr(int64(99))},
			wantContains: []string{"WHERE entity_id = $1"},
			wantArgsLen:  3,
		},
		{
			name: "all filters — sequential placeholders",
			q: AuditLogQuery{
				Since:      since,
				Until:      until,
				Categories: []string{"auth"},
				Actors:     []string{"alice"},
				Actions:    []string{"masked_reveal"},
				EntityType: "drive",
				EntityID:   ptr(int64(7)),
			},
			wantContains: []string{
				"WHERE ts >= $1",
				"AND ts < $2",
				"AND category = ANY($3::text[])",
				"AND actor = ANY($4::text[])",
				"AND action = ANY($5::text[])",
				"AND entity_type = $6",
				"AND entity_id = $7",
				"LIMIT $8 OFFSET $9",
			},
			wantArgsLen: 9,
		},
		{
			name: "partial filters renumber correctly",
			q:    AuditLogQuery{Until: until, EntityID: ptr(int64(3))},
			wantContains: []string{
				"WHERE ts < $1",
				"AND entity_id = $2",
				"LIMIT $3 OFFSET $4",
			},
			wantArgsLen: 4,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := runList(t, tt.q)
			for _, frag := range tt.wantContains {
				if !strings.Contains(c.SQL, frag) {
					t.Errorf("SQL missing %q\n%s", frag, c.SQL)
				}
			}
			for _, frag := range tt.wantNotContains {
				if strings.Contains(c.SQL, frag) {
					t.Errorf("SQL must not contain %q\n%s", frag, c.SQL)
				}
			}
			if len(c.Args) != tt.wantArgsLen {
				t.Errorf("args len = %d, want %d: %v", len(c.Args), tt.wantArgsLen, c.Args)
			}
			// Last two args are always Limit then Offset.
			if c.Args[len(c.Args)-2] != 100 {
				t.Errorf("penultimate arg (limit) = %v, want 100", c.Args[len(c.Args)-2])
			}
			if c.Args[len(c.Args)-1] != 0 {
				t.Errorf("last arg (offset) = %v, want 0", c.Args[len(c.Args)-1])
			}
		})
	}
}

func TestList_WhereArgValues(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	c := runList(t, AuditLogQuery{
		Since:      since,
		Categories: []string{"auth", "admin"},
		EntityID:   ptr(int64(42)),
		Limit:      10,
		Offset:     5,
	})
	if len(c.Args) != 5 {
		t.Fatalf("want 5 args, got %d: %v", len(c.Args), c.Args)
	}
	if ts, ok := c.Args[0].(time.Time); !ok || !ts.Equal(since) {
		t.Errorf("args[0] since = %v", c.Args[0])
	}
	if cats, ok := c.Args[1].([]string); !ok || !reflect.DeepEqual(cats, []string{"auth", "admin"}) {
		t.Errorf("args[1] categories = %v", c.Args[1])
	}
	if c.Args[2] != int64(42) {
		t.Errorf("args[2] entity_id = %v, want int64(42)", c.Args[2])
	}
	if c.Args[3] != 10 || c.Args[4] != 5 {
		t.Errorf("args[3,4] limit/offset = %v/%v, want 10/5", c.Args[3], c.Args[4])
	}
}

// ---------- List scan mapping + errors ----------

// listRow is the full 16-value projection List scans, in column order.
func listRow(
	id int64, ts time.Time, actor string, category *string, action, entityType string,
	entityID *int64, detail, ip, ua *string, before, after []byte,
	traceID, prevHash, rowHash *string, success *bool,
) func(dest ...any) error {
	return scanRow(id, ts, actor, category, action, entityType, entityID, detail, ip, ua,
		before, after, traceID, prevHash, rowHash, success)
}

func TestList_ScanMapping(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 4, 8, 0, 0, 0, time.UTC)
	f := &fakeDBTX{queryRows: rowsFrom(
		listRow(2, ts, "alice", ptr("auth"), "masked_reveal", "token",
			ptr(int64(5)), ptr("detail-a"), ptr("1.2.3.4"), ptr("curl"),
			[]byte(`{"b":1}`), []byte(`{"a":2}`), ptr("trace-a"), ptr("h0"), ptr("h1"), ptr(true)),
		listRow(1, ts, "bob", nil, "login", "session",
			nil, nil, nil, nil, nil, nil, nil, nil, nil, nil),
	)}
	r := &AuditLogQueryRepo{exec: f}
	got, err := r.List(context.Background(), AuditLogQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 rows, got %d", len(got))
	}
	row0 := got[0]
	if row0.ID != 2 || row0.Actor != "alice" || row0.Action != "masked_reveal" || row0.EntityType != "token" {
		t.Errorf("row0 core fields wrong: %+v", row0)
	}
	if !row0.Ts.Equal(ts) {
		t.Errorf("row0 ts = %v", row0.Ts)
	}
	if row0.Category == nil || *row0.Category != "auth" {
		t.Errorf("row0 category = %v", row0.Category)
	}
	if row0.EntityID == nil || *row0.EntityID != 5 {
		t.Errorf("row0 entity_id = %v", row0.EntityID)
	}
	if row0.Detail == nil || *row0.Detail != "detail-a" {
		t.Errorf("row0 detail = %v", row0.Detail)
	}
	if row0.IP == nil || *row0.IP != "1.2.3.4" || row0.UserAgent == nil || *row0.UserAgent != "curl" {
		t.Errorf("row0 ip/ua = %v/%v", row0.IP, row0.UserAgent)
	}
	if string(row0.Before) != `{"b":1}` || string(row0.After) != `{"a":2}` {
		t.Errorf("row0 before/after = %s/%s", row0.Before, row0.After)
	}
	if row0.TraceID == nil || row0.PrevRowHash == nil || row0.RowHash == nil {
		t.Errorf("row0 trace/hash pointers should be set: %+v", row0)
	}
	if row0.Success == nil || *row0.Success != true {
		t.Errorf("row0 success = %v", row0.Success)
	}
	// Row 1: all nullable columns NULL.
	row1 := got[1]
	if row1.Category != nil || row1.EntityID != nil || row1.Detail != nil || row1.IP != nil ||
		row1.UserAgent != nil || row1.TraceID != nil || row1.PrevRowHash != nil ||
		row1.RowHash != nil || row1.Success != nil {
		t.Errorf("row1 nullable fields should be nil: %+v", row1)
	}
	if row1.Before != nil || row1.After != nil {
		t.Errorf("row1 before/after should be nil: %v/%v", row1.Before, row1.After)
	}
}

func TestList_EmptyResult(t *testing.T) {
	t.Parallel()
	r := &AuditLogQueryRepo{exec: &fakeDBTX{}} // default → zero rows
	got, err := r.List(context.Background(), AuditLogQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Error("want non-nil empty slice (JSON [] not null)")
	}
	if len(got) != 0 {
		t.Errorf("want 0 rows, got %d", len(got))
	}
}

func TestList_QueryError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("query fail")
	r := &AuditLogQueryRepo{exec: &fakeDBTX{queryErr: sentinel}}
	_, err := r.List(context.Background(), AuditLogQuery{})
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "audit_log_query: list") {
		t.Errorf("got %v", err)
	}
}

func TestList_ScanError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("scan fail")
	r := &AuditLogQueryRepo{exec: &fakeDBTX{queryRows: rowsFrom(func(dest ...any) error { return sentinel })}}
	_, err := r.List(context.Background(), AuditLogQuery{})
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "audit_log_query: scan") {
		t.Errorf("got %v", err)
	}
}

func TestList_RowsErr(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("iterate fail")
	rows := rowsFrom() // zero rows, but Err() surfaces the failure
	rows.err = sentinel
	r := &AuditLogQueryRepo{exec: &fakeDBTX{queryRows: rows}}
	got, err := r.List(context.Background(), AuditLogQuery{})
	if !errors.Is(err, sentinel) {
		t.Errorf("want rows.Err() surfaced, got %v", err)
	}
	if got == nil {
		t.Error("out slice should still be non-nil even when rows.Err() fails")
	}
}

// ---------- DistinctCategories ----------

func TestDistinctCategories_NilRepo(t *testing.T) {
	t.Parallel()
	var r *AuditLogQueryRepo
	got, err := r.DistinctCategories(context.Background())
	if err != nil || got != nil {
		t.Errorf("nil repo = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestDistinctCategories_HappyPath(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{queryRows: rowsFrom(scanRow("admin"), scanRow("auth"))}
	r := &AuditLogQueryRepo{exec: f}
	got, err := r.DistinctCategories(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"admin", "auth"}) {
		t.Errorf("got %v", got)
	}
	c := f.queryCalls[0]
	for _, frag := range []string{"SELECT DISTINCT category", "category IS NOT NULL", "ORDER BY category", "LIMIT 100"} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
}

func TestDistinctCategories_QueryError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("q fail")
	r := &AuditLogQueryRepo{exec: &fakeDBTX{queryErr: sentinel}}
	_, err := r.DistinctCategories(context.Background())
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "distinct categories") {
		t.Errorf("got %v", err)
	}
}

// ---------- DistinctActions ----------

func TestDistinctActions_NilRepo(t *testing.T) {
	t.Parallel()
	var r *AuditLogQueryRepo
	got, err := r.DistinctActions(context.Background())
	if err != nil || got != nil {
		t.Errorf("nil repo = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestDistinctActions_HappyPath(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{queryRows: rowsFrom(scanRow("masked_reveal"), scanRow("login"))}
	r := &AuditLogQueryRepo{exec: f}
	got, err := r.DistinctActions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"masked_reveal", "login"}) {
		t.Errorf("got %v", got)
	}
	c := f.queryCalls[0]
	for _, frag := range []string{"SELECT action", "GROUP BY action", "ORDER BY MAX(ts) DESC", "LIMIT 100"} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
}

func TestDistinctActions_QueryError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("q fail")
	r := &AuditLogQueryRepo{exec: &fakeDBTX{queryErr: sentinel}}
	_, err := r.DistinctActions(context.Background())
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "distinct actions") {
		t.Errorf("got %v", err)
	}
}

// ---------- scanStrings ----------

func TestScanStrings(t *testing.T) {
	t.Parallel()

	t.Run("empty → non-nil empty slice", func(t *testing.T) {
		t.Parallel()
		got, err := scanStrings(rowsFrom())
		if err != nil {
			t.Fatal(err)
		}
		if got == nil {
			t.Error("want non-nil empty slice")
		}
		if len(got) != 0 {
			t.Errorf("want empty, got %v", got)
		}
	})

	t.Run("multiple rows", func(t *testing.T) {
		t.Parallel()
		got, err := scanStrings(rowsFrom(scanRow("a"), scanRow("b"), scanRow("c")))
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, []string{"a", "b", "c"}) {
			t.Errorf("got %v", got)
		}
	})

	t.Run("scan error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan fail")
		_, err := scanStrings(rowsFrom(func(dest ...any) error { return sentinel }))
		if !errors.Is(err, sentinel) {
			t.Errorf("want scan error, got %v", err)
		}
	})

	t.Run("rows error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("iterate fail")
		rows := rowsFrom(scanRow("a"))
		rows.err = sentinel
		got, err := scanStrings(rows)
		if !errors.Is(err, sentinel) {
			t.Errorf("want rows.Err() surfaced, got %v", err)
		}
		if !reflect.DeepEqual(got, []string{"a"}) {
			t.Errorf("rows scanned before Err should still return, got %v", got)
		}
	})
}
