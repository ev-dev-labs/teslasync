package repository

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// FSMTransitionRecord represents a recorded FSM state transition.
type FSMTransitionRecord struct {
	ID        string    `json:"id" db:"id"`
	EntityID  string    `json:"entityId" db:"entity_id"`
	FSMName   string    `json:"fsmName" db:"fsm_name"`
	FromState fsm.State `json:"fromState" db:"from_state"`
	Event     fsm.Event `json:"event" db:"event"`
	ToState   fsm.State `json:"toState" db:"to_state"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
}

// FSMHistoryRepository defines the persistence interface for FSM transition history.
type FSMHistoryRepository interface {
	RecordTransition(ctx context.Context, record FSMTransitionRecord) error
	GetHistory(ctx context.Context, entityID string, limit int) ([]FSMTransitionRecord, error)
	GetByEntityID(ctx context.Context, entityID string) ([]FSMTransitionRecord, error)
}
