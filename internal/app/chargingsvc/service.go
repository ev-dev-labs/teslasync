package chargingsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Service orchestrates charging session use cases.
type Service struct {
	repo       repository.ChargingSessionRepository
	fsmHistory repository.FSMHistoryRepository
	engine     *fsm.Engine[*charging.ChargingSession]
}

// New creates a new charging service.
func New(
	repo repository.ChargingSessionRepository,
	fsmHistory repository.FSMHistoryRepository,
) *Service {
	s := &Service{
		repo:       repo,
		fsmHistory: fsmHistory,
	}
	s.engine = s.setupFSM()
	return s
}

func (s *Service) setupFSM() *fsm.Engine[*charging.ChargingSession] {
	def := charging.NewChargingFSM()
	engine := fsm.NewEngine[*charging.ChargingSession](def)

	engine.AddGuard(
		fsm.Transition{From: charging.StateConnecting, Event: charging.EventStartCharge, To: charging.StateCharging},
		charging.CanStartCharging,
	)

	// Register SubFSM for charging phases
	subDef := charging.NewChargingSubFSM()
	engine.RegisterSubFSM(charging.StateCharging, subDef, fsm.SubFSMConfig{
		TerminalStates:  []fsm.State{charging.SubStateComplete},
		OnTerminalEvent: charging.EventComplete,
		ResetOnExit:     true,
	})

	return engine
}

// SetTracer wires an FSM tracer into the underlying engine so transitions
// emit OTel spans. Domain depends only on the fsm.Tracer port; concrete
// OTel adapter is installed by the composition root.
func (s *Service) SetTracer(t fsm.Tracer) {
	s.engine.SetTracer(t)
}

// Create starts a new charging session.
func (s *Service) Create(ctx context.Context, session *charging.ChargingSession) error {
	if err := session.Validate(); err != nil {
		return fmt.Errorf("charging session validation: %w", err)
	}
	session.FSMState = charging.StatePending
	session.CreatedAt = time.Now()

	if err := s.repo.Save(ctx, session); err != nil {
		return fmt.Errorf("saving charging session: %w", err)
	}
	return nil
}

// GetByID returns a charging session by ID.
func (s *Service) GetByID(ctx context.Context, id string) (*charging.ChargingSession, error) {
	return s.repo.GetByID(ctx, id)
}

// GetByVehicleID returns all charging sessions for a vehicle.
func (s *Service) GetByVehicleID(ctx context.Context, vehicleID string) ([]charging.ChargingSession, error) {
	return s.repo.GetByVehicleID(ctx, vehicleID)
}

// HandleEvent processes an FSM event for a charging session.
func (s *Service) HandleEvent(ctx context.Context, sessionID string, event fsm.Event) error {
	session, err := s.repo.GetByID(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("loading charging session: %w", err)
	}

	oldState := session.FSMState
	newState, err := s.engine.Fire(ctx, session, session.FSMState, event)
	if err != nil {
		return fmt.Errorf("firing event %s on session %s: %w", event, sessionID, err)
	}

	session.FSMState = newState
	if newState == charging.StateCompleted {
		session.CompletedAt = time.Now()
	}

	if err := s.repo.Save(ctx, session); err != nil {
		return fmt.Errorf("saving session after transition: %w", err)
	}

	return s.fsmHistory.RecordTransition(ctx, repository.FSMTransitionRecord{
		ID:        fmt.Sprintf("%s-%d", sessionID, time.Now().UnixNano()),
		EntityID:  sessionID,
		FSMName:   "charging_session",
		FromState: oldState,
		Event:     event,
		ToState:   newState,
		CreatedAt: time.Now(),
	})
}
