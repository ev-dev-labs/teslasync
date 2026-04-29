package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// --- Mocks ---

type mockChannelRepo struct {
	channels []*models.NotificationChannel
	err      error
}

func (m *mockChannelRepo) GetAllChannels(_ context.Context) ([]*models.NotificationChannel, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.channels, nil
}

// capturedRequest records what was sent for test assertions.
type capturedRequest struct {
	ChannelType string
	Title       string
	Message     string
	ChannelID   int64
}

// --- DecodeNotifySpec Tests ---

func TestDecodeNotifySpec(t *testing.T) {
	tests := []struct {
		name        string
		input       json.RawMessage
		wantChannel string
		wantMessage string
		wantTitle   string
		wantErr     string
	}{
		{
			name:        "valid full config",
			input:       json.RawMessage(`{"type":"notify","channel":"all","message":"Hello","title":"Alert"}`),
			wantChannel: "all",
			wantMessage: "Hello",
			wantTitle:   "Alert",
		},
		{
			name:        "valid without type",
			input:       json.RawMessage(`{"channel":"discord","message":"test"}`),
			wantChannel: "discord",
			wantMessage: "test",
		},
		{
			name:        "valid all channels",
			input:       json.RawMessage(`{"type":"notify","channel":"all","message":"m"}`),
			wantChannel: "all",
		},
		{
			name:        "valid slack",
			input:       json.RawMessage(`{"type":"notify","channel":"slack","message":"m"}`),
			wantChannel: "slack",
		},
		{
			name:        "valid telegram",
			input:       json.RawMessage(`{"type":"notify","channel":"telegram","message":"m"}`),
			wantChannel: "telegram",
		},
		{
			name:        "valid email",
			input:       json.RawMessage(`{"type":"notify","channel":"email","message":"m"}`),
			wantChannel: "email",
		},
		{
			name:        "valid webhook",
			input:       json.RawMessage(`{"type":"notify","channel":"webhook","message":"m"}`),
			wantChannel: "webhook",
		},
		{
			name:        "valid ntfy",
			input:       json.RawMessage(`{"type":"notify","channel":"ntfy","message":"m"}`),
			wantChannel: "ntfy",
		},
		{
			name:        "valid pushover",
			input:       json.RawMessage(`{"type":"notify","channel":"pushover","message":"m"}`),
			wantChannel: "pushover",
		},
		{
			name:    "empty config",
			input:   json.RawMessage(``),
			wantErr: "action config is empty",
		},
		{
			name:    "invalid JSON",
			input:   json.RawMessage(`{broken`),
			wantErr: "unmarshal notify action config",
		},
		{
			name:    "wrong type",
			input:   json.RawMessage(`{"type":"command","channel":"all","message":"m"}`),
			wantErr: `expected type "notify"`,
		},
		{
			name:    "missing channel",
			input:   json.RawMessage(`{"type":"notify","message":"m"}`),
			wantErr: "channel is required",
		},
		{
			name:    "unsupported channel",
			input:   json.RawMessage(`{"type":"notify","channel":"sms","message":"m"}`),
			wantErr: `unsupported channel "sms"`,
		},
		{
			name:    "missing message",
			input:   json.RawMessage(`{"type":"notify","channel":"all"}`),
			wantErr: "message is required",
		},
		{
			name:    "empty message",
			input:   json.RawMessage(`{"type":"notify","channel":"all","message":""}`),
			wantErr: "message is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := DecodeNotifySpec(tt.input)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Channel != tt.wantChannel {
				t.Errorf("channel = %q, want %q", cfg.Channel, tt.wantChannel)
			}
			if tt.wantMessage != "" && cfg.Message != tt.wantMessage {
				t.Errorf("message = %q, want %q", cfg.Message, tt.wantMessage)
			}
			if tt.wantTitle != "" && cfg.Title != tt.wantTitle {
				t.Errorf("title = %q, want %q", cfg.Title, tt.wantTitle)
			}
		})
	}
}

// --- resolveTemplate Tests ---

