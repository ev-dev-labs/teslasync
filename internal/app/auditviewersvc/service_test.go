package auditviewersvc

// White-box tests for the audit viewer service. The service is a thin
// orchestrator over two ports (the audit_logs read repo and the hash-chain
// verifier), so these tests drive it through in-package fakes — the same
// test-double approach the database/audit repos use against their DBTX
// fake — instead of a live PostgreSQL pool. Everything here is
// deterministic and race-safe (no sleeps, no shared mutable fake state
// outside atomics).

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/audit"
	"github.com/ev-dev-labs/teslasync/internal/database"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
)

// ---------- test doubles ----------

// fakeRepo is a race-safe queryPort. Canned results are set at
// construction (read-only during calls); call bookkeeping uses atomics
// so the same fake can back the concurrency test.
type fakeRepo struct {
	listRows   []auditdb.AuditLogRow
	listErr    error
	cats       []string
	catsErr    error
	actions    []string
	actionsErr error

	listCalls   atomic.Int64
	catCalls    atomic.Int64
	actionCalls atomic.Int64
	lastQuery   atomic.Pointer[auditdb.AuditLogQuery]
}

func (f *fakeRepo) List(_ context.Context, q auditdb.AuditLogQuery) ([]auditdb.AuditLogRow, error) {
	f.listCalls.Add(1)
	f.lastQuery.Store(&q) // q is a per-call value copy — safe to retain
	return f.listRows, f.listErr
}

func (f *fakeRepo) DistinctCategories(_ context.Context) ([]string, error) {
	f.catCalls.Add(1)
	return f.cats, f.catsErr
}

func (f *fakeRepo) DistinctActions(_ context.Context) ([]string, error) {
	f.actionCalls.Add(1)
	return f.actions, f.actionsErr
}

var _ queryPort = (*fakeRepo)(nil)

// fakeRecorder is a race-safe verifyPort.
type fakeRecorder struct {
	badID   int64
	checked int
	err     error

	calls     atomic.Int64
	lastSince atomic.Pointer[time.Time]
	lastLimit atomic.Int64
}

func (f *fakeRecorder) VerifyChain(_ context.Context, since time.Time, limit int) (int64, int, error) {
	f.calls.Add(1)
	f.lastSince.Store(&since)
	f.lastLimit.Store(int64(limit))
	return f.badID, f.checked, f.err
}

var _ verifyPort = (*fakeRecorder)(nil)

func int64Ptr(v int64) *int64 { return &v }

// ---------- New: wiring + typed-nil handling ----------

func TestNew(t *testing.T) {
	t.Parallel()

	// These concrete values are only used to prove the non-nil branch of
	// New stores them; their methods are never invoked so no pool is
	// touched (constructing a zero-value pool does not connect).
	realRepo := auditdb.NewAuditLogQueryRepo(&database.DB{Pool: &pgxpool.Pool{}})
	if realRepo == nil {
		t.Fatal("precondition: pool-backed DB should yield a non-nil repo")
	}
	realRecorder := audit.New(&pgxpool.Pool{}, nil)
	if realRecorder == nil {
		t.Fatal("precondition: non-nil pool should yield a non-nil recorder")
	}

	tests := []struct {
		name        string
		repo        *auditdb.AuditLogQueryRepo
		recorder    *audit.Recorder
		wantRepoSet bool
		wantRecSet  bool
	}{
		{"both nil", nil, nil, false, false},
		{"repo only", realRepo, nil, true, false},
		{"recorder only", nil, realRecorder, false, true},
		{"both set", realRepo, realRecorder, true, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			s := New(tt.repo, tt.recorder)
			if s == nil {
				t.Fatal("New returned a nil Service")
			}
			// The critical regression guard: a nil *concrete* argument
			// must land as a genuine nil port, never a typed-nil
			// interface (which would defeat the ErrNotConfigured guards
			// and nil-deref instead).
			if (s.repo != nil) != tt.wantRepoSet {
				t.Errorf("s.repo set = %v, want %v", s.repo != nil, tt.wantRepoSet)
			}
			if (s.recorder != nil) != tt.wantRecSet {
				t.Errorf("s.recorder set = %v, want %v", s.recorder != nil, tt.wantRecSet)
			}
		})
	}
}

