package notificationsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/port/messaging"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Service orchestrates notification use cases.
type Service struct {
	repo       repository.NotificationRepository
	fsmHistory repository.FSMHistoryRepository
	notifier   messaging.Notifier
	engine     *fsm.Engine[*notification.Notification]
}

// New creates a new notification service.
func New(
	repo repository.NotificationRepository,
	fsmHistory repository.FSMHistoryRepository,
	notifier messaging.Notifier,
) *Service {
	def := notification.NewNotificationFSM()
	return &Service{
		repo:       repo,
		fsmHistory: fsmHistory,
		notifier:   notifier,
		engine:     fsm.NewEngine[*notification.Notification](def),
	}
}

// Create queues a new notification.
func (s *Service) Create(ctx context.Context, n *notification.Notification) error {
	n.FSMState = notification.StatePending
	n.CreatedAt = time.Now()
	return s.repo.Save(ctx, n)
}

// GetPending returns pending notifications.
func (s *Service) GetPending(ctx context.Context, limit int) ([]notification.Notification, error) {
	return s.repo.GetPending(ctx, limit)
}

// Send attempts to send a notification and updates its state.
func (s *Service) Send(ctx context.Context, id string) error {
	n, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("loading notification: %w", err)
	}

	// Transition to sending
	if err := s.handleEvent(ctx, n, notification.EventSend); err != nil {
		return err
	}

	// Attempt to send
	var sendErr error
	switch n.Channel {
	case "push":
		sendErr = s.notifier.SendPush(ctx, n.UserID, n)
	case "email":
		sendErr = s.notifier.SendEmail(ctx, n.UserID, n)
	default:
		sendErr = fmt.Errorf("unknown channel: %s", n.Channel)
	}

	if sendErr != nil {
		// Transition to failed
		n.FailedReason = sendErr.Error()
		return s.handleEvent(ctx, n, notification.EventFail)
	}

	// Transition to sent
	n.SentAt = time.Now()
	return s.handleEvent(ctx, n, notification.EventConfirm)
}

func (s *Service) handleEvent(ctx context.Context, n *notification.Notification, event fsm.Event) error {
	oldState := n.FSMState
	newState, err := s.engine.Fire(ctx, n, n.FSMState, event)
	if err != nil {
		return fmt.Errorf("firing event %s on notification %s: %w", event, n.ID, err)
	}

	n.FSMState = newState
	if err := s.repo.Save(ctx, n); err != nil {
		return fmt.Errorf("saving notification: %w", err)
	}

	return s.fsmHistory.RecordTransition(ctx, repository.FSMTransitionRecord{
		ID:        fmt.Sprintf("%s-%d", n.ID, time.Now().UnixNano()),
		EntityID:  n.ID,
		FSMName:   "notification",
		FromState: oldState,
		Event:     event,
		ToState:   newState,
		CreatedAt: time.Now(),
	})
}
