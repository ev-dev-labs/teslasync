package api

import (
	"context"
	"net/http"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// AlertHandler handles alert rule CRUD and test-notification HTTP requests.
// Alert firing/listing moved to the notifications subsystem (ADR-010).
type AlertHandler struct {
	alertRuleRepo alertRuleRepository
	notifRepo     notificationRepository
	eventHub      *EventHub
	mqttClient    pahomqtt.Client
	liveSignals   signal.LiveSignalStore
}

type alertRuleRepository interface {
	GetAll(context.Context) ([]*models.AlertRule, error)
	Update(context.Context, int64, *models.AlertRule) error
	GetByID(context.Context, int64) (*models.AlertRule, error)
	Create(context.Context, *models.AlertRule) error
	Delete(context.Context, int64) error
}

type notificationRepository interface {
	GetLogs(context.Context, int, int) ([]*models.NotificationLog, error)
	CreateLog(context.Context, *models.NotificationLog) error
	GetChannel(context.Context, int64) (*models.NotificationChannel, error)
	GetAllChannels(context.Context) ([]*models.NotificationChannel, error)
}

func NewAlertHandler(db *database.DB, hub *EventHub, mc pahomqtt.Client, store signal.LiveSignalStore) *AlertHandler {
	return &AlertHandler{
		alertRuleRepo: database.NewAlertRuleRepo(db),
		notifRepo:     database.NewNotificationRepo(db),
		eventHub:      hub,
		mqttClient:    mc,
		liveSignals:   store,
	}
}

// List returns recent notification logs. Alert rows migrated to
// notifications (ADR-010 Option B); this endpoint is kept for backward
// compatibility with the frontend /alerts route.
func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	logs, err := h.notifRepo.GetLogs(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list notification logs")
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	if logs == nil {
		logs = []*models.NotificationLog{}
	}
	writeJSON(w, http.StatusOK, logs)
}

// MarkRead is a no-op kept for backward compatibility. The notifications
// table is append-only (ADR-010); "read" status is tracked client-side.
func (h *AlertHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	if _, err := urlParamInt64(r, "alertID"); err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
