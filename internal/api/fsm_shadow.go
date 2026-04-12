package api

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
)

// FSMShadow runs the new FSM alongside the old state machine in shadow mode.
// It processes the same signals but does NOT write to DB — only logs discrepancies
// between the old and new state machines for validation.
type FSMShadow struct {
	mu       sync.Mutex
	machines map[int64]*fsm.VehicleFSM // keyed by vehicleID
	transRepo *database.FSMTransitionRepo

	// Stats
	totalBatches     int64
	totalDiscrepancies int64
}

// NewFSMShadow creates a shadow FSM observer.
func NewFSMShadow(transRepo *database.FSMTransitionRepo) *FSMShadow {
	return &FSMShadow{
		machines:  make(map[int64]*fsm.VehicleFSM),
		transRepo: transRepo,
	}
}

// shadowAction logs transitions to fsm_transitions table but does NOT
// write to vehicle_states or vehicles — the old code remains authoritative.
type shadowAction struct {
	transRepo *database.FSMTransitionRepo
}

func (a *shadowAction) Execute(ctx context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) error {
	if a.transRepo == nil {
		return nil
	}
	snapshot := extractShadowContext(sctx)
	return a.transRepo.Insert(ctx, vehicleID, "vehicle", nil,
		string(from), string(to), sctx.MatchedTrigger, sctx.MatchedGuard,
		sctx.TransitionMode, snapshot, 0)
}

func extractShadowContext(sctx *fsm.SignalContext) map[string]interface{} {
	ctx := map[string]interface{}{
		"shadow": true, // marks this as shadow-mode transition
	}
	if sctx.Gear != "" {
		ctx["Gear"] = sctx.Gear
	}
	if sctx.Speed > 0 {
		ctx["Speed"] = sctx.Speed
	}
	ctx["IsGearCapable"] = sctx.IsGearCapable
	ctx["IsCharging"] = sctx.IsCharging
	return ctx
}

// ProcessSignals runs the new FSM on the same signal batch as the old code.
// Compares resulting state with oldState and logs discrepancies.
func (s *FSMShadow) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}, oldState string) {
	s.mu.Lock()
	m, exists := s.machines[vehicleID]
	if !exists {
		// Initialize with the same state as the old machine
		initial := fsm.State(oldState)
		if !initial.IsValid() {
			initial = fsm.Online
		}
		m = fsm.NewVehicleFSM(initial, &shadowAction{transRepo: s.transRepo})
		s.machines[vehicleID] = m
	}
	s.totalBatches++
	s.mu.Unlock()

	// Run FSM — this won't write to vehicle_states/vehicles (shadow action only logs transitions)
	if err := m.ProcessSignals(ctx, vehicleID, signals); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm-shadow: ProcessSignals error")
		return
	}

	// Check pending debounced transitions
	sctx := &fsm.SignalContext{Now: time.Now().UTC()}
	_ = m.CheckPending(ctx, vehicleID, sctx)

	// Compare
	newState := string(m.Current())
	if newState != oldState {
		s.mu.Lock()
		s.totalDiscrepancies++
		discCount := s.totalDiscrepancies
		batchCount := s.totalBatches
		s.mu.Unlock()

		log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("old_state", oldState).
			Str("new_fsm_state", newState).
			Int64("discrepancies", discCount).
			Int64("total_batches", batchCount).
			Msg("fsm-shadow: STATE DISCREPANCY — old and new FSM disagree")
	}
}

// HandleTimeout runs the FSM timeout handler and compares with old behavior.
func (s *FSMShadow) HandleTimeout(ctx context.Context, vehicleID int64, oldNewState string) {
	s.mu.Lock()
	m, exists := s.machines[vehicleID]
	s.mu.Unlock()

	if !exists {
		return
	}

	if err := m.HandleTimeout(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm-shadow: HandleTimeout error")
		return
	}

	newState := string(m.Current())
	if newState != oldNewState {
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("old_timeout_state", oldNewState).
			Str("new_fsm_state", newState).
			Msg("fsm-shadow: TIMEOUT DISCREPANCY")
	}
}

// Stats returns shadow mode statistics.
func (s *FSMShadow) Stats() (batches, discrepancies int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.totalBatches, s.totalDiscrepancies
}

// VehicleState returns the current FSM state for a vehicle (for API/debugging).
func (s *FSMShadow) VehicleState(vehicleID int64) string {
	s.mu.Lock()
	m, exists := s.machines[vehicleID]
	s.mu.Unlock()
	if !exists {
		return ""
	}
	return string(m.Current())
}
