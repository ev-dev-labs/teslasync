package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// SettingsHandler handles user settings.
type SettingsHandler struct {
	settingsRepo *database.SettingsRepo
	cache        *database.Cache
}

func NewSettingsHandler(db *database.DB, cache *database.Cache) *SettingsHandler {
	return &SettingsHandler{
		settingsRepo: database.NewSettingsRepo(db),
		cache:        cache,
	}
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cacheKey := "settings:global"

	var s models.Settings
	if h.cache.Get(ctx, cacheKey, &s) {
		writeJSON(w, http.StatusOK, s)
		return
	}

	sp, err := h.settingsRepo.Get(ctx)
	if err != nil {
		log.Error().Err(err).Msg("failed to get settings")
		writeError(w, http.StatusInternalServerError, "failed to get settings")
		return
	}

	h.cache.Set(ctx, cacheKey, sp, 300*time.Second)
	writeJSON(w, http.StatusOK, sp)
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var s models.Settings
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.settingsRepo.Upsert(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to update settings")
		writeError(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	h.cache.Delete(context.Background(), "settings:global")
	writeJSON(w, http.StatusOK, s)
}
