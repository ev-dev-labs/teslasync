// Package notification provides a message-queue-backed notification dispatcher.
//
// Instead of sending notifications synchronously inside HTTP handlers, callers
// publish a NotificationRequest to the MQTT broker. The Worker subscribes to
// the internal topic and delivers the notification asynchronously, decoupling
// request handling from external HTTP calls (Discord, Slack, Telegram, etc.).
package notification

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

// Request describes a notification to be delivered.
type Request struct {
	ChannelType string            `json:"channel_type"` // discord, slack, telegram, webhook, ntfy, pushover
	Config      map[string]string `json:"config"`       // channel-specific config (webhook_url, bot_token, etc.)
	Title       string            `json:"title"`
	Message     string            `json:"message"`
	ChannelID   int64             `json:"channel_id,omitempty"` // for logging
}

// InternalTopic is the MQTT topic used for internal notification dispatch.
const InternalTopic = "teslasync/internal/notifications"

// Send dispatches a notification to the appropriate channel.
func Send(req *Request) error {
	switch req.ChannelType {
	case "discord":
		return sendDiscord(req.Config["webhook_url"], req.Title, req.Message)
	case "slack":
		return sendSlack(req.Config["webhook_url"], req.Title, req.Message)
	case "telegram":
		return sendTelegram(req.Config["bot_token"], req.Config["chat_id"], req.Title, req.Message)
	case "webhook":
		return sendWebhook(req.Config["url"], req.Config["method"], req.Title, req.Message)
	case "ntfy":
		return sendNtfy(req.Config["server_url"], req.Config["topic"], req.Title, req.Message)
	case "pushover":
		return sendPushover(req.Config["app_token"], req.Config["user_key"], req.Title, req.Message)
	case "email":
		log.Info().Str("to", req.Config["to"]).Str("title", req.Title).Msg("email notification (SMTP not configured)")
		return nil
	default:
		return fmt.Errorf("unsupported channel type: %s", req.ChannelType)
	}
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

func sendDiscord(webhookURL, title, message string) error {
	payload := map[string]interface{}{
		"content": fmt.Sprintf("**%s**\n%s", title, message),
	}
	return postJSON(webhookURL, payload)
}

func sendSlack(webhookURL, title, message string) error {
	payload := map[string]interface{}{
		"text": fmt.Sprintf("*%s*\n%s", title, message),
	}
	return postJSON(webhookURL, payload)
}

func sendTelegram(botToken, chatID, title, message string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       fmt.Sprintf("*%s*\n%s", title, message),
		"parse_mode": "Markdown",
	}
	return postJSON(url, payload)
}

func sendWebhook(url, method, title, message string) error {
	if method == "" {
		method = "POST"
	}
	payload := map[string]interface{}{
		"title":   title,
		"message": message,
		"source":  "teslasync",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

func sendNtfy(serverURL, topic, title, message string) error {
	url := fmt.Sprintf("%s/%s", serverURL, topic)
	req, err := http.NewRequest("POST", url, bytes.NewReader([]byte(message)))
	if err != nil {
		return err
	}
	req.Header.Set("Title", title)
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func sendPushover(appToken, userKey, title, message string) error {
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
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return nil
}
