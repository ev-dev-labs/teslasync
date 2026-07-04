package backup

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// TestBackupConfigRepo_NotConfigured proves every pool-touching method
// degrades to ErrRepoNotConfigured (never a nil-pointer panic) across all
// three ways a repo can lack a querier: nil *DB, a *DB with a nil Pool, and
// a zero-value struct.
func TestBackupConfigRepo_NotConfigured(t *testing.T) {
	ctx := context.Background()
	repos := map[string]*BackupConfigRepo{
		"nil DB":      NewBackupConfigRepo(nil),
		"nil Pool":    NewBackupConfigRepo(&database.DB{}),
		"zero struct": {},
	}
	for name, repo := range repos {
		t.Run(name, func(t *testing.T) {
			cfg := sampleConfig()
			checks := []struct {
				op   string
				call func() error
			}{
				{"Create", func() error { return repo.Create(ctx, &cfg) }},
				{"GetByID", func() error { _, err := repo.GetByID(ctx, 1); return err }},
				{"List", func() error { _, err := repo.List(ctx); return err }},
				{"Update", func() error { return repo.Update(ctx, &cfg) }},
				{"Delete", func() error { return repo.Delete(ctx, 1) }},
				{"GetDueConfigs", func() error { _, err := repo.GetDueConfigs(ctx); return err }},
				{"MarkRun", func() error { return repo.MarkRun(ctx, 1) }},
			}
			for _, c := range checks {
				if err := c.call(); !errors.Is(err, ErrRepoNotConfigured) {
					t.Errorf("%s: want ErrRepoNotConfigured, got %v", c.op, err)
				}
			}
		})
	}
}

func TestBackupConfigRepo_Create_NilConfig(t *testing.T) {
	ctx := context.Background()
	// nil-config guard runs before the ready() check, so even a fully wired
	// repo — and a not-configured one — must report ErrNilConfig.
	for name, repo := range map[string]*BackupConfigRepo{
		"configured":     {q: &fakeDBTX{}},
		"not configured": NewBackupConfigRepo(nil),
	} {
		t.Run(name, func(t *testing.T) {
			if err := repo.Create(ctx, nil); !errors.Is(err, ErrNilConfig) {
				t.Fatalf("want ErrNilConfig, got %v", err)
			}
		})
	}
}

func TestBackupConfigRepo_Create_Success(t *testing.T) {
	created := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		enabled     bool
		wantNextRun bool
	}{
		{"enabled computes next_run_at", true, true},
		{"disabled leaves next_run_at nil", false, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeDBTX{row: fakeRow{vals: []any{int64(101), created, created}}}
			repo := &BackupConfigRepo{q: f}
			cfg := sampleConfig()
			cfg.ID = 0
			cfg.Enabled = tc.enabled
			cfg.FrequencyDays = 2

			if err := repo.Create(context.Background(), &cfg); err != nil {
				t.Fatalf("Create: %v", err)
			}
			if cfg.ID != 101 {
				t.Errorf("RETURNING id not scanned: got %d", cfg.ID)
			}
			if !cfg.CreatedAt.Equal(created) || !cfg.UpdatedAt.Equal(created) {
				t.Errorf("RETURNING timestamps not scanned: %v / %v", cfg.CreatedAt, cfg.UpdatedAt)
			}
			if len(f.rowCalls) != 1 {
				t.Fatalf("want exactly one QueryRow, got %d", len(f.rowCalls))
			}
			call := f.rowCalls[0]
			if !strings.Contains(call.sql, "INSERT INTO backup_configs") {
				t.Errorf("not an INSERT: %s", call.sql)
			}
			if len(call.args) != 11 {
				t.Fatalf("want 11 bound args, got %d", len(call.args))
			}
			if call.args[1].(bool) != tc.enabled {
				t.Errorf("arg[1] enabled: got %v, want %v", call.args[1], tc.enabled)
			}
			nextRun, _ := call.args[10].(*time.Time)
			if tc.wantNextRun && nextRun == nil {
				t.Error("enabled config must compute next_run_at")
			}
			if !tc.wantNextRun && nextRun != nil {
				t.Errorf("disabled config must leave next_run_at nil, got %v", *nextRun)
			}
		})
	}
}

func TestBackupConfigRepo_Create_ScanErrorWrapped(t *testing.T) {
	boom := errors.New("insert boom")
	repo := &BackupConfigRepo{q: &fakeDBTX{row: fakeRow{err: boom}}}
	cfg := sampleConfig()
	err := repo.Create(context.Background(), &cfg)
	if !errors.Is(err, boom) {
		t.Fatalf("want wrapped boom, got %v", err)
	}
	if !strings.Contains(err.Error(), "backup config create") {
		t.Errorf("error missing context: %v", err)
	}
}

