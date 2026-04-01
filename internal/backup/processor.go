package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

var backupTables = []string{
	"vehicles", "drives", "charging_sessions", "positions", "addresses",
	"geofences", "geofence_events", "alerts", "alert_rules", "settings",
	"daily_mileage", "vehicle_states", "software_updates", "tire_pressure_snapshots",
	"vampire_drain_events", "visited_locations", "trips", "trip_drives",
	"battery_snapshots", "motor_snapshots", "climate_snapshots", "media_snapshots",
	"charging_telemetry", "notification_channels", "notification_logs",
	"efficiency_factors", "api_keys",
}

// Processor handles backup creation and restoration.
type Processor struct {
	pool    *pgxpool.Pool
	runRepo *database.BackupRunRepo
	cfgRepo *database.BackupConfigRepo
}

func NewProcessor(db *database.DB) *Processor {
	return &Processor{
		pool:    db.Pool,
		runRepo: database.NewBackupRunRepo(db),
		cfgRepo: database.NewBackupConfigRepo(db),
	}
}

// RunBackup executes a backup for the given config and run.
func (p *Processor) RunBackup(ctx context.Context, cfg *models.BackupConfig, run *models.BackupRun) {
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
	for _, table := range tables {
		rows, err := p.exportTable(ctx, table)
		if err != nil {
			log.Warn().Err(err).Str("table", table).Msg("backup: skipping table")
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

	// Mark completed
	if err := p.runRepo.Complete(ctx, run.ID, fileName, filePath, int64(len(finalData)), totalRecords, len(tables), checksum, duration); err != nil {
		log.Error().Err(err).Msg("backup: failed to mark completed")
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

	log.Info().Str("file", fileName).Int64("size", int64(len(finalData))).Int("records", totalRecords).Int64("duration_ms", duration).Msg("backup: completed")
}

func (p *Processor) exportTable(ctx context.Context, table string) (json.RawMessage, error) {
	query := fmt.Sprintf(`SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM "%s" t`, table)
	var result json.RawMessage
	err := p.pool.QueryRow(ctx, query).Scan(&result)
	return result, err
}
