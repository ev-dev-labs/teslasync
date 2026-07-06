package postgres

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

var notificationCols = []string{
	"id", "user_id", "type", "title", "body", "fsm_state", "channel",
	"failed_reason", "retry_count", "created_at", "sent_at",
}

func notificationRow(n notification.Notification) []any {
	return []any{
		n.ID, n.UserID, n.Type, n.Title, n.Body, n.FSMState, n.Channel,
		n.FailedReason, n.RetryCount, n.CreatedAt, n.SentAt,
	}
}

func sampleNotification() notification.Notification {
	base := time.Date(2026, 8, 9, 10, 11, 12, 0, time.UTC)
	return notification.Notification{
		ID:           "400",
		UserID:       "7",
		Type:         "charging_complete",
		Title:        "Charge complete",
		Body:         "Your vehicle finished charging",
		FSMState:     fsm.State("pending"),
		Channel:      "push",
		FailedReason: "",
		RetryCount:   0,
		CreatedAt:    base,
		SentAt:       base.Add(time.Second),
	}
}

func TestNewNotificationRepository(t *testing.T) {
	t.Parallel()
	repo := NewNotificationRepository(lazyPool(t))
	if repo == nil {
		t.Fatal("NewNotificationRepository returned nil")
	}
	var _ repository.NotificationRepository = repo
	if _, ok := repo.(*notificationRepository); !ok {
		t.Fatalf("returned %T, want *notificationRepository", repo)
	}
}

func TestNotificationRepository_singleRowGetters(t *testing.T) {
	t.Parallel()
	want := sampleNotification()
	row := notificationRow(want)

	runGetter(t, "GetByID", row, want, queries.GetNotificationByID, "400", "scanning notification 400",
		func(pool *fakePool) (*notification.Notification, error) {
			return (&notificationRepository{pool: pool}).GetByID(context.Background(), "400")
		})
	runGetter(t, "GetByIDForUpdate", row, want, queries.GetNotificationByIDForUpdate, "400", "scanning notification 400",
		func(pool *fakePool) (*notification.Notification, error) {
			return (&notificationRepository{pool: pool}).GetByIDForUpdate(context.Background(), "400")
		})
}

func TestNotificationRepository_GetByUserID(t *testing.T) {
	t.Parallel()
	n1 := sampleNotification()
	n2 := sampleNotification()
	n2.ID = "401"
	n2.Type = "trip_complete"
	scenarios := listScenarios(notificationCols, notificationRow, []notification.Notification{n1, n2},
		"querying notifications for user", "collecting notifications for user")
	runListMethod(t, scenarios, queries.GetNotificationsByUserID, []any{"7"},
		func(pool *fakePool) ([]notification.Notification, error) {
			return (&notificationRepository{pool: pool}).GetByUserID(context.Background(), "7")
		})
}

func TestNotificationRepository_GetPending(t *testing.T) {
	t.Parallel()
	n1 := sampleNotification()
	n2 := sampleNotification()
	n2.ID = "402"
	scenarios := listScenarios(notificationCols, notificationRow, []notification.Notification{n1, n2},
		"querying pending notifications", "collecting pending notifications")
	runListMethod(t, scenarios, queries.GetPendingNotifications, []any{50},
		func(pool *fakePool) ([]notification.Notification, error) {
			return (&notificationRepository{pool: pool}).GetPending(context.Background(), 50)
		})
}

func TestNotificationRepository_Save(t *testing.T) {
	t.Parallel()
	n := sampleNotification()
	execBoom := errors.New("deadlock detected")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		if err := (&notificationRepository{pool: pool}).Save(context.Background(), &n); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.execN != 1 {
			t.Fatalf("execN = %d, want 1", pool.execN)
		}
		if pool.execSQL != queries.UpsertNotification {
			t.Errorf("SQL = %q, want UpsertNotification", pool.execSQL)
		}
		wantArgs := []any{
			n.ID, n.UserID, n.Type, n.Title, n.Body, n.FSMState, n.Channel,
			n.FailedReason, n.RetryCount, n.CreatedAt, n.SentAt,
		}
		if !reflect.DeepEqual(pool.execArgs, wantArgs) {
			t.Errorf("exec args = %v,\nwant %v", pool.execArgs, wantArgs)
		}
	})

	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{execErr: execBoom}
		err := (&notificationRepository{pool: pool}).Save(context.Background(), &n)
		if !errors.Is(err, execBoom) {
			t.Fatalf("error = %v, want wrap of execBoom", err)
		}
		if !strings.Contains(err.Error(), "saving notification 400") {
			t.Errorf("error %q missing context 'saving notification 400'", err)
		}
	})
}
