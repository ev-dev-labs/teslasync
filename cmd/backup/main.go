package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Version is overridden at link time via -ldflags="-X main.Version=$(git rev-parse --short HEAD)".
var Version = "dev"

// Config is loaded once at startup from env vars. All fields are
// documented inline so `backup --help` and the runbook agree.
type Config struct {
	// Source database — same env vars as the API so an operator can
	// run the backup as a sidecar with the API's existing Secret.
	DBHost     string
	DBPort     int
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string

	// Destination
	Dest string // "local" or "s3"

	// Local destination
	LocalPath string // mount path, e.g. /backups

	// S3-compatible destination (works for AWS S3, MinIO, B2, R2, Wasabi)
	S3Endpoint    string // empty => AWS S3 default; otherwise MinIO/etc URL
	S3Region      string
	S3Bucket      string
	S3Prefix      string // optional key prefix
	S3AccessKey   string
	S3SecretKey   string
	S3UsePathStyle bool // MinIO + B2 require path-style addressing

	// Retention. Both default to a sensible self-hosted homelab value.
	// Set to 0 to disable a tier.
	RetainDailyCopies  int
	RetainWeeklyCopies int

	// pg_dump tuning
	PgDumpJobs       int // 0 => serial; >0 => parallel sections (custom format only)
	PgDumpCompressLv int // 0..9 (custom format default 6; we ship 9 for self-hosted disk cost)

	// Operational
	LogLevel string
	DryRun   bool
}

