package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/models"
)

// NotificationHandler handles notification channel CRUD and test delivery.
type NotificationHandler struct {
	repo *database.NotificationRepo
}

func NewNotificationHandler(db *database.DB) *NotificationHandler {
	return &NotificationHandler{repo: database.NewNotificationRepo(db)}
}

func (h *NotificationHandler) ListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := h.repo.GetAllChannels(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list notification channels")
		writeError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	if channels == nil {
		channels = []*models.NotificationChannel{}
	}
	writeJSON(w, http.StatusOK, channels)
}

func (h *NotificationHandler) GetChannel(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "channelID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	ch, err := h.repo.GetChannel(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

func (h *NotificationHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string            `json:"name"`
		Type    string            `json:"type"`
		Config  map[string]string `json:"config"`
		Enabled bool              `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	validTypes := map[string]bool{"discord": true, "email": true, "slack": true, "telegram": true, "webhook": true, "ntfy": true, "pushover": true}
	if !validTypes[body.Type] {
		writeError(w, http.StatusBadRequest, "invalid channel type")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	ch := &models.NotificationChannel{
		Name:    strings.TrimSpace(body.Name),
		Type:    body.Type,
		Config:  body.Config,
		Enabled: body.Enabled,
	}
	if ch.Config == nil {
		ch.Config = make(map[string]string)
	}

	if err := h.repo.CreateChannel(r.Context(), ch); err != nil {
		log.Error().Err(err).Msg("failed to create notification channel")
		writeError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}
	writeJSON(w, http.StatusCreated, ch)
}

func (h *NotificationHandler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "channelID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	var body struct {
		Name    string            `json:"name"`
		Type    string            `json:"type"`
		Config  map[string]string `json:"config"`
		Enabled bool              `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	ch := &models.NotificationChannel{
		ID:      id,
		Name:    strings.TrimSpace(body.Name),
		Type:    body.Type,
		Config:  body.Config,
		Enabled: body.Enabled,
	}
	if ch.Config == nil {
		ch.Config = make(map[string]string)
	}

	if err := h.repo.UpdateChannel(r.Context(), ch); err != nil {
		log.Error().Err(err).Msg("failed to update notification channel")
		writeError(w, http.StatusInternalServerError, "failed to update channel")
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

func (h *NotificationHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "channelID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	if err := h.repo.DeleteChannel(r.Context(), id); err != nil {
		log.Error().Err(err).Msg("failed to delete notification channel")
		writeError(w, http.StatusInternalServerError, "failed to delete channel")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *NotificationHandler) ToggleChannel(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "channelID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.repo.ToggleChannel(r.Context(), id, body.Enabled); err != nil {
		log.Error().Err(err).Msg("failed to toggle channel")
		writeError(w, http.StatusInternalServerError, "failed to toggle channel")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"id": id, "enabled": body.Enabled})
}

// TestChannel sends a test notification through the specified channel.
func (h *NotificationHandler) TestChannel(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "channelID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	ch, err := h.repo.GetChannel(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "channel not found")
		return
	}

	testMsg := "TeslaSync test notification — your channel is configured correctly!"
	sendErr := sendNotification(ch, "TeslaSync Test", testMsg)

	status := "sent"
	errStr := ""
	if sendErr != nil {
		status = "failed"
		errStr = sendErr.Error()
	}

	now := time.Now().UTC()
	logEntry := &models.NotificationLog{
		ChannelID: ch.ID,
		Title:     "TeslaSync Test",
		Message:   testMsg,
		Status:    status,
		Error:     errStr,
	}
	if status == "sent" {
		logEntry.SentAt = &now
	}
	_ = h.repo.CreateLog(r.Context(), logEntry)

	if sendErr != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": sendErr.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Test notification sent"})
}

func (h *NotificationHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	logs, err := h.repo.GetLogs(r.Context(), limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to get notification logs")
		writeError(w, http.StatusInternalServerError, "failed to get logs")
		return
	}
	if logs == nil {
		logs = []*models.NotificationLog{}
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *NotificationHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get notification stats")
		writeError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// sendNotification dispatches a message to the configured channel.
func sendNotification(ch *models.NotificationChannel, title, message string) error {
	switch ch.Type {
	case "discord":
		return sendDiscord(ch.Config["webhook_url"], title, message)
	case "slack":
		return sendSlack(ch.Config["webhook_url"], title, message)
	case "telegram":
		return sendTelegram(ch.Config["bot_token"], ch.Config["chat_id"], title, message)
	case "webhook":
		return sendWebhook(ch.Config["url"], ch.Config["method"], title, message)
	case "ntfy":
		return sendNtfy(ch.Config["server_url"], ch.Config["topic"], title, message)
	case "email":
		// Email requires SMTP config — log placeholder for now
		log.Info().Str("to", ch.Config["to"]).Str("title", title).Msg("email notification (SMTP not configured)")
		return nil
	case "pushover":
		return sendPushover(ch.Config["app_token"], ch.Config["user_key"], title, message)
	default:
		return fmt.Errorf("unsupported channel type: %s", ch.Type)
	}
}

func sendDiscord(webhookURL, title, message string) error {
	if webhookURL == "" {
		return fmt.Errorf("discord webhook_url not configured")
	}
	payload := map[string]interface{}{
		"embeds": []map[string]interface{}{
			{"title": title, "description": message, "color": 0xE82127},
		},
	}
	return postJSON(webhookURL, payload)
}

func sendSlack(webhookURL, title, message string) error {
	if webhookURL == "" {
		return fmt.Errorf("slack webhook_url not configured")
	}
	payload := map[string]interface{}{
		"text": fmt.Sprintf("*%s*\n%s", title, message),
	}
	return postJSON(webhookURL, payload)
}

func sendTelegram(botToken, chatID, title, message string) error {
	if botToken == "" || chatID == "" {
		return fmt.Errorf("telegram bot_token and chat_id required")
	}
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       fmt.Sprintf("*%s*\n%s", title, message),
		"parse_mode": "Markdown",
	}
	return postJSON(url, payload)
}

func sendWebhook(url, method, title, message string) error {
	if url == "" {
		return fmt.Errorf("webhook url not configured")
	}
	if method == "" {
		method = "POST"
	}
	payload := map[string]string{"title": title, "message": message, "source": "teslasync"}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("webhook returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func sendNtfy(serverURL, topic, title, message string) error {
	if topic == "" {
		return fmt.Errorf("ntfy topic not configured")
	}
	if serverURL == "" {
		serverURL = "https://ntfy.sh"
	}
	url := fmt.Sprintf("%s/%s", strings.TrimRight(serverURL, "/"), topic)
	req, err := http.NewRequest("POST", url, strings.NewReader(message))
	if err != nil {
		return err
	}
	req.Header.Set("Title", title)
	req.Header.Set("Priority", "default")
	req.Header.Set("Tags", "electric_plug")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ntfy returned %d", resp.StatusCode)
	}
	return nil
}

func sendPushover(appToken, userKey, title, message string) error {
	if appToken == "" || userKey == "" {
		return fmt.Errorf("pushover app_token and user_key required")
	}
	payload := map[string]string{
		"token":   appToken,
		"user":    userKey,
		"title":   title,
		"message": message,
	}
	return postJSON("https://api.pushover.net/1/messages.json", payload)
}

func postJSON(url string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}
