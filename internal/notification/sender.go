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
	// Severity is the wire-level severity ('info' | 'warn' | 'critical')
	// used by the quiet-hours dispatcher to decide whether to bypass an
	// active Do-Not-Disturb window. Empty values are treated as 'info'.
	// Phase-46 / Prompt 19.
	Severity string `json:"severity,omitempty"`
	// SuppressTransportTitle asks transports that render a separate
	// title field (Discord/Slack/Telegram/ntfy/webhook) to deliver
	// body-only output: no bold header line, no X-Title header. The
	// canonical Title is still passed in for transports that REQUIRE
	// one (WebPush, email Subject, Pushover) and for notification_logs
	// persistence. Phase-50 / ADR-005.
	SuppressTransportTitle bool `json:"suppress_transport_title,omitempty"`
}

// InternalTopic is the MQTT topic used for internal notification dispatch.
const InternalTopic = "teslasync/internal/notifications"

// Send dispatches a notification to the appropriate channel.
func Send(req *Request) error {
	switch req.ChannelType {
	case "discord":
		return sendDiscord(req.Config["webhook_url"], req.Title, req.Message, req.SuppressTransportTitle)
	case "slack":
		return sendSlack(req.Config["webhook_url"], req.Title, req.Message, req.SuppressTransportTitle)
	case "telegram":
		return sendTelegram(req.Config["bot_token"], req.Config["chat_id"], req.Title, req.Message, req.SuppressTransportTitle)
	case "webhook":
		return sendWebhook(req.Config["url"], req.Config["method"], req.Title, req.Message, req.SuppressTransportTitle)
	case "ntfy":
		return sendNtfy(req.Config["server_url"], req.Config["topic"], req.Title, req.Message, req.SuppressTransportTitle)
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

// sendDiscord posts a Markdown-formatted content payload to a Discord
// webhook URL. The canonical layout is `**<title>**\n<message>` so the
// title renders bold. When `suppressTitle` is set (rule.IncludeTitle =
// false) we drop the bold header AND the leading newline so the body
// stands alone — empty body is treated as a no-op rather than sending
// a blank message. Phase-50 / ADR-005.
func sendDiscord(webhookURL, title, message string, suppressTitle bool) error {
	content := fmt.Sprintf("**%s**\n%s", title, message)
	if suppressTitle {
		if message == "" {
			return nil
		}
		content = message
	}
	payload := map[string]interface{}{"content": content}
	return postJSON(webhookURL, payload)
}

func sendSlack(webhookURL, title, message string, suppressTitle bool) error {
	text := fmt.Sprintf("*%s*\n%s", title, message)
	if suppressTitle {
		if message == "" {
			return nil
		}
		text = message
	}
	payload := map[string]interface{}{"text": text}
	return postJSON(webhookURL, payload)
}

func sendTelegram(botToken, chatID, title, message string, suppressTitle bool) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	text := fmt.Sprintf("*%s*\n%s", title, message)
	if suppressTitle {
		if message == "" {
			return nil
		}
		text = message
	}
	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "Markdown",
	}
	return postJSON(url, payload)
}

// sendWebhook posts a JSON body to a user-configured URL. The payload
// always carries both `title` and `message` keys so receivers can
// branch on them; when `suppressTitle` is set we emit an empty string
// for the title key (rather than dropping it) to keep the schema
// stable for consumers that pre-declare a typed struct.
func sendWebhook(url, method, title, message string, suppressTitle bool) error {
	if method == "" {
		method = "POST"
	}
	effectiveTitle := title
	if suppressTitle {
		effectiveTitle = ""
	}
	payload := map[string]interface{}{
		"title":   effectiveTitle,
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

// sendNtfy posts the message body to a ntfy topic. When `suppressTitle`
// is set we omit the `Title` header so ntfy renders the body alone.
func sendNtfy(serverURL, topic, title, message string, suppressTitle bool) error {
	url := fmt.Sprintf("%s/%s", serverURL, topic)
	req, err := http.NewRequest("POST", url, bytes.NewReader([]byte(message)))
	if err != nil {
		return err
	}
	if !suppressTitle && title != "" {
		req.Header.Set("Title", title)
	}
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
