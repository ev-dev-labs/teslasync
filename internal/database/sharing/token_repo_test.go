package sharing

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// These tests exercise every exported TokenRepo method against an in-process
// fake pool (the tokenPool interface is declared locally precisely so tests can
// supply one without pgxmock or a live PostgreSQL). They also pin the SQL
// constants so a column/filter typo fails at test time rather than in
// production, and cover the pure-Go token generator.

// ── fakes ──────────────────────────────────────────────────────────────────

// fakePool implements tokenPool. Each method records its call and returns the
// configured canned result so tests can assert both the outbound SQL/args and
// the repo's handling of the response.
type fakePool struct {
	execTag  pgconn.CommandTag
	execErr  error
	rowFn    func(sql string, args []any) pgx.Row
	rows     pgx.Rows
	queryErr error

	execCalls  int
	queryCalls int
	rowCalls   int
	lastSQL    string
	lastArgs   []any
}

func (p *fakePool) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	p.execCalls++
	p.lastSQL, p.lastArgs = sql, args
	return p.execTag, p.execErr
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.queryCalls++
	p.lastSQL, p.lastArgs = sql, args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.rowCalls++
	p.lastSQL, p.lastArgs = sql, args
	if p.rowFn == nil {
		return fakeRow{scan: func(...any) error { return errors.New("fakePool: rowFn not configured") }}
	}
	return p.rowFn(sql, args)
}

// fakeRow implements pgx.Row for QueryRow-based methods.
type fakeRow struct {
	scan func(dest ...any) error
}

func (r fakeRow) Scan(dest ...any) error { return r.scan(dest...) }

// fakeRows implements pgx.Rows for Query-based methods. It embeds pgx.Rows so
// the interface is satisfied; only the four methods ListByDrive calls are
// overridden. Any other method call would hit the nil embedded interface and
// panic — surfacing an unexpected code path instead of silently succeeding.
type fakeRows struct {
	pgx.Rows
	data    []drivemodel.ShareToken
	pos     int
	scanErr error
	scanAt  int
	errErr  error
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.data) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	i := r.pos - 1
	if r.scanErr != nil && i == r.scanAt {
		return r.scanErr
	}
	return fillShareToken(dest, r.data[i])
}

func (r *fakeRows) Err() error { return r.errErr }
func (r *fakeRows) Close()     { r.closed = true }

// ── scan helpers ─────────────────────────────────────────────────────────────

// setDest assigns v into a *T scan destination, returning a descriptive error
// on a type mismatch. This doubles as a guard that the repo's Scan column order
// and types stay in lock-step with the SELECT projection.
func setDest[T any](dest any, v T) error {
	p, ok := dest.(*T)
	if !ok {
		return fmt.Errorf("scan dest is %T, want *%T", dest, v)
	}
	*p = v
	return nil
}

// fillShareToken populates the 12 scan destinations produced by getByTokenSQL /
// listByDriveSQL from src, in the exact column order the repo scans.
func fillShareToken(dest []any, src drivemodel.ShareToken) error {
	if len(dest) != 12 {
		return fmt.Errorf("share token scan: got %d dest, want 12", len(dest))
	}
	steps := []func() error{
		func() error { return setDest(dest[0], src.ID) },
		func() error { return setDest(dest[1], src.Token) },
		func() error { return setDest(dest[2], src.DriveID) },
		func() error { return setDest(dest[3], src.CreatedBy) },
		func() error { return setDest(dest[4], src.Title) },
		func() error { return setDest(dest[5], src.Description) },
		func() error { return setDest(dest[6], src.IncludeMap) },
		func() error { return setDest(dest[7], src.IncludeTelemetry) },
		func() error { return setDest(dest[8], src.IncludeSpeed) },
		func() error { return setDest(dest[9], src.Views) },
		func() error { return setDest(dest[10], src.ExpiresAt) },
		func() error { return setDest(dest[11], src.CreatedAt) },
	}
	for i, step := range steps {
		if err := step(); err != nil {
			return fmt.Errorf("dest[%d]: %w", i, err)
		}
	}
	return nil
}

