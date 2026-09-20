package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"
)

func TestNewProvider_LocalDefaultAndCustomPath(t *testing.T) {
	t.Parallel()
	p, err := NewProvider("local", nil)
	if err != nil {
		t.Fatalf("NewProvider local nil: %v", err)
	}
	if p.Name() != "local" {
		t.Fatalf("Name=%q", p.Name())
	}
	local, ok := p.(*LocalStorage)
	if !ok {
		t.Fatalf("type %T", p)
	}
	if local.basePath != "/data/backups" {
		t.Fatalf("default path=%q", local.basePath)
	}

	custom, err := NewProvider("local", json.RawMessage(`{"path":"/tmp/teslasync-backups"}`))
	if err != nil {
		t.Fatalf("NewProvider custom: %v", err)
	}
	if custom.(*LocalStorage).basePath != "/tmp/teslasync-backups" {
		t.Fatalf("custom path=%q", custom.(*LocalStorage).basePath)
	}
}

func TestNewProvider_RejectsBadJSONAndUnknown(t *testing.T) {
	t.Parallel()
	if _, err := NewProvider("local", json.RawMessage(`{`)); err == nil {
		t.Fatal("want parse error for local")
	}
	if _, err := NewProvider("s3", json.RawMessage(`{`)); err == nil {
		t.Fatal("want parse error for s3")
	}
	if _, err := NewProvider("azure", json.RawMessage(`{`)); err == nil {
		t.Fatal("want parse error for azure")
	}
	if _, err := NewProvider("gcs", json.RawMessage(`{`)); err == nil {
		t.Fatal("want parse error for gcs")
	}
	if _, err := NewProvider("ftp", nil); err == nil || !strings.Contains(err.Error(), "unsupported provider") {
		t.Fatalf("err=%v", err)
	}
}

func TestLocalStorage_UploadDownloadListDelete(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := NewLocalStorage(LocalConfig{Path: dir})
	ctx := context.Background()

	payload := []byte(`{"hello":"world"}`)
	if err := store.Upload(ctx, "backups/run-1.json", bytes.NewReader(payload), int64(len(payload))); err != nil {
		t.Fatalf("Upload: %v", err)
	}

	rc, err := store.Download(ctx, "backups/run-1.json")
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	got, err := io.ReadAll(rc)
	_ = rc.Close()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("got %s", got)
	}

	listed, err := store.List(ctx, "backups")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(listed) != 1 || !strings.Contains(listed[0], "run-1.json") {
		t.Fatalf("listed=%v", listed)
	}

	missing, err := store.List(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("List missing: %v", err)
	}
	if len(missing) != 0 {
		t.Fatalf("missing list=%v", missing)
	}

	if err := store.Delete(ctx, "backups/run-1.json"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "backups", "run-1.json")); !os.IsNotExist(err) {
		t.Fatalf("file still present: %v", err)
	}
}

func TestS3FullKeyAndNewS3Storage(t *testing.T) {
	t.Parallel()
	s := &S3Storage{prefix: "pre"}
	if got := s.fullKey("k"); got != "pre/k" {
		t.Fatalf("fullKey=%q", got)
	}
	s.prefix = ""
	if got := s.fullKey("k"); got != "k" {
		t.Fatalf("fullKey empty prefix=%q", got)
	}
	if s.Name() != "s3" {
		t.Fatalf("Name=%q", s.Name())
	}

	got, err := NewS3Storage(S3Config{Bucket: "b", Region: "us-east-1", AccessKey: "ak", SecretKey: "sk", Endpoint: "http://127.0.0.1:9000", Prefix: "p"})
	if err != nil {
		t.Fatalf("NewS3Storage: %v", err)
	}
	if got.bucket != "b" || got.prefix != "p" {
		t.Fatalf("bucket=%q prefix=%q", got.bucket, got.prefix)
	}
}

func TestAzureAndGCSFullKey(t *testing.T) {
	t.Parallel()
	a := &AzureStorage{prefix: "pre"}
	if a.fullKey("k") != "pre/k" || a.Name() != "azure" {
		t.Fatalf("azure fullKey/name")
	}
	a.prefix = ""
	if a.fullKey("k") != "k" {
		t.Fatal("azure empty prefix")
	}
	g := &GCSStorage{prefix: "pre"}
	if g.fullKey("k") != "pre/k" || g.Name() != "gcs" {
		t.Fatalf("gcs fullKey/name")
	}
	g.prefix = ""
	if g.fullKey("k") != "k" {
		t.Fatal("gcs empty prefix")
	}
}

