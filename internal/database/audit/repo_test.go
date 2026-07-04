package audit

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fixedNow pins the wall clock so the ts argument written into audit_logs
// is deterministic and assertable.
var fixedNow = time.Date(2026, 7, 4, 18, 30, 0, 0, time.UTC)

func fixedNowFn() time.Time { return fixedNow }

// newTestAuditRepo wires an AuditRepo to a recording fake DBTX with a
// pinned clock — the standard fixture for the write-path tests.
func newTestAuditRepo(f *fakeDBTX) *AuditRepo {
	return &AuditRepo{exec: f, now: fixedNowFn}
}

// ---------- capText (rune-safe truncation) ----------

func TestCapText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"empty", "", 10, ""},
		{"under_limit", "abc", 10, "abc"},
		{"exact_limit", "abcde", 5, "abcde"},
		{"ascii_truncate", "abcdefghij", 4, "abcd"},
		{"zero_max_returns_input", "abcdef", 0, "abcdef"},
		{"negative_max_returns_input", "abcdef", -1, "abcdef"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := capText(tt.in, tt.max)
			if got != tt.want {
				t.Errorf("capText(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
			}
		})
	}
}

// TestCapText_RuneSafe is the regression guard for the byte-vs-rune
// truncation bug: a naive s[:max] slice can cut a multi-byte rune in
// half, yielding invalid UTF-8 that PostgreSQL rejects. capText must
// always emit valid UTF-8 no larger than max bytes.
func TestCapText_RuneSafe(t *testing.T) {
	t.Parallel()
	multi := strings.Repeat("é", 100) // "é" is 2 bytes → 200 bytes, 100 runes
	for _, max := range []int{1, 3, 65, 101, 199, 200} {
		got := capText(multi, max)
		if !utf8.ValidString(got) {
			t.Errorf("capText(max=%d) produced invalid UTF-8: %q", max, got)
		}
		if len(got) > max {
			t.Errorf("capText(max=%d) len=%d exceeds max", max, len(got))
		}
	}
	// A 2-byte rune cannot fit in a 1-byte budget → empty (not a half rune).
	if got := capText(multi, 1); got != "" {
		t.Errorf("capText(max=1) = %q, want empty string", got)
	}
}

// ---------- constructors ----------

func TestNewAuditRepo(t *testing.T) {
	t.Parallel()
	// nil pool → exec stays nil (open-mode guard), now defaults.
	r := NewAuditRepo(nil, nil)
	if r == nil {
		t.Fatal("NewAuditRepo returned nil")
	}
	if r.exec != nil {
		t.Error("exec should be nil when pool is nil (avoids typed-nil interface)")
	}
	if r.now == nil {
		t.Fatal("now should default to a non-nil func")
	}
	_ = r.now() // must not panic

	// non-nil pool → exec set. The zero-value pool is never dialed here.
	r2 := NewAuditRepo(&pgxpool.Pool{}, fixedNowFn)
	if r2.exec == nil {
		t.Error("exec should be set when pool is non-nil")
	}
}

func TestNewAuditRepoWithDB(t *testing.T) {
	t.Parallel()
	if r := NewAuditRepoWithDB(nil); r != nil {
		t.Error("nil db should yield a nil repo")
	}
	// db present but pool nil → repo present, exec nil (not configured).
	r := NewAuditRepoWithDB(&database.DB{})
	if r == nil {
		t.Fatal("non-nil db should yield a non-nil repo")
	}
	if r.exec != nil {
		t.Error("nil pool should leave exec nil")
	}
	// db + pool → exec set.
	r2 := NewAuditRepoWithDB(&database.DB{Pool: &pgxpool.Pool{}})
	if r2 == nil || r2.exec == nil {
		t.Error("db with pool should set exec")
	}
}

// ---------- WriteRevealEvent ----------

