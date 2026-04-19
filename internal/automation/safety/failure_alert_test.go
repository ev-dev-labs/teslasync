package safety

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// ─── Mock Channel Loader ───────────────────────────────

type mockChannelLoader struct {
	mu       sync.Mutex
	channels []*models.NotificationChannel
	err      error
}

func (m *mockChannelLoader) GetAllChannels(_ context.Context) ([]*models.NotificationChannel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return nil, m.err
	}
	return m.channels, nil
}

func newMockChannelLoader(channels ...*models.NotificationChannel) *mockChannelLoader {
	return &mockChannelLoader{channels: channels}
}

// ─── Tracking Sender ───────────────────────────────────

type sentNotification struct {
	channelType string
	title       string
	message     string
	channelID   int64
}

type trackingSender struct {
	mu    sync.Mutex
	sent  []sentNotification
	err   error            // if non-nil, all sends fail
	errAt map[int64]error  // per-channel errors (keyed by channel ID)
}

func newTrackingSender() *trackingSender {
	return &trackingSender{errAt: make(map[int64]error)}
}

func (s *trackingSender) send(req *notification.Request) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if e, ok := s.errAt[req.ChannelID]; ok {
		return e
	}
	if s.err != nil {
		return s.err
	}
	s.sent = append(s.sent, sentNotification{
		channelType: req.ChannelType,
		title:       req.Title,
		message:     req.Message,
		channelID:   req.ChannelID,
	})
	return nil
}

func (s *trackingSender) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sent)
}

func (s *trackingSender) last() (sentNotification, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sent) == 0 {
		return sentNotification{}, false
	}
	return s.sent[len(s.sent)-1], true
}

func (s *trackingSender) all() []sentNotification {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]sentNotification, len(s.sent))
	copy(out, s.sent)
	return out
}

// ─── Helper ────────────────────────────────────────────

func testEvent() FailureEvent {
	return FailureEvent{
		AutomationID:      42,
		AutomationName:    "charge-guard",
		TriggerType:       "battery",
		FailedActionIndex: 1,
		FailedActionType:  "command",
		Error:             "vehicle is offline",
		RetryCount:        3,
		Timestamp:         time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC),
	}
}

func discordChannel() *models.NotificationChannel {
	return &models.NotificationChannel{
		ID:      1,
		Name:    "my-discord",
		Type:    "discord",
		Config:  map[string]string{"webhook_url": "https://discord.test/hook"},
		Enabled: true,
	}
}

func slackChannel() *models.NotificationChannel {
	return &models.NotificationChannel{
		ID:      2,
		Name:    "my-slack",
		Type:    "slack",
		Config:  map[string]string{"webhook_url": "https://slack.test/hook"},
		Enabled: true,
	}
}

func disabledChannel() *models.NotificationChannel {
	return &models.NotificationChannel{
		ID:      3,
		Name:    "disabled-channel",
		Type:    "telegram",
		Config:  map[string]string{"bot_token": "tok", "chat_id": "123"},
		Enabled: false,
	}
}

// ─── Send: Single Channel ──────────────────────────────

func TestSend_SingleChannel(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sender.count() != 1 {
		t.Fatalf("expected 1 send, got %d", sender.count())
	}

	msg, _ := sender.last()
	if msg.channelType != "discord" {
		t.Errorf("channel type = %q, want discord", msg.channelType)
	}
	if msg.channelID != 1 {
		t.Errorf("channel ID = %d, want 1", msg.channelID)
	}
}

// ─── Send: Multiple Channels ───────────────────────────

func TestSend_MultipleChannels(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel(), slackChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sender.count() != 2 {
		t.Fatalf("expected 2 sends, got %d", sender.count())
	}

	sent := sender.all()
	types := map[string]bool{}
	for _, s := range sent {
		types[s.channelType] = true
	}
	if !types["discord"] || !types["slack"] {
		t.Errorf("expected discord and slack, got %v", types)
	}
}

// ─── Send: Disabled Channels Filtered Out ──────────────

func TestSend_SkipsDisabledChannels(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel(), disabledChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sender.count() != 1 {
		t.Fatalf("expected 1 send (disabled filtered), got %d", sender.count())
	}
}

