package admin

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
)

// annRow builds the 11-column []any that chart_annotations SELECTs scan into,
// in the exact column order used by List / GetByID.
func annRow(a *dashboardmodel.ChartAnnotation) []any {
	return []any{
		a.ID, a.UserID, a.VehicleID, a.OccurredAt, a.Category,
		a.Title, a.Description, a.Scope, a.Color, a.CreatedAt, a.UpdatedAt,
	}
}

func sampleAnnotation() *dashboardmodel.ChartAnnotation {
	ts := time.Date(2026, 3, 1, 8, 0, 0, 0, time.UTC)
	return &dashboardmodel.ChartAnnotation{
		ID:          7,
		UserID:      i64(1),
		VehicleID:   i64(42),
		OccurredAt:  ts,
		Category:    dashboardmodel.AnnotationCategoryMaintenance,
		Title:       "tire change",
		Description: strp("all four"),
		Scope:       []string{"tire"},
		Color:       strp("#abc"),
		CreatedAt:   ts,
		UpdatedAt:   ts,
	}
}

func TestChartAnnotationRepo_List(t *testing.T) {
	t.Parallel()
	a1 := sampleAnnotation()
	a2 := sampleAnnotation()
	a2.ID = 8
	a2.VehicleID = nil
	a2.Description = nil
	a2.Color = nil
	a2.Scope = []string{}

	tests := []struct {
		name     string
		filter   ChartAnnotationFilter
		script   queryResult
		wantLen  int
		wantErr  bool
		errFrag  string
		wantArgs []any
	}{
		{
			name:     "success two rows",
			filter:   ChartAnnotationFilter{VehicleID: i64(42), Scope: "tire"},
			script:   queryResult{rows: newFakeRows([][]any{annRow(a1), annRow(a2)})},
			wantLen:  2,
			wantArgs: []any{i64(42), (*time.Time)(nil), (*time.Time)(nil), "tire"},
		},
		{
			name:    "empty result",
			filter:  ChartAnnotationFilter{},
			script:  queryResult{rows: newFakeRows(nil)},
			wantLen: 0,
		},
		{
			name:    "query error",
			filter:  ChartAnnotationFilter{},
			script:  queryResult{err: errors.New("boom")},
			wantErr: true,
			errFrag: "chart_annotations list query",
		},
		{
			name:    "scan error",
			filter:  ChartAnnotationFilter{},
			script:  queryResult{rows: &fakeRows{data: [][]any{annRow(a1)}, cursor: -1, scanErrAt: 0}},
			wantErr: true,
			errFrag: "chart_annotations list scan",
		},
		{
			name:    "iter error",
			filter:  ChartAnnotationFilter{},
			script:  queryResult{rows: &fakeRows{data: [][]any{annRow(a1)}, cursor: -1, scanErrAt: -1, iterErr: errors.New("iter")}},
			wantErr: true,
			errFrag: "chart_annotations list iter",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &ChartAnnotationRepo{pool: pool}

			got, err := repo.List(context.Background(), tt.filter)
			if tt.wantErr {
				requireErr(t, err, tt.errFrag)
				if got != nil {
					t.Errorf("want nil slice on error, got %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			if tt.wantArgs != nil {
				if len(pool.queryCalls) != 1 {
					t.Fatalf("want 1 query call, got %d", len(pool.queryCalls))
				}
				assertArgsEqual(t, pool.queryCalls[0].args, tt.wantArgs)
			}
			if tt.wantLen == 2 {
				if got[0].ID != 7 || got[1].ID != 8 {
					t.Errorf("row order/ids wrong: %d,%d", got[0].ID, got[1].ID)
				}
				if got[1].VehicleID != nil {
					t.Errorf("row2 vehicle_id should be nil, got %v", *got[1].VehicleID)
				}
				if !reflect.DeepEqual(got[0].Scope, []string{"tire"}) {
					t.Errorf("row1 scope=%v, want [tire]", got[0].Scope)
				}
			}
		})
	}
}

func TestChartAnnotationRepo_GetByID(t *testing.T) {
	t.Parallel()
	a := sampleAnnotation()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		wantErr bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: annRow(a)}},
		{name: "not found", row: noRow(), wantNil: true},
		{name: "scan error", row: fakeRow{scanErr: errors.New("boom")}, wantErr: true, errFrag: "chart_annotations get_by_id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &ChartAnnotationRepo{pool: pool}

			got, err := repo.GetByID(context.Background(), 7)
			if tt.wantErr {
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
			if got == nil || got.ID != 7 || got.Title != "tire change" {
				t.Fatalf("unexpected row: %+v", got)
			}
			if len(pool.queryRowCalls) != 1 || !reflect.DeepEqual(pool.queryRowCalls[0].args, []any{int64(7)}) {
				t.Errorf("GetByID must bind id=$1, got %+v", pool.queryRowCalls)
			}
		})
	}
}