func strPtr(s string) *string        { return &s }
func timePtr(t time.Time) *time.Time { return &t }

// ── pure-Go: generateToken ───────────────────────────────────────────────────

// TestGenerateToken confirms the token is a 32-char lowercase hex string
// (16 random bytes), decodes cleanly, and is unique across many calls — the
// public share URL depends on both properties.
func TestGenerateToken(t *testing.T) {
	t.Parallel()

	const n = 512
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		tok, err := generateToken()
		if err != nil {
			t.Fatalf("generateToken() error = %v", err)
		}
		if len(tok) != 32 {
			t.Fatalf("token %q length = %d, want 32", tok, len(tok))
		}
		if _, err := hex.DecodeString(tok); err != nil {
			t.Fatalf("token %q is not valid hex: %v", tok, err)
		}
		if tok != strings.ToLower(tok) {
			t.Fatalf("token %q must be lowercase hex", tok)
		}
		if _, dup := seen[tok]; dup {
			t.Fatalf("duplicate token generated: %q", tok)
		}
		seen[tok] = struct{}{}
	}
}

// ── SQL-shape pinning ────────────────────────────────────────────────────────

var shareTokenColumns = []string{
	"id", "token", "drive_id", "created_by", "title", "description",
	"include_map", "include_telemetry", "include_speed", "views",
	"expires_at", "created_at",
}

func TestInsertTokenSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"INSERT INTO share_tokens",
		"token, drive_id, created_by, title, description",
		"include_map, include_telemetry, include_speed, expires_at",
		"VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
		"RETURNING id, created_at",
	}
	for _, frag := range mustContain {
		if !strings.Contains(insertTokenSQL, frag) {
			t.Errorf("insertTokenSQL missing %q\nfull SQL:\n%s", frag, insertTokenSQL)
		}
	}
}

func TestSelectSQL_ProjectAllColumns(t *testing.T) {
	t.Parallel()
	// getByTokenSQL and listByDriveSQL must share the same projection so
	// scanShareToken (12 dests) stays valid for both paths.
	for _, sql := range []struct {
		name string
		body string
	}{
		{"getByTokenSQL", getByTokenSQL},
		{"listByDriveSQL", listByDriveSQL},
	} {
		if !strings.Contains(sql.body, selectTokenColumns) {
			t.Errorf("%s does not embed selectTokenColumns\nfull SQL:\n%s", sql.name, sql.body)
		}
		for _, col := range shareTokenColumns {
			if !strings.Contains(sql.body, col) {
				t.Errorf("%s missing column %q\nfull SQL:\n%s", sql.name, col, sql.body)
			}
		}
		if !strings.Contains(sql.body, "FROM share_tokens") {
			t.Errorf("%s missing FROM share_tokens", sql.name)
		}
	}
}

func TestGetByTokenSQL_Shape(t *testing.T) {
	t.Parallel()
	if !strings.Contains(getByTokenSQL, "WHERE token = $1") {
		t.Errorf("getByTokenSQL missing %q\nfull SQL:\n%s", "WHERE token = $1", getByTokenSQL)
	}
}

func TestListByDriveSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"WHERE drive_id = $1",
		"ORDER BY created_at DESC",
	}
	for _, frag := range mustContain {
		if !strings.Contains(listByDriveSQL, frag) {
			t.Errorf("listByDriveSQL missing %q\nfull SQL:\n%s", frag, listByDriveSQL)
		}
	}
}

func TestMutationSQL_Shape(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		sql  string
		want string
	}{
		{"incrementViewsSQL", incrementViewsSQL, "UPDATE share_tokens SET views = views + 1 WHERE id = $1"},
		{"deleteTokenSQL", deleteTokenSQL, "DELETE FROM share_tokens WHERE token = $1"},
		{"deleteExpiredSQL", deleteExpiredSQL, "DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND expires_at < $1"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if c.sql != c.want {
				t.Errorf("%s = %q, want %q", c.name, c.sql, c.want)
			}
		})
	}
}

