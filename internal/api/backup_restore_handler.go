package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

type BackupRestoreHandler struct {
	cfgRepo   *database.BackupConfigRepo
	runRepo   *database.BackupRunRepo
	processor *backup.Processor
}

func NewBackupRestoreHandler(db *database.DB) *BackupRestoreHandler {
	return &BackupRestoreHandler{
		cfgRepo:   database.NewBackupConfigRepo(db),
		runRepo:   database.NewBackupRunRepo(db),
		processor: backup.NewProcessor(db),
	}
}

// ── Config CRUD ─────────────────────────────────────────

func (h *BackupRestoreHandler) ListConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := h.cfgRepo.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("backup: failed to list configs")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to list backup configs"))
		return
	}
	if configs == nil {
		configs = []*models.BackupConfig{}
	}
	writeJSON(w, http.StatusOK, configs)
}

func (h *BackupRestoreHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		writeAppError(w, r, ErrBackupConfigNotFound)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *BackupRestoreHandler) CreateConfig(w http.ResponseWriter, r *http.Request) {
	var cfg models.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	// Validate
	if cfg.FrequencyDays < 1 {
		cfg.FrequencyDays = 1
	}
	if cfg.FrequencyDays > 30 {
		cfg.FrequencyDays = 30
	}
	if cfg.MaxRetention < 1 {
		cfg.MaxRetention = 5
	}
	if cfg.MaxRetention > 100 {
		cfg.MaxRetention = 100
	}
	if cfg.BackupType == "" {
		cfg.BackupType = "full"
	}
	if cfg.Provider == "" {
		cfg.Provider = "local"
	}
	if cfg.ProviderConfig == nil {
		cfg.ProviderConfig = json.RawMessage(`{}`)
	}

	if err := h.cfgRepo.Create(r.Context(), &cfg); err != nil {
		log.Error().Err(err).Msg("backup: failed to create config")
		writeAppError(w, r, ErrBackupFailed.WithMessage("failed to create backup config"))
		return
	}
	writeJSON(w, http.StatusCreated, cfg)
}