func TestChartAnnotationRepo_Create(t *testing.T) {
	t.Parallel()

	t.Run("success normalizes nil scope and populates ids", func(t *testing.T) {
		t.Parallel()
		created := time.Date(2026, 2, 2, 2, 2, 2, 0, time.UTC)
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(99), created, created}}}}
		repo := &ChartAnnotationRepo{pool: pool}

		a := &dashboardmodel.ChartAnnotation{
			OccurredAt: created,
			Category:   dashboardmodel.AnnotationCategoryMilestone,
			Title:      "100k miles",
			Scope:      nil, // must be normalized to []string{}
		}
		if err := repo.Create(context.Background(), a); err != nil {
			t.Fatalf("Create: %v", err)
		}
		if a.ID != 99 || !a.CreatedAt.Equal(created) || !a.UpdatedAt.Equal(created) {
			t.Fatalf("ids not populated: %+v", a)
		}
		if a.Scope == nil || len(a.Scope) != 0 {
			t.Fatalf("scope must be normalized to non-nil empty, got %#v", a.Scope)
		}
		// scope arg (index 6) must be a non-nil empty []string, not nil.
		if len(pool.queryRowCalls) != 1 {
			t.Fatalf("want 1 QueryRow, got %d", len(pool.queryRowCalls))
		}
		scopeArg, ok := pool.queryRowCalls[0].args[6].([]string)
		if !ok || scopeArg == nil {
			t.Fatalf("scope arg must be non-nil []string, got %#v", pool.queryRowCalls[0].args[6])
		}
		// created_at + updated_at both bind arg $9 (same timestamp).
		if got := len(pool.queryRowCalls[0].args); got != 9 {
			t.Fatalf("Create must bind 9 args, got %d", got)
		}
	})

	t.Run("scan error is wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errors.New("boom")}}}
		repo := &ChartAnnotationRepo{pool: pool}
		err := repo.Create(context.Background(), sampleAnnotation())
		requireErr(t, err, "chart_annotations create")
	})
}