func TestWriteRevealEvent_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *AuditRepo
	if err := nilRepo.WriteRevealEvent(ctx, AuditRevealEvent{Variant: "token"}); err == nil {
		t.Error("nil repo should error")
	}
	unconfigured := &AuditRepo{now: fixedNowFn} // exec nil
	if err := unconfigured.WriteRevealEvent(ctx, AuditRevealEvent{Variant: "token"}); err == nil {
		t.Error("nil exec should error")
	}
}

func TestWriteRevealEvent_VariantRequired(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := newTestAuditRepo(f)
	for _, v := range []string{"", "   ", "\t\n"} {
		err := r.WriteRevealEvent(context.Background(), AuditRevealEvent{Variant: v})
		if !errors.Is(err, ErrAuditRevealVariantRequired) {
			t.Errorf("variant %q: want ErrAuditRevealVariantRequired, got %v", v, err)
		}
	}
	if len(f.execCalls) != 0 {
		t.Errorf("no Exec should run when variant is invalid, got %d", len(f.execCalls))
	}
}

func TestWriteRevealEvent_HappyPath(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := newTestAuditRepo(f)
	err := r.WriteRevealEvent(context.Background(), AuditRevealEvent{
		Actor: "alice", Variant: "  token  ", Kind: "masked_reveal",
		IP: "10.0.0.1", UserAgent: "curl/8",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(f.execCalls) != 1 {
		t.Fatalf("want exactly 1 Exec, got %d", len(f.execCalls))
	}
	c := f.execCalls[0]
	for _, frag := range []string{
		"INSERT INTO audit_logs",
		"ts, actor, action, entity_type, entity_id, detail, ip, user_agent",
		"VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)",
	} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
	if len(c.Args) != 7 {
		t.Fatalf("want 7 args, got %d: %v", len(c.Args), c.Args)
	}
	if ts, ok := c.Args[0].(time.Time); !ok || !ts.Equal(fixedNow) {
		t.Errorf("args[0] ts = %v, want %v", c.Args[0], fixedNow)
	}
	if c.Args[1] != "alice" {
		t.Errorf("args[1] actor = %v, want alice", c.Args[1])
	}
	if c.Args[2] != AuditRevealAction {
		t.Errorf("args[2] action = %v, want %v", c.Args[2], AuditRevealAction)
	}
	if c.Args[3] != "token" {
		t.Errorf("args[3] variant = %v, want trimmed 'token'", c.Args[3])
	}
	if c.Args[4] != "masked_reveal" {
		t.Errorf("args[4] kind = %v, want masked_reveal", c.Args[4])
	}
	if c.Args[5] != "10.0.0.1" || c.Args[6] != "curl/8" {
		t.Errorf("args[5,6] ip/ua = %v/%v", c.Args[5], c.Args[6])
	}
}

func TestWriteRevealEvent_NullMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                     string
		kind, ip, ua             string
		wantKind, wantIP, wantUA any
	}{
		{"all empty → NULL", "", "", "", nil, nil, nil},
		{"all set", "k", "1.1.1.1", "ua", "k", "1.1.1.1", "ua"},
		{"kind only", "k", "", "", "k", nil, nil},
		{"ip only", "", "2.2.2.2", "", nil, "2.2.2.2", nil},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			r := newTestAuditRepo(f)
			if err := r.WriteRevealEvent(context.Background(), AuditRevealEvent{
				Variant: "token", Kind: tt.kind, IP: tt.ip, UserAgent: tt.ua,
			}); err != nil {
				t.Fatal(err)
			}
			c := f.execCalls[0]
			if c.Args[4] != tt.wantKind {
				t.Errorf("kind arg = %v, want %v", c.Args[4], tt.wantKind)
			}
			if c.Args[5] != tt.wantIP {
				t.Errorf("ip arg = %v, want %v", c.Args[5], tt.wantIP)
			}
			if c.Args[6] != tt.wantUA {
				t.Errorf("ua arg = %v, want %v", c.Args[6], tt.wantUA)
			}
		})
	}
}

