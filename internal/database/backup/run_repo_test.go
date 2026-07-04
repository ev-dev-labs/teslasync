package backup

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestBackupRunRepo_NotConfigured(t *testing.T) {
	ctx := context.Background()
	repos := map[string]*BackupRunRepo{
		"nil DB":      NewBackupRunRepo(nil),
		"nil Pool":    NewBackupRunRepo(&database.DB{}),
		"zero struct": {},
	}
	for name, repo := range repos {
		t.Run(name, func(t *testing.T) {
			run := sampleRun()
			checks := []struct {
				op   string
				call func() error
			}{
				{"Create", func() error { return repo.Create(ctx, &run) }},
				{"UpdateStatus", func() error { return repo.UpdateStatus(ctx, 1, "running") }},
				{"Complete", func() error { return repo.Complete(ctx, 1, "completed", "f", "p", 1, 1, 1, "c", 1) }},
				{"Fail", func() error { return repo.Fail(ctx, 1, "err", 1) }},
				{"GetByID", func() error { _, err := repo.GetByID(ctx, 1); return err }},
				{"List", func() error { _, err := repo.List(ctx, 10, 0); return err }},
				{"ListByConfig", func() error { _, err := repo.ListByConfig(ctx, 1, 10); return err }},
				{"LatestSuccessful", func() error { _, err := repo.LatestSuccessful(ctx); return err }},
				{"CleanupOld", func() error { _, err := repo.CleanupOld(ctx, 1, 5); return err }},
			}
			for _, c := range checks {
				if err := c.call(); !errors.Is(err, ErrRepoNotConfigured) {
					t.Errorf("%s: want ErrRepoNotConfigured, got %v", c.op, err)
				}
			}
		})
	}
}

func TestBackupRunRepo_Create_NilRun(t *testing.T) {
	ctx := context.Background()
	for name, repo := range map[string]*BackupRunRepo{
		"configured":     {q: &fakeDBTX{}},
		"not configured": NewBackupRunRepo(nil),
	} {
		t.Run(name, func(t *testing.T) {
			if err := repo.Create(ctx, nil); !errors.Is(err, ErrNilRun) {
				t.Fatalf("want ErrNilRun, got %v", err)
			}
		})
	}
}

func TestBackupRunRepo_Create_Success(t *testing.T) {
	created := time.Date(2026, 6, 1, 11, 0, 0, 0, time.UTC)
	f := &fakeDBTX{row: fakeRow{vals: []any{int64(77), created}}}
	repo := &BackupRunRepo{q: f}
	run := sampleRun()
	run.ID = 0
	if err := repo.Create(context.Background(), &run); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if run.ID != 77 {
		t.Errorf("RETURNING id not scanned: got %d", run.ID)
	}
	if !run.CreatedAt.Equal(created) {
		t.Errorf("RETURNING created_at not scanned: got %v", run.CreatedAt)
	}
	if len(f.rowCalls) != 1 {
		t.Fatalf("want 1 QueryRow, got %d", len(f.rowCalls))
	}
	call := f.rowCalls[0]
	if !strings.Contains(call.sql, "INSERT INTO backup_runs") {
		t.Errorf("not an INSERT: %s", call.sql)
	}
	if len(call.args) != 6 {
		t.Fatalf("want 6 args, got %d", len(call.args))
	}
	if call.args[3].(string) != run.Status {
		t.Errorf("arg[3] status: got %v, want %v", call.args[3], run.Status)
	}
}

func TestBackupRunRepo_Create_ScanErrorWrapped(t *testing.T) {
	boom := errors.New("insert boom")
	repo := &BackupRunRepo{q: &fakeDBTX{row: fakeRow{err: boom}}}
	run := sampleRun()
	err := repo.Create(context.Background(), &run)
	if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run create") {
		t.Fatalf("want wrapped boom, got %v", err)
	}
}