func TestBackupConfigRepo_GetByID(t *testing.T) {
	ctx := context.Background()
	want := sampleConfig()

	t.Run("success returns fully populated config", func(t *testing.T) {
		f := &fakeDBTX{row: fakeRow{vals: configScanVals(want)}}
		repo := &BackupConfigRepo{q: f}
		got, err := repo.GetByID(ctx, 42)
		if err != nil {
			t.Fatalf("GetByID: %v", err)
		}
		if got.ID != want.ID || got.Name != want.Name || got.Provider != want.Provider {
			t.Errorf("scalar mismatch: %+v", got)
		}
		if got.LastRunAt == nil || !got.LastRunAt.Equal(*want.LastRunAt) {
			t.Errorf("LastRunAt pointer not scanned: %v", got.LastRunAt)
		}
		if len(got.IncludeTables) != 2 || got.IncludeTables[0] != "vehicles" {
			t.Errorf("IncludeTables slice not scanned: %v", got.IncludeTables)
		}
		if string(got.ProviderConfig) != `{"path":"/data"}` {
			t.Errorf("ProviderConfig JSON not scanned: %s", got.ProviderConfig)
		}
		if len(f.rowCalls) != 1 || f.rowCalls[0].args[0].(int64) != 42 {
			t.Errorf("expected id=42 bound as $1, got %+v", f.rowCalls)
		}
		if !strings.Contains(f.rowCalls[0].sql, "WHERE id = $1") {
			t.Errorf("unexpected SQL: %s", f.rowCalls[0].sql)
		}
	})

	t.Run("not-found is a wrapped error, never (nil,nil)", func(t *testing.T) {
		// The handler maps any GetByID error to 404; returning (nil,nil)
		// would instead serialise a null 200. Pin the error contract.
		repo := &BackupConfigRepo{q: &fakeDBTX{row: fakeRow{err: pgx.ErrNoRows}}}
		got, err := repo.GetByID(ctx, 99)
		if got != nil {
			t.Errorf("want nil config on error, got %+v", got)
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("want pgx.ErrNoRows in chain, got %v", err)
		}
		if !strings.Contains(err.Error(), "backup config get 99") {
			t.Errorf("error missing context: %v", err)
		}
	})
}

func TestBackupConfigRepo_List(t *testing.T) {
	ctx := context.Background()
	c1 := sampleConfig()
	c2 := sampleConfig()
	c2.ID = 43
	c2.Name = "Weekly"

	t.Run("returns all rows and closes the cursor", func(t *testing.T) {
		rows := &fakeRows{rows: [][]any{configScanVals(c1), configScanVals(c2)}}
		f := &fakeDBTX{rows: rows}
		repo := &BackupConfigRepo{q: f}
		got, err := repo.List(ctx)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(got) != 2 || got[0].ID != 42 || got[1].ID != 43 {
			t.Fatalf("unexpected rows: %+v", got)
		}
		if !rows.closed {
			t.Error("rows.Close() was not called")
		}
		if !strings.Contains(f.queryCalls[0].sql, "ORDER BY created_at DESC") {
			t.Errorf("unexpected SQL: %s", f.queryCalls[0].sql)
		}
	})

	t.Run("empty result is a nil slice with no error", func(t *testing.T) {
		repo := &BackupConfigRepo{q: &fakeDBTX{rows: &fakeRows{}}}
		got, err := repo.List(ctx)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if got != nil {
			t.Errorf("want nil slice, got %#v", got)
		}
	})

	t.Run("query/scan/rows errors are wrapped", func(t *testing.T) {
		queryBoom := errors.New("query boom")
		scanBoom := errors.New("scan boom")
		rowsBoom := errors.New("rows boom")
		cases := []struct {
			name string
			f    *fakeDBTX
			want error
		}{
			{"query", &fakeDBTX{queryErr: queryBoom}, queryBoom},
			{"scan", &fakeDBTX{rows: &fakeRows{rows: [][]any{configScanVals(c1)}, scanErr: scanBoom}}, scanBoom},
			{"rows", &fakeDBTX{rows: &fakeRows{rows: [][]any{configScanVals(c1)}, errFinal: rowsBoom}}, rowsBoom},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				repo := &BackupConfigRepo{q: tc.f}
				got, err := repo.List(ctx)
				if got != nil {
					t.Errorf("want nil slice on error, got %#v", got)
				}
				if !errors.Is(err, tc.want) {
					t.Fatalf("want wrapped %v, got %v", tc.want, err)
				}
			})
		}
	})
}

