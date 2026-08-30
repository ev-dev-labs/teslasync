package admin

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func pinnedRow(p *dashboardmodel.PinnedItem) []any {
	return []any{p.ID, p.UserID, p.ItemType, p.ItemID, p.Position, p.PinnedAt, p.Context}
}

func samplePin() *dashboardmodel.PinnedItem {
	return &dashboardmodel.PinnedItem{
		ID:       11,
		UserID:   i64(1),
		ItemType: dashboardmodel.PinnedItemTypeWidget,
		ItemID:   "w-1",
		Position: 0,
		PinnedAt: time.Date(2026, 5, 5, 5, 0, 0, 0, time.UTC),
		Context:  strp("dash-1"),
	}
}

func TestPinnedRepo_List(t *testing.T) {
	t.Parallel()
	p1 := samplePin()
	p2 := samplePin()
	p2.ID = 12
	p2.Position = 1
	p2.Context = nil

	tests := []struct {
		name     string
		filter   PinnedListFilter
		script   queryResult
		wantLen  int
		errFrag  string
		wantArgs []any
	}{
		{
			name:     "success with context filter",
			filter:   PinnedListFilter{UserID: i64(1), ItemType: dashboardmodel.PinnedItemTypeWidget, Context: strp("dash-1")},
			script:   queryResult{rows: newFakeRows([][]any{pinnedRow(p1), pinnedRow(p2)})},
			wantLen:  2,
			wantArgs: []any{i64(1), "widget", true, "dash-1"},
		},
		{
			name:     "nil context disables context filter",
			filter:   PinnedListFilter{ItemType: dashboardmodel.PinnedItemTypeVehicle},
			script:   queryResult{rows: newFakeRows(nil)},
			wantLen:  0,
			wantArgs: []any{(*int64)(nil), "vehicle", false, ""},
		},
		{
			name:     "empty-string context still filters (hasContext true)",
			filter:   PinnedListFilter{ItemType: dashboardmodel.PinnedItemTypeWidget, Context: strp("")},
			script:   queryResult{rows: newFakeRows(nil)},
			wantLen:  0,
			wantArgs: []any{(*int64)(nil), "widget", true, ""},
		},
		{name: "query error", filter: PinnedListFilter{}, script: queryResult{err: errors.New("boom")}, errFrag: "pinned_items list query"},
		{name: "scan error", filter: PinnedListFilter{}, script: queryResult{rows: &fakeRows{data: [][]any{pinnedRow(p1)}, cursor: -1, scanErrAt: 0}}, errFrag: "pinned_items list scan"},
		{name: "iter error", filter: PinnedListFilter{}, script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errors.New("x")}}, errFrag: "pinned_items list iter"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &PinnedRepo{pool: pool}
			got, err := repo.List(context.Background(), tt.filter)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			assertArgsEqual(t, pool.queryCalls[0].args, tt.wantArgs)
			if tt.wantLen == 2 && (got[0].ItemType != dashboardmodel.PinnedItemTypeWidget || got[1].Context != nil) {
				t.Errorf("scanned rows wrong: %+v %+v", got[0], got[1])
			}
		})
	}
}

func TestPinnedRepo_GetByID(t *testing.T) {
	t.Parallel()
	p := samplePin()
	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: pinnedRow(p)}},
		{name: "not found", row: noRow(), wantNil: true},
		{name: "scan error", row: fakeRow{scanErr: errors.New("boom")}, errFrag: "pinned_items get_by_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &PinnedRepo{pool: pool}
			got, err := repo.GetByID(context.Background(), 11)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.ID != 11 || got.ItemID != "w-1" {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestPinnedRepo_Create(t *testing.T) {
	t.Parallel()
	insertRow := func() pgx.Row {
		return fakeRow{vals: []any{int64(11), int(0), time.Date(2026, 5, 5, 5, 0, 0, 0, time.UTC)}}
	}

	t.Run("begin error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errors.New("boom")}}}
		repo := &PinnedRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), samplePin()), "pinned_items create begin")
	})

	t.Run("shift error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errors.New("boom")}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &PinnedRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), samplePin()), "pinned_items create shift")
	})

	t.Run("duplicate maps to ErrPinnedAlreadyExists", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(3)}},
			queryRowQueue: []pgx.Row{fakeRow{scanErr: &pgconn.PgError{Code: "23505"}}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &PinnedRepo{pool: pool}
		err := repo.Create(context.Background(), samplePin())
		if !errors.Is(err, ErrPinnedAlreadyExists) {
			t.Fatalf("err=%v, want ErrPinnedAlreadyExists", err)
		}
		if tx.commitCalls != 0 {
			t.Errorf("must not commit on conflict")
		}
	})

	t.Run("other insert error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(3)}},
			queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &PinnedRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), samplePin()), "pinned_items create insert")
	})

	t.Run("commit error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(3)}},
			queryRowQueue: []pgx.Row{insertRow()},
			commitErr:     errors.New("boom"),
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &PinnedRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), samplePin()), "pinned_items create commit")
	})

	t.Run("success shifts then inserts at position 0", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(3)}},
			queryRowQueue: []pgx.Row{insertRow()},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &PinnedRepo{pool: pool}
		p := &dashboardmodel.PinnedItem{
			UserID:   i64(1),
			ItemType: dashboardmodel.PinnedItemTypeWidget,
			ItemID:   "w-1",
			Context:  strp("dash-1"),
		}
		if err := repo.Create(context.Background(), p); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if p.ID != 11 || p.Position != 0 {
			t.Fatalf("returned fields not populated: %+v", p)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit count=%d, want 1", tx.commitCalls)
		}
		// shift scopes by (user, type, context) — 3 args.
		assertArgsEqual(t, tx.execCalls[0].args, []any{i64(1), "widget", strp("dash-1")})
		// insert binds (user, type, item_id, context) — 4 args.
		assertArgsEqual(t, tx.queryRowCalls[0].args, []any{i64(1), "widget", "w-1", strp("dash-1")})
	})
}

func TestPinnedRepo_UpdatePosition(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "pinned_items update_position"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &PinnedRepo{pool: pool}
			err := repo.UpdatePosition(context.Background(), 11, 4)
			switch {
			case tt.wantErr != nil:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err=%v, want %v", err, tt.wantErr)
				}
			case tt.errFrag != "":
				requireErr(t, err, tt.errFrag)
			default:
				if err != nil {
					t.Fatalf("unexpected err: %v", err)
				}
				if !reflect.DeepEqual(pool.execCalls[0].args, []any{int64(11), int(4)}) {
					t.Errorf("args=%#v, want [11 4]", pool.execCalls[0].args)
				}
			}
		})
	}
}

func TestPinnedRepo_Delete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "pinned_items delete"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &PinnedRepo{pool: pool}
			err := repo.Delete(context.Background(), 11)
			switch {
			case tt.wantErr != nil:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err=%v, want %v", err, tt.wantErr)
				}
			case tt.errFrag != "":
				requireErr(t, err, tt.errFrag)
			default:
				if err != nil {
					t.Fatalf("unexpected err: %v", err)
				}
			}
		})
	}
}