// ---------- ErrNotConfigured guards across every method ----------

// callErr invokes the named method on s and returns only its error so the
// four guard-bearing methods can be table-tested uniformly.
func callErr(s *Service, method string) error {
	switch method {
	case "Query":
		_, err := s.Query(context.Background(), auditdb.AuditLogQuery{})
		return err
	case "DistinctCategories":
		_, err := s.DistinctCategories(context.Background())
		return err
	case "DistinctActions":
		_, err := s.DistinctActions(context.Background())
		return err
	case "VerifyChain":
		_, _, err := s.VerifyChain(context.Background(), time.Time{}, 0)
		return err
	default:
		return fmt.Errorf("unknown method %q", method)
	}
}

func TestService_NotConfigured(t *testing.T) {
	t.Parallel()

	methods := []string{"Query", "DistinctCategories", "DistinctActions", "VerifyChain"}
	services := []struct {
		name string
		s    *Service
	}{
		{"nil receiver", nil},
		{"New(nil,nil)", New(nil, nil)},
		{"empty struct", &Service{}},
	}
	for _, svc := range services {
		svc := svc
		for _, m := range methods {
			m := m
			t.Run(svc.name+"/"+m, func(t *testing.T) {
				t.Parallel()
				err := callErr(svc.s, m)
				if !errors.Is(err, ErrNotConfigured) {
					t.Errorf("%s.%s err = %v, want ErrNotConfigured", svc.name, m, err)
				}
			})
		}
	}
}

// ---------- Query ----------

func TestQuery_Success(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 4, 8, 0, 0, 0, time.UTC)
	rowsOK := []auditdb.AuditLogRow{
		{ID: 2, Actor: "alice", Action: "masked_reveal", EntityType: "token", Ts: ts},
		{ID: 1, Actor: "bob", Action: "login", EntityType: "session", Ts: ts},
	}

	tests := []struct {
		name string
		q    auditdb.AuditLogQuery
	}{
		{"empty filter", auditdb.AuditLogQuery{}},
		{
			name: "full filter passed through verbatim",
			q: auditdb.AuditLogQuery{
				Since:      ts,
				Until:      ts.Add(time.Hour),
				Categories: []string{"auth"},
				Actors:     []string{"alice"},
				Actions:    []string{"masked_reveal"},
				EntityType: "token",
				EntityID:   int64Ptr(7),
				Limit:      25,
				Offset:     5,
			},
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeRepo{listRows: rowsOK}
			s := &Service{repo: f}

			got, err := s.Query(context.Background(), tt.q)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if !reflect.DeepEqual(got, rowsOK) {
				t.Errorf("rows = %+v, want %+v", got, rowsOK)
			}
			if n := f.listCalls.Load(); n != 1 {
				t.Errorf("List call count = %d, want 1", n)
			}
			gotQ := f.lastQuery.Load()
			if gotQ == nil || !reflect.DeepEqual(*gotQ, tt.q) {
				t.Errorf("filter forwarded to repo = %+v, want %+v", gotQ, tt.q)
			}
		})
	}
}

func TestQuery_NilSlicePassThrough(t *testing.T) {
	t.Parallel()
	f := &fakeRepo{listRows: nil}
	s := &Service{repo: f}
	got, err := s.Query(context.Background(), auditdb.AuditLogQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("service must not fabricate rows: got %+v, want nil pass-through", got)
	}
}