func TestBackupConfigRepo_Update(t *testing.T) {
	ctx := context.Background()

	t.Run("nil config", func(t *testing.T) {
		repo := &BackupConfigRepo{q: &fakeDBTX{}}
		if err := repo.Update(ctx, nil); !errors.Is(err, ErrNilConfig) {
			t.Fatalf("want ErrNilConfig, got %v", err)
		}
	})

	cases := []struct {
		name     string
		enabled  bool
		wantNext bool
	}{
		{"enabled recomputes next_run_at", true, true},
		{"disabled clears next_run_at", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeDBTX{}
			repo := &BackupConfigRepo{q: f}
			cfg := sampleConfig()
			cfg.Enabled = tc.enabled
			if err := repo.Update(ctx, &cfg); err != nil {
				t.Fatalf("Update: %v", err)
			}
			if len(f.execCalls) != 1 {
				t.Fatalf("want 1 Exec, got %d", len(f.execCalls))
			}
			call := f.execCalls[0]
			if !strings.Contains(call.sql, "UPDATE backup_configs SET") {
				t.Errorf("unexpected SQL: %s", call.sql)
			}
			if len(call.args) != 12 {
				t.Fatalf("want 12 args, got %d", len(call.args))
			}
			if call.args[0].(int64) != cfg.ID {
				t.Errorf("id must bind as $1, got %v", call.args[0])
			}
			nextRun, _ := call.args[11].(*time.Time)
			if tc.wantNext && nextRun == nil {
				t.Error("enabled config must set next_run_at")
			}
			if !tc.wantNext && nextRun != nil {
				t.Errorf("disabled config must leave next_run_at nil, got %v", *nextRun)
			}
		})
	}

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("update boom")
		repo := &BackupConfigRepo{q: &fakeDBTX{execErr: boom}}
		cfg := sampleConfig()
		err := repo.Update(ctx, &cfg)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup config update 42") {
			t.Fatalf("want wrapped boom with id context, got %v", err)
		}
	})
}

func TestBackupConfigRepo_Delete(t *testing.T) {
	ctx := context.Background()

	t.Run("success binds id and issues DELETE", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupConfigRepo{q: f}
		if err := repo.Delete(ctx, 7); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if len(f.execCalls) != 1 {
			t.Fatalf("want 1 Exec, got %d", len(f.execCalls))
		}
		call := f.execCalls[0]
		if !strings.Contains(call.sql, "DELETE FROM backup_configs WHERE id = $1") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0].(int64) != 7 {
			t.Errorf("want id=7, got %v", call.args[0])
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("delete boom")
		repo := &BackupConfigRepo{q: &fakeDBTX{execErr: boom}}
		err := repo.Delete(ctx, 7)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup config delete 7") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

func TestBackupConfigRepo_GetDueConfigs(t *testing.T) {
	ctx := context.Background()
	due := sampleConfig()

	t.Run("returns due rows with the enabled+next_run predicate", func(t *testing.T) {
		f := &fakeDBTX{rows: &fakeRows{rows: [][]any{configScanVals(due)}}}
		repo := &BackupConfigRepo{q: f}
		got, err := repo.GetDueConfigs(ctx)
		if err != nil {
			t.Fatalf("GetDueConfigs: %v", err)
		}
		if len(got) != 1 || got[0].ID != due.ID {
			t.Fatalf("unexpected rows: %+v", got)
		}
		sql := f.queryCalls[0].sql
		if !strings.Contains(sql, "enabled = true") || !strings.Contains(sql, "next_run_at IS NULL OR next_run_at <= NOW()") {
			t.Errorf("due predicate missing: %s", sql)
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		boom := errors.New("due boom")
		repo := &BackupConfigRepo{q: &fakeDBTX{queryErr: boom}}
		_, err := repo.GetDueConfigs(ctx)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup config due") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}

func TestBackupConfigRepo_MarkRun(t *testing.T) {
	ctx := context.Background()

	t.Run("advances last/next run for id", func(t *testing.T) {
		f := &fakeDBTX{}
		repo := &BackupConfigRepo{q: f}
		if err := repo.MarkRun(ctx, 5); err != nil {
			t.Fatalf("MarkRun: %v", err)
		}
		call := f.execCalls[0]
		if !strings.Contains(call.sql, "last_run_at = NOW()") || !strings.Contains(call.sql, "INTERVAL") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0].(int64) != 5 {
			t.Errorf("want id=5, got %v", call.args[0])
		}
	})

	t.Run("exec error wrapped", func(t *testing.T) {
		boom := errors.New("mark boom")
		repo := &BackupConfigRepo{q: &fakeDBTX{execErr: boom}}
		err := repo.MarkRun(ctx, 5)
		if !errors.Is(err, boom) || !strings.Contains(err.Error(), "backup config mark run 5") {
			t.Fatalf("want wrapped boom, got %v", err)
		}
	})
}
