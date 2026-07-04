package geofence

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// FilterExistingIDs
// ---------------------------------------------------------------------------

func TestFilterExistingIDs(t *testing.T) {
	t.Run("empty input short-circuits without querying", func(t *testing.T) {
		pool := &fakePool{}
		got, err := newRepo(pool).FilterExistingIDs(context.Background(), nil)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got != nil {
			t.Fatalf("want nil, got %v", got)
		}
		if len(pool.queryCalls) != 0 {
			t.Fatalf("empty input must not query, got %d calls", len(pool.queryCalls))
		}
	})

	t.Run("returns the subset that exists", func(t *testing.T) {
		rows := newFakeRows([][]any{{int64(1)}, {int64(3)}})
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		ids := []int64{1, 2, 3}

		got, err := newRepo(pool).FilterExistingIDs(context.Background(), ids)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if !reflect.DeepEqual(got, []int64{1, 3}) {
			t.Fatalf("want [1 3], got %v", got)
		}
		call := pool.queryCalls[0]
		if !strings.Contains(call.sql, "WHERE id = ANY($1)") {
			t.Errorf("SQL missing ANY($1): %s", call.sql)
		}
		if len(call.args) != 1 || !reflect.DeepEqual(call.args[0], ids) {
			t.Errorf("args: want [[1 2 3]], got %v", call.args)
		}
	})

	t.Run("query error is wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).FilterExistingIDs(context.Background(), []int64{1})
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "geofences-repo-filter-existing") {
			t.Fatalf("want wrapped filter-existing error, got %v", err)
		}
	})

	t.Run("scan error is wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{{int64(1)}})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).FilterExistingIDs(context.Background(), []int64{1})
		if err == nil || !strings.Contains(err.Error(), "filter-existing scan") {
			t.Fatalf("want scan error, got %v", err)
		}
	})

	t.Run("iteration error is wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{{int64(1)}})
		rows.iterErr = errBoom
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).FilterExistingIDs(context.Background(), []int64{1})
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "iter") {
			t.Fatalf("want wrapped iter error, got %v", err)
		}
	})
}

// ---------------------------------------------------------------------------
// BulkDelete
// ---------------------------------------------------------------------------

func TestBulkDelete(t *testing.T) {
	t.Run("empty input short-circuits without a transaction", func(t *testing.T) {
		pool := &fakePool{}
		n, err := newRepo(pool).BulkDelete(context.Background(), nil)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if n != 0 {
			t.Fatalf("want 0, got %d", n)
		}
		if pool.beginCalls != 0 {
			t.Fatalf("empty input must not begin a tx, got %d", pool.beginCalls)
		}
	})

	t.Run("success commits and returns rows affected", func(t *testing.T) {
		ids := []int64{1, 2, 3}
		tx := &fakeTx{execQueue: []execResult{{tag: tag(3)}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

		n, err := newRepo(pool).BulkDelete(context.Background(), ids)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if n != 3 {
			t.Fatalf("want 3 deleted, got %d", n)
		}
		if len(tx.execCalls) != 1 {
			t.Fatalf("want 1 Exec, got %d", len(tx.execCalls))
		}
		call := tx.execCalls[0]
		if !strings.Contains(call.sql, "DELETE FROM geofences WHERE id = ANY($1)") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if len(call.args) != 1 || !reflect.DeepEqual(call.args[0], ids) {
			t.Errorf("args: want [[1 2 3]], got %v", call.args)
		}
		if tx.commitCalls != 1 {
			t.Errorf("want exactly one Commit, got %d", tx.commitCalls)
		}
	})

	t.Run("begin error is wrapped and skips exec", func(t *testing.T) {
		pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
		n, err := newRepo(pool).BulkDelete(context.Background(), []int64{1})
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "begin") {
			t.Fatalf("want wrapped begin error, got %v", err)
		}
		if n != 0 {
			t.Fatalf("want 0 on error, got %d", n)
		}
	})

	t.Run("exec error rolls back and never commits", func(t *testing.T) {
		tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

		n, err := newRepo(pool).BulkDelete(context.Background(), []int64{1})
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "geofences-repo-bulk-delete") {
			t.Fatalf("want wrapped bulk-delete error, got %v", err)
		}
		if n != 0 {
			t.Fatalf("want 0 on error, got %d", n)
		}
		if tx.commitCalls != 0 {
			t.Errorf("must not commit on exec error, commits=%d", tx.commitCalls)
		}
		if tx.rollbackCalls != 1 {
			t.Errorf("want exactly one deferred Rollback, got %d", tx.rollbackCalls)
		}
	})

	t.Run("commit error is wrapped", func(t *testing.T) {
		tx := &fakeTx{execQueue: []execResult{{tag: tag(2)}}, commitErr: errBoom}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

		n, err := newRepo(pool).BulkDelete(context.Background(), []int64{1, 2})
		if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "commit") {
			t.Fatalf("want wrapped commit error, got %v", err)
		}
		if n != 0 {
			t.Fatalf("want 0 on commit error, got %d", n)
		}
		if tx.rollbackCalls != 1 {
			t.Errorf("want deferred Rollback after failed commit, got %d", tx.rollbackCalls)
		}
	})
}