func TestResolveTemplate(t *testing.T) {
	tests := []struct {
		name string
		tmpl string
		vars map[string]string
		want string
	}{
		{
			name: "single variable",
			tmpl: "Hello {{name}}",
			vars: map[string]string{"name": "Test Bot"},
			want: "Hello Test Bot",
		},
		{
			name: "multiple variables",
			tmpl: "{{name}} ran on {{vehicle}}: {{status}}",
			vars: map[string]string{"name": "Night Charge", "vehicle": "Model 3", "status": "success"},
			want: "Night Charge ran on Model 3: success",
		},
		{
			name: "unresolved variables left as-is",
			tmpl: "{{name}} at {{timestamp}}",
			vars: map[string]string{"name": "Bot"},
			want: "Bot at {{timestamp}}",
		},
		{
			name: "no variables",
			tmpl: "Plain message",
			vars: map[string]string{},
			want: "Plain message",
		},
		{
			name: "empty template",
			tmpl: "",
			vars: map[string]string{"name": "x"},
			want: "",
		},
		{
			name: "repeated variable",
			tmpl: "{{v}} and {{v}}",
			vars: map[string]string{"v": "ok"},
			want: "ok and ok",
		},
		{
			name: "nil vars",
			tmpl: "{{name}}",
			vars: nil,
			want: "{{name}}",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveTemplate(tt.tmpl, tt.vars)
			if got != tt.want {
				t.Errorf("resolveTemplate(%q) = %q, want %q", tt.tmpl, got, tt.want)
			}
		})
	}
}

// --- filterChannels Tests ---

func TestFilterChannels(t *testing.T) {
	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord #alerts", Type: "discord", Enabled: true},
		{ID: 2, Name: "Slack ops", Type: "slack", Enabled: true},
		{ID: 3, Name: "Disabled Telegram", Type: "telegram", Enabled: false},
		{ID: 4, Name: "Pushover", Type: "pushover", Enabled: true},
	}

	tests := []struct {
		name      string
		filter    string
		wantCount int
		wantIDs   []int64
	}{
		{"all returns enabled only", "all", 3, []int64{1, 2, 4}},
		{"discord filter", "discord", 1, []int64{1}},
		{"slack filter", "slack", 1, []int64{2}},
		{"telegram filter skips disabled", "telegram", 0, nil},
		{"pushover filter", "pushover", 1, []int64{4}},
		{"nonexistent type", "sms", 0, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := filterChannels(channels, tt.filter)
			if len(got) != tt.wantCount {
				t.Fatalf("filterChannels(%q) returned %d channels, want %d", tt.filter, len(got), tt.wantCount)
			}
			for i, ch := range got {
				if tt.wantIDs != nil && ch.ID != tt.wantIDs[i] {
					t.Errorf("channel[%d].ID = %d, want %d", i, ch.ID, tt.wantIDs[i])
				}
			}
		})
	}
}

// --- Execute Tests ---

func TestNotifyExecute_AllChannels(t *testing.T) {
	var sent []capturedRequest
	sender := func(req *notification.Request) error {
		sent = append(sent, capturedRequest{
			ChannelType: req.ChannelType,
			Title:       req.Title,
			Message:     req.Message,
			ChannelID:   req.ChannelID,
		})
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Config: map[string]string{"webhook_url": "http://example.com"}, Enabled: true},
		{ID: 2, Name: "Slack", Type: "slack", Config: map[string]string{"webhook_url": "http://example.com"}, Enabled: true},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{1: {ID: 1, DisplayName: "Model 3"}}},
		sender,
	)

	vid := int64(1)
	raw := json.RawMessage(`{"type":"notify","channel":"all","message":"Automation '{{name}}' ran: {{status}}","title":"TeslaSync","vars":{"name":"Night Charge","status":"success"}}`)
	resultJSON, err := exec.Execute(context.Background(), &vid, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result NotifyResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	if result.ChannelsSent != 2 {
		t.Errorf("channels_sent = %d, want 2", result.ChannelsSent)
	}
	if result.ChannelsFailed != 0 {
		t.Errorf("channels_failed = %d, want 0", result.ChannelsFailed)
	}
	if len(sent) != 2 {
		t.Fatalf("expected 2 sends, got %d", len(sent))
	}

	// Verify template resolution.
	wantMsg := "Automation 'Night Charge' ran: success"
	if sent[0].Message != wantMsg {
		t.Errorf("message = %q, want %q", sent[0].Message, wantMsg)
	}
	if sent[0].Title != "TeslaSync" {
		t.Errorf("title = %q, want %q", sent[0].Title, "TeslaSync")
	}
}

