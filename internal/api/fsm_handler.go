package api

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
	"github.com/ev-dev-labs/teslasync/internal/fsm/charge"
	"github.com/ev-dev-labs/teslasync/internal/fsm/drive"
)

// FSMHandler owns the new FSM-based vehicle state management.
// Manages vehicle FSM + drive/charge sub-FSMs.
type FSMHandler struct {
	mu        sync.Mutex
	machines  map[int64]*fsm.VehicleFSM
	drives    map[int64]*drive.SessionFSM  // active drive sub-FSMs per vehicle
	charges   map[int64]*charge.SessionFSM // active charge sub-FSMs per vehicle
	stateRepo   *database.VehicleStateRepo
	vehicleRepo *database.VehicleRepo
	transRepo   *database.FSMTransitionRepo
}

// NewFSMHandler creates an authoritative FSM handler.
func NewFSMHandler(stateRepo *database.VehicleStateRepo, vehicleRepo *database.VehicleRepo, transRepo *database.FSMTransitionRepo) *FSMHandler {
	return &FSMHandler{
		machines:    make(map[int64]*fsm.VehicleFSM),
		drives:      make(map[int64]*drive.SessionFSM),
		charges:     make(map[int64]*charge.SessionFSM),
		stateRepo:   stateRepo,
		vehicleRepo: vehicleRepo,
		transRepo:   transRepo,
	}
}

// fsmAction handles all side effects of a vehicle state transition:
// persists to vehicle_states, updates vehicles table, logs to fsm_transitions,
// and manages drive/charge sub-FSM lifecycle.
type fsmAction struct {
	handler     *FSMHandler
	stateRepo   *database.VehicleStateRepo
	vehicleRepo *database.VehicleRepo
	transRepo   *database.FSMTransitionRepo
}

func (a *fsmAction) Execute(ctx context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) error {
	// Best-effort writes; collect the first error so the FSM can decide whether to
	// roll back its in-memory transition. We continue past failures so that, e.g.,
	// a vehicle_states write failure doesn't block the vehicles.state update that
	// the UI relies on.
	var firstErr error
	keep := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}

	// 1. End current state record
	if err := a.stateRepo.EndCurrent(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: failed to end current state")
		keep(err)
	}

	// 2. Insert new state record
	if _, err := a.stateRepo.Insert(ctx, vehicleID, string(to)); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("state", string(to)).Msg("fsm: failed to insert state")
		keep(err)
	}

	// 3. State is now tracked in vehicle_live_state, not on the vehicles table.
	// The live-state repo is the single source of truth for current vehicle state.

	// 4. Gear capability is now derived from vehicle_live_state, not stored on the vehicle row.

	// 5. Log transition to fsm_transitions
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

	// 6. Manage sub-FSM lifecycle based on state transitions
	a.handler.manageSubFSMs(ctx, vehicleID, from, to, sctx)

	return firstErr
}

