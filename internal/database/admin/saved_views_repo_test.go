package admin

import (
	"context"
	"errors"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func savedViewRow(v *dashboardmodel.SavedView) []any {
	return []any{
		v.ID, v.UserID, v.Name, v.Route, v.Query,
		v.IsDefault, v.IsPinned, v.SortOrder, v.CreatedAt, v.UpdatedAt,
	}
}

func sampleView() *dashboardmodel.SavedView {
	ts := time.Date(2026, 6, 6, 6, 0, 0, 0, time.UTC)
	return &dashboardmodel.SavedView{
		ID:        21,
		UserID:    i64(1),
		Name:      "recent",
		Route:     "/drives",
		Query:     "?range=7d",
		IsDefault: true,
		IsPinned:  false,
		SortOrder: 2,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestSavedViewsRepo_List(t *testing.T) {
	t.Parallel()
	v1 := sampleView()
	v2 := sampleView()
	v2.ID = 22
	v2.UserID = nil
	v2.IsPinned = true

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{savedViewRow(v1), savedViewRow(v2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error", script: queryResult{err: errors.New("boom")}, errFrag: "saved_views list query"},
		{name: "scan error", script: queryResult{rows: &fakeRows{data: [][]any{savedViewRow(v1)}, cursor: -1, scanErrAt: 0}}, errFrag: "saved_views list scan"},
		{name: "iter error", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errors.New("x")}}, errFrag: "saved_views list iter"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &SavedViewsRepo{pool: pool}
			got, err := repo.List(context.Background(), SavedViewListFilter{UserID: i64(1), Route: "/drives"})
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
			assertArgsEqual(t, pool.queryCalls[0].args, []any{i64(1), "/drives"})
			if tt.wantLen == 2 && (got[0].Name != "recent" || !got[1].IsPinned) {
				t.Errorf("scanned rows wrong: %+v %+v", got[0], got[1])
			}
		})
	}
}

func TestSavedViewsRepo_GetByID(t *testing.T) {
	t.Parallel()
	v := sampleView()
	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: savedViewRow(v)}},
		{name: "not found", row: noRow(), wantNil: true},
		{name: "scan error", row: fakeRow{scanErr: errors.New("boom")}, errFrag: "saved_views get_by_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &SavedViewsRepo{pool: pool}
			got, err := repo.GetByID(context.Background(), 21)
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
			if got == nil || got.ID != 21 || got.Route != "/drives" {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestSavedViewsRepo_Create(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	insertRow := func() pgx.Row { return fakeRow{vals: []any{int64(21), ts, ts}} }

	t.Run("begin error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errors.New("boom")}}}
		repo := &SavedViewsRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), sampleView()), "saved_views create begin")
	})

	t.Run("clear-default error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errors.New("boom")}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		v := sampleView() // IsDefault=true triggers clearDefaultTx
		requireErr(t, repo.Create(context.Background(), v), "saved_views clear default")
	})

	t.Run("duplicate maps to ErrSavedViewAlreadyExists", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(1)}}, // clearDefault
			queryRowQueue: []pgx.Row{fakeRow{scanErr: &pgconn.PgError{Code: "23505"}}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		err := repo.Create(context.Background(), sampleView())
		if !errors.Is(err, ErrSavedViewAlreadyExists) {
			t.Fatalf("err=%v, want ErrSavedViewAlreadyExists", err)
		}
	})

	t.Run("other insert error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(1)}},
			queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), sampleView()), "saved_views create insert")
	})

	t.Run("commit error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(1)}},
			queryRowQueue: []pgx.Row{insertRow()},
			commitErr:     errors.New("boom"),
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), sampleView()), "saved_views create commit")
	})

	t.Run("non-default view skips clear-default", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{insertRow()}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		v := sampleView()
		v.IsDefault = false
		if err := repo.Create(context.Background(), v); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if len(tx.execCalls) != 0 {
			t.Errorf("clearDefault must be skipped when IsDefault=false, got %d Exec calls", len(tx.execCalls))
		}
		if v.ID != 21 || tx.commitCalls != 1 {
			t.Errorf("post-create state wrong: id=%d commits=%d", v.ID, tx.commitCalls)
		}
	})

	t.Run("default view clears prior default then inserts", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			execQueue:     []execResult{{tag: tag(1)}},
			queryRowQueue: []pgx.Row{insertRow()},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		v := sampleView()
		if err := repo.Create(context.Background(), v); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if len(tx.execCalls) != 1 {
			t.Fatalf("want 1 clearDefault Exec, got %d", len(tx.execCalls))
		}
		assertArgsEqual(t, tx.execCalls[0].args, []any{i64(1), "/drives"})
	})
}