func TestNewAzureStorage_InvalidAccount(t *testing.T) {
	t.Parallel()
	if _, err := NewAzureStorage(AzureConfig{AccountName: "bad name", AccountKey: "not-base64"}); err == nil {
		t.Fatal("want azure credential error")
	}
}

func TestNewGCSStorage_InvalidJSON(t *testing.T) {
	t.Parallel()
	if _, err := NewGCSStorage(GCSConfig{Bucket: "b", CredentialsJSON: "{"}); err == nil {
		t.Fatal("want gcs client error")
	}
}

func TestProcessor_VerifyAndRestoreLocal(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := NewLocalStorage(LocalConfig{Path: dir})
	ctx := context.Background()

	body := []byte(`{"vehicles":[{"id":1}],"_metadata":{"version":"1.0"}}`)
	sum := sha256.Sum256(body)
	checksum := hex.EncodeToString(sum[:])
	path := "backups/run.json"
	if err := store.Upload(ctx, path, bytes.NewReader(body), int64(len(body))); err != nil {
		t.Fatalf("upload: %v", err)
	}

	p := &Processor{}
	if err := p.verifyUpload(ctx, store, path, checksum); err != nil {
		t.Fatalf("verifyUpload: %v", err)
	}
	if err := p.verifyUpload(ctx, store, path, "deadbeef"); err == nil {
		t.Fatal("want checksum mismatch")
	}

	cfgJSON, _ := json.Marshal(LocalConfig{Path: dir})
	filePath := path
	fileName := "run.json"
	run := &backupmodel.BackupRun{FilePath: &filePath, Checksum: &checksum, FileName: &fileName}
	if err := p.VerifyBackup(ctx, run, "local", cfgJSON); err != nil {
		t.Fatalf("VerifyBackup: %v", err)
	}
	if err := p.VerifyBackup(ctx, &backupmodel.BackupRun{}, "local", cfgJSON); err == nil {
		t.Fatal("want missing path/checksum")
	}
	if err := p.VerifyBackup(ctx, run, "ftp", cfgJSON); err == nil {
		t.Fatal("want provider error")
	}

	data, err := p.RestoreBackup(ctx, run, "local", cfgJSON)
	if err != nil {
		t.Fatalf("RestoreBackup: %v", err)
	}
	if _, ok := data["vehicles"]; !ok {
		t.Fatalf("parsed=%v", data)
	}

	if _, err := p.RestoreBackup(ctx, &backupmodel.BackupRun{}, "local", cfgJSON); err == nil {
		t.Fatal("want missing path")
	}

	badSum := "00"
	run.Checksum = &badSum
	if _, err := p.RestoreBackup(ctx, run, "local", cfgJSON); err == nil {
		t.Fatal("want checksum mismatch on restore")
	}
}

func TestProcessor_RestoreGzip(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	ctx := context.Background()
	store := NewLocalStorage(LocalConfig{Path: dir})

	// gzip via RestoreBackup path: write gzip bytes using compress/gzip through Upload of already-gzipped content
	raw := []byte(`{"ok":true}`)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	path := "backups/run.json.gz"
	if err := store.Upload(ctx, path, bytes.NewReader(buf.Bytes()), int64(buf.Len())); err != nil {
		t.Fatalf("upload: %v", err)
	}
	cfgJSON, _ := json.Marshal(LocalConfig{Path: dir})
	filePath := path
	fileName := "run.json.gz"
	p := &Processor{}
	run := &backupmodel.BackupRun{FilePath: &filePath, FileName: &fileName}
	data, err := p.RestoreBackup(ctx, run, "local", cfgJSON)
	if err != nil {
		t.Fatalf("RestoreBackup gzip: %v", err)
	}
	if string(data["ok"]) != "true" {
		t.Fatalf("data=%v", data)
	}
}

func TestExportTable_RejectsUnknownTable(t *testing.T) {
	t.Parallel()
	p := &Processor{}
	if _, err := p.exportTable(context.Background(), "not_a_table"); err == nil {
		t.Fatal("want allowlist rejection")
	}
}