// TestSQL_ParameterisedOnly asserts every query uses positional placeholders
// and never a Go format verb — a cheap guard against a future edit sliding
// into fmt.Sprintf-built SQL (injection risk).
func TestSQL_ParameterisedOnly(t *testing.T) {
	t.Parallel()
	all := map[string]string{
		"insertTokenSQL":    insertTokenSQL,
		"getByTokenSQL":     getByTokenSQL,
		"listByDriveSQL":    listByDriveSQL,
		"incrementViewsSQL": incrementViewsSQL,
		"deleteTokenSQL":    deleteTokenSQL,
		"deleteExpiredSQL":  deleteExpiredSQL,
	}
	for name, sql := range all {
		if !strings.Contains(sql, "$1") {
			t.Errorf("%s has no positional placeholder $1\n%s", name, sql)
		}
		for _, verb := range []string{"%s", "%d", "%v", "%q"} {
			if strings.Contains(sql, verb) {
				t.Errorf("%s contains format verb %q — must use bind parameters, not string interpolation", name, verb)
			}
		}
	}
}

// ── constructor ─────────────────────────────────────────────────────────────

// TestNewTokenRepo_NilPanics defends the construction-time fail-fast: a nil db
// or a db with a nil pool is a wiring bug, not a runtime condition.
func TestNewTokenRepo_NilPanics(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"nil db", func() { _ = NewTokenRepo(nil) }},
		// A DB value with a nil Pool must also panic rather than defer the
		// nil-deref to the first query.
		{"nil pool", func() { _ = NewTokenRepo(&database.DB{}) }},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewTokenRepo(%s) did not panic", c.name)
				}
			}()
			c.fn()
		})
	}
}

// TestNewTokenRepo_BindsPool covers the constructor success path: a valid
// database.DB whose pool is a real *pgxpool.Pool is bound onto the repo. The
// pool is created with a loopback DSN and never pinged, so no connection is
// established (pgxpool connects lazily); Close cleans up the background
// health-check goroutine.
func TestNewTokenRepo_BindsPool(t *testing.T) {
	t.Parallel()
	cfg, err := pgxpool.ParseConfig("postgres://user:pass@127.0.0.1:1/db")
	if err != nil {
		t.Fatalf("ParseConfig() error = %v", err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig() error = %v", err)
	}
	defer pool.Close()

	repo := NewTokenRepo(&database.DB{Pool: pool})
	if repo == nil {
		t.Fatal("NewTokenRepo() = nil")
	}
	bound, ok := repo.pool.(*pgxpool.Pool)
	if !ok || bound != pool {
		t.Fatalf("repo.pool = %v, want the provided *pgxpool.Pool", repo.pool)
	}
}

// ── Create ──────────────────────────────────────────────────────────────────

func TestTokenRepo_Create(t *testing.T) {
	t.Parallel()

	scanTime := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)

	t.Run("nil token returns error without querying", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{}
		repo := &TokenRepo{pool: fp}
		if err := repo.Create(context.Background(), nil); err == nil {
			t.Fatal("expected error for nil token")
		}
		if fp.rowCalls != 0 {
			t.Errorf("QueryRow called %d times, want 0 for nil token", fp.rowCalls)
		}
	})

	t.Run("invalid drive id returns error without querying", func(t *testing.T) {
		t.Parallel()
		for _, driveID := range []int64{0, -1} {
			fp := &fakePool{}
			repo := &TokenRepo{pool: fp}
			err := repo.Create(context.Background(), &drivemodel.ShareToken{DriveID: driveID})
			if err == nil {
				t.Fatalf("driveID=%d: expected error", driveID)
			}
			if fp.rowCalls != 0 {
				t.Errorf("driveID=%d: QueryRow called, want none", driveID)
			}
		}
	})

	t.Run("success populates id, created_at, token and passes args", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(dest ...any) error {
					if len(dest) != 2 {
						return fmt.Errorf("Create scan: got %d dest, want 2", len(dest))
					}
					if err := setDest(dest[0], int64(77)); err != nil {
						return err
					}
					return setDest(dest[1], scanTime)
				}}
			},
		}
		repo := &TokenRepo{pool: fp}
		st := &drivemodel.ShareToken{
			DriveID:          42,
			CreatedBy:        strPtr("alice"),
			Title:            strPtr("My Drive"),
			IncludeMap:       true,
			IncludeTelemetry: true,
			IncludeSpeed:     true,
		}
		if err := repo.Create(context.Background(), st); err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if st.ID != 77 {
			t.Errorf("st.ID = %d, want 77", st.ID)
		}
		if !st.CreatedAt.Equal(scanTime) {
			t.Errorf("st.CreatedAt = %v, want %v", st.CreatedAt, scanTime)
		}
		if len(st.Token) != 32 {
			t.Errorf("st.Token = %q, want 32 hex chars", st.Token)
		}
		if fp.lastSQL != insertTokenSQL {
			t.Errorf("Create used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 9 {
			t.Fatalf("Create passed %d args, want 9", len(fp.lastArgs))
		}
		if fp.lastArgs[0] != st.Token {
			t.Errorf("arg[0] = %v, want token %q", fp.lastArgs[0], st.Token)
		}
		if fp.lastArgs[1] != int64(42) {
			t.Errorf("arg[1] = %v, want drive_id 42", fp.lastArgs[1])
		}
	})

	t.Run("scan error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("insert boom")
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(...any) error { return sentinel }}
			},
		}
		repo := &TokenRepo{pool: fp}
		err := repo.Create(context.Background(), &drivemodel.ShareToken{DriveID: 1})
		if !errors.Is(err, sentinel) {
			t.Fatalf("Create() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "create share token") {
			t.Errorf("error %q missing operation context", err)
		}
	})
}