func TestBackupRunRepo_UpdateStatus(t *testing.T) {
	ctx := context.Background()

	t.Run("running branch stamps started_at", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupRunRepo{q: f}
		if err := repo.UpdateStatus(ctx, 3, "running"); err != nil {
			t.Fatalf("UpdateStatus: %v", err)
		}
		call := f.execCalls[0]
		if !strings.Contains(call.sql, "started_at=$3") {
			t.Errorf("running must set started_at: %s", call.sql)
		}
		if len(call.args) != 3 {
			t.Fatalf("running wants 3 args (id,status,now), got %d", len(call.args))
		}
		if _, ok := call.args[2].(time.Time); !ok {
			t.Errorf("arg[2] should be started_at time, got %T", call.args[2])
		}
	})

	t.Run("non-running branch omits started_at", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupRunRepo{q: f}
		if err := repo.UpdateStatus(ctx, 3, "verify_failed"); err != nil {
			t.Fatalf("UpdateStatus: %v", err)
		}
		call := f.execCalls[0]
		if strings.Contains(call.sql, "started_at") {
			t.Errorf("non-running must not touch started_at: %s", call.sql)
		}
		if len(call.args) != 2 {
			t.Fatalf("non-running wants 2 args, got %d", len(call.args))
		}
	})

	t.Run("errors are wrapped in both branches", func(t *testing.T) {
		for _, status := range []string{"running", "verify_failed"} {
			boom := errors.New("status boom")
			repo := &BackupRunRepo{q: &fakeDBTX{execErr: boom}}
			err := repo.UpdateStatus(ctx, 9, status)
			if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run 9") {
				t.Errorf("status=%s: want wrapped boom, got %v", status, err)
			}
		}
	})
}

