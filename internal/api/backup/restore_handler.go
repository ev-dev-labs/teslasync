package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apperror"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	corebackup "github.com/ev-dev-labs/teslasync/internal/backup"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbackup "github.com/ev-dev-labs/teslasync/internal/database/backup"
	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"
)

// RestoreHandler exposes the backup config CRUD + run management +
// download/verify/preview-restore endpoints. Mounted under
// /api/v1/backup/* in router.go.
//
// The platform-side backup logic (Processor, Provider) lives in
// internal/backup; that package shares the bare name `backup` with
// THIS package, so it is aliased here as `corebackup` to disambiguate.
type RestoreHandler struct {
	cfgRepo   *dbbackup.BackupConfigRepo
	runRepo   *dbbackup.BackupRunRepo
	processor *corebackup.Processor
}

// NewRestoreHandler constructs a RestoreHandler with default repos and
// processor wired from the given DB pool.
func NewRestoreHandler(db *database.DB) *RestoreHandler {
	return &RestoreHandler{
		cfgRepo:   dbbackup.NewBackupConfigRepo(db),
		runRepo:   dbbackup.NewBackupRunRepo(db),
		processor: corebackup.NewProcessor(db),
	}
}

func (h *RestoreHandler) ListConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := h.cfgRepo.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("backup: failed to list configs")
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list backup configs"))
		return
	}
	if configs == nil {
		configs = []*backupmodel.BackupConfig{}
	}
	httpx.WriteJSON(w, http.StatusOK, configs)
}

func (h *RestoreHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupConfigNotFound)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, cfg)
}

func (h *RestoreHandler) CreateConfig(w http.ResponseWriter, r *http.Request) {
	var cfg backupmodel.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return
	}
	clampConfigBounds(&cfg)
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
		apperror.Write(w, r, apperror.ErrBackupFailed.WithMessage("failed to create backup config"))
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, cfg)
}

func (h *RestoreHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	var cfg backupmodel.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		apperror.Write(w, r, apperror.ErrInvalidJSON)
		return
	}
	cfg.ID = id
	clampConfigBounds(&cfg)

	if err := h.cfgRepo.Update(r.Context(), &cfg); err != nil {
		log.Error().Err(err).Msg("backup: failed to update config")
		apperror.Write(w, r, apperror.ErrBackupFailed.WithMessage("failed to update backup config"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, cfg)
}

func (h *RestoreHandler) DeleteConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	if err := h.cfgRepo.Delete(r.Context(), id); err != nil {
		apperror.Write(w, r, apperror.ErrBackupFailed.WithMessage("failed to delete config"))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// clampConfigBounds keeps create/update bounds aligned.
func clampConfigBounds(cfg *backupmodel.BackupConfig) {
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
}

func (h *RestoreHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
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
		apperror.Write(w, r, apperror.ErrDBQuery.WithMessage("failed to list backup runs"))
		return
	}
	if runs == nil {
		runs = []*backupmodel.BackupRun{}
	}
	httpx.WriteJSON(w, http.StatusOK, runs)
}

func (h *RestoreHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupRunNotFound)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, run)
}

// TriggerBackup starts an immediate backup using a config.
func (h *RestoreHandler) TriggerBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid config ID"))
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupConfigNotFound)
		return
	}

	run := &backupmodel.BackupRun{
		ConfigID:   &cfg.ID,
		RunType:    "backup",
		BackupType: cfg.BackupType,
		Status:     "queued",
		Provider:   cfg.Provider,
		Metadata:   json.RawMessage(`{"trigger": "manual"}`),
	}
	if err := h.runRepo.Create(r.Context(), run); err != nil {
		apperror.Write(w, r, apperror.ErrBackupFailed.WithMessage("failed to create backup run"))
		return
	}

	// Detach from the request context because the run continues after response.
	go h.processor.RunBackup(context.Background(), cfg, run)

	httpx.WriteJSON(w, http.StatusAccepted, run)
}

// TriggerQuickBackup starts an immediate full backup with default
// settings (no config needed).
func (h *RestoreHandler) TriggerQuickBackup(w http.ResponseWriter, r *http.Request) {
	cfg := &backupmodel.BackupConfig{
		Name:           "Quick Backup",
		BackupType:     "full",
		Provider:       "local",
		ProviderConfig: json.RawMessage(`{"path": "/data/backups"}`),
		Compress:       true,
	}

	run := &backupmodel.BackupRun{
		RunType:    "backup",
		BackupType: "full",
		Status:     "queued",
		Provider:   "local",
		Metadata:   json.RawMessage(`{"trigger": "quick"}`),
	}
	if err := h.runRepo.Create(r.Context(), run); err != nil {
		apperror.Write(w, r, apperror.ErrBackupFailed.WithMessage("failed to create backup run"))
		return
	}

	go h.processor.RunBackup(context.Background(), cfg, run)
	httpx.WriteJSON(w, http.StatusAccepted, run)
}

// DownloadBackup streams the backup file to the client.
func (h *RestoreHandler) DownloadBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil || run.FilePath == nil {
		apperror.Write(w, r, apperror.ErrBackupRunNotFound)
		return
	}

	providerConfig := h.providerConfigForRun(r.Context(), run)

	provider, err := corebackup.NewProvider(run.Provider, providerConfig)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupStorageError.WithMessage("failed to initialize storage provider"))
		return
	}

	rc, err := provider.Download(r.Context(), *run.FilePath)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupStorageError.WithMessage("failed to download backup file"))
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
	_, _ = io.Copy(w, rc)
}

// VerifyBackup verifies the integrity of an existing backup by
// re-downloading and checking the checksum.
func (h *RestoreHandler) VerifyBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupRunNotFound)
		return
	}

	providerConfig := h.providerConfigForRun(r.Context(), run)

	if err := h.processor.VerifyBackup(r.Context(), run, run.Provider, providerConfig); err != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"verified": false,
			"error":    err.Error(),
		})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"verified": true,
		"checksum": run.Checksum,
	})
}

// PreviewRestore downloads and parses a backup, returning table names
// and row counts without importing.
func (h *RestoreHandler) PreviewRestore(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "runID"), 10, 64)
	if err != nil {
		apperror.Write(w, r, apperror.ErrInvalidID.WithMessage("invalid run ID"))
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		apperror.Write(w, r, apperror.ErrBackupRunNotFound)
		return
	}

	providerConfig := h.providerConfigForRun(r.Context(), run)

	data, err := h.processor.RestoreBackup(r.Context(), run, run.Provider, providerConfig)
	if err != nil {
		apperror.Write(w, r, apperror.ErrRestoreFailed.WithMessage(fmt.Sprintf("failed to parse backup: %v", err)))
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
		_ = json.Unmarshal(raw, &arr)
		tables = append(tables, tableInfo{Name: name, Rows: len(arr)})
	}

	var meta map[string]interface{}
	if m, ok := data["_metadata"]; ok {
		_ = json.Unmarshal(m, &meta)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"tables":            tables,
		"metadata":          meta,
		"checksum_verified": run.Checksum != nil,
	})
}

// providerConfigForRun uses the saved config when present, otherwise the local
// provider default shared by download, verify, and preview.
func (h *RestoreHandler) providerConfigForRun(ctx context.Context, run *backupmodel.BackupRun) json.RawMessage {
	providerConfig := json.RawMessage(`{"path": "/data/backups"}`)
	if run.ConfigID != nil {
		if cfg, err := h.cfgRepo.GetByID(ctx, *run.ConfigID); err == nil {
			providerConfig = cfg.ProviderConfig
		}
	}
	return providerConfig
}
