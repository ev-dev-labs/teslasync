package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

var exportCols = []string{
	"id", "user_id", "format", "vehicle_id", "date_from", "date_to",
	"fsm_state", "file_path", "file_size", "failed_reason", "created_at", "completed_at",
}

func exportRow(j export.ExportJob) []any {
	return []any{
		j.ID, j.UserID, j.Format, j.VehicleID, j.DateFrom, j.DateTo,
		j.FSMState, j.FilePath, j.FileSize, j.FailedReason, j.CreatedAt, j.CompletedAt,
	}
}

func sampleExport() export.ExportJob {
	base := time.Date(2026, 7, 8, 9, 10, 11, 0, time.UTC)
	return export.ExportJob{
		ID:           "300",
		UserID:       "7",
		Format:       "csv",
		VehicleID:    "42",
		DateFrom:     base.Add(-24 * time.Hour),
		DateTo:       base,
		FSMState:     fsm.State("completed"),
		FilePath:     "/tmp/export-300.csv",
		FileSize:     2048,
		FailedReason: "",
		CreatedAt:    base,
		CompletedAt:  base.Add(time.Minute),
	}
}

func TestNewExportJobRepository(t *testing.T) {
	t.Parallel()
	repo := NewExportJobRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewExportJobRepository returned nil")
	}
	var _ repository.ExportJobRepository = repo
	if _, ok := repo.(*exportRepository); !ok {
		t.Fatalf("returned %T, want *exportRepository", repo)
	}
}

func TestExportRepository_singleRowGetters(t *testing.T) {
	t.Parallel()
	want := sampleExport()
	row := exportRow(want)

	runGetter(t, "GetByID", row, want, queries.GetExportJobByID, "300", "scanning export job 300",
		func(pool *fakePool) (*export.ExportJob, error) {
			return (&exportRepository{pool: pool}).GetByID(context.Background(), "300")
		})
	runGetter(t, "GetByIDForUpdate", row, want, queries.GetExportJobByIDForUpdate, "300", "scanning export job 300",
		func(pool *fakePool) (*export.ExportJob, error) {
			return (&exportRepository{pool: pool}).GetByIDForUpdate(context.Background(), "300")
		})
}

func TestExportRepository_GetByUserID(t *testing.T) {
	t.Parallel()
	j1 := sampleExport()
	j2 := sampleExport()
	j2.ID = "301"
	j2.Format = "json"
	scenarios := listScenarios(exportCols, exportRow, []export.ExportJob{j1, j2},
		"querying export jobs for user", "collecting export jobs for user")
	runListMethod(t, scenarios, queries.GetExportJobsByUserID, []any{"7"},
		func(pool *fakePool) ([]export.ExportJob, error) {
			return (&exportRepository{pool: pool}).GetByUserID(context.Background(), "7")
		})
}

func TestExportRepository_Save(t *testing.T) {
	t.Parallel()
	j := sampleExport()
	execBoom := errors.New("disk full")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&exportRepository{pool: pool}).Save(context.Background(), &j); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertExportJob {
			t.Errorf("SQL = %q, want UpsertExportJob", pool.execSQL)
		}
		wantArgs := []any{
			j.ID, j.UserID, j.Format, j.VehicleID, j.DateFrom, j.DateTo,
			j.FSMState, j.FilePath, j.FileSize, j.FailedReason, j.CreatedAt, j.CompletedAt,
		}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&exportRepository{pool: pool}).Save(context.Background(), &j)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving export job 300") {
			t.Errorf("error %q missing context 'saving export job 300'", err)
		}
	})
}