func TestQuery_ErrorWrapped(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db exploded")
	f := &fakeRepo{listErr: sentinel}
	s := &Service{repo: f}

	got, err := s.Query(context.Background(), auditdb.AuditLogQuery{})
	if got != nil {
		t.Errorf("rows on error = %+v, want nil", got)
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("err = %v, want it to unwrap to the repo sentinel", err)
	}
	if !strings.Contains(err.Error(), "auditviewersvc: query") {
		t.Errorf("err = %q, want a service-context prefix", err.Error())
	}
	if errors.Is(err, ErrNotConfigured) {
		t.Error("a repo error must never be reported as ErrNotConfigured")
	}
}

// ---------- DistinctCategories / DistinctActions ----------

func TestDistinctCategories(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		want := []string{"admin", "auth", "security"}
		f := &fakeRepo{cats: want}
		s := &Service{repo: f}
		got, err := s.DistinctCategories(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
		if n := f.catCalls.Load(); n != 1 {
			t.Errorf("call count = %d, want 1", n)
		}
	})

	t.Run("empty slice preserved (JSON [] not null)", func(t *testing.T) {
		t.Parallel()
		f := &fakeRepo{cats: []string{}}
		s := &Service{repo: f}
		got, err := s.DistinctCategories(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got == nil || len(got) != 0 {
			t.Errorf("want non-nil empty slice, got %v", got)
		}
	})

	t.Run("error wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("boom")
		f := &fakeRepo{catsErr: sentinel}
		s := &Service{repo: f}
		got, err := s.DistinctCategories(context.Background())
		if got != nil {
			t.Errorf("want nil on error, got %v", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "auditviewersvc: distinct categories") {
			t.Errorf("err = %v", err)
		}
	})
}

func TestDistinctActions(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		want := []string{"masked_reveal", "login", "delete_vehicle"}
		f := &fakeRepo{actions: want}
		s := &Service{repo: f}
		got, err := s.DistinctActions(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("got %v, want %v", got, want)
		}
		if n := f.actionCalls.Load(); n != 1 {
			t.Errorf("call count = %d, want 1", n)
		}
	})

	t.Run("empty slice preserved", func(t *testing.T) {
		t.Parallel()
		f := &fakeRepo{actions: []string{}}
		s := &Service{repo: f}
		got, err := s.DistinctActions(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got == nil || len(got) != 0 {
			t.Errorf("want non-nil empty slice, got %v", got)
		}
	})

	t.Run("error wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("boom")
		f := &fakeRepo{actionsErr: sentinel}
		s := &Service{repo: f}
		got, err := s.DistinctActions(context.Background())
		if got != nil {
			t.Errorf("want nil on error, got %v", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "auditviewersvc: distinct actions") {
			t.Errorf("err = %v", err)
		}
	})
}

// ---------- VerifyChain ----------

func TestVerifyChain_Success(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		badID   int64
		checked int
		limit   int
	}{
		{"intact chain", 0, 128, 500},
		{"tampered row surfaces first bad id", 42, 7, 1000},
		{"nothing to check", 0, 0, 10},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeRecorder{badID: tt.badID, checked: tt.checked}
			s := &Service{recorder: f}

			badID, checked, err := s.VerifyChain(context.Background(), since, tt.limit)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if badID != tt.badID {
				t.Errorf("firstBadID = %d, want %d", badID, tt.badID)
			}
			if checked != tt.checked {
				t.Errorf("checked = %d, want %d", checked, tt.checked)
			}
			if n := f.calls.Load(); n != 1 {
				t.Errorf("VerifyChain call count = %d, want 1", n)
			}
			if gs := f.lastSince.Load(); gs == nil || !gs.Equal(since) {
				t.Errorf("since forwarded = %v, want %v", gs, since)
			}
			if int(f.lastLimit.Load()) != tt.limit {
				t.Errorf("limit forwarded = %d, want %d", f.lastLimit.Load(), tt.limit)
			}
		})
	}
}