func TestWriteRevealEvent_Truncation(t *testing.T) {
	t.Parallel()
	longVariant := strings.Repeat("é", 100) // 200 bytes > 64
	longKind := strings.Repeat("k", 300)    // 300 bytes > 128
	f := &fakeDBTX{}
	r := newTestAuditRepo(f)
	if err := r.WriteRevealEvent(context.Background(), AuditRevealEvent{
		Variant: longVariant, Kind: longKind,
	}); err != nil {
		t.Fatal(err)
	}
	c := f.execCalls[0]
	variant, _ := c.Args[3].(string)
	if len(variant) > MaxAuditRevealVariantLen {
		t.Errorf("variant not capped: len=%d > %d", len(variant), MaxAuditRevealVariantLen)
	}
	if !utf8.ValidString(variant) {
		t.Errorf("variant is invalid UTF-8 after cap: %q", variant)
	}
	kind, _ := c.Args[4].(string)
	if len(kind) > MaxAuditRevealKindLen {
		t.Errorf("kind not capped: len=%d > %d", len(kind), MaxAuditRevealKindLen)
	}
}

func TestWriteRevealEvent_ExecError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db down")
	f := &fakeDBTX{execErr: sentinel}
	r := newTestAuditRepo(f)
	err := r.WriteRevealEvent(context.Background(), AuditRevealEvent{Variant: "token"})
	if !errors.Is(err, sentinel) {
		t.Errorf("want wrapped sentinel, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "audit_logs insert") {
		t.Errorf("error missing context: %v", err)
	}
}

// ---------- WriteImpersonationStart / End ----------

func TestWriteImpersonation_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	evt := AuditImpersonationEvent{Actor: "a", Target: "b"}
	var nilRepo *AuditRepo
	if err := nilRepo.WriteImpersonationStart(ctx, evt); err == nil {
		t.Error("nil repo start should error")
	}
	if err := nilRepo.WriteImpersonationEnd(ctx, evt); err == nil {
		t.Error("nil repo end should error")
	}
	unconfigured := &AuditRepo{now: fixedNowFn}
	if err := unconfigured.WriteImpersonationStart(ctx, evt); err == nil {
		t.Error("nil exec should error")
	}
}

func TestWriteImpersonation_Validation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, actor, target, wantSub string
	}{
		{"empty actor", "", "bob", "actor required"},
		{"whitespace actor", "   ", "bob", "actor required"},
		{"empty target", "alice", "", "target required"},
		{"whitespace target", "alice", "  ", "target required"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			r := newTestAuditRepo(f)
			err := r.WriteImpersonationStart(context.Background(),
				AuditImpersonationEvent{Actor: tt.actor, Target: tt.target})
			if err == nil || !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("want error containing %q, got %v", tt.wantSub, err)
			}
			if len(f.execCalls) != 0 {
				t.Errorf("no Exec should run on validation failure, got %d", len(f.execCalls))
			}
		})
	}
}

func TestWriteImpersonation_HappyPath(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		call       func(*AuditRepo, context.Context, AuditImpersonationEvent) error
		wantAction string
	}{
		{"start", (*AuditRepo).WriteImpersonationStart, AuditImpersonationStartAction},
		{"end", (*AuditRepo).WriteImpersonationEnd, AuditImpersonationEndAction},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			r := newTestAuditRepo(f)
			err := tt.call(r, context.Background(), AuditImpersonationEvent{
				Actor: "  admin  ", Target: "  victim  ", IP: "9.9.9.9", UserAgent: "UA",
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(f.execCalls) != 1 {
				t.Fatalf("want 1 Exec, got %d", len(f.execCalls))
			}
			c := f.execCalls[0]
			if !strings.Contains(c.SQL, "VALUES ($1, $2, $3, 'impersonation', NULL, $4, $5, $6)") {
				t.Errorf("SQL should hardcode entity_type 'impersonation'\n%s", c.SQL)
			}
			if len(c.Args) != 6 {
				t.Fatalf("want 6 args, got %d: %v", len(c.Args), c.Args)
			}
			if ts, ok := c.Args[0].(time.Time); !ok || !ts.Equal(fixedNow) {
				t.Errorf("args[0] ts = %v", c.Args[0])
			}
			if c.Args[1] != "admin" {
				t.Errorf("args[1] actor = %v, want trimmed 'admin'", c.Args[1])
			}
			if c.Args[2] != tt.wantAction {
				t.Errorf("args[2] action = %v, want %v", c.Args[2], tt.wantAction)
			}
			if c.Args[3] != "victim" {
				t.Errorf("args[3] target = %v, want trimmed 'victim'", c.Args[3])
			}
			if c.Args[4] != "9.9.9.9" || c.Args[5] != "UA" {
				t.Errorf("args[4,5] ip/ua = %v/%v", c.Args[4], c.Args[5])
			}
		})
	}
}

