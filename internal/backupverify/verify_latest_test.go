package backupverify

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/ev-dev-labs/teslasync/internal/backup"
)

func writeLocalBackup(t *testing.T, dir string, tables map[string]any) (filePath, checksum string, cfgJSON json.RawMessage) {
	t.Helper()
	payload, err := json.Marshal(tables)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	checksum = hex.EncodeToString(sum[:])
	filePath = "backups/latest.json"
	if err := os.MkdirAll(filepath.Join(dir, "backups"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, filePath), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	cfgJSON, err = json.Marshal(map[string]string{"path": dir})
	if err != nil {
		t.Fatal(err)
	}
	return filePath, checksum, cfgJSON
}

func TestVerifyLatest_NilVerifier(t *testing.T) {
	t.Parallel()
	var v *Verifier
	res, err := v.VerifyLatest(context.Background())
	if err == nil || res == nil || res.Error != "nil verifier" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestNewVerifier_Defaults(t *testing.T) {
	t.Parallel()
	v := NewVerifier(&backup.Processor{}, &fakeRuns{}, &fakeConfigs{}, nil, 0)
	if len(v.criticals) != 1 || v.criticals[0] != "vehicles" {
		t.Fatalf("criticals=%v", v.criticals)
	}
	if v.maxAge != 7*24*time.Hour {
		t.Fatalf("maxAge=%s", v.maxAge)
	}
}

func TestVerifyLatest_LookupAndValidationFailures(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	proc := &backup.Processor{}
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)

	t.Run("latest run error", func(t *testing.T) {
		v := NewVerifier(proc, &fakeRuns{err: errors.New("db")}, &fakeConfigs{}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "lookup latest run") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("no successful backup", func(t *testing.T) {
		v := NewVerifier(proc, &fakeRuns{run: nil}, &fakeConfigs{}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || res.Error != "no successful backup found" {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("stale", func(t *testing.T) {
		cid := int64(9)
		run := &backupmodel.BackupRun{ID: 3, ConfigID: &cid, CreatedAt: now.Add(-48 * time.Hour)}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "old") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("missing config id", func(t *testing.T) {
		run := &backupmodel.BackupRun{ID: 3, CreatedAt: now}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "no config_id") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("invalid checksum", func(t *testing.T) {
		cid := int64(9)
		bad := "not-sha"
		run := &backupmodel.BackupRun{ID: 3, ConfigID: &cid, CreatedAt: now, Checksum: &bad}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "SHA-256") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("config lookup error", func(t *testing.T) {
		cid := int64(9)
		sum := strings.Repeat("ab", 32)
		run := &backupmodel.BackupRun{ID: 3, ConfigID: &cid, CreatedAt: now, Checksum: &sum}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{err: errors.New("cfg")}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "lookup config") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})

	t.Run("config missing", func(t *testing.T) {
		cid := int64(9)
		sum := strings.Repeat("ab", 32)
		run := &backupmodel.BackupRun{ID: 3, ConfigID: &cid, CreatedAt: now, Checksum: &sum}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: nil}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "not found") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})
}

func TestVerifyLatest_RestoreAndTableInvariants(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	ctx := context.Background()
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	cid := int64(4)
	proc := &backup.Processor{}

	t.Run("success", func(t *testing.T) {
		path, checksum, cfgJSON := writeLocalBackup(t, dir, map[string]any{
			"vehicles": []map[string]any{{"id": 1}, {"id": 2}},
			"drives":   []map[string]any{{"id": 9}},
		})
		run := &backupmodel.BackupRun{
			ID:        11,
			ConfigID:  &cid,
			CreatedAt: now.Add(-time.Minute),
			FilePath:  &path,
			Checksum:  &checksum,
		}
		cfg := &backupmodel.BackupConfig{ID: cid, Provider: "local", ProviderConfig: cfgJSON}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: cfg}, []string{"vehicles", "drives"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err != nil || !res.OK || !res.ChecksumOK {
			t.Fatalf("res=%+v err=%v", res, err)
		}
		if res.RunID != 11 || len(res.TablesVerified) != 2 {
			t.Fatalf("res=%+v", res)
		}
	})

	t.Run("missing table", func(t *testing.T) {
		path, checksum, cfgJSON := writeLocalBackup(t, filepath.Join(dir, "missing"), map[string]any{
			"vehicles": []map[string]any{{"id": 1}},
		})
		run := &backupmodel.BackupRun{
			ID: 12, ConfigID: &cid, CreatedAt: now.Add(-time.Minute), FilePath: &path, Checksum: &checksum,
		}
		cfg := &backupmodel.BackupConfig{ID: cid, Provider: "local", ProviderConfig: cfgJSON}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: cfg}, []string{"vehicles", "drives"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || res.OK {
			t.Fatalf("want table failure res=%+v", res)
		}
		if !strings.Contains(res.Error, "critical tables") {
			t.Fatalf("error=%q", res.Error)
		}
	})

	t.Run("zero rows", func(t *testing.T) {
		path, checksum, cfgJSON := writeLocalBackup(t, filepath.Join(dir, "zero"), map[string]any{
			"vehicles": []any{},
		})
		run := &backupmodel.BackupRun{
			ID: 13, ConfigID: &cid, CreatedAt: now.Add(-time.Minute), FilePath: &path, Checksum: &checksum,
		}
		cfg := &backupmodel.BackupConfig{ID: cid, Provider: "local", ProviderConfig: cfgJSON}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: cfg}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || res.OK {
			t.Fatalf("want zero-row failure res=%+v", res)
		}
	})

	t.Run("unparseable table payload", func(t *testing.T) {
		path, checksum, cfgJSON := writeLocalBackup(t, filepath.Join(dir, "bad"), map[string]any{
			"vehicles": "not-an-array",
		})
		run := &backupmodel.BackupRun{
			ID: 14, ConfigID: &cid, CreatedAt: now.Add(-time.Minute), FilePath: &path, Checksum: &checksum,
		}
		cfg := &backupmodel.BackupConfig{ID: cid, Provider: "local", ProviderConfig: cfgJSON}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: cfg}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || res.OK {
			t.Fatalf("want parse failure res=%+v", res)
		}
	})

	t.Run("restore error", func(t *testing.T) {
		sum := strings.Repeat("ab", 32)
		missing := "backups/nope.json"
		run := &backupmodel.BackupRun{
			ID: 15, ConfigID: &cid, CreatedAt: now.Add(-time.Minute), FilePath: &missing, Checksum: &sum,
		}
		cfgJSON, _ := json.Marshal(map[string]string{"path": dir})
		cfg := &backupmodel.BackupConfig{ID: cid, Provider: "local", ProviderConfig: cfgJSON}
		v := NewVerifier(proc, &fakeRuns{run: run}, &fakeConfigs{cfg: cfg}, []string{"vehicles"}, time.Hour)
		v.now = func() time.Time { return now }
		res, err := v.VerifyLatest(ctx)
		if err == nil || !strings.Contains(res.Error, "restore") {
			t.Fatalf("res=%+v err=%v", res, err)
		}
	})
}
