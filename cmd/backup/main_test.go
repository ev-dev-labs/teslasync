package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// TestLocalUploader_EnforceRetention_DailyAndWeeklyTiers seeds a
// tmpdir with 30 fake dump files spread one-per-day backwards from
// now, asks the retention logic to keep 7 daily + 4 weekly, and
// asserts the surviving set matches the tier rules.
func TestLocalUploader_EnforceRetention_DailyAndWeeklyTiers(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	now := time.Now().UTC().Truncate(24 * time.Hour)
	for i := 0; i < 30; i++ {
		ts := now.AddDate(0, 0, -i)
		name := fmt.Sprintf("teslasync-%s.dump", ts.Format("20060102T150405Z"))
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("fake"), 0o644); err != nil {
			t.Fatalf("write %s: %v", p, err)
		}
		if err := os.WriteFile(p+".manifest.json", []byte("{}"), 0o644); err != nil {
			t.Fatalf("write manifest: %v", err)
		}
		// Backdate the mtime so retention sees a realistic spread.
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatalf("chtimes: %v", err)
		}
	}

	u, err := newLocalUploader(&Config{LocalPath: dir})
	if err != nil {
		t.Fatalf("newLocalUploader: %v", err)
	}
	if err := u.EnforceRetention(context.Background(), 7, 4); err != nil {
		t.Fatalf("EnforceRetention: %v", err)
	}

	// Inventory the survivors.
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	var dumps []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".dump" {
			dumps = append(dumps, e.Name())
		}
	}
	sort.Strings(dumps)

	// Should keep 7 daily (most recent) + up to 4 distinct ISO weeks
	// from the remaining tail. With 30 sequential days the tail spans
	// roughly 23 days = 3–4 ISO weeks, so the 4-weekly tier may keep
	// 3 or 4 depending on the calendar alignment of `now`. Assert
	// upper bound + lower bound to stay calendar-agnostic.
	if got, want := len(dumps), 7+4; got > want {
		t.Errorf("kept %d dumps; want at most %d (7 daily + 4 weekly)", got, want)
	}
	if got, lo := len(dumps), 7+3; got < lo {
		t.Errorf("kept %d dumps; want at least %d (7 daily + ≥3 weekly buckets in a 23-day tail)", got, lo)
	}

	// Every kept dump must still have its manifest sidecar.
	for _, d := range dumps {
		manifest := filepath.Join(dir, d+".manifest.json")
		if _, err := os.Stat(manifest); err != nil {
			t.Errorf("manifest missing for kept dump %s: %v", d, err)
		}
	}

	// No pruned dump should leave a dangling manifest behind.
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		dumpName := e.Name()[:len(e.Name())-len(".manifest.json")]
		if _, err := os.Stat(filepath.Join(dir, dumpName)); err != nil {
			t.Errorf("orphan manifest %s: dump was pruned but manifest remained", e.Name())
		}
	}
}

// TestLocalUploader_EnforceRetention_NoOpWhenZero verifies that
// setting both tiers to 0 leaves every dump in place.
func TestLocalUploader_EnforceRetention_NoOpWhenZero(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	for i := 0; i < 5; i++ {
		ts := time.Now().UTC().AddDate(0, 0, -i)
		name := fmt.Sprintf("teslasync-%s.dump", ts.Format("20060102T150405Z"))
		p := filepath.Join(dir, name)
		_ = os.WriteFile(p, []byte("x"), 0o644)
	}

	u, _ := newLocalUploader(&Config{LocalPath: dir})
	if err := u.EnforceRetention(context.Background(), 0, 0); err != nil {
		t.Fatalf("EnforceRetention: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if got := len(entries); got != 5 {
		t.Errorf("expected 5 dumps untouched, got %d", got)
	}
}

// TestLocalUploader_EnforceRetention_FewerThanKeep verifies that
// when the dir holds fewer dumps than the keep window, nothing is
// deleted (no negative-indexing bugs).
func TestLocalUploader_EnforceRetention_FewerThanKeep(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	for i := 0; i < 3; i++ {
		ts := time.Now().UTC().AddDate(0, 0, -i)
		name := fmt.Sprintf("teslasync-%s.dump", ts.Format("20060102T150405Z"))
		_ = os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644)
	}

	u, _ := newLocalUploader(&Config{LocalPath: dir})
	if err := u.EnforceRetention(context.Background(), 7, 4); err != nil {
		t.Fatalf("EnforceRetention: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if got := len(entries); got != 3 {
		t.Errorf("expected 3 dumps untouched, got %d", got)
	}
}

func TestLoadConfig_RequiresPassword(t *testing.T) {
	t.Setenv("DATABASE_PASS", "")
	t.Setenv("DATABASE_PASSWORD", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected error for missing DATABASE_PASS")
	}
}

func TestLoadConfig_S3RequiresBucketAndCreds(t *testing.T) {
	t.Setenv("DATABASE_PASS", "x")
	t.Setenv("BACKUP_DEST", "s3")
	t.Setenv("BACKUP_S3_BUCKET", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected error for missing BACKUP_S3_BUCKET")
	}

	t.Setenv("BACKUP_S3_BUCKET", "tesla-dumps")
	t.Setenv("BACKUP_S3_ACCESS_KEY", "")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected error for missing S3 credentials")
	}
}

func TestLoadConfig_RejectsUnknownDest(t *testing.T) {
	t.Setenv("DATABASE_PASS", "x")
	t.Setenv("BACKUP_DEST", "ftp")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected error for BACKUP_DEST=ftp")
	}
}

func TestLoadConfig_RejectsBadCompressLevel(t *testing.T) {
	t.Setenv("DATABASE_PASS", "x")
	t.Setenv("BACKUP_DEST", "local")
	t.Setenv("BACKUP_PGDUMP_COMPRESS_LEVEL", "12")
	if _, err := loadConfig(); err == nil {
		t.Fatal("expected error for compress level out of range")
	}
}