func TestNotifyExecute_SingleChannel(t *testing.T) {
	var sent []capturedRequest
	sender := func(req *notification.Request) error {
		sent = append(sent, capturedRequest{ChannelType: req.ChannelType, ChannelID: req.ChannelID})
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
		{ID: 2, Name: "Slack", Type: "slack", Enabled: true, Config: map[string]string{}},
		{ID: 3, Name: "Ntfy", Type: "ntfy", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		sender,
	)

	raw := json.RawMessage(`{"type":"notify","channel":"slack","message":"test"}`)
	resultJSON, err := exec.Execute(context.Background(), nil, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result NotifyResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if result.ChannelsSent != 1 {
		t.Errorf("channels_sent = %d, want 1", result.ChannelsSent)
	}
	if len(sent) != 1 {
		t.Fatalf("expected 1 send, got %d", len(sent))
	}
	if sent[0].ChannelType != "slack" {
		t.Errorf("channel_type = %q, want slack", sent[0].ChannelType)
	}
}

func TestNotifyExecute_PartialFailure(t *testing.T) {
	callCount := 0
	sender := func(req *notification.Request) error {
		callCount++
		if req.ChannelType == "slack" {
			return fmt.Errorf("slack timeout")
		}
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
		{ID: 2, Name: "Slack", Type: "slack", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		sender,
	)

	raw := json.RawMessage(`{"type":"notify","channel":"all","message":"test"}`)
	resultJSON, err := exec.Execute(context.Background(), nil, raw)

	if err == nil {
		t.Fatal("expected error for partial failure")
	}
	if !strings.Contains(err.Error(), "1 of 2") {
		t.Errorf("error %q should contain '1 of 2'", err.Error())
	}

	// Result should still be returned.
	if resultJSON == nil {
		t.Fatal("expected result JSON even on partial failure")
	}
	var result NotifyResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.ChannelsSent != 1 {
		t.Errorf("channels_sent = %d, want 1", result.ChannelsSent)
	}
	if result.ChannelsFailed != 1 {
		t.Errorf("channels_failed = %d, want 1", result.ChannelsFailed)
	}

	// Verify details.
	for _, d := range result.Details {
		if d.ChannelType == "discord" && !d.Success {
			t.Error("discord should have succeeded")
		}
		if d.ChannelType == "slack" && d.Success {
			t.Error("slack should have failed")
		}
		if d.ChannelType == "slack" && d.Error == "" {
			t.Error("slack detail should have error message")
		}
	}
}

func TestNotifyExecute_NoMatchingChannels(t *testing.T) {
	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		func(req *notification.Request) error { return nil },
	)

	raw := json.RawMessage(`{"type":"notify","channel":"telegram","message":"test"}`)
	_, err := exec.Execute(context.Background(), nil, raw)

	if err == nil {
		t.Fatal("expected error for no matching channels")
	}
	if !strings.Contains(err.Error(), "no enabled notification channels") {
		t.Errorf("error %q should mention no channels", err.Error())
	}
}

func TestNotifyExecute_AllDisabledChannels(t *testing.T) {
	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: false, Config: map[string]string{}},
		{ID: 2, Name: "Slack", Type: "slack", Enabled: false, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		func(req *notification.Request) error { return nil },
	)

	raw := json.RawMessage(`{"type":"notify","channel":"all","message":"test"}`)
	_, err := exec.Execute(context.Background(), nil, raw)

	if err == nil {
		t.Fatal("expected error for all disabled channels")
	}
	if !strings.Contains(err.Error(), "no enabled notification channels") {
		t.Errorf("error %q should mention no channels", err.Error())
	}
}

func TestNotifyExecute_ChannelRepoError(t *testing.T) {
	exec := NewNotifyExecutor(
		&mockChannelRepo{err: fmt.Errorf("db connection failed")},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		func(req *notification.Request) error { return nil },
	)

	raw := json.RawMessage(`{"type":"notify","channel":"all","message":"test"}`)
	_, err := exec.Execute(context.Background(), nil, raw)

	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "load notification channels") {
		t.Errorf("error %q should mention loading channels", err.Error())
	}
}

