package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbackup "github.com/ev-dev-labs/teslasync/internal/database/backup"
)

var backupTables = []string{
	"vehicles", "drives", "charging_sessions", "positions", "addresses",
	"geofences", "geofence_events", "alerts", "alert_rules", "settings",
	"daily_mileage", "vehicle_states", "software_updates",
	"vampire_drain_events", "visited_locations", "trips", "trip_drives",
	"signal_log", "notification_channels", "notification_logs",
	"efficiency_factors", "api_keys",
}

var (
	backupRunsMetric = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "backup_runs_total",
		Help:      "Total backup runs by status and provider",
	}, []string{"status", "provider"})
	backupDurationMetric = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "backup_duration_seconds",
		Help:      "Backup operation duration",
		Buckets:   []float64{1, 5, 10, 30, 60, 120, 300},
	})
	backupSizeMetric = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "backup_size_bytes",
		Help:      "Backup file size",
		Buckets:   []float64{1e5, 1e6, 1e7, 1e8, 5e8, 1e9},
	})
)

// Processor handles backup creation and restoration.
type Processor struct {
	pool    *pgxpool.Pool
	runRepo *dbbackup.BackupRunRepo
	cfgRepo *dbbackup.BackupConfigRepo
}

func NewProcessor(db *database.DB) *Processor {
	return &Processor{
		pool:    db.Pool,
		runRepo: dbbackup.NewBackupRunRepo(db),
		cfgRepo: dbbackup.NewBackupConfigRepo(db),
	}
}

// RunBackup executes a backup for the given config and run.
func (p *Processor) RunBackup(ctx context.Context, cfg *backupmodel.BackupConfig, run *backupmodel.BackupRun) {
	start := time.Now()

	// Mark running
	if err := p.runRepo.UpdateStatus(ctx, run.ID, "running"); err != nil {
		log.Error().Err(err).Int64("run_id", run.ID).Msg("backup: failed to mark running")
		return
	}

	// Determine tables
	tables := backupTables
	if len(cfg.IncludeTables) > 0 {
		tables = cfg.IncludeTables
	}

	// Export data
	data := make(map[string]json.RawMessage)
	totalRecords := 0
	totalTables := len(tables)
	failedTables := 0
	for _, table := range tables {
		rows, err := p.exportTable(ctx, table)
		if err != nil {
			log.Warn().Err(err).Str("table", table).Msg("backup: skipping table")
			failedTables++
			continue
		}
		data[table] = rows
		var arr []json.RawMessage
		_ = json.Unmarshal(rows, &arr)
		totalRecords += len(arr)
	}

	// Add metadata
	meta := map[string]interface{}{
		"version":    "1.0",
		"created_at": time.Now().UTC().Format(time.RFC3339),
		"tables":     tables,
		"type":       cfg.BackupType,
	}
	metaJSON, _ := json.Marshal(meta)
	data["_metadata"] = metaJSON

	// Serialize
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		duration := time.Since(start).Milliseconds()
		_ = p.runRepo.Fail(ctx, run.ID, fmt.Sprintf("marshal: %v", err), duration)
		return
	}

	// Compress if enabled
	var finalData []byte
	ext := ".json"
	if cfg.Compress {
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		if _, err := gz.Write(jsonBytes); err != nil {
			duration := time.Since(start).Milliseconds()
			_ = p.runRepo.Fail(ctx, run.ID, fmt.Sprintf("compress: %v", err), duration)
			return
		}
		gz.Close()
		finalData = buf.Bytes()
		ext = ".json.gz"
	} else {
		finalData = jsonBytes
	}

	// Checksum
	hash := sha256.Sum256(finalData)
	checksum := hex.EncodeToString(hash[:])

	// Generate filename
	ts := time.Now().UTC().Format("20060102-150405")
	fileName := fmt.Sprintf("teslasync-backup-%s-%s%s", cfg.BackupType, ts, ext)

	// Upload to provider
	provider, err := NewProvider(cfg.Provider, cfg.ProviderConfig)
	if err != nil {
		duration := time.Since(start).Milliseconds()
		_ = p.runRepo.Fail(ctx, run.ID, fmt.Sprintf("provider init: %v", err), duration)
		return
	}

	filePath := fmt.Sprintf("backups/%s", fileName)
	if err := provider.Upload(ctx, filePath, bytes.NewReader(finalData), int64(len(finalData))); err != nil {
		duration := time.Since(start).Milliseconds()
		_ = p.runRepo.Fail(ctx, run.ID, fmt.Sprintf("upload: %v", err), duration)
		return
	}

	duration := time.Since(start).Milliseconds()

	// Determine final status based on table export results
	var status string
	switch {
	case failedTables == 0:
		status = "completed"
	case failedTables == totalTables:
		status = "failed"
	default:
		status = "partial"
	}

	// Mark completed with computed status
	if err := p.runRepo.Complete(ctx, run.ID, status, fileName, filePath, int64(len(finalData)), totalRecords, len(tables), checksum, duration); err != nil {
		log.Error().Err(err).Msg("backup: failed to mark completed")
	}
	backupRunsMetric.WithLabelValues(status, cfg.Provider).Inc()
	backupDurationMetric.Observe(float64(duration) / 1000.0)
	backupSizeMetric.Observe(float64(len(finalData)))

	// Post-upload integrity verification: re-download and verify checksum
	if err := p.verifyUpload(ctx, provider, filePath, checksum); err != nil {
		log.Warn().Err(err).Str("file", fileName).Msg("backup: integrity verification failed")
		_ = p.runRepo.UpdateStatus(ctx, run.ID, "verify_failed")
	}

	// Update config last/next run
	if run.ConfigID != nil {
		_ = p.cfgRepo.MarkRun(ctx, *run.ConfigID)
	}

	// Cleanup old runs
	if run.ConfigID != nil && cfg.MaxRetention > 0 {
		cleaned, _ := p.runRepo.CleanupOld(ctx, *run.ConfigID, cfg.MaxRetention)
		if cleaned > 0 {
			log.Info().Int64("cleaned", cleaned).Int64("config_id", *run.ConfigID).Msg("backup: cleaned old runs")
		}
	}

	log.Info().Str("file", fileName).Int64("size", int64(len(finalData))).Int("records", totalRecords).Int("total", totalTables).Int("failed", failedTables).Str("status", status).Int64("duration_ms", duration).Msg("backup run finished")
}

