package notificationsvc

import (
	"context"
	"fmt"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// mockNotificationRepo implements repository.NotificationRepository for testing.
type mockNotificationRepo struct {
	notifications map[string]*notification.Notification
}

func newMockNotificationRepo() *mockNotificationRepo {
	return &mockNotificationRepo{notifications: make(map[string]*notification.Notification)}
}

func (m *mockNotificationRepo) GetByID(_ context.Context, id string) (*notification.Notification, error) {
	n, ok := m.notifications[id]
	if !ok {
		return nil, fmt.Errorf("notification %s: not found", id)
	}
	cp := *n
	return &cp, nil
}

func (m *mockNotificationRepo) GetByUserID(_ context.Context, userID string) ([]notification.Notification, error) {
	var result []notification.Notification
	for _, n := range m.notifications {
		if n.UserID == userID {
			result = append(result, *n)
		}
	}
	return result, nil
}

func (m *mockNotificationRepo) GetPending(_ context.Context, limit int) ([]notification.Notification, error) {
	var result []notification.Notification
	for _, n := range m.notifications {
		if n.FSMState == notification.StatePending {
			result = append(result, *n)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (m *mockNotificationRepo) Save(_ context.Context, n *notification.Notification) error {
	cp := *n
	m.notifications[n.ID] = &cp
	return nil
}

func (m *mockNotificationRepo) GetByIDForUpdate(ctx context.Context, id string) (*notification.Notification, error) {
	return m.GetByID(ctx, id)
}

// mockFSMHistory implements repository.FSMHistoryRepository for testing.
type mockFSMHistory struct {
	records []repository.FSMTransitionRecord
}

func (m *mockFSMHistory) RecordTransition(_ context.Context, r repository.FSMTransitionRecord) error {
	m.records = append(m.records, r)
	return nil
}

func (m *mockFSMHistory) GetHistory(_ context.Context, _ string, _ int) ([]repository.FSMTransitionRecord, error) {
	return m.records, nil
}

func (m *mockFSMHistory) GetByEntityID(_ context.Context, entityID string) ([]repository.FSMTransitionRecord, error) {
	var result []repository.FSMTransitionRecord
	for _, r := range m.records {
		if r.EntityID == entityID {
			result = append(result, r)
		}
	}
	return result, nil
}

// mockNotifier implements messaging.Notifier for testing.
type mockNotifier struct {
	pushErr  error
	emailErr error
}

func (m *mockNotifier) SendPush(_ context.Context, _ string, _ *notification.Notification) error {
	return m.pushErr
}

func (m *mockNotifier) SendEmail(_ context.Context, _ string, _ *notification.Notification) error {
	return m.emailErr
}

func TestService_Create(t *testing.T) {
	repo := newMockNotificationRepo()
	svc := New(repo, &mockFSMHistory{}, &mockNotifier{})

	n := &notification.Notification{
		ID:      "n1",
		UserID:  "u1",
		Type:    "charging_complete",
		Title:   "Charging Done",
		Body:    "Your vehicle is fully charged.",
		Channel: "push",
	}
	err := svc.Create(context.Background(), n)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	got, err := repo.GetByID(context.Background(), "n1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.FSMState != notification.StatePending {
		t.Errorf("expected FSMState 'pending', got %q", got.FSMState)
	}
}

func TestService_GetPending(t *testing.T) {
	repo := newMockNotificationRepo()
	svc := New(repo, &mockFSMHistory{}, &mockNotifier{})

	for i := 0; i < 5; i++ {
		n := &notification.Notification{
			ID:      fmt.Sprintf("n%d", i),
			UserID:  "u1",
			Type:    "alert",
			Title:   "Alert",
			Body:    "Test alert",
			Channel: "push",
		}
		_ = svc.Create(context.Background(), n)
	}

	pending, err := svc.GetPending(context.Background(), 10)
	if err != nil {
		t.Fatalf("GetPending() error: %v", err)
	}
	if len(pending) != 5 {
		t.Errorf("expected 5 pending notifications, got %d", len(pending))
	}
}

func TestService_Send(t *testing.T) {
	repo := newMockNotificationRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history, &mockNotifier{})

	n := &notification.Notification{
		ID:       "n1",
		UserID:   "u1",
		Type:     "charging_complete",
		Title:    "Charging Done",
		Body:     "Your vehicle is fully charged.",
		Channel:  "push",
		FSMState: notification.StatePending,
	}
	_ = repo.Save(context.Background(), n)

	err := svc.Send(context.Background(), "n1")
	if err != nil {
		t.Fatalf("Send() error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "n1")
	if got.FSMState != notification.StateSent {
		t.Errorf("expected state 'sent', got %q", got.FSMState)
	}
	if got.SentAt.IsZero() {
		t.Error("expected SentAt to be set")
	}

	// Should have 2 transitions: pending->sending, sending->sent
	if len(history.records) != 2 {
		t.Errorf("expected 2 transition records, got %d", len(history.records))
	}
}

func TestService_Send_Email(t *testing.T) {
	repo := newMockNotificationRepo()
	svc := New(repo, &mockFSMHistory{}, &mockNotifier{})

	n := &notification.Notification{
		ID:       "n1",
		UserID:   "u1",
		Type:     "trip_complete",
		Title:    "Trip Summary",
		Body:     "Your trip is complete.",
		Channel:  "email",
		FSMState: notification.StatePending,
	}
	_ = repo.Save(context.Background(), n)

	err := svc.Send(context.Background(), "n1")
	if err != nil {
		t.Fatalf("Send() error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "n1")
	if got.FSMState != notification.StateSent {
		t.Errorf("expected state 'sent', got %q", got.FSMState)
	}
}

func TestService_Send_Failure(t *testing.T) {
	repo := newMockNotificationRepo()
	history := &mockFSMHistory{}
	notifier := &mockNotifier{pushErr: fmt.Errorf("push service unavailable")}
	svc := New(repo, history, notifier)

	n := &notification.Notification{
		ID:       "n1",
		UserID:   "u1",
		Type:     "alert",
		Title:    "Alert",
		Body:     "Test",
		Channel:  "push",
		FSMState: notification.StatePending,
	}
	_ = repo.Save(context.Background(), n)

	err := svc.Send(context.Background(), "n1")
	if err != nil {
		t.Fatalf("Send() should not return error (transitions to failed): %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "n1")
	if got.FSMState != notification.StateFailed {
		t.Errorf("expected state 'failed', got %q", got.FSMState)
	}
	if got.FailedReason == "" {
		t.Error("expected FailedReason to be set")
	}

	// Should have 2 transitions: pending->sending, sending->failed
	if len(history.records) != 2 {
		t.Errorf("expected 2 transition records, got %d", len(history.records))
	}
}
