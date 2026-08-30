package notification

import (
	"encoding/json"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"net/http"
	"strconv"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// ScheduleHandler manages scheduled notifications.
type ScheduleHandler struct {
	schedRepo  *dbnotif.NotificationScheduleRepo
	prefRepo   *dbnotif.NotificationPreferenceRepo
	metricRepo *dbnotif.NotificationMetricRepo
}

func NewScheduleHandler(db *database.DB) *ScheduleHandler {
	return &ScheduleHandler{
		schedRepo:  dbnotif.NewNotificationScheduleRepo(db),
		prefRepo:   dbnotif.NewNotificationPreferenceRepo(db),
		metricRepo: dbnotif.NewNotificationMetricRepo(db),
	}
}

// --- Schedules ---

func (h *ScheduleHandler) ListSchedules(w http.ResponseWriter, r *http.Request) {
	schedules, err := h.schedRepo.List(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list schedules")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list schedules")
		return
	}
	if schedules == nil {
		schedules = []*notificationmodel.NotificationSchedule{}
	}
	httpx.WriteJSON(w, http.StatusOK, schedules)
}

func (h *ScheduleHandler) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	var s notificationmodel.NotificationSchedule
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if s.ChannelID == 0 || s.Title == "" || s.Message == "" {
		httpx.WriteError(w, http.StatusBadRequest, "channel_id, title, and message are required")
		return
	}
	if s.CronExpr == nil && s.ScheduledAt == nil {
		httpx.WriteError(w, http.StatusBadRequest, "either cron_expr or scheduled_at is required")
		return
	}
	if err := h.schedRepo.Create(r.Context(), &s); err != nil {
		log.Error().Err(err).Msg("failed to create schedule")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create schedule")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, s)
}

func (h *ScheduleHandler) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "scheduleID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid schedule ID")
		return
	}
	if err := h.schedRepo.Delete(r.Context(), id); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete schedule")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- Preferences ---

func (h *ScheduleHandler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	prefs, err := h.prefRepo.GetByChannel(r.Context(), channelID)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get preferences")
		return
	}
	if prefs == nil {
		prefs = []*notificationmodel.NotificationPreference{}
	}
	httpx.WriteJSON(w, http.StatusOK, prefs)
}

func (h *ScheduleHandler) UpdatePreference(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	var body struct {
		EventType string `json:"event_type"`
		Enabled   bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.EventType == "" {
		httpx.WriteError(w, http.StatusBadRequest, "event_type is required")
		return
	}
	if err := h.prefRepo.Upsert(r.Context(), channelID, body.EventType, body.Enabled); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update preference")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// --- Analytics ---

func (h *ScheduleHandler) GetAnalytics(w http.ResponseWriter, r *http.Request) {
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 && d <= 365 {
			days = d
		}
	}
	summary, err := h.metricRepo.GetSummary(r.Context(), days)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get analytics")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, summary)
}

func (h *ScheduleHandler) GetChannelMetrics(w http.ResponseWriter, r *http.Request) {
	channelID, err := strconv.ParseInt(chi.URLParam(r, "channelID"), 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get metrics")
		return
	}
	if metrics == nil {
		metrics = []*notificationmodel.NotificationMetric{}
	}
	httpx.WriteJSON(w, http.StatusOK, metrics)
}