func (h *BackupRestoreHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	var cfg models.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeAppError(w, r, ErrInvalidJSON)
		return
	}
	cfg.ID = id
	// Validate bounds
	if cfg.FrequencyDays < 1 {
		cfg.FrequencyDays = 1
	}
	if cfg.FrequencyDays > 30 {
		cfg.FrequencyDays = 30
	}
	if cfg.MaxRetention < 1 {
		cfg.MaxRetention = 5
	}
	if cfg.MaxRetention > 100 {
		cfg.MaxRetention = 100
	}

	if err := h.cfgRepo.Update(r.Context(), &cfg); err != nil {
		log.Error().Err(err).Msg("backup: failed to update config")
		writeAppError(w, r, ErrBackupFailed.WithMessage("failed to update backup config"))
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *BackupRestoreHandler) DeleteConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	if err := h.cfgRepo.Delete(r.Context(), id); err != nil {
		writeAppError(w, r, ErrBackupFailed.WithMessage("failed to delete config"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ── Run management ──────────────────────────────────────

func (h *BackupRestoreHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 && v <= 200 {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = v
		}
	}

	runs, err := h.runRepo.List(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("backup: failed to list runs")
		writeAppError(w, r, ErrDBQuery.WithMessage("failed to list backup runs"))
		return
	}
	if runs == nil {
		runs = []*models.BackupRun{}
	}
	writeJSON(w, http.StatusOK, runs)
}

func (h *BackupRestoreHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		writeAppError(w, r, ErrBackupRunNotFound)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// TriggerBackup starts an immediate backup using a config.
func (h *BackupRestoreHandler) TriggerBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		writeAppError(w, r, ErrBackupConfigNotFound)
		return
	}

	run := &models.BackupRun{
		ConfigID:   &cfg.ID,
		RunType:    "backup",
		BackupType: cfg.BackupType,
		Status:     "queued",
		Provider:   cfg.Provider,
		Metadata:   json.RawMessage(`{"trigger": "manual"}`),
	}
	if err := h.runRepo.Create(r.Context(), run); err != nil {
		writeAppError(w, r, ErrBackupFailed.WithMessage("failed to create backup run"))
		return
	}

	// Run async
	go h.processor.RunBackup(context.Background(), cfg, run)

	writeJSON(w, http.StatusAccepted, run)
}

// TriggerQuickBackup starts an immediate full backup with default settings (no config needed).
func (h *BackupRestoreHandler) TriggerQuickBackup(w http.ResponseWriter, r *http.Request) {
	cfg := &models.BackupConfig{
		Name:           "Quick Backup",
		BackupType:     "full",
		Provider:       "local",
		ProviderConfig: json.RawMessage(`{"path": "/data/backups"}`),
		Compress:       true,
	}

	run := &models.BackupRun{
		RunType:    "backup",
		BackupType: "full",
		Status:     "queued",
		Provider:   "local",
		Metadata:   json.RawMessage(`{"trigger": "quick"}`),
	}
	if err := h.runRepo.Create(r.Context(), run); err != nil {
		writeAppError(w, r, ErrBackupFailed.WithMessage("failed to create backup run"))
		return
	}

	go h.processor.RunBackup(context.Background(), cfg, run)
	writeJSON(w, http.StatusAccepted, run)
}

// ── Download / Verify / Restore ────────────────────────────

// DownloadBackup streams the backup file to the client.
func (h *BackupRestoreHandler) DownloadBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil || run.FilePath == nil {
		writeAppError(w, r, ErrBackupRunNotFound)
		return
	}

	// Find provider config from the associated config or use defaults for local
	providerConfig := json.RawMessage(`{"path": "/data/backups"}`)
	if run.ConfigID != nil {
		if cfg, err := h.cfgRepo.GetByID(r.Context(), *run.ConfigID); err == nil {
			providerConfig = cfg.ProviderConfig
		}
	}

	provider, err := backup.NewProvider(run.Provider, providerConfig)
	if err != nil {
		writeAppError(w, r, ErrBackupStorageError.WithMessage("failed to initialize storage provider"))
		return
	}

	rc, err := provider.Download(r.Context(), *run.FilePath)
	if err != nil {
		writeAppError(w, r, ErrBackupStorageError.WithMessage("failed to download backup file"))
		return
	}
	defer rc.Close()

	fileName := "backup.json"
	if run.FileName != nil {
		fileName = *run.FileName
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	w.WriteHeader(http.StatusOK)
	io.Copy(w, rc)
}

// VerifyBackup verifies the integrity of an existing backup by re-downloading and checking checksum.
func (h *BackupRestoreHandler) VerifyBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		writeAppError(w, r, ErrBackupRunNotFound)
		return
	}

	providerConfig := json.RawMessage(`{"path": "/data/backups"}`)
	if run.ConfigID != nil {
		if cfg, err := h.cfgRepo.GetByID(r.Context(), *run.ConfigID); err == nil {
			providerConfig = cfg.ProviderConfig
		}
	}

	if err := h.processor.VerifyBackup(r.Context(), run, run.Provider, providerConfig); err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"verified": false,
			"error":    err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"verified": true,
		"checksum": run.Checksum,
	})
}

// PreviewRestore downloads and parses a backup, returning table names and row counts without importing.
func (h *BackupRestoreHandler) PreviewRestore(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		writeAppError(w, r, ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		writeAppError(w, r, ErrBackupRunNotFound)
		return
	}

	providerConfig := json.RawMessage(`{"path": "/data/backups"}`)
	if run.ConfigID != nil {
		if cfg, err := h.cfgRepo.GetByID(r.Context(), *run.ConfigID); err == nil {
			providerConfig = cfg.ProviderConfig
		}
	}

	data, err := h.processor.RestoreBackup(r.Context(), run, run.Provider, providerConfig)
	if err != nil {
		writeAppError(w, r, ErrRestoreFailed.WithMessage(fmt.Sprintf("failed to parse backup: %v", err)))
		return
	}

	type tableInfo struct {
		Name string `json:"name"`
		Rows int    `json:"rows"`
	}
	var tables []tableInfo
	for name, raw := range data {
		if name == "_metadata" {
			continue
		}
		var arr []json.RawMessage
		json.Unmarshal(raw, &arr)
		tables = append(tables, tableInfo{Name: name, Rows: len(arr)})
	}

	// Extract metadata
	var meta map[string]interface{}
	if m, ok := data["_metadata"]; ok {
		json.Unmarshal(m, &meta)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tables":            tables,
		"metadata":          meta,
		"checksum_verified": run.Checksum != nil,
	})
}
