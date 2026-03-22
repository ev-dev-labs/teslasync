package notification

import (
	"testing"
)

func TestSendUnsupportedChannel(t *testing.T) {
	req := &Request{
		ChannelType: "unknown_channel",
		Config:      map[string]string{},
		Title:       "Test",
		Message:     "Test message",
	}
	err := Send(req)
	if err == nil {
		t.Error("Send() with unsupported channel should return error")
	}
}

func TestSendEmail(t *testing.T) {
	req := &Request{
		ChannelType: "email",
		Config:      map[string]string{"to": "test@example.com"},
		Title:       "Test",
		Message:     "Test email",
	}
	// Email is a placeholder — should succeed without error
	err := Send(req)
	if err != nil {
		t.Errorf("Send(email) error: %v", err)
	}
}

func TestInternalTopicConstant(t *testing.T) {
	if InternalTopic == "" {
		t.Error("InternalTopic should not be empty")
	}
	if InternalTopic != "teslasync/internal/notifications" {
		t.Errorf("InternalTopic = %q, want 'teslasync/internal/notifications'", InternalTopic)
	}
}

func TestPublishNilClient(t *testing.T) {
	req := &Request{
		ChannelType: "email",
		Config:      map[string]string{"to": "test@example.com"},
		Title:       "Test",
		Message:     "Fallback test",
	}
	// Should fall back to direct send (email placeholder succeeds)
	err := Publish(nil, req)
	if err != nil {
		t.Errorf("Publish(nil) should fall back to direct send: %v", err)
	}
}
