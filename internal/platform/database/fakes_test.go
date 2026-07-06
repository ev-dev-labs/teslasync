package database

// Shared in-package test doubles for the platform database pool wrapper.
//
// The DB methods talk to their *pgxpool.Pool through the local pinger /
// txBeginner seams (see connect.go), so these fakes let the ping and
// transaction branches be exercised without a live PostgreSQL — the same
// interface-seam approach the sibling repositories under internal/database/*
// use (e.g. internal/database/tesla's teslaPool + fakeTx). Everything here is
// deterministic and race-safe: no real DB, network, or Tesla API is touched.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// errBoom is the canonical synthetic failure used to drive error branches.
var errBoom = errors.New("boom")

// fakePinger implements the pinger seam. It records how many times Ping was
// called and whether the received context carried a deadline (proving Health's
// 3-second timeout was applied). When returnCtxErr is set it echoes the
// context error, so a cancelled parent context can be observed end-to-end.
type fakePinger struct {
	err          error
	returnCtxErr bool
	calls        int
	sawDeadline  bool
}

func (f *fakePinger) Ping(ctx context.Context) error {
	f.calls++
	_, f.sawDeadline = ctx.Deadline()
	if f.returnCtxErr {
		return ctx.Err()
	}
	return f.err
}

var _ pinger = (*fakePinger)(nil)

// fakeBeginner implements the txBeginner seam. Begin returns err when set,
// otherwise the scripted tx; calls are counted so tests can assert Begin ran
// exactly once.
type fakeBeginner struct {
	tx    pgx.Tx
	err   error
	calls int
}

func (f *fakeBeginner) Begin(_ context.Context) (pgx.Tx, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.tx, nil
}

var _ txBeginner = (*fakeBeginner)(nil)

// fakeTx implements pgx.Tx by embedding the interface so the many unused
// methods are satisfied for free; only Commit and Rollback — the two verbs
// withTx invokes — are overridden. Each records its invocation count and
// returns a configurable error so the commit-failure and rollback paths are
// reachable.
type fakeTx struct {
	pgx.Tx

	commitErr   error
	rollbackErr error

	commitCalls   int
	rollbackCalls int
}

func (t *fakeTx) Commit(_ context.Context) error {
	t.commitCalls++
	return t.commitErr
}

func (t *fakeTx) Rollback(_ context.Context) error {
	t.rollbackCalls++
	return t.rollbackErr
}

var _ pgx.Tx = (*fakeTx)(nil)

// validDBConfig returns a parseable DatabaseConfig pointing at a closed local
// port. With MinConns=0 the derived pool is lazy, so no connection is ever
// dialed unless a test explicitly forces one.
func validDBConfig() config.DatabaseConfig {
	return config.DatabaseConfig{
		Host:     "127.0.0.1",
		Port:     59999,
		User:     "u",
		Password: "p",
		Name:     "db",
		SSLMode:  "disable",
		MaxConns: 4,
		MinConns: 0,
	}
}

// newLazyPool builds a real *pgxpool.Pool with MinConns=0 so it never dials at
// construction time. It is registered for cleanup so the pool's background
// health-check goroutine is stopped when the test finishes (Close is safe to
// call more than once). Used to exercise the thin passthrough methods
// (Stats/Close/Migrate) and the real-pool delegation branches without a live
// database.
func newLazyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	cfg := validDBConfig()
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxConns)
	poolCfg.MinConns = int32(cfg.MinConns)
	pool, err := pgxpool.NewWithConfig(context.Background(), poolCfg)
	if err != nil {
		t.Fatalf("NewWithConfig: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// cancelledCtx returns a context that is already cancelled — used to force the
// ping / begin fast-fail branches without any network activity.
func cancelledCtx() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}