// ── GetByToken ───────────────────────────────────────────────────────────────

func TestTokenRepo_GetByToken(t *testing.T) {
	t.Parallel()

	created := time.Date(2026, 7, 1, 9, 30, 0, 0, time.UTC)
	expires := created.Add(48 * time.Hour)
	want := drivemodel.ShareToken{
		ID: 5, Token: "abc123", DriveID: 9,
		CreatedBy: strPtr("bob"), Title: strPtr("Trip"), Description: nil,
		IncludeMap: true, IncludeTelemetry: false, IncludeSpeed: true,
		Views: 3, ExpiresAt: timePtr(expires), CreatedAt: created,
	}

	t.Run("empty token short-circuits to not found", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{}
		repo := &TokenRepo{pool: fp}
		got, err := repo.GetByToken(context.Background(), "")
		if err != nil || got != nil {
			t.Fatalf("GetByToken(\"\") = (%v, %v), want (nil, nil)", got, err)
		}
		if fp.rowCalls != 0 {
			t.Errorf("QueryRow called for empty token")
		}
	})

	t.Run("success maps every column", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(dest ...any) error { return fillShareToken(dest, want) }}
			},
		}
		repo := &TokenRepo{pool: fp}
		got, err := repo.GetByToken(context.Background(), "abc123")
		if err != nil {
			t.Fatalf("GetByToken() error = %v", err)
		}
		if got == nil {
			t.Fatal("GetByToken() = nil, want a token")
		}
		assertShareTokenEqual(t, *got, want)
		if fp.lastSQL != getByTokenSQL {
			t.Errorf("GetByToken used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 1 || fp.lastArgs[0] != "abc123" {
			t.Errorf("GetByToken args = %v, want [abc123]", fp.lastArgs)
		}
	})

	t.Run("no rows returns nil, nil", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(...any) error { return pgx.ErrNoRows }}
			},
		}
		repo := &TokenRepo{pool: fp}
		got, err := repo.GetByToken(context.Background(), "missing")
		if err != nil || got != nil {
			t.Fatalf("GetByToken(missing) = (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("wrapped ErrNoRows still treated as not found", func(t *testing.T) {
		t.Parallel()
		// Guards the errors.Is fix: the previous `err == pgx.ErrNoRows`
		// compare would have mis-classified a wrapped ErrNoRows as a real
		// error (500 instead of 404).
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(...any) error {
					return fmt.Errorf("driver layer: %w", pgx.ErrNoRows)
				}}
			},
		}
		repo := &TokenRepo{pool: fp}
		got, err := repo.GetByToken(context.Background(), "missing")
		if err != nil || got != nil {
			t.Fatalf("GetByToken wrapped-no-rows = (%v, %v), want (nil, nil)", got, err)
		}
	})

	t.Run("other scan error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("select boom")
		fp := &fakePool{
			rowFn: func(_ string, _ []any) pgx.Row {
				return fakeRow{scan: func(...any) error { return sentinel }}
			},
		}
		repo := &TokenRepo{pool: fp}
		got, err := repo.GetByToken(context.Background(), "abc")
		if got != nil {
			t.Errorf("GetByToken() token = %v, want nil on error", got)
		}
		if !errors.Is(err, sentinel) {
			t.Fatalf("GetByToken() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "get share token") {
			t.Errorf("error %q missing operation context", err)
		}
	})
}