// IsAllowedTable returns true if the table name is in the processor's backup table list.
// Used to prevent SQL injection — table names in queries MUST pass this check.
func IsAllowedTable(table string) bool {
	for _, t := range backupTables {
		if t == table {
			return true
		}
	}
	return false
}

func (p *Processor) exportTable(ctx context.Context, table string) (json.RawMessage, error) {
	if !IsAllowedTable(table) {
		log.Error().Str("table", table).Msg("backup: table not in allowlist, skipping")
		return nil, fmt.Errorf("backup: table %q not in allowlist", table)
	}
	// table name is safe — validated against backupTables allowlist above
	query := fmt.Sprintf(`SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM "%s" t`, table)
	var result json.RawMessage
	err := p.pool.QueryRow(ctx, query).Scan(&result)
	return result, err
}

// verifyUpload re-downloads the backup file and verifies its SHA-256 checksum matches.
func (p *Processor) verifyUpload(ctx context.Context, provider StorageProvider, filePath, expectedChecksum string) error {
	rc, err := provider.Download(ctx, filePath)
	if err != nil {
		return fmt.Errorf("download for verify: %w", err)
	}
	defer rc.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, rc); err != nil {
		return fmt.Errorf("read for verify: %w", err)
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != expectedChecksum {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedChecksum, actual)
	}
	return nil
}

// VerifyBackup checks integrity of an existing backup by re-downloading and verifying checksum.
func (p *Processor) VerifyBackup(ctx context.Context, run *backupmodel.BackupRun, providerType string, providerConfig json.RawMessage) error {
	if run.FilePath == nil || run.Checksum == nil {
		return fmt.Errorf("backup has no file path or checksum")
	}
	provider, err := NewProvider(providerType, providerConfig)
	if err != nil {
		return fmt.Errorf("provider init: %w", err)
	}
	return p.verifyUpload(ctx, provider, *run.FilePath, *run.Checksum)
}

// RestoreBackup downloads and decompresses a backup, returning the parsed table data.
func (p *Processor) RestoreBackup(ctx context.Context, run *backupmodel.BackupRun, providerType string, providerConfig json.RawMessage) (map[string]json.RawMessage, error) {
	if run.FilePath == nil {
		return nil, fmt.Errorf("backup has no file path")
	}

	provider, err := NewProvider(providerType, providerConfig)
	if err != nil {
		return nil, fmt.Errorf("provider init: %w", err)
	}

	rc, err := provider.Download(ctx, *run.FilePath)
	if err != nil {
		return nil, fmt.Errorf("download: %w", err)
	}
	defer rc.Close()

	rawData, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	// Verify checksum if available
	if run.Checksum != nil {
		hash := sha256.Sum256(rawData)
		actual := hex.EncodeToString(hash[:])
		if actual != *run.Checksum {
			return nil, fmt.Errorf("checksum mismatch: expected %s, got %s", *run.Checksum, actual)
		}
	}

	// Decompress if gzipped
	var jsonData []byte
	if run.FileName != nil && strings.HasSuffix(*run.FileName, ".gz") {
		gz, err := gzip.NewReader(bytes.NewReader(rawData))
		if err != nil {
			return nil, fmt.Errorf("gzip open: %w", err)
		}
		defer gz.Close()
		jsonData, err = io.ReadAll(gz)
		if err != nil {
			return nil, fmt.Errorf("gzip read: %w", err)
		}
	} else {
		jsonData = rawData
	}

	var data map[string]json.RawMessage
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return nil, fmt.Errorf("parse backup JSON: %w", err)
	}

	return data, nil
}