func TestSavedViewsRepo_Update(t *testing.T) {
	t.Parallel()
	loadRow := func() pgx.Row { return fakeRow{vals: []any{i64(1), "/drives"}} }
	updatedRow := func() pgx.Row {
		v := sampleView()
		v.Name = "renamed"
		return fakeRow{vals: savedViewRow(v)}
	}
	newName := "renamed"
	yes := true

	t.Run("begin error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errors.New("boom")}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{})
		requireErr(t, err, "saved_views update begin")
	})

	t.Run("load not found returns ErrNoRows", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{noRow()}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		got, err := repo.Update(context.Background(), 21, SavedViewUpdate{})
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err=%v, want ErrNoRows", err)
		}
		if got != nil {
			t.Errorf("want nil view, got %+v", got)
		}
	})

	t.Run("load error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{})
		requireErr(t, err, "saved_views update load")
	})

	t.Run("clear-default error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{loadRow()},
			execQueue:     []execResult{{err: errors.New("boom")}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{IsDefault: &yes})
		requireErr(t, err, "saved_views clear default")
	})

	t.Run("duplicate maps to ErrSavedViewAlreadyExists", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{loadRow(), fakeRow{scanErr: &pgconn.PgError{Code: "23505"}}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{Name: &newName})
		if !errors.Is(err, ErrSavedViewAlreadyExists) {
			t.Fatalf("err=%v, want ErrSavedViewAlreadyExists", err)
		}
	})

	t.Run("update exec error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{loadRow(), fakeRow{scanErr: errors.New("boom")}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{Name: &newName})
		requireErr(t, err, "saved_views update exec")
	})

	t.Run("commit error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{loadRow(), updatedRow()},
			commitErr:     errors.New("boom"),
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		_, err := repo.Update(context.Background(), 21, SavedViewUpdate{Name: &newName})
		requireErr(t, err, "saved_views update commit")
	})

	t.Run("success returns updated row and binds patch", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{loadRow(), updatedRow()}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &SavedViewsRepo{pool: pool}
		got, err := repo.Update(context.Background(), 21, SavedViewUpdate{Name: &newName})
		if err != nil {
			t.Fatalf("Update: %v", err)
		}
		if got == nil || got.Name != "renamed" {
			t.Fatalf("returned view wrong: %+v", got)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit count=%d, want 1", tx.commitCalls)
		}
		// UPDATE binds (id, name, query, is_default, is_pinned, sort_order).
		updArgs := tx.queryRowCalls[1].args
		if len(updArgs) != 6 || updArgs[0] != int64(21) {
			t.Fatalf("update args wrong: %#v", updArgs)
		}
		if gotName, ok := updArgs[1].(*string); !ok || gotName == nil || *gotName != "renamed" {
			t.Errorf("name arg=%#v, want *string renamed", updArgs[1])
		}
	})
}

func TestSavedViewsRepo_Delete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "saved_views delete"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &SavedViewsRepo{pool: pool}
			err := repo.Delete(context.Background(), 21)
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

// TestClearDefaultTx exercises the unexported helper directly against a fakeTx
// so its wrapping + arg binding is pinned independent of Create / Update.
func TestClearDefaultTx(t *testing.T) {
	t.Parallel()

	t.Run("success binds user+route", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{tag: tag(1)}}}
		if err := clearDefaultTx(context.Background(), tx, i64(1), "/drives"); err != nil {
			t.Fatalf("clearDefaultTx: %v", err)
		}
		assertArgsEqual(t, tx.execCalls[0].args, []any{i64(1), "/drives"})
	})

	t.Run("error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execQueue: []execResult{{err: errors.New("boom")}}}
		err := clearDefaultTx(context.Background(), tx, nil, "/drives")
		requireErr(t, err, "saved_views clear default")
	})
}