func TestNotifyExecute_InvalidConfig(t *testing.T) {
	exec := NewNotifyExecutor(
		&mockChannelRepo{},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		func(req *notification.Request) error { return nil },
	)

	tests := []struct {
		name    string
		raw     json.RawMessage
		wantErr string
	}{
		{"empty config", json.RawMessage(``), "invalid notify action config"},
		{"missing channel", json.RawMessage(`{"type":"notify","message":"m"}`), "invalid notify action config"},
		{"missing message", json.RawMessage(`{"type":"notify","channel":"all"}`), "invalid notify action config"},
		{"wrong type", json.RawMessage(`{"type":"command","channel":"all","message":"m"}`), "invalid notify action config"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := exec.Execute(context.Background(), nil, tt.raw)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestNotifyExecute_TemplateResolution(t *testing.T) {
	var sentMsg, sentTitle string
	sender := func(req *notification.Request) error {
		sentMsg = req.Message
		sentTitle = req.Title
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{
			42: {ID: 42, DisplayName: "Model Y LR"},
		}},
		sender,
	)

	vid := int64(42)
	raw := json.RawMessage(`{
		"type": "notify",
		"channel": "discord",
		"title": "{{name}} on {{vehicle}}",
		"message": "Status: {{status}}, battery: {{battery_level}}%, trigger: {{trigger}}",
		"vars": {
			"name": "Low Battery Alert",
			"status": "triggered",
			"battery_level": "15",
			"trigger": "battery_below"
		}
	}`)

	_, err := exec.Execute(context.Background(), &vid, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	wantTitle := "Low Battery Alert on Model Y LR"
	if sentTitle != wantTitle {
		t.Errorf("title = %q, want %q", sentTitle, wantTitle)
	}

	wantMsg := "Status: triggered, battery: 15%, trigger: battery_below"
	if sentMsg != wantMsg {
		t.Errorf("message = %q, want %q", sentMsg, wantMsg)
	}
}

func TestNotifyExecute_VehicleRepoError(t *testing.T) {
	// Vehicle repo error should not block notification — just skip vehicle var.
	var sentMsg string
	sender := func(req *notification.Request) error {
		sentMsg = req.Message
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{err: fmt.Errorf("db error")},
		sender,
	)

	vid := int64(1)
	raw := json.RawMessage(`{"type":"notify","channel":"discord","message":"Vehicle: {{vehicle}}"}`)
	_, err := exec.Execute(context.Background(), &vid, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Vehicle template should remain unresolved.
	if !strings.Contains(sentMsg, "{{vehicle}}") {
		t.Errorf("message %q should contain unresolved {{vehicle}}", sentMsg)
	}
}

func TestNotifyExecute_NilVehicleID(t *testing.T) {
	var sentMsg string
	sender := func(req *notification.Request) error {
		sentMsg = req.Message
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		sender,
	)

	raw := json.RawMessage(`{"type":"notify","channel":"discord","message":"Fleet alert: {{name}}","vars":{"name":"Fleet Check"}}`)
	_, err := exec.Execute(context.Background(), nil, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sentMsg != "Fleet alert: Fleet Check" {
		t.Errorf("message = %q, want %q", sentMsg, "Fleet alert: Fleet Check")
	}
}

func TestNotifyExecute_ContextCancelled(t *testing.T) {
	sender := func(req *notification.Request) error {
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		sender,
	)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	raw := json.RawMessage(`{"type":"notify","channel":"all","message":"test"}`)
	_, err := exec.Execute(ctx, nil, raw)

	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
	if !strings.Contains(err.Error(), "context cancelled") {
		t.Errorf("error %q should mention context cancelled", err.Error())
	}
}

func TestNotifyExecute_TimestampResolved(t *testing.T) {
	var sentMsg string
	sender := func(req *notification.Request) error {
		sentMsg = req.Message
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{}},
		sender,
	)

	raw := json.RawMessage(`{"type":"notify","channel":"discord","message":"Time: {{timestamp}}"}`)
	_, err := exec.Execute(context.Background(), nil, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Timestamp should have been resolved (no longer contains the placeholder).
	if strings.Contains(sentMsg, "{{timestamp}}") {
		t.Errorf("message %q should have resolved {{timestamp}}", sentMsg)
	}
	// Should look like an RFC3339 timestamp.
	if !strings.Contains(sentMsg, "T") || !strings.Contains(sentMsg, "Z") {
		t.Errorf("message %q doesn't look like it contains a UTC timestamp", sentMsg)
	}
}

func TestNotifyExecute_VarsOverrideAutoResolved(t *testing.T) {
	var sentMsg string
	sender := func(req *notification.Request) error {
		sentMsg = req.Message
		return nil
	}

	channels := []*models.NotificationChannel{
		{ID: 1, Name: "Discord", Type: "discord", Enabled: true, Config: map[string]string{}},
	}

	exec := NewNotifyExecutor(
		&mockChannelRepo{channels: channels},
		&mockVehicleRepo{byID: map[int64]*models.Vehicle{
			1: {ID: 1, DisplayName: "Model 3"},
		}},
		sender,
	)

	vid := int64(1)
	// Caller overrides the vehicle name.
	raw := json.RawMessage(`{"type":"notify","channel":"discord","message":"Vehicle: {{vehicle}}","vars":{"vehicle":"Custom Name"}}`)
	_, err := exec.Execute(context.Background(), &vid, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sentMsg != "Vehicle: Custom Name" {
		t.Errorf("message = %q, want %q", sentMsg, "Vehicle: Custom Name")
	}
}

// --- Interface Compliance ---

func TestNotifyExecutor_ImplementsActionExecutor(t *testing.T) {
	var _ ActionExecutor = (*NotifyExecutor)(nil)
}