func TestChartAnnotationRepo_Update(t *testing.T) {
	t.Parallel()
	newTitle := "renamed"
	newCat := dashboardmodel.AnnotationCategoryUpgrade

	tests := []struct {
		name       string
		getRow     pgx.Row
		exec       *execResult // nil => Exec not expected
		patch      ChartAnnotationUpdate
		wantErr    error
		errFrag    string
		verifyArgs func(t *testing.T, args []any)
	}{
		{
			name:    "not found returns ErrNoRows",
			getRow:  noRow(),
			wantErr: pgx.ErrNoRows,
		},
		{
			name:    "get error propagates wrapped",
			getRow:  fakeRow{scanErr: errors.New("boom")},
			errFrag: "chart_annotations get_by_id",
		},
		{
			name:    "exec error wrapped",
			getRow:  fakeRow{vals: annRow(sampleAnnotation())},
			exec:    &execResult{err: errors.New("boom")},
			errFrag: "chart_annotations update",
		},
		{
			name:    "zero rows affected returns ErrNoRows",
			getRow:  fakeRow{vals: annRow(sampleAnnotation())},
			exec:    &execResult{tag: tag(0)},
			wantErr: pgx.ErrNoRows,
		},
		{
			name:   "patch title and category",
			getRow: fakeRow{vals: annRow(sampleAnnotation())},
			exec:   &execResult{tag: tag(1)},
			patch:  ChartAnnotationUpdate{Title: &newTitle, Category: &newCat},
			verifyArgs: func(t *testing.T, args []any) {
				if args[3] != "renamed" {
					t.Errorf("title arg=%v, want renamed", args[3])
				}
				if args[2] != string(dashboardmodel.AnnotationCategoryUpgrade) {
					t.Errorf("category arg=%v, want upgrade", args[2])
				}
			},
		},
		{
			name:   "patch all non-clear fields",
			getRow: fakeRow{vals: annRow(sampleAnnotation())},
			exec:   &execResult{tag: tag(1)},
			patch: ChartAnnotationUpdate{
				OccurredAt:  timePtr(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)),
				Description: strp("updated desc"),
				Scope:       &[]string{"battery", "cost"},
				Color:       strp("#123"),
			},
			verifyArgs: func(t *testing.T, args []any) {
				if occ, ok := args[1].(time.Time); !ok || !occ.Equal(time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)) {
					t.Errorf("occurred_at arg=%v, want 2027-01-01", args[1])
				}
				if d, ok := args[4].(*string); !ok || d == nil || *d != "updated desc" {
					t.Errorf("description arg=%#v, want *string updated desc", args[4])
				}
				if sc, ok := args[5].([]string); !ok || !reflect.DeepEqual(sc, []string{"battery", "cost"}) {
					t.Errorf("scope arg=%#v, want [battery cost]", args[5])
				}
				if c, ok := args[6].(*string); !ok || c == nil || *c != "#123" {
					t.Errorf("color arg=%#v, want *string #123", args[6])
				}
			},
		},
		{
			name:   "clear description wins over set",
			getRow: fakeRow{vals: annRow(sampleAnnotation())},
			exec:   &execResult{tag: tag(1)},
			patch:  ChartAnnotationUpdate{ClearDescription: true, Description: strp("ignored")},
			verifyArgs: func(t *testing.T, args []any) {
				if args[4] != (*string)(nil) {
					t.Errorf("description arg=%v, want nil (cleared)", args[4])
				}
			},
		},
		{
			name:   "clear color wins over set",
			getRow: fakeRow{vals: annRow(sampleAnnotation())},
			exec:   &execResult{tag: tag(1)},
			patch:  ChartAnnotationUpdate{ClearColor: true, Color: strp("#fff")},
			verifyArgs: func(t *testing.T, args []any) {
				if args[6] != (*string)(nil) {
					t.Errorf("color arg=%v, want nil (cleared)", args[6])
				}
			},
		},
		{
			name: "nil scope patch normalized to empty slice",
			getRow: func() pgx.Row {
				a := sampleAnnotation()
				a.Scope = nil
				return fakeRow{vals: annRow(a)}
			}(),
			exec:  &execResult{tag: tag(1)},
			patch: ChartAnnotationUpdate{},
			verifyArgs: func(t *testing.T, args []any) {
				sc, ok := args[5].([]string)
				if !ok || sc == nil {
					t.Errorf("scope arg must be non-nil []string, got %#v", args[5])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.getRow}}
			if tt.exec != nil {
				pool.execQueue = []execResult{*tt.exec}
			}
			repo := &ChartAnnotationRepo{pool: pool}

			err := repo.Update(context.Background(), 7, tt.patch)
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
				if tt.verifyArgs != nil {
					if len(pool.execCalls) != 1 {
						t.Fatalf("want 1 Exec, got %d", len(pool.execCalls))
					}
					tt.verifyArgs(t, pool.execCalls[0].args)
				}
			}
		})
	}
}

func TestChartAnnotationRepo_Delete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		exec    execResult
		wantErr error
		errFrag string
	}{
		{name: "success", exec: execResult{tag: tag(1)}},
		{name: "exec error", exec: execResult{err: errors.New("boom")}, errFrag: "chart_annotations delete"},
		{name: "not found", exec: execResult{tag: tag(0)}, wantErr: pgx.ErrNoRows},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{execQueue: []execResult{tt.exec}}
			repo := &ChartAnnotationRepo{pool: pool}
			err := repo.Delete(context.Background(), 7)
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
				if len(pool.execCalls) != 1 || !reflect.DeepEqual(pool.execCalls[0].args, []any{int64(7)}) {
					t.Errorf("Delete must bind id=$1, got %+v", pool.execCalls)
				}
			}
		})
	}
}