// ── ListByDrive ──────────────────────────────────────────────────────────────

func TestTokenRepo_ListByDrive(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	rows := []drivemodel.ShareToken{
		{ID: 1, Token: "t1", DriveID: 9, IncludeMap: true, Views: 2, CreatedAt: base.Add(2 * time.Hour)},
		{ID: 2, Token: "t2", DriveID: 9, Title: strPtr("second"), Views: 0, CreatedAt: base.Add(time.Hour)},
	}

	t.Run("query error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("query boom")
		fp := &fakePool{queryErr: sentinel}
		repo := &TokenRepo{pool: fp}
		got, err := repo.ListByDrive(context.Background(), 9)
		if got != nil {
			t.Errorf("ListByDrive() = %v, want nil on error", got)
		}
		if !errors.Is(err, sentinel) {
			t.Fatalf("ListByDrive() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "list share tokens") {
			t.Errorf("error %q missing operation context", err)
		}
	})

	t.Run("empty result returns nil slice, nil error", func(t *testing.T) {
		t.Parallel()
		fr := &fakeRows{}
		fp := &fakePool{rows: fr}
		repo := &TokenRepo{pool: fp}
		got, err := repo.ListByDrive(context.Background(), 9)
		if err != nil {
			t.Fatalf("ListByDrive() error = %v", err)
		}
		if len(got) != 0 {
			t.Errorf("ListByDrive() = %v, want empty", got)
		}
		if !fr.closed {
			t.Error("rows.Close() was not called")
		}
	})

	t.Run("multiple rows scanned in order", func(t *testing.T) {
		t.Parallel()
		fr := &fakeRows{data: rows}
		fp := &fakePool{rows: fr}
		repo := &TokenRepo{pool: fp}
		got, err := repo.ListByDrive(context.Background(), 9)
		if err != nil {
			t.Fatalf("ListByDrive() error = %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("ListByDrive() len = %d, want 2", len(got))
		}
		assertShareTokenEqual(t, *got[0], rows[0])
		assertShareTokenEqual(t, *got[1], rows[1])
		if fp.lastSQL != listByDriveSQL {
			t.Errorf("ListByDrive used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 1 || fp.lastArgs[0] != int64(9) {
			t.Errorf("ListByDrive args = %v, want [9]", fp.lastArgs)
		}
	})

	t.Run("row scan error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan boom")
		fr := &fakeRows{data: rows, scanErr: sentinel, scanAt: 1}
		fp := &fakePool{rows: fr}
		repo := &TokenRepo{pool: fp}
		got, err := repo.ListByDrive(context.Background(), 9)
		if got != nil {
			t.Errorf("ListByDrive() = %v, want nil on scan error", got)
		}
		if !errors.Is(err, sentinel) {
			t.Fatalf("ListByDrive() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "scan share token") {
			t.Errorf("error %q missing scan context", err)
		}
	})

	t.Run("rows.Err after iteration is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("iter boom")
		fr := &fakeRows{data: rows, errErr: sentinel}
		fp := &fakePool{rows: fr}
		repo := &TokenRepo{pool: fp}
		got, err := repo.ListByDrive(context.Background(), 9)
		if got != nil {
			t.Errorf("ListByDrive() = %v, want nil on rows.Err", got)
		}
		if !errors.Is(err, sentinel) {
			t.Fatalf("ListByDrive() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "rows iteration") {
			t.Errorf("error %q missing iteration context", err)
		}
	})
}

// ── IncrementViews ───────────────────────────────────────────────────────────

func TestTokenRepo_IncrementViews(t *testing.T) {
	t.Parallel()

	t.Run("invalid id returns error without executing", func(t *testing.T) {
		t.Parallel()
		for _, id := range []int64{0, -5} {
			fp := &fakePool{}
			repo := &TokenRepo{pool: fp}
			if err := repo.IncrementViews(context.Background(), id); err == nil {
				t.Errorf("id=%d: expected error", id)
			}
			if fp.execCalls != 0 {
				t.Errorf("id=%d: Exec called, want none", id)
			}
		}
	})

	t.Run("success passes id arg", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{execTag: pgconn.NewCommandTag("UPDATE 1")}
		repo := &TokenRepo{pool: fp}
		if err := repo.IncrementViews(context.Background(), 12); err != nil {
			t.Fatalf("IncrementViews() error = %v", err)
		}
		if fp.lastSQL != incrementViewsSQL {
			t.Errorf("IncrementViews used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 1 || fp.lastArgs[0] != int64(12) {
			t.Errorf("IncrementViews args = %v, want [12]", fp.lastArgs)
		}
	})

	t.Run("exec error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("update boom")
		fp := &fakePool{execErr: sentinel}
		repo := &TokenRepo{pool: fp}
		err := repo.IncrementViews(context.Background(), 1)
		if !errors.Is(err, sentinel) {
			t.Fatalf("IncrementViews() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "increment share token views") {
			t.Errorf("error %q missing operation context", err)
		}
	})
}

// ── Delete ──────────────────────────────────────────────────────────────────

func TestTokenRepo_Delete(t *testing.T) {
	t.Parallel()

	t.Run("empty token returns error without executing", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{}
		repo := &TokenRepo{pool: fp}
		if err := repo.Delete(context.Background(), ""); err == nil {
			t.Fatal("expected error for empty token")
		}
		if fp.execCalls != 0 {
			t.Errorf("Exec called for empty token")
		}
	})

	t.Run("row deleted returns nil", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{execTag: pgconn.NewCommandTag("DELETE 1")}
		repo := &TokenRepo{pool: fp}
		if err := repo.Delete(context.Background(), "tok"); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
		if fp.lastSQL != deleteTokenSQL {
			t.Errorf("Delete used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 1 || fp.lastArgs[0] != "tok" {
			t.Errorf("Delete args = %v, want [tok]", fp.lastArgs)
		}
	})

	t.Run("no rows affected returns ErrShareTokenNotFound", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{execTag: pgconn.NewCommandTag("DELETE 0")}
		repo := &TokenRepo{pool: fp}
		err := repo.Delete(context.Background(), "gone")
		if !errors.Is(err, ErrShareTokenNotFound) {
			t.Fatalf("Delete() error = %v, want ErrShareTokenNotFound", err)
		}
	})

	t.Run("exec error is wrapped and not the sentinel", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("delete boom")
		fp := &fakePool{execErr: sentinel}
		repo := &TokenRepo{pool: fp}
		err := repo.Delete(context.Background(), "tok")
		if !errors.Is(err, sentinel) {
			t.Fatalf("Delete() error = %v, want wrapped %v", err, sentinel)
		}
		if errors.Is(err, ErrShareTokenNotFound) {
			t.Error("a real DB error must not be reported as ErrShareTokenNotFound")
		}
		if !strings.Contains(err.Error(), "delete share token") {
			t.Errorf("error %q missing operation context", err)
		}
	})
}