// ─── Send: No Enabled Channels → Error ─────────────────

func TestSend_NoEnabledChannels_ReturnsError(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(disabledChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err == nil {
		t.Fatal("expected error when no enabled channels")
	}
	if !strings.Contains(err.Error(), "no enabled notification channels") {
		t.Errorf("error = %q, want 'no enabled notification channels...'", err.Error())
	}
	if sender.count() != 0 {
		t.Errorf("expected 0 sends, got %d", sender.count())
	}
}

// ─── Send: Empty Channel List → Error ──────────────────

func TestSend_EmptyChannelList_ReturnsError(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader()
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err == nil {
		t.Fatal("expected error when channel list is empty")
	}
}

// ─── Send: Channel Load Error ──────────────────────────

func TestSend_ChannelLoadError(t *testing.T) {
	sender := newTrackingSender()
	loader := &mockChannelLoader{err: fmt.Errorf("database down")}
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err == nil {
		t.Fatal("expected error when channel load fails")
	}
	if !strings.Contains(err.Error(), "database down") {
		t.Errorf("error should wrap cause, got: %v", err)
	}
}

// ─── Send: All Channels Fail → Error ───────────────────

func TestSend_AllChannelsFail_ReturnsError(t *testing.T) {
	sender := newTrackingSender()
	sender.err = fmt.Errorf("webhook timeout")
	loader := newMockChannelLoader(discordChannel(), slackChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err == nil {
		t.Fatal("expected error when all channels fail")
	}
	if !strings.Contains(err.Error(), "all 2 notification channels failed") {
		t.Errorf("error = %q, want 'all 2 notification channels failed...'", err.Error())
	}
}

// ─── Send: Partial Failure → Success ───────────────────

func TestSend_PartialFailure_ReturnsNil(t *testing.T) {
	sender := newTrackingSender()
	sender.errAt[2] = fmt.Errorf("slack is down")
	loader := newMockChannelLoader(discordChannel(), slackChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	err := alerter.Send(context.Background(), testEvent())
	if err != nil {
		t.Fatalf("partial failure should return nil, got: %v", err)
	}
	if sender.count() != 1 {
		t.Errorf("expected 1 successful send, got %d", sender.count())
	}
}

// ─── Send: Context Cancelled Before Dispatch ───────────

func TestSend_ContextCancelled(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := alerter.Send(ctx, testEvent())
	if err == nil {
		t.Fatal("expected error when context is cancelled")
	}
	if sender.count() != 0 {
		t.Errorf("expected 0 sends with cancelled context, got %d", sender.count())
	}
}

// ─── Message Content: Includes All Fields ──────────────

func TestMessageContent_IncludesAllFields(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	event := testEvent()
	_ = alerter.Send(context.Background(), event)

	msg, ok := sender.last()
	if !ok {
		t.Fatal("expected a sent notification")
	}

	// Title
	if !strings.Contains(msg.title, "Automation Failed") {
		t.Errorf("title should contain 'Automation Failed', got: %q", msg.title)
	}
	if !strings.Contains(msg.title, "charge-guard") {
		t.Errorf("title should contain automation name, got: %q", msg.title)
	}

	// Message body fields
	checks := []struct {
		label    string
		expected string
	}{
		{"automation name", "charge-guard"},
		{"automation ID", "42"},
		{"trigger type", "battery"},
		{"failed action type", "command"},
		{"failed action step", "step 2"},
		{"error message", "vehicle is offline"},
		{"retry count", "3"},
		{"timestamp", "2026-04-18T12:00:00Z"},
	}

	for _, check := range checks {
		if !strings.Contains(msg.message, check.expected) {
			t.Errorf("message should contain %s (%q), got:\n%s", check.label, check.expected, msg.message)
		}
	}
}

// ─── Message Content: Auto-Disabled Event ──────────────

func TestMessageContent_AutoDisabled(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	event := FailureEvent{
		AutomationID:       7,
		AutomationName:     "night-sentry",
		AutoDisabled:       true,
		AutoDisabledReason: "5 consecutive failures",
		Timestamp:          time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC),
	}

	_ = alerter.Send(context.Background(), event)
	msg, _ := sender.last()

	if !strings.Contains(msg.title, "Automation Disabled") {
		t.Errorf("auto-disabled title should say 'Automation Disabled', got: %q", msg.title)
	}
	if !strings.Contains(msg.message, "AUTO-DISABLED") {
		t.Errorf("message should contain 'AUTO-DISABLED', got:\n%s", msg.message)
	}
	if !strings.Contains(msg.message, "5 consecutive failures") {
		t.Errorf("message should contain disable reason, got:\n%s", msg.message)
	}
}

// ─── Message Content: Minimal Event ────────────────────

func TestMessageContent_MinimalEvent(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	event := FailureEvent{
		AutomationID:   1,
		AutomationName: "minimal",
	}

	err := alerter.Send(context.Background(), event)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	msg, _ := sender.last()
	if !strings.Contains(msg.message, "minimal") {
		t.Errorf("message should contain name, got:\n%s", msg.message)
	}
	// Should not contain optional fields
	if strings.Contains(msg.message, "Trigger:") {
		t.Error("message should not contain Trigger when empty")
	}
	if strings.Contains(msg.message, "Retries:") {
		t.Error("message should not contain Retries when zero")
	}
	if strings.Contains(msg.message, "AUTO-DISABLED") {
		t.Error("message should not contain AUTO-DISABLED when false")
	}
}

// ─── AsNotifier Adapter ────────────────────────────────

func TestAsNotifier_ImplementsInterface(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	var n Notifier = alerter.AsNotifier()

	err := n.NotifyAutoDisabled(context.Background(), 99, "test-rule", "too many failures")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sender.count() != 1 {
		t.Fatalf("expected 1 send via adapter, got %d", sender.count())
	}

	msg, _ := sender.last()
	if !strings.Contains(msg.title, "Automation Disabled") {
		t.Errorf("adapter should produce auto-disabled title, got: %q", msg.title)
	}
	if !strings.Contains(msg.message, "test-rule") {
		t.Errorf("adapter message should contain automation name, got:\n%s", msg.message)
	}
	if !strings.Contains(msg.message, "AUTO-DISABLED") {
		t.Errorf("adapter message should contain AUTO-DISABLED, got:\n%s", msg.message)
	}
	if !strings.Contains(msg.message, "too many failures") {
		t.Errorf("adapter message should contain reason, got:\n%s", msg.message)
	}
}

func TestAsNotifier_PropagatesError(t *testing.T) {
	sender := newTrackingSender()
	sender.err = fmt.Errorf("all channels down")
	loader := newMockChannelLoader(discordChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	n := alerter.AsNotifier()
	err := n.NotifyAutoDisabled(context.Background(), 1, "test", "reason")
	if err == nil {
		t.Fatal("expected error when all channels fail via adapter")
	}
}

// ─── Nil Sender Default ────────────────────────────────

func TestNewFailureAlerter_NilSenderUsesDefault(t *testing.T) {
	loader := newMockChannelLoader()
	alerter := NewFailureAlerter(loader, nil)

	// Can't test actual send without real channels, but verify it doesn't panic.
	if alerter.sender == nil {
		t.Fatal("sender should be set to default when nil is passed")
	}
}

// ─── Concurrent Safety ─────────────────────────────────

func TestSend_ConcurrentSafe(t *testing.T) {
	sender := newTrackingSender()
	loader := newMockChannelLoader(discordChannel(), slackChannel())
	alerter := NewFailureAlerter(loader, sender.send)

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(id int) {
			defer wg.Done()
			event := FailureEvent{
				AutomationID:   int64(id),
				AutomationName: fmt.Sprintf("auto-%d", id),
				Error:          "test error",
			}
			alerter.Send(context.Background(), event)
		}(i)
	}

	wg.Wait()

	// Each goroutine sends to 2 channels.
	if sender.count() != goroutines*2 {
		t.Errorf("expected %d sends, got %d", goroutines*2, sender.count())
	}
}
