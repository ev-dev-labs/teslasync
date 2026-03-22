package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// NotificationScheduleHandler manages scheduled notifications.
type NotificationScheduleHandler struct {
	schedRepo *database.NotificationScheduleRepo
	prefRepo  *database.NotificationPreferenceRepo
	metricRepo *database.NotificationMetricRepo
}

func NewNotificationScheduleHandler(db *database.DB) *NotificationScheduleHandler {
	return &NotificationScheduleHandler{
		schedRepo:  database.NewNotificationScheduleRepo(db),
		prefRepo:   database.NewNotificationPreferenceRepo(db),
		metricRepo: database.NewNotificationMetricRepo(db),
	}
}

// --- Schedules ---

func (h *NotificationScheduleHandler) ListSchedules(w http.ResponseWriter, r *http.Request) {
	schedules, err := h.schedRepo.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list schedules")
		writeError(w, http.StatusInternalServerError, "failed to list schedules")
		return
	}
	if schedules == nil {
		schedules = []*models.NotificationSchedule{}
	}
	writeJSON(w, http.StatusOK, schedules)
}

func (h *NotificationScheduleHandler) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	var s models.NotificationSchedule
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if s.ChannelID == 0 || s.Title == "" || s.Message == "" {
		writeError(w, http.StatusBadRequest, "channel_id, title, and message are required")
		return
	}
	if s.CronExpr == nil && s.ScheduledAt == nil {
		writeError(w, http.StatusBadRequest, "either cron_expr or scheduled_at is required")
		return
	}
	if err := h.schedRepo.Create(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to create schedule")
		writeError(w, http.StatusInternalServerError, "failed to create schedule")
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

func (h *NotificationScheduleHandler) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "scheduleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid schedule ID")
		return
	}
	if err := h.schedRepo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete schedule")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- Preferences ---

func (h *NotificationScheduleHandler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	prefs, err := h.prefRepo.GetByChannel(r.Context(), channelID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get preferences")
		return
	}
	if prefs == nil {
		prefs = []*models.NotificationPreference{}
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (h *NotificationScheduleHandler) UpdatePreference(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	var body struct {
		EventType string `json:"event_type"`
		Enabled   bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.EventType == "" {
		writeError(w, http.StatusBadRequest, "event_type is required")
		return
	}
	if err := h.prefRepo.Upsert(r.Context(), channelID, body.EventType, body.Enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update preference")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// --- Analytics ---

func (h *NotificationScheduleHandler) GetAnalytics(w http.ResponseWriter, r *http.Request) {
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 && d <= 365 {
			days = d
		}
	}
	summary, err := h.metricRepo.GetSummary(r.Context(), days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get analytics")
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *NotificationScheduleHandler) GetChannelMetrics(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 && d <= 365 {
			days = d
		}
	}
	metrics, err := h.metricRepo.GetByChannel(r.Context(), channelID, days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get metrics")
		return
	}
	if metrics == nil {
		metrics = []*models.NotificationMetric{}
	}
	writeJSON(w, http.StatusOK, metrics)
}
