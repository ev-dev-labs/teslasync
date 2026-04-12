package api

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
)

// FSMHandler owns the new FSM-based vehicle state management.
// Replaces the old vehicleStateMachine + detectVehicleState + trackStateTransition.
type FSMHandler struct {
	mu        sync.Mutex
	machines  map[int64]*fsm.VehicleFSM
	stateRepo *database.VehicleStateRepo
	vehicleRepo *database.VehicleRepo
	transRepo *database.FSMTransitionRepo
}

// NewFSMHandler creates an authoritative FSM handler.
func NewFSMHandler(stateRepo *database.VehicleStateRepo, vehicleRepo *database.VehicleRepo, transRepo *database.FSMTransitionRepo) *FSMHandler {
	return &FSMHandler{
		machines:    make(map[int64]*fsm.VehicleFSM),
		stateRepo:   stateRepo,
		vehicleRepo: vehicleRepo,
		transRepo:   transRepo,
	}
}

// fsmAction handles all side effects of a vehicle state transition:
// persists to vehicle_states, updates vehicles table, logs to fsm_transitions.
type fsmAction struct {
	stateRepo   *database.VehicleStateRepo
	vehicleRepo *database.VehicleRepo
	transRepo   *database.FSMTransitionRepo
}

func (a *fsmAction) Execute(ctx context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) error {
	// 1. End current state record
	if err := a.stateRepo.EndCurrent(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: failed to end current state")
	}

	// 2. Insert new state record
	if _, err := a.stateRepo.Insert(ctx, vehicleID, string(to)); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("state", string(to)).Msg("fsm: failed to insert state")
	}

	// 3. Update vehicles table
	if err := a.vehicleRepo.UpdateState(ctx, vehicleID, string(to), true); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: failed to update vehicle state")
	}

	// 4. Log transition to fsm_transitions
	if a.transRepo != nil {
		snapshot := map[string]interface{}{}
		if sctx.Gear != "" {
			snapshot["Gear"] = sctx.Gear
		}
		if sctx.Speed > 0 {
			snapshot["Speed"] = sctx.Speed
		}
		snapshot["IsGearCapable"] = sctx.IsGearCapable
		snapshot["IsCharging"] = sctx.IsCharging
		if err := a.transRepo.Insert(ctx, vehicleID, "vehicle", nil,
			string(from), string(to), sctx.MatchedTrigger, sctx.MatchedGuard,
			sctx.TransitionMode, snapshot, 0); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: failed to log transition")
		}
	}

	return nil
}

// getOrCreate returns the FSM for a vehicle, creating it if needed.
func (h *FSMHandler) getOrCreate(ctx context.Context, vehicleID int64) *fsm.VehicleFSM {
	h.mu.Lock()
	defer h.mu.Unlock()

	m, exists := h.machines[vehicleID]
	if exists {
		return m
	}

	// Load current state from DB
	currentDB, _ := h.stateRepo.GetCurrentState(ctx, vehicleID)
	if currentDB == "" {
		currentDB = "online"
	}
	initial := fsm.State(currentDB)
	if !initial.IsValid() {
		initial = fsm.Online
	}

	action := &fsmAction{
		stateRepo:   h.stateRepo,
		vehicleRepo: h.vehicleRepo,
		transRepo:   h.transRepo,
	}
	m = fsm.NewVehicleFSM(initial, action)
	h.machines[vehicleID] = m

	log.Info().Int64("vehicle_id", vehicleID).Str("state", currentDB).Msg("fsm: initialized vehicle FSM from DB")
	return m
}

// ProcessSignals runs the FSM on a signal batch. This is the authoritative state transition path.
func (h *FSMHandler) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	m := h.getOrCreate(ctx, vehicleID)

	if err := m.ProcessSignals(ctx, vehicleID, signals); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: ProcessSignals error")
	}

	// Check pending debounced transitions
	sctx := &fsm.SignalContext{Now: time.Now().UTC()}
	_ = m.CheckPending(ctx, vehicleID, sctx)
}

// HandleTimeout transitions a vehicle to offline/asleep when telemetry stops.
func (h *FSMHandler) HandleTimeout(ctx context.Context, vehicleID int64) {
	m := h.getOrCreate(ctx, vehicleID)

	if err := m.HandleTimeout(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: HandleTimeout error")
	}
}

// HandleSignalReceived wakes a vehicle from asleep/offline state.
func (h *FSMHandler) HandleSignalReceived(ctx context.Context, vehicleID int64) {
	m := h.getOrCreate(ctx, vehicleID)

	if err := m.HandleSignalReceived(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: HandleSignalReceived error")
	}
}

// CurrentState returns the FSM state for a vehicle.
func (h *FSMHandler) CurrentState(vehicleID int64) string {
	h.mu.Lock()
	m, exists := h.machines[vehicleID]
	h.mu.Unlock()
	if !exists {
		return ""
	}
	return string(m.Current())
}

// Stats returns the number of active FSM instances.
func (h *FSMHandler) Stats() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.machines)
}