// manageSubFSMs creates/finalizes drive and charge sub-FSMs on state transitions.
func (h *FSMHandler) manageSubFSMs(_ context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Entering Driving → create drive sub-FSM
	if to == fsm.Driving && from != fsm.Driving {
		// Finalize any active charge first (unplug-and-go)
		if chargeFSM, ok := h.charges[vehicleID]; ok {
			chargeFSM.TriggerEnding(sctx.Signals, true)
			delete(h.charges, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: force-completed charge (drive started)")
		}
		// Create drive sub-FSM
		driveFSM := drive.NewSessionFSM(vehicleID, "", 0) // driveID will be set by session tracker
		if sctx.Signals != nil {
			driveFSM.ProcessSignals(sctx.Signals)
		}
		h.drives[vehicleID] = driveFSM
		log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: drive sub-FSM created")
	}

	// Exiting Driving → finalize drive sub-FSM
	if from == fsm.Driving && to != fsm.Driving {
		if driveFSM, ok := h.drives[vehicleID]; ok {
			driveFSM.TriggerEnding(sctx.Signals)
			if !driveFSM.IsCompleted() {
				driveFSM.ForceComplete()
			}
			issues := driveFSM.ValidationIssues()
			if len(issues) > 0 {
				log.Warn().Int64("vehicle_id", vehicleID).Strs("issues", issues).Msg("fsm: drive validation warnings")
			}
			delete(h.drives, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Str("state", string(driveFSM.State())).Msg("fsm: drive sub-FSM completed")
		}
	}

	// Entering Charging → create charge sub-FSM
	if to == fsm.Charging && from != fsm.Charging {
		// Finalize any active drive first
		if driveFSM, ok := h.drives[vehicleID]; ok {
			driveFSM.TriggerEnding(sctx.Signals)
			if !driveFSM.IsCompleted() {
				driveFSM.ForceComplete()
			}
			delete(h.drives, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: force-completed drive (charge started)")
		}
		chargeFSM := charge.NewSessionFSM(vehicleID, "", 0)
		if sctx.Signals != nil {
			chargeFSM.ProcessSignals(sctx.Signals)
		}
		h.charges[vehicleID] = chargeFSM
		log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: charge sub-FSM created")
	}

	// Exiting Charging → finalize charge sub-FSM
	if from == fsm.Charging && to != fsm.Charging {
		if chargeFSM, ok := h.charges[vehicleID]; ok {
			chargeFSM.TriggerEnding(sctx.Signals, false)
			if !chargeFSM.IsCompleted() {
				chargeFSM.ForceComplete()
			}
			issues := chargeFSM.ValidationIssues()
			if len(issues) > 0 {
				log.Warn().Int64("vehicle_id", vehicleID).Strs("issues", issues).Msg("fsm: charge validation warnings")
			}
			delete(h.charges, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Str("state", string(chargeFSM.State())).Msg("fsm: charge sub-FSM completed")
		}
	}
}

// getOrCreate returns the FSM for a vehicle, creating it if needed.
func (h *FSMHandler) getOrCreate(ctx context.Context, vehicleID int64) *fsm.VehicleFSM {
	h.mu.Lock()
	defer h.mu.Unlock()

	m, exists := h.machines[vehicleID]
	if exists {
		return m
	}

	currentDB, _ := h.stateRepo.GetCurrentState(ctx, vehicleID)
	if currentDB == "" {
		currentDB = "online"
	}
	initial := fsm.State(currentDB)
	if !initial.IsValid() {
		initial = fsm.Online
	}

	action := &fsmAction{
		handler:     h,
		stateRepo:   h.stateRepo,
		vehicleRepo: h.vehicleRepo,
		transRepo:   h.transRepo,
	}
	m = fsm.NewVehicleFSM(initial, action)

	// Gear capability is now derived from vehicle_live_state signals.
	// No need to rehydrate from the vehicle row.

	h.machines[vehicleID] = m

	log.Info().Int64("vehicle_id", vehicleID).Str("state", currentDB).Msg("fsm: initialized vehicle FSM from DB")
	return m
}

// ProcessSignals runs the FSM on a signal batch and forwards to active sub-FSMs.
func (h *FSMHandler) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	m := h.getOrCreate(ctx, vehicleID)

	// Wake vehicle from asleep/offline when any signal arrives
	if state := m.Current(); state == fsm.Asleep || state == fsm.Offline {
		if err := m.HandleSignalReceived(ctx, vehicleID); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: HandleSignalReceived error")
		}
	}

	// Run vehicle FSM (may trigger sub-FSM creation/finalization via fsmAction)
	if err := m.ProcessSignals(ctx, vehicleID, signals); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: ProcessSignals error")
	}

	// Check pending debounced transitions
	sctx := &fsm.SignalContext{Now: time.Now().UTC()}
	_ = m.CheckPending(ctx, vehicleID, sctx)

	// Forward signals to active sub-FSMs for accumulation
	h.mu.Lock()
	activeDrive := h.drives[vehicleID]
	activeCharge := h.charges[vehicleID]
	h.mu.Unlock()

	if activeDrive != nil {
		activeDrive.ProcessSignals(signals)
	}
	if activeCharge != nil {
		activeCharge.ProcessSignals(signals)
	}
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

// ActiveDrive returns the drive sub-FSM context for a vehicle, if active.
func (h *FSMHandler) ActiveDrive(vehicleID int64) *drive.Context {
	h.mu.Lock()
	d, ok := h.drives[vehicleID]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	ctx := d.Context()
	return &ctx
}

// ActiveDriveState returns the state and context of the active drive sub-FSM.
func (h *FSMHandler) ActiveDriveState(vehicleID int64) (string, *drive.Context) {
	h.mu.Lock()
	d, ok := h.drives[vehicleID]
	h.mu.Unlock()
	if !ok {
		return "", nil
	}
	ctx := d.Context()
	return string(d.State()), &ctx
}

// ActiveCharge returns the charge sub-FSM context for a vehicle, if active.
func (h *FSMHandler) ActiveCharge(vehicleID int64) *charge.Context {
	h.mu.Lock()
	c, ok := h.charges[vehicleID]
	h.mu.Unlock()
	if !ok {
		return nil
	}
	ctx := c.Context()
	return &ctx
}

// ActiveChargeState returns the state and context of the active charge sub-FSM.
func (h *FSMHandler) ActiveChargeState(vehicleID int64) (string, *charge.Context) {
	h.mu.Lock()
	c, ok := h.charges[vehicleID]
	h.mu.Unlock()
	if !ok {
		return "", nil
	}
	ctx := c.Context()
	return string(c.State()), &ctx
}

// Stats returns the number of active FSM instances.
func (h *FSMHandler) Stats() map[string]int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return map[string]int{
		"vehicles": len(h.machines),
		"drives":   len(h.drives),
		"charges":  len(h.charges),
	}
}

// VehicleFSMSnapshot is a point-in-time view of one vehicle's FSM state.
// Exposed via /fsm/stats so the frontend can flag FSMs that are stale despite
// the vehicle actively streaming telemetry.
type VehicleFSMSnapshot struct {
	VehicleID            int64     `json:"vehicle_id"`
	State                string    `json:"state"`
	LastTransitionAt     time.Time `json:"last_transition_at"`
	SecondsSinceLastTransition float64 `json:"seconds_since_last_transition"`
	IsGearCapable        bool      `json:"is_gear_capable"`
}

// VehicleSnapshots returns one snapshot per known vehicle FSM.
func (h *FSMHandler) VehicleSnapshots() []VehicleFSMSnapshot {
	h.mu.Lock()
	machines := make(map[int64]*fsm.VehicleFSM, len(h.machines))
	for id, m := range h.machines {
		machines[id] = m
	}
	h.mu.Unlock()

	now := time.Now()
	out := make([]VehicleFSMSnapshot, 0, len(machines))
	for id, m := range machines {
		last := m.LastTransitionAt()
		out = append(out, VehicleFSMSnapshot{
			VehicleID:                  id,
			State:                      string(m.Current()),
			LastTransitionAt:           last,
			SecondsSinceLastTransition: now.Sub(last).Seconds(),
			IsGearCapable:              m.IsGearCapable(),
		})
	}
	return out
}