func TestBackupRunRepo_Complete(t *testing.T) {
	ctx := context.Background()

	t.Run("binds all completion fields", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupRunRepo{q: f}
		err := repo.Complete(ctx, 4, "completed", "backup.json", "backups/backup.json", 4096, 900, 12, "abc123", 5000)
		if err != nil {
			t.Fatalf("Complete: %v", err)
		}
		call := f.execCalls[0]
		if !strings.Contains(call.sql, "completed_at=$10") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if len(call.args) != 10 {
			t.Fatalf("want 10 args, got %d", len(call.args))
		}
		if call.args[0].(int64) != 4 || call.args[1].(string) != "completed" {
			t.Errorf("id/status not bound: %v / %v", call.args[0], call.args[1])
		}
		if call.args[4].(int64) != 4096 || call.args[8].(int64) != 5000 {
			t.Errorf("size/duration not bound: %v / %v", call.args[4], call.args[8])
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("complete boom")
		repo := &BackupRunRepo{q: &fakeDBTX{execErr: boom}}
		err := repo.Complete(ctx, 4, "completed", "f", "p", 1, 1, 1, "c", 1)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run 4 complete") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

func TestBackupRunRepo_Fail(t *testing.T) {
	ctx := context.Background()

	t.Run("sets failed status and error message", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupRunRepo{q: f}
		if err := repo.Fail(ctx, 6, "disk full", 1200); err != nil {
			t.Fatalf("Fail: %v", err)
		}
		call := f.execCalls[0]
		if !strings.Contains(call.sql, "status='failed'") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if len(call.args) != 4 {
			t.Fatalf("want 4 args, got %d", len(call.args))
		}
		if call.args[1].(string) != "disk full" {
			t.Errorf("error_message not bound: %v", call.args[1])
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("fail boom")
		repo := &BackupRunRepo{q: &fakeDBTX{execErr: boom}}
		err := repo.Fail(ctx, 6, "x", 1)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run 6 fail") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

func TestBackupRunRepo_GetByID(t *testing.T) {
	ctx := context.Background()
	want := sampleRun()

	t.Run("success returns fully populated run", func(t *testing.T) {
		f := &fakeDBTX{row: fakeRow{vals: runScanVals(want)}}
		repo := &BackupRunRepo{q: f}
		got, err := repo.GetByID(ctx, 7)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if got.ID != want.ID || got.Status != want.Status {
			t.Errorf("scalar mismatch: %+v", got)
		}
		if got.ConfigID == nil || *got.ConfigID != *want.ConfigID {
			t.Errorf("ConfigID pointer not scanned: %v", got.ConfigID)
		}
		if got.FilePath == nil || *got.FilePath != *want.FilePath {
			t.Errorf("FilePath pointer not scanned: %v", got.FilePath)
		}
		if got.ErrorMessage != nil {
			t.Errorf("nil ErrorMessage must round-trip as nil, got %v", *got.ErrorMessage)
		}
		if f.rowCalls[0].args[0].(int64) != 7 {
			t.Errorf("id not bound: %v", f.rowCalls[0].args[0])
		}
	})

	t.Run("error wrapped", func(t *testing.T) {
		repo := &BackupRunRepo{q: &fakeDBTX{row: fakeRow{err: pgx.ErrNoRows}}}
		got, err := repo.GetByID(ctx, 99)
		if got != nil {
			t.Errorf("want nil run, got %+v", got)
		}
		if !errors.Is(err, pgx.ErrNoRows) || !strings.Contains(err.Error(), "backup run get 99") {
			t.Fatalf("want wrapped ErrNoRows, got %v", err)
		}
	})
}

func TestBackupRunRepo_List(t *testing.T) {
	ctx := context.Background()
	r1 := sampleRun()
	r2 := sampleRun()
	r2.ID = 8

	t.Run("returns rows and binds limit/offset", func(t *testing.T) {
		rows := &fakeRows{rows: [][]any{runScanVals(r1), runScanVals(r2)}}
		f := &fakeDBTX{rows: rows}
		repo := &BackupRunRepo{q: f}
		got, err := repo.List(ctx, 25, 50)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(got) != 2 || got[0].ID != 7 || got[1].ID != 8 {
			t.Fatalf("unexpected rows: %+v", got)
		}
		if !rows.closed {
			t.Error("rows.Close() not called")
		}
		call := f.queryCalls[0]
		if !strings.Contains(call.sql, "LIMIT $1 OFFSET $2") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0].(int) != 25 || call.args[1].(int) != 50 {
			t.Errorf("limit/offset not bound: %v / %v", call.args[0], call.args[1])
		}
	})

	t.Run("empty is nil slice", func(t *testing.T) {
		repo := &BackupRunRepo{q: &fakeDBTX{rows: &fakeRows{}}}
		got, err := repo.List(ctx, 10, 0)
		if err != nil || got != nil {
			t.Fatalf("want (nil,nil), got (%#v, %v)", got, err)
		}
	})

	t.Run("query/scan/rows errors wrapped", func(t *testing.T) {
		queryBoom := errors.New("query boom")
		scanBoom := errors.New("scan boom")
		rowsBoom := errors.New("rows boom")
		cases := []struct {
			name string
			f    *fakeDBTX
			want error
		}{
			{"query", &fakeDBTX{queryErr: queryBoom}, queryBoom},
			{"scan", &fakeDBTX{rows: &fakeRows{rows: [][]any{runScanVals(r1)}, scanErr: scanBoom}}, scanBoom},
			{"rows", &fakeDBTX{rows: &fakeRows{rows: [][]any{runScanVals(r1)}, errFinal: rowsBoom}}, rowsBoom},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				repo := &BackupRunRepo{q: tc.f}
				_, err := repo.List(ctx, 10, 0)
				if !errors.Is(err, tc.want) {
					t.Fatalf("want wrapped %v, got %v", tc.want, err)
				}
			})
		}
	})
}

func TestBackupRunRepo_ListByConfig(t *testing.T) {
	ctx := context.Background()
	r1 := sampleRun()

	t.Run("filters by config_id and binds limit", func(t *testing.T) {
		f := &fakeDBTX{rows: &fakeRows{rows: [][]any{runScanVals(r1)}}}
		repo := &BackupRunRepo{q: f}
		got, err := repo.ListByConfig(ctx, 42, 15)
		if err != nil {
			t.Fatalf("ListByConfig: %v", err)
		}
		if len(got) != 1 || got[0].ID != r1.ID {
			t.Fatalf("unexpected rows: %+v", got)
		}
		call := f.queryCalls[0]
		if !strings.Contains(call.sql, "WHERE config_id = $1") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0].(int64) != 42 || call.args[1].(int) != 15 {
			t.Errorf("config_id/limit not bound: %v / %v", call.args[0], call.args[1])
		}
	})

	t.Run("query error wrapped with config context", func(t *testing.T) {
		boom := errors.New("lbc boom")
		repo := &BackupRunRepo{q: &fakeDBTX{queryErr: boom}}
		_, err := repo.ListByConfig(ctx, 42, 15)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run list config 42") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

// TestBackupRunRepo_LatestSuccessful_StatusMisnamePin is the regression
// guard for the R2-style status misname. The processor records a fully
// successful backup as status='completed' (never 'success'); the query must
// match that literal or backup-verify silently reports "no successful
// backup found" for every real backup.
func TestBackupRunRepo_LatestSuccessful(t *testing.T) {
	ctx := context.Background()

	t.Run("matches status=completed, not the never-written success", func(t *testing.T) {
		want := sampleRun()
		f := &fakeDBTX{row: fakeRow{vals: runScanVals(want)}}
		repo := &BackupRunRepo{q: f}
		got, err := repo.LatestSuccessful(ctx)
		if err != nil {
			t.Fatalf("LatestSuccessful: %v", err)
		}
		if got == nil || got.ID != want.ID {
			t.Fatalf("want run %d, got %+v", want.ID, got)
		}
		sql := f.rowCalls[0].sql
		if !strings.Contains(sql, "status = 'completed'") {
			t.Errorf("must filter on the status the processor writes ('completed'); SQL: %s", sql)
		}
		if strings.Contains(sql, "status = 'success'") {
			t.Errorf("regression: filters on 'success', which nothing ever writes; SQL: %s", sql)
		}
		if !strings.Contains(sql, "file_path IS NOT NULL") {
			t.Errorf("must require a stored artifact; SQL: %s", sql)
		}
	})

	t.Run("no successful backup yields (nil,nil)", func(t *testing.T) {
		repo := &BackupRunRepo{q: &fakeDBTX{row: fakeRow{err: pgx.ErrNoRows}}}
		got, err := repo.LatestSuccessful(ctx)
		if got != nil || err != nil {
			t.Fatalf("want (nil,nil), got (%+v, %v)", got, err)
		}
	})

	t.Run("other errors are wrapped", func(t *testing.T) {
		boom := errors.New("scan boom")
		repo := &BackupRunRepo{q: &fakeDBTX{row: fakeRow{err: boom}}}
		got, err := repo.LatestSuccessful(ctx)
		if got != nil {
			t.Errorf("want nil run, got %+v", got)
		}
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "latest successful") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

func TestBackupRunRepo_CleanupOld(t *testing.T) {
	ctx := context.Background()

	t.Run("rejects non-positive retention", func(t *testing.T) {
		for _, keepN := range []int{0, -1, -100} {
			repo := &BackupRunRepo{q: &fakeDBTX{}}
			got, err := repo.CleanupOld(ctx, 1, keepN)
			if !errors.Is(err, ErrInvalidRetention) {
				t.Errorf("keepN=%d: want ErrInvalidRetention, got %v", keepN, err)
			}
			if got != 0 {
				t.Errorf("keepN=%d: want 0 rows, got %d", keepN, got)
			}
		}
	})

	t.Run("guard runs before touching the pool", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupRunRepo{q: f}
		if _, err := repo.CleanupOld(ctx, 1, 0); !errors.Is(err, ErrInvalidRetention) {
			t.Fatalf("want ErrInvalidRetention, got %v", err)
		}
		if len(f.execCalls) != 0 {
			t.Errorf("invalid retention must not issue a DELETE, got %d execs", len(f.execCalls))
		}
	})

	t.Run("returns rows affected", func(t *testing.T) {
		f := &fakeDBTX{execTag: pgconn.NewCommandTag("DELETE 3")}
		repo := &BackupRunRepo{q: f}
		got, err := repo.CleanupOld(ctx, 42, 5)
		if err != nil {
			t.Fatalf("CleanupOld: %v", err)
		}
		if got != 3 {
			t.Errorf("want 3 rows affected, got %d", got)
		}
		call := f.execCalls[0]
		if call.args[0].(int64) != 42 || call.args[1].(int) != 5 {
			t.Errorf("config_id/keepN not bound: %v / %v", call.args[0], call.args[1])
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("cleanup boom")
		repo := &BackupRunRepo{q: &fakeDBTX{execErr: boom}}
		got, err := repo.CleanupOld(ctx, 42, 5)
		if got != 0 {
			t.Errorf("want 0 on error, got %d", got)
		}
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup run cleanup config 42") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}