func main() {
	if err := run(); err != nil {
		// Distinguish hard failure from "dump succeeded, upload failed"
		// so the CronJob's restartPolicy: OnFailure backs off cleanly.
		var partial *partialError
		if errors.As(err, &partial) {
			log.Error().Err(err).Msg("backup partial: dump succeeded, upload failed; local copy retained")
			os.Exit(2)
		}
		log.Error().Err(err).Msg("backup failed")
		os.Exit(1)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	setupLogger(cfg.LogLevel)

	log.Info().
		Str("version", Version).
		Str("dest", cfg.Dest).
		Str("db_host", cfg.DBHost).
		Str("db_name", cfg.DBName).
		Bool("dry_run", cfg.DryRun).
		Msg("backup starting")

	ctx, cancel := signalContext()
	defer cancel()

	// Probe the DB before kicking off a multi-minute pg_dump so we fail fast.
	migrationVer, err := probeDatabase(ctx, cfg)
	if err != nil {
		return fmt.Errorf("probe database: %w", err)
	}
	log.Info().Int64("schema_migration", migrationVer).Msg("database reachable")

	if cfg.DryRun {
		log.Info().Msg("dry-run mode: skipping pg_dump and upload")
		return nil
	}

	// Stage the dump on local disk first, even when the final destination
	// is S3. This gives us:
	//   * a stable SHA-256 (we hash bytes already-on-disk, not a stream)
	//   * a fallback copy if the upload fails (exit code 2 — partial)
	//   * predictable peak disk usage = dump size, not 2x dump size
	stageDir, err := os.MkdirTemp("", "teslasync-backup-*")
	if err != nil {
		return fmt.Errorf("stage temp dir: %w", err)
	}
	defer func() {
		if cfg.Dest == "local" {
			// Local destination already received the file via rename;
			// nothing left in stage. Best-effort cleanup.
			_ = os.RemoveAll(stageDir)
		}
		// For S3 dest, stage holds the fallback copy on partial failure.
		// The next successful run cleans up old stage dirs via retention.
	}()

	timestamp := time.Now().UTC().Format("20060102T150405Z")
	dumpName := fmt.Sprintf("teslasync-%s.dump", timestamp)
	stagePath := filepath.Join(stageDir, dumpName)

	dumpSize, dumpSHA, err := runPgDump(ctx, cfg, stagePath)
	if err != nil {
		return fmt.Errorf("pg_dump: %w", err)
	}
	log.Info().
		Str("path", stagePath).
		Int64("bytes", dumpSize).
		Str("sha256", dumpSHA).
		Msg("pg_dump complete")

	manifest := Manifest{
		Version:           Version,
		CreatedAt:         time.Now().UTC(),
		SchemaMigration:   migrationVer,
		DatabaseHost:      cfg.DBHost, // host only, no creds
		DatabaseName:      cfg.DBName,
		DumpFile:          dumpName,
		DumpBytes:         dumpSize,
		DumpSHA256:        dumpSHA,
		DumpFormat:        "pg_dump custom (-Fc)",
		PgDumpCompressLvl: cfg.PgDumpCompressLv,
	}
	manifestPath := filepath.Join(stageDir, dumpName+".manifest.json")
	if err := writeManifest(manifest, manifestPath); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	uploader, err := newUploader(cfg)
	if err != nil {
		return fmt.Errorf("init uploader: %w", err)
	}
	if err := uploader.Upload(ctx, stagePath, manifestPath); err != nil {
		return &partialError{inner: err}
	}
	log.Info().Str("dest", cfg.Dest).Msg("upload complete")

	if err := uploader.EnforceRetention(ctx, cfg.RetainDailyCopies, cfg.RetainWeeklyCopies); err != nil {
		// Retention failure is non-fatal — the backup itself is safe.
		log.Warn().Err(err).Msg("retention enforcement failed (non-fatal)")
	}
	log.Info().Msg("backup complete")
	return nil
}

func loadConfig() (*Config, error) {
	c := &Config{
		DBHost:     env("DATABASE_HOST", "localhost"),
		DBPort:     envInt("DATABASE_PORT", 5432),
		DBUser:     env("DATABASE_USER", "teslasync"),
		DBPassword: env("DATABASE_PASS", env("DATABASE_PASSWORD", "")),
		DBName:     env("DATABASE_NAME", "teslasync"),
		DBSSLMode:  env("DATABASE_SSL_MODE", "disable"),

		Dest:      strings.ToLower(env("BACKUP_DEST", "local")),
		LocalPath: env("BACKUP_LOCAL_PATH", "/backups"),

		S3Endpoint:     env("BACKUP_S3_ENDPOINT", ""),
		S3Region:       env("BACKUP_S3_REGION", "us-east-1"),
		S3Bucket:       env("BACKUP_S3_BUCKET", ""),
		S3Prefix:       env("BACKUP_S3_PREFIX", ""),
		S3AccessKey:    env("BACKUP_S3_ACCESS_KEY", ""),
		S3SecretKey:    env("BACKUP_S3_SECRET_KEY", ""),
		S3UsePathStyle: envBool("BACKUP_S3_PATH_STYLE", true),

		RetainDailyCopies:  envInt("BACKUP_RETAIN_DAILY", 7),
		RetainWeeklyCopies: envInt("BACKUP_RETAIN_WEEKLY", 4),

		PgDumpJobs:       envInt("BACKUP_PGDUMP_JOBS", 0),
		PgDumpCompressLv: envInt("BACKUP_PGDUMP_COMPRESS_LEVEL", 9),

		LogLevel: env("LOG_LEVEL", "info"),
		DryRun:   envBool("BACKUP_DRY_RUN", false),
	}

	if c.DBPassword == "" {
		return nil, errors.New("DATABASE_PASS (or DATABASE_PASSWORD) is required")
	}
	switch c.Dest {
	case "local":
		if c.LocalPath == "" {
			return nil, errors.New("BACKUP_LOCAL_PATH is required when BACKUP_DEST=local")
		}
	case "s3":
		if c.S3Bucket == "" {
			return nil, errors.New("BACKUP_S3_BUCKET is required when BACKUP_DEST=s3")
		}
		if c.S3AccessKey == "" || c.S3SecretKey == "" {
			return nil, errors.New("BACKUP_S3_ACCESS_KEY and BACKUP_S3_SECRET_KEY are required when BACKUP_DEST=s3")
		}
	default:
		return nil, fmt.Errorf("BACKUP_DEST must be 'local' or 's3', got %q", c.Dest)
	}
	if c.PgDumpCompressLv < 0 || c.PgDumpCompressLv > 9 {
		return nil, fmt.Errorf("BACKUP_PGDUMP_COMPRESS_LEVEL must be 0..9, got %d", c.PgDumpCompressLv)
	}
	return c, nil
}

func probeDatabase(ctx context.Context, cfg *Config) (int64, error) {
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s&connect_timeout=5",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBSSLMode,
	)
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return 0, fmt.Errorf("pool: %w", err)
	}
	defer pool.Close()

	var version int64
	err = pool.QueryRow(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version)
	if err != nil {
		// If schema_migrations is absent (fresh DB), proceed with version=0 —
		// we still want to back up whatever is there.
		log.Warn().Err(err).Msg("could not read schema_migrations.version (continuing with 0)")
		return 0, nil
	}
	return version, nil
}

