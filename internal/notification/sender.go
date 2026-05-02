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
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// Request describes a notification to be delivered.
type Request struct {
	ChannelType string            `json:"channel_type"` // discord, slack, telegram, webhook, ntfy, pushover
	Config      map[string]string `json:"config"`       // channel-specific config (webhook_url, bot_token, etc.)
	Title       string            `json:"title"`
	Message     string            `json:"message"`
	ChannelID   int64             `json:"channel_id,omitempty"` // for logging
	// AlertID, when > 0, links the resulting notification_logs row to its
	// originating alert_rules row. Required for the frontend's drill-through
	// from alert toast to context page (Phase 40 / Prompt 14) and for
	// computed-metric alerts to surface as alert-backed notifications.
	AlertID int64 `json:"alert_id,omitempty"`
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
	case ChannelTypeWebPush:
		return dispatchWebPush(req)
	default:
		return fmt.Errorf("unsupported channel type: %s", req.ChannelType)
	}
}

// ChannelTypeWebPush is the synthetic channel name used by the alert
// fan-out path to deliver a single notification to every subscribed
// browser-device-pairing. There is no user-configurable "WebPush channel"
// row in notification_channels — the fan-out builds one Request per alert
// with this ChannelType and an empty Config, and the dispatcher resolves
// the registered webpush.Service to do the actual delivery.
const ChannelTypeWebPush = "webpush"

// webpushDispatcher is the dispatcher hook for the synthetic "webpush"
// channel (Phase 40 / Prompt 52). Each binary that wires Web Push registers
// it via SetWebPushDispatcher in main(); the package keeps the function
// behind an indirection because internal/webpush imports
// internal/database which transitively depends on this package, so a
// direct import would create a cycle.
//
// When unset (no VAPID config, e.g. local dev without push), Send() for
// "webpush" requests is a no-op that returns nil so the alert fan-out
// stays green.
var (
	webpushDispatcher   func(req *Request) error
	webpushDispatcherMu sync.RWMutex
)

// SetWebPushDispatcher registers the dispatcher hook called for every
// Request whose ChannelType is ChannelTypeWebPush. Pass nil to clear it
// (used by tests).
func SetWebPushDispatcher(d func(req *Request) error) {
	webpushDispatcherMu.Lock()
	webpushDispatcher = d
	webpushDispatcherMu.Unlock()
}

func dispatchWebPush(req *Request) error {
	webpushDispatcherMu.RLock()
	d := webpushDispatcher
	webpushDispatcherMu.RUnlock()
	if d == nil {
		// No-op when push is disabled or the binary did not register a
		// dispatcher (e.g. test harnesses).
		log.Debug().Str("title", req.Title).Msg("webpush dispatcher not registered — skipping")
		return nil
	}
	return d(req)
}

var httpClient *http.Client

var (
	// senderClientMu guards swaps of the package-level httpClient. The
	// pointer is read on every notification dispatch so the swap MUST be
	// race-safe.
	senderClientMu sync.RWMutex
)

// senderClientTimeout matches the historical 10s budget retained for
// backwards compatibility with the previous bare http.Client.
const senderClientTimeout = 10 * time.Second

func init() {
	// Initialise the package-level client at import time so callers that
	// never invoke SetSink (tests, off-by-default disabled-sink mode) keep
	// today's behaviour: zerolog-only, no api_call_logs persistence.
	httpClient = newSenderClient(nil)
}

// SetSink rebuilds the package-level outbound HTTP client to route every
// notification dispatch through the supplied APICallSink. Production wiring
// (cmd/teslasync/main.go, cmd/notification-worker/main.go,
// cmd/automation-worker/main.go) calls this once at startup, AFTER the
// async api_call_logs writer has been constructed and BEFORE the MQTT
// notification consumer starts.
//
// Passing a nil sink reverts to the no-sink default (zerolog only) — useful
// for tests that need to undo a previous SetSink call (use t.Cleanup).
//
// Safe to call concurrently with in-flight notification dispatches: the
// pointer swap is guarded by senderClientMu and round-trips already
// resolved their *http.Client before the swap remain valid for the
// lifetime of that round-trip.
func SetSink(sink httputil.APICallSink) {
	c := newSenderClient(sink)
	senderClientMu.Lock()
	httpClient = c
	senderClientMu.Unlock()
}

// newSenderClient builds the *http.Client used for every channel dispatch in
// this package. A single client is reused (Name="notify-generic") because
// the notification worker fan-outs over channel types in-process; per-call
// LoggedTransport tags every entry with service="notify-generic" so
// downstream queries see one consolidated stream.
func newSenderClient(sink httputil.APICallSink) *http.Client {
	return httputil.NewClient(httputil.ClientConfig{
		Name:          "notify-generic",
		Timeout:       senderClientTimeout,
		Sink:          sink,
		EnableLogging: true,
	})
}

// senderClient returns the current package-level outbound client under the
// senderClientMu read lock so the pointer is observed coherently with the
// last SetSink swap.
func senderClient() *http.Client {
	senderClientMu.RLock()
	defer senderClientMu.RUnlock()
	return httpClient
}

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
	resp, err := senderClient().Do(req)
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
	resp, err := senderClient().Do(req)
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
	resp, err := senderClient().Post(url, "application/json", bytes.NewReader(body))
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
