package notification

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// Notification represents a notification aggregate.
type Notification struct {
	ID           string    `json:"id" db:"id"`
	UserID       string    `json:"userId" db:"user_id"`
	Type         string    `json:"type" db:"type"` // "charging_complete", "trip_complete", "alert", etc.
	Title        string    `json:"title" db:"title"`
	Body         string    `json:"body" db:"body"`
	FSMState     fsm.State `json:"fsmState" db:"fsm_state"`
	Channel      string    `json:"channel" db:"channel"` // "push", "email", "webhook"
	FailedReason string    `json:"failedReason,omitempty" db:"failed_reason"`
	RetryCount   int       `json:"retryCount" db:"retry_count"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	SentAt       time.Time `json:"sentAt,omitempty" db:"sent_at"`
}
