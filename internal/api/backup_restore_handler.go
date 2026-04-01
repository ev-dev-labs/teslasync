package api

import (
	"context"
	"encoding/json"
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
		writeError(w, http.StatusInternalServerError, "failed to list backup configs")
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
		writeError(w, http.StatusBadRequest, "invalid config ID")
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "config not found")
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *BackupRestoreHandler) CreateConfig(w http.ResponseWriter, r *http.Request) {
	var cfg models.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
		writeError(w, http.StatusInternalServerError, "failed to create backup config")
		return
	}
	writeJSON(w, http.StatusCreated, cfg)
}

func (h *BackupRestoreHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config ID")
		return
	}
	var cfg models.BackupConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
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
		writeError(w, http.StatusInternalServerError, "failed to update backup config")
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

func (h *BackupRestoreHandler) DeleteConfig(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config ID")
		return
	}
	if err := h.cfgRepo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete config")
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
		writeError(w, http.StatusInternalServerError, "failed to list backup runs")
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
		writeError(w, http.StatusBadRequest, "invalid run ID")
		return
	}
	run, err := h.runRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "run not found")
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// TriggerBackup starts an immediate backup using a config.
func (h *BackupRestoreHandler) TriggerBackup(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "configID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid config ID")
		return
	}
	cfg, err := h.cfgRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "config not found")
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
		writeError(w, http.StatusInternalServerError, "failed to create backup run")
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
		writeError(w, http.StatusInternalServerError, "failed to create backup run")
		return
	}

	go h.processor.RunBackup(context.Background(), cfg, run)
	writeJSON(w, http.StatusAccepted, run)
}