func TestVerifyChain_ErrorWrappedPreservesCounts(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	sentinel := errors.New("scan failed")
	f := &fakeRecorder{badID: 9, checked: 3, err: sentinel}
	s := &Service{recorder: f}

	badID, checked, err := s.VerifyChain(context.Background(), since, 100)
	if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "auditviewersvc: verify chain") {
		t.Errorf("err = %v, want wrapped sentinel with service context", err)
	}
	if badID != 9 || checked != 3 {
		t.Errorf("badID/checked = %d/%d, want 9/3 (recorder counts preserved on error)", badID, checked)
	}
	if errors.Is(err, ErrNotConfigured) {
		t.Error("a recorder error must never be reported as ErrNotConfigured")
	}
}

// ---------- sentinel + type aliases ----------

func TestErrNotConfigured(t *testing.T) {
	t.Parallel()
	if ErrNotConfigured == nil {
		t.Fatal("ErrNotConfigured must be a non-nil sentinel")
	}
	if !errors.Is(ErrNotConfigured, ErrNotConfigured) {
		t.Error("sentinel must match itself")
	}
	// The admin handler relies on unrelated errors NOT matching it.
	wrapped := fmt.Errorf("auditviewersvc: query: %w", errors.New("x"))
	if errors.Is(wrapped, ErrNotConfigured) {
		t.Error("an unrelated wrapped error must not match ErrNotConfigured")
	}
}

func TestTypeAliases(t *testing.T) {
	t.Parallel()
	// Query and Row are transparent aliases, so values assign both ways
	// with no conversion — this keeps internal/handler/v1 off a direct
	// internal/database import.
	q := Query{Limit: 5, Offset: 2, EntityType: "drive"}
	var backQ auditdb.AuditLogQuery = q
	if backQ.Limit != 5 || backQ.Offset != 2 || backQ.EntityType != "drive" {
		t.Errorf("Query alias lost fields: %+v", backQ)
	}

	row := Row{ID: 7, Actor: "alice", Action: "login"}
	var backRow auditdb.AuditLogRow = row
	if backRow.ID != 7 || backRow.Actor != "alice" || backRow.Action != "login" {
		t.Errorf("Row alias lost fields: %+v", backRow)
	}
}

// ---------- concurrency (race detector) ----------

// TestService_ConcurrentAccess proves the service is safe for concurrent
// use: it holds no mutable state after construction, so many goroutines
// can fan out across all four methods with `-race` staying clean.
func TestService_ConcurrentAccess(t *testing.T) {
	t.Parallel()
	f := &fakeRepo{
		listRows: []auditdb.AuditLogRow{{ID: 1, Actor: "a", Action: "x"}},
		cats:     []string{"auth"},
		actions:  []string{"login"},
	}
	rec := &fakeRecorder{badID: 0, checked: 5}
	s := &Service{repo: f, recorder: rec}

	const goroutines = 8
	const iters = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for g := 0; g < goroutines; g++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iters; j++ {
				if _, err := s.Query(context.Background(), auditdb.AuditLogQuery{Limit: j}); err != nil {
					t.Errorf("Query: %v", err)
					return
				}
				if _, err := s.DistinctCategories(context.Background()); err != nil {
					t.Errorf("DistinctCategories: %v", err)
					return
				}
				if _, err := s.DistinctActions(context.Background()); err != nil {
					t.Errorf("DistinctActions: %v", err)
					return
				}
				if _, _, err := s.VerifyChain(context.Background(), time.Time{}, j); err != nil {
					t.Errorf("VerifyChain: %v", err)
					return
				}
			}
		}()
	}
	wg.Wait()

	wantCalls := int64(goroutines * iters)
	if n := f.listCalls.Load(); n != wantCalls {
		t.Errorf("List calls = %d, want %d", n, wantCalls)
	}
	if n := f.catCalls.Load(); n != wantCalls {
		t.Errorf("DistinctCategories calls = %d, want %d", n, wantCalls)
	}
	if n := f.actionCalls.Load(); n != wantCalls {
		t.Errorf("DistinctActions calls = %d, want %d", n, wantCalls)
	}
	if n := rec.calls.Load(); n != wantCalls {
		t.Errorf("VerifyChain calls = %d, want %d", n, wantCalls)
	}
}