func TestWriteImpersonation_NullMappingAndTruncation(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := newTestAuditRepo(f)
	longActor := strings.Repeat("é", 200) // 400 bytes > 256
	if err := r.WriteImpersonationEnd(context.Background(),
		AuditImpersonationEvent{Actor: longActor, Target: "bob"}); err != nil {
		t.Fatal(err)
	}
	c := f.execCalls[0]
	if c.Args[4] != nil {
		t.Errorf("empty IP should map to nil, got %v", c.Args[4])
	}
	if c.Args[5] != nil {
		t.Errorf("empty UA should map to nil, got %v", c.Args[5])
	}
	actor, _ := c.Args[1].(string)
	if len(actor) > MaxAuditImpersonationSubjectLen {
		t.Errorf("actor not capped: len=%d", len(actor))
	}
	if !utf8.ValidString(actor) {
		t.Errorf("actor invalid UTF-8 after cap")
	}
}

func TestWriteImpersonation_ExecError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")
	f := &fakeDBTX{execErr: sentinel}
	r := newTestAuditRepo(f)
	err := r.WriteImpersonationStart(context.Background(),
		AuditImpersonationEvent{Actor: "a", Target: "b"})
	if !errors.Is(err, sentinel) {
		t.Errorf("want wrapped sentinel, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "impersonation insert") {
		t.Errorf("error missing context: %v", err)
	}
}

// ---------- ListDistinctActiveSubjects ----------

func TestListDistinctActiveSubjects_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *AuditRepo
	if _, err := nilRepo.ListDistinctActiveSubjects(ctx); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&AuditRepo{now: fixedNowFn}).ListDistinctActiveSubjects(ctx); err == nil {
		t.Error("nil exec should error")
	}
}

func TestListDistinctActiveSubjects_HappyPath(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{queryRows: rowsFrom(
		scanRow("  alice  "), // trimmed
		scanRow("bob"),
		scanRow("   "), // whitespace-only → skipped
		scanRow("carol"),
	)}
	r := newTestAuditRepo(f)
	got, err := r.ListDistinctActiveSubjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"alice", "bob", "carol"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	c := f.queryCalls[0]
	for _, frag := range []string{
		"SELECT DISTINCT subject", "FROM auth_sessions", "revoked_at IS NULL", "ORDER BY subject ASC",
	} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
}

func TestListDistinctActiveSubjects_QueryError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("query fail")
	f := &fakeDBTX{queryErr: sentinel}
	_, err := newTestAuditRepo(f).ListDistinctActiveSubjects(context.Background())
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "distinct subjects") {
		t.Errorf("got %v", err)
	}
}

func TestListDistinctActiveSubjects_ScanError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("scan fail")
	f := &fakeDBTX{queryRows: rowsFrom(func(dest ...any) error { return sentinel })}
	_, err := newTestAuditRepo(f).ListDistinctActiveSubjects(context.Background())
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "auth_sessions scan") {
		t.Errorf("got %v", err)
	}
}

func TestListDistinctActiveSubjects_RowsErr(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("iterate fail")
	rows := rowsFrom(scanRow("alice"))
	rows.err = sentinel
	f := &fakeDBTX{queryRows: rows}
	_, err := newTestAuditRepo(f).ListDistinctActiveSubjects(context.Background())
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "auth_sessions iterate") {
		t.Errorf("got %v", err)
	}
}
