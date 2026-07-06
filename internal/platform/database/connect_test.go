package database

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// TestConnect_ErrorPaths covers each failure branch of Connect. All three are
// reachable without dialing a real database: an invalid sslmode fails DSN
// parsing, MaxConns=0 fails pool construction, and a cancelled context makes
// the connectivity ping fail fast (the pool is lazy so nothing is dialed).
func TestConnect_ErrorPaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mutate    func(*config.DatabaseConfig)
		cancelCtx bool
		wantErr   string
	}{
		{
			name:    "invalid sslmode fails DSN parse",
			mutate:  func(c *config.DatabaseConfig) { c.SSLMode = "bogus" },
			wantErr: "parsing database DSN",
		},
		{
			name:    "zero max conns fails pool creation",
			mutate:  func(c *config.DatabaseConfig) { c.MaxConns = 0 },
			wantErr: "creating connection pool",
		},
		{
			name:      "cancelled context fails ping",
			mutate:    func(*config.DatabaseConfig) {},
			cancelCtx: true,
			wantErr:   "pinging database",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			cfg := validDBConfig()
			tt.mutate(&cfg)

			ctx := context.Background()
			if tt.cancelCtx {
				ctx = cancelledCtx()
			}

			db, err := Connect(ctx, cfg)
			if err == nil {
				t.Fatalf("Connect() error = nil, want error containing %q", tt.wantErr)
			}
			if db != nil {
				t.Errorf("Connect() returned non-nil DB %v on error, want nil", db)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Connect() error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestMustConnect_FatalOnError verifies MustConnect terminates the process with
// exit code 1 when the underlying Connect fails. It re-executes this test in a
// child process (the standard Go idiom for asserting on os.Exit) with an
// invalid sslmode so Connect fails at DSN parsing — no database is contacted.
func TestMustConnect_FatalOnError(t *testing.T) {
	if os.Getenv("APEX_DB_CRASH") == "1" {
		cfg := validDBConfig()
		cfg.SSLMode = "bogus"
		MustConnect(context.Background(), cfg)
		// Unreachable if MustConnect fatals as intended.
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=^TestMustConnect_FatalOnError$", "-test.v")
	cmd.Env = append(os.Environ(), "APEX_DB_CRASH=1")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()

	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("child process error = %v, want *exec.ExitError (non-zero exit); stderr=%q", err, stderr.String())
	}
	if got := exitErr.ExitCode(); got != 1 {
		t.Errorf("child exit code = %d, want 1; stderr=%q", got, stderr.String())
	}
	if !strings.Contains(stderr.String(), "failed to connect to database") {
		t.Errorf("child stderr = %q, want it to contain the fatal message", stderr.String())
	}
}

// TestDB_Close covers both branches of Close: the nil-pool guard (must not
// panic) and a real pool (closes cleanly; Close is idempotent).
func TestDB_Close(t *testing.T) {
	t.Run("nil pool does not panic", func(t *testing.T) {
		db := &DB{}
		db.Close() // must be a no-op, not a nil dereference
	})

	t.Run("real pool closes cleanly and is idempotent", func(t *testing.T) {
		db := &DB{Pool: newLazyPool(t)}
		db.Close()
		db.Close() // second call must remain safe
	})
}

// TestHealthPing exercises the extracted ping helper against a fake pinger,
// covering success, error propagation, deadline application, and parent-context
// cancellation.
func TestHealthPing(t *testing.T) {
	t.Parallel()

	t.Run("success applies a deadline", func(t *testing.T) {
		t.Parallel()
		p := &fakePinger{}
		if err := healthPing(context.Background(), p); err != nil {
			t.Fatalf("healthPing() error = %v, want nil", err)
		}
		if p.calls != 1 {
			t.Errorf("Ping calls = %d, want 1", p.calls)
		}
		if !p.sawDeadline {
			t.Error("Ping context had no deadline, want the 3s timeout applied")
		}
	})

	t.Run("propagates ping error", func(t *testing.T) {
		t.Parallel()
		p := &fakePinger{err: errBoom}
		err := healthPing(context.Background(), p)
		if !errors.Is(err, errBoom) {
			t.Fatalf("healthPing() error = %v, want errBoom", err)
		}
	})

	t.Run("cancelled parent context surfaces cancellation", func(t *testing.T) {
		t.Parallel()
		p := &fakePinger{returnCtxErr: true}
		err := healthPing(cancelledCtx(), p)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("healthPing() error = %v, want context.Canceled", err)
		}
	})
}

// TestDB_Health verifies the exported Health method delegates to the real pool.
// A cancelled context makes the lazy pool's ping fail immediately with no dial.
func TestDB_Health(t *testing.T) {
	db := &DB{Pool: newLazyPool(t)}
	err := db.Health(cancelledCtx())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Health() error = %v, want context.Canceled", err)
	}
}

// TestWithTx covers the transaction lifecycle branches of the extracted withTx
// helper using fakes: begin failure, fn failure (rollback), success (commit),
// and commit failure.
func TestWithTx(t *testing.T) {
	t.Parallel()

	t.Run("begin error is wrapped and fn never runs", func(t *testing.T) {
		t.Parallel()
		b := &fakeBeginner{err: errBoom}
		ranFn := false
		err := withTx(context.Background(), b, func(pgx.Tx) error {
			ranFn = true
			return nil
		})
		if !errors.Is(err, errBoom) {
			t.Fatalf("withTx() error = %v, want errBoom", err)
		}
		if !strings.Contains(err.Error(), "beginning transaction") {
			t.Errorf("withTx() error = %q, want it wrapped with 'beginning transaction'", err.Error())
		}
		if ranFn {
			t.Error("fn ran despite Begin failing")
		}
		if b.calls != 1 {
			t.Errorf("Begin calls = %d, want 1", b.calls)
		}
	})

	t.Run("fn error rolls back and returns the raw error", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		b := &fakeBeginner{tx: tx}
		err := withTx(context.Background(), b, func(pgx.Tx) error { return errBoom })
		if !errors.Is(err, errBoom) {
			t.Fatalf("withTx() error = %v, want errBoom", err)
		}
		if tx.rollbackCalls != 1 {
			t.Errorf("Rollback calls = %d, want 1", tx.rollbackCalls)
		}
		if tx.commitCalls != 0 {
			t.Errorf("Commit calls = %d, want 0", tx.commitCalls)
		}
	})

	t.Run("success commits and passes the tx to fn", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{}
		b := &fakeBeginner{tx: tx}
		var gotTx pgx.Tx
		err := withTx(context.Background(), b, func(inner pgx.Tx) error {
			gotTx = inner
			return nil
		})
		if err != nil {
			t.Fatalf("withTx() error = %v, want nil", err)
		}
		if gotTx != pgx.Tx(tx) {
			t.Error("fn received a different tx than Begin returned")
		}
		if tx.commitCalls != 1 {
			t.Errorf("Commit calls = %d, want 1", tx.commitCalls)
		}
		if tx.rollbackCalls != 0 {
			t.Errorf("Rollback calls = %d, want 0", tx.rollbackCalls)
		}
	})

	t.Run("commit error is propagated", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{commitErr: errBoom}
		b := &fakeBeginner{tx: tx}
		err := withTx(context.Background(), b, func(pgx.Tx) error { return nil })
		if !errors.Is(err, errBoom) {
			t.Fatalf("withTx() error = %v, want errBoom", err)
		}
		if tx.commitCalls != 1 {
			t.Errorf("Commit calls = %d, want 1", tx.commitCalls)
		}
	})
}

