package admin

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
)

func layoutRow(l *dashboardmodel.DashboardLayout) []any {
	return []any{l.ID, l.UserID, l.VehicleID, l.Name, l.IsDefault, l.Layout, l.CreatedAt, l.UpdatedAt}
}

func sampleLayout() *dashboardmodel.DashboardLayout {
	ts := time.Date(2026, 4, 4, 4, 0, 0, 0, time.UTC)
	return &dashboardmodel.DashboardLayout{
		ID:        3,
		UserID:    i64(1),
		VehicleID: i64(9),
		Name:      "default",
		IsDefault: true,
		Layout:    json.RawMessage(`{"widgets":[]}`),
		CreatedAt: ts,
		UpdatedAt: ts,
	}
}

func TestDashboardLayoutRepo_List(t *testing.T) {
	t.Parallel()
	l1 := sampleLayout()
	l2 := sampleLayout()
	l2.ID = 4
	l2.IsDefault = false
	l2.UserID = nil

	tests := []struct {
		name    string
		script  queryResult
		wantLen int
		errFrag string
	}{
		{name: "success", script: queryResult{rows: newFakeRows([][]any{layoutRow(l1), layoutRow(l2)})}, wantLen: 2},
		{name: "empty", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0},
		{name: "query error", script: queryResult{err: errors.New("boom")}, errFrag: "dashboard_layouts list query"},
		{name: "scan error", script: queryResult{rows: &fakeRows{data: [][]any{layoutRow(l1)}, cursor: -1, scanErrAt: 0}}, errFrag: "dashboard_layouts list scan"},
		{name: "iter error", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errors.New("iter fail")}}, errFrag: "iter fail"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &DashboardLayoutRepo{pool: pool}
			got, err := repo.List(context.Background(), i64(1), i64(9))
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
			assertArgsEqual(t, pool.queryCalls[0].args, []any{i64(1), i64(9)})
			if tt.wantLen == 2 && !reflect.DeepEqual([]byte(got[0].Layout), []byte(`{"widgets":[]}`)) {
				t.Errorf("layout json not scanned: %s", got[0].Layout)
			}
		})
	}
}

func TestDashboardLayoutRepo_GetByID(t *testing.T) {
	t.Parallel()
	l := sampleLayout()
	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: layoutRow(l)}},
		{name: "not found", row: noRow(), wantNil: true},
		{name: "scan error", row: fakeRow{scanErr: errors.New("boom")}, errFrag: "dashboard_layouts get_by_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &DashboardLayoutRepo{pool: pool}
			got, err := repo.GetByID(context.Background(), 3)
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
			if got == nil || got.ID != 3 || got.Name != "default" {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestDashboardLayoutRepo_Create(t *testing.T) {
	t.Parallel()
	t.Run("success populates ids", func(t *testing.T) {
		t.Parallel()
		ts := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(55), ts, ts}}}}
		repo := &DashboardLayoutRepo{pool: pool}
		l := &dashboardmodel.DashboardLayout{Name: "new", Layout: json.RawMessage(`{}`)}
		if err := repo.Create(context.Background(), l); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if l.ID != 55 || !l.CreatedAt.Equal(ts) || !l.UpdatedAt.Equal(ts) {
			t.Fatalf("ids not populated: %+v", l)
		}
		if got := len(pool.queryRowCalls[0].args); got != 6 {
			t.Fatalf("Create must bind 6 args (created_at+updated_at share $6), got %d", got)
		}
	})
	t.Run("scan error wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.Create(context.Background(), sampleLayout()), "dashboard_layouts create")
	})
}

func TestDashboardLayoutRepo_Update(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "dashboard_layouts update"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &DashboardLayoutRepo{pool: pool}
			err := repo.Update(context.Background(), 3, "renamed", []byte(`{"a":1}`), false)
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
				args := pool.execCalls[0].args
				if args[0] != int64(3) || args[1] != "renamed" || args[3] != false {
					t.Errorf("update args wrong: %#v", args)
				}
			}
		})
	}
}

func TestDashboardLayoutRepo_Delete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "dashboard_layouts delete"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &DashboardLayoutRepo{pool: pool}
			err := repo.Delete(context.Background(), 3)
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

func TestDashboardLayoutRepo_SetDefault(t *testing.T) {
	t.Parallel()

	// lookupRow scans the (user_id, vehicle_id) tuple used to scope the clear.
	lookupRow := func() pgx.Row { return fakeRow{vals: []any{i64(1), i64(9)}} }

	t.Run("begin error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginQueue: []beginResult{{err: errors.New("boom")}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.SetDefault(context.Background(), 3), "dashboard_layouts set_default begin")
	})

	t.Run("lookup not found returns ErrNoRows", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{noRow()}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		if err := repo.SetDefault(context.Background(), 3); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("err=%v, want ErrNoRows", err)
		}
		if tx.commitCalls != 0 {
			t.Errorf("must not commit on lookup miss")
		}
		if tx.rollbackCalls == 0 {
			t.Errorf("deferred rollback must run")
		}
	})

	t.Run("lookup error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.SetDefault(context.Background(), 3), "dashboard_layouts set_default lookup")
	})

	t.Run("clear error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{lookupRow()},
			execQueue:     []execResult{{err: errors.New("boom")}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.SetDefault(context.Background(), 3), "dashboard_layouts set_default clear")
	})

	t.Run("set error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{lookupRow()},
			execQueue:     []execResult{{tag: tag(1)}, {err: errors.New("boom")}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.SetDefault(context.Background(), 3), "dashboard_layouts set_default set")
	})

	t.Run("commit error wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{lookupRow()},
			execQueue:     []execResult{{tag: tag(1)}, {tag: tag(1)}},
			commitErr:     errors.New("boom"),
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		requireErr(t, repo.SetDefault(context.Background(), 3), "dashboard_layouts set_default commit")
	})

	t.Run("success commits and scopes clear by tuple", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{lookupRow()},
			execQueue:     []execResult{{tag: tag(2)}, {tag: tag(1)}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		repo := &DashboardLayoutRepo{pool: pool}
		if err := repo.SetDefault(context.Background(), 3); err != nil {
			t.Fatalf("SetDefault: %v", err)
		}
		if tx.commitCalls != 1 {
			t.Errorf("commit count=%d, want 1", tx.commitCalls)
		}
		if len(tx.execCalls) != 2 {
			t.Fatalf("want 2 Exec (clear+set), got %d", len(tx.execCalls))
		}
		// clear is scoped by id<>$1 plus the (user_id,vehicle_id) tuple.
		clearArgs := tx.execCalls[0].args
		assertArgsEqual(t, clearArgs, []any{int64(3), i64(1), i64(9)})
		// set flips exactly id=$1.
		assertArgsEqual(t, tx.execCalls[1].args, []any{int64(3)})
	})
}