// ── DeleteExpired ────────────────────────────────────────────────────────────

func TestTokenRepo_DeleteExpired(t *testing.T) {
	t.Parallel()

	t.Run("returns rows affected and passes a UTC cutoff", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{execTag: pgconn.NewCommandTag("DELETE 4")}
		repo := &TokenRepo{pool: fp}
		before := time.Now().UTC()
		n, err := repo.DeleteExpired(context.Background())
		after := time.Now().UTC()
		if err != nil {
			t.Fatalf("DeleteExpired() error = %v", err)
		}
		if n != 4 {
			t.Errorf("DeleteExpired() = %d, want 4", n)
		}
		if fp.lastSQL != deleteExpiredSQL {
			t.Errorf("DeleteExpired used unexpected SQL:\n%s", fp.lastSQL)
		}
		if len(fp.lastArgs) != 1 {
			t.Fatalf("DeleteExpired passed %d args, want 1", len(fp.lastArgs))
		}
		cutoff, ok := fp.lastArgs[0].(time.Time)
		if !ok {
			t.Fatalf("cutoff arg is %T, want time.Time", fp.lastArgs[0])
		}
		if cutoff.Location() != time.UTC {
			t.Errorf("cutoff location = %v, want UTC", cutoff.Location())
		}
		if cutoff.Before(before) || cutoff.After(after) {
			t.Errorf("cutoff %v not within [%v, %v]", cutoff, before, after)
		}
	})

	t.Run("zero rows affected returns 0", func(t *testing.T) {
		t.Parallel()
		fp := &fakePool{execTag: pgconn.NewCommandTag("DELETE 0")}
		repo := &TokenRepo{pool: fp}
		n, err := repo.DeleteExpired(context.Background())
		if err != nil || n != 0 {
			t.Fatalf("DeleteExpired() = (%d, %v), want (0, nil)", n, err)
		}
	})

	t.Run("exec error is wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("cleanup boom")
		fp := &fakePool{execErr: sentinel}
		repo := &TokenRepo{pool: fp}
		n, err := repo.DeleteExpired(context.Background())
		if n != 0 {
			t.Errorf("DeleteExpired() = %d, want 0 on error", n)
		}
		if !errors.Is(err, sentinel) {
			t.Fatalf("DeleteExpired() error = %v, want wrapped %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "delete expired share tokens") {
			t.Errorf("error %q missing operation context", err)
		}
	})
}