// TestWithTx_PanicRollsBackAndRepanics verifies a panic inside fn triggers a
// rollback and then re-propagates unchanged.
func TestWithTx_PanicRollsBackAndRepanics(t *testing.T) {
	tx := &fakeTx{}
	b := &fakeBeginner{tx: tx}

	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("withTx did not re-panic")
		}
		if r != "boom-panic" {
			t.Errorf("recovered panic = %v, want \"boom-panic\"", r)
		}
		if tx.rollbackCalls != 1 {
			t.Errorf("Rollback calls = %d, want 1", tx.rollbackCalls)
		}
		if tx.commitCalls != 0 {
			t.Errorf("Commit calls = %d, want 0", tx.commitCalls)
		}
	}()

	_ = withTx(context.Background(), b, func(pgx.Tx) error {
		panic("boom-panic")
	})
	t.Fatal("withTx should have re-panicked before returning")
}

// TestDB_WithTx_RealPoolBeginError verifies the exported WithTx method delegates
// to the real pool: a cancelled context fails Begin immediately (no dial) and
// the error is wrapped, with fn never invoked.
func TestDB_WithTx_RealPoolBeginError(t *testing.T) {
	db := &DB{Pool: newLazyPool(t)}
	ranFn := false
	err := db.WithTx(cancelledCtx(), func(pgx.Tx) error {
		ranFn = true
		return nil
	})
	if err == nil {
		t.Fatal("WithTx() error = nil, want a begin error")
	}
	if !strings.Contains(err.Error(), "beginning transaction") {
		t.Errorf("WithTx() error = %q, want it wrapped with 'beginning transaction'", err.Error())
	}
	if ranFn {
		t.Error("fn ran despite Begin failing")
	}
}

// TestDB_Stats asserts the pool statistics map is complete and reports the
// expected shape/values for a freshly-created lazy pool.
func TestDB_Stats(t *testing.T) {
	db := &DB{Pool: newLazyPool(t)}
	stats := db.Stats()

	wantKeys := []string{"total_conns", "idle_conns", "acquired_conns", "max_conns"}
	for _, k := range wantKeys {
		if _, ok := stats[k]; !ok {
			t.Errorf("Stats() missing key %q", k)
		}
	}
	if len(stats) != len(wantKeys) {
		t.Errorf("Stats() has %d keys, want %d (%v)", len(stats), len(wantKeys), stats)
	}

	if got, ok := stats["max_conns"].(int32); !ok || got != 4 {
		t.Errorf("Stats()[max_conns] = %v (%T), want int32(4)", stats["max_conns"], stats["max_conns"])
	}
	if got, ok := stats["total_conns"].(int32); !ok || got != 0 {
		t.Errorf("Stats()[total_conns] = %v (%T), want int32(0)", stats["total_conns"], stats["total_conns"])
	}
	if got, ok := stats["acquired_conns"].(int32); !ok || got != 0 {
		t.Errorf("Stats()[acquired_conns] = %v (%T), want int32(0)", stats["acquired_conns"], stats["acquired_conns"])
	}
}