// runPgDump shells out to pg_dump in custom format and writes the result
// to outPath. Returns the dump's size in bytes and its SHA-256.
func runPgDump(ctx context.Context, cfg *Config, outPath string) (int64, string, error) {
	args := []string{
		"--host=" + cfg.DBHost,
		"--port=" + strconv.Itoa(cfg.DBPort),
		"--username=" + cfg.DBUser,
		"--dbname=" + cfg.DBName,
		"--format=custom",
		"--compress=" + strconv.Itoa(cfg.PgDumpCompressLv),
		"--no-password",
		"--verbose",
		"--file=" + outPath,
	}
	if cfg.PgDumpJobs > 0 {
		// pg_dump custom format does NOT support --jobs; parallel dump
		// requires --format=directory. We accept the perf hit here
		// because custom format is the only one that supports
		// selective restore + cross-version restore. If the operator
		// REALLY needs parallel dump, they can fork; we won't complicate
		// the default for a corner case.
		log.Warn().Int("requested_jobs", cfg.PgDumpJobs).
			Msg("BACKUP_PGDUMP_JOBS ignored: custom format is single-threaded by design")
	}

	cmd := exec.CommandContext(ctx, "pg_dump", args...)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+cfg.DBPassword)

	// Pipe pg_dump's stderr through zerolog at debug level so the
	// CronJob's log stream stays readable but verbose output is
	// available with LOG_LEVEL=debug.
	stderr := &lineLogger{level: zerolog.DebugLevel, prefix: "pg_dump"}
	cmd.Stderr = stderr
	cmd.Stdout = io.Discard // pg_dump --file means stdout is unused

	start := time.Now()
	if err := cmd.Run(); err != nil {
		return 0, "", fmt.Errorf("pg_dump exited: %w (stderr tail: %s)", err, stderr.Tail())
	}
	log.Info().Dur("duration", time.Since(start)).Msg("pg_dump duration")

	fi, err := os.Stat(outPath)
	if err != nil {
		return 0, "", fmt.Errorf("stat dump: %w", err)
	}

	f, err := os.Open(outPath)
	if err != nil {
		return 0, "", fmt.Errorf("open dump: %w", err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return 0, "", fmt.Errorf("hash dump: %w", err)
	}
	return fi.Size(), hex.EncodeToString(h.Sum(nil)), nil
}

// Manifest is written alongside each dump. The schema is documented in
// docs/runbooks/backup-restore.md; if you change it, bump the runbook.
type Manifest struct {
	Version           string    `json:"version"`
	CreatedAt         time.Time `json:"created_at"`
	SchemaMigration   int64     `json:"schema_migration"`
	DatabaseHost      string    `json:"database_host"`
	DatabaseName      string    `json:"database_name"`
	DumpFile          string    `json:"dump_file"`
	DumpBytes         int64     `json:"dump_bytes"`
	DumpSHA256        string    `json:"dump_sha256"`
	DumpFormat        string    `json:"dump_format"`
	PgDumpCompressLvl int       `json:"pg_dump_compress_level"`
}

func writeManifest(m Manifest, path string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// Uploader abstracts the destination. local and s3 implementations
// live in storage_local.go and storage_s3.go.
type Uploader interface {
	Upload(ctx context.Context, dumpPath, manifestPath string) error
	EnforceRetention(ctx context.Context, daily, weekly int) error
}

func newUploader(cfg *Config) (Uploader, error) {
	switch cfg.Dest {
	case "local":
		return newLocalUploader(cfg)
	case "s3":
		return newS3Uploader(cfg)
	}
	return nil, fmt.Errorf("unsupported dest %q", cfg.Dest)
}

// partialError signals "dump succeeded, upload failed". Mapped to exit 2.
type partialError struct{ inner error }

func (e *partialError) Error() string { return "upload failed (dump retained locally): " + e.inner.Error() }
func (e *partialError) Unwrap() error { return e.inner }

func signalContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-ch
		log.Warn().Msg("signal received; cancelling backup")
		cancel()
	}()
	return ctx, cancel
}

func setupLogger(level string) {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	lv, err := zerolog.ParseLevel(level)
	if err != nil {
		lv = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lv)
}

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok {
		return v
	}
	return def
}
func envInt(k string, def int) int {
	if v, ok := os.LookupEnv(k); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
func envBool(k string, def bool) bool {
	if v, ok := os.LookupEnv(k); ok {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

// lineLogger is a minimal io.Writer that buffers stderr into lines and
// emits them at the configured zerolog level, with the last 32 lines
// kept in memory for Tail() so an error message can include context.
type lineLogger struct {
	level  zerolog.Level
	prefix string
	buf    []byte
	tail   []string
}

func (l *lineLogger) Write(p []byte) (int, error) {
	l.buf = append(l.buf, p...)
	for {
		i := indexNewline(l.buf)
		if i < 0 {
			break
		}
		line := strings.TrimRight(string(l.buf[:i]), "\r")
		l.buf = l.buf[i+1:]
		if line == "" {
			continue
		}
		log.WithLevel(l.level).Str("source", l.prefix).Msg(line)
		l.tail = append(l.tail, line)
		if len(l.tail) > 32 {
			l.tail = l.tail[len(l.tail)-32:]
		}
	}
	return len(p), nil
}

func (l *lineLogger) Tail() string {
	return strings.Join(l.tail, " | ")
}

func indexNewline(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return -1
}