// ── shared assertions ────────────────────────────────────────────────────────

func assertShareTokenEqual(t *testing.T, got, want drivemodel.ShareToken) {
	t.Helper()
	if got.ID != want.ID || got.Token != want.Token || got.DriveID != want.DriveID {
		t.Errorf("scalar mismatch: got {ID:%d Token:%q DriveID:%d}, want {ID:%d Token:%q DriveID:%d}",
			got.ID, got.Token, got.DriveID, want.ID, want.Token, want.DriveID)
	}
	if !strPtrEqual(got.CreatedBy, want.CreatedBy) {
		t.Errorf("CreatedBy = %v, want %v", derefStr(got.CreatedBy), derefStr(want.CreatedBy))
	}
	if !strPtrEqual(got.Title, want.Title) {
		t.Errorf("Title = %v, want %v", derefStr(got.Title), derefStr(want.Title))
	}
	if !strPtrEqual(got.Description, want.Description) {
		t.Errorf("Description = %v, want %v", derefStr(got.Description), derefStr(want.Description))
	}
	if got.IncludeMap != want.IncludeMap || got.IncludeTelemetry != want.IncludeTelemetry || got.IncludeSpeed != want.IncludeSpeed {
		t.Errorf("include flags mismatch: got (%v,%v,%v), want (%v,%v,%v)",
			got.IncludeMap, got.IncludeTelemetry, got.IncludeSpeed,
			want.IncludeMap, want.IncludeTelemetry, want.IncludeSpeed)
	}
	if got.Views != want.Views {
		t.Errorf("Views = %d, want %d", got.Views, want.Views)
	}
	if !timePtrEqual(got.ExpiresAt, want.ExpiresAt) {
		t.Errorf("ExpiresAt = %v, want %v", got.ExpiresAt, want.ExpiresAt)
	}
	if !got.CreatedAt.Equal(want.CreatedAt) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, want.CreatedAt)
	}
}

func strPtrEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func derefStr(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func timePtrEqual(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}
