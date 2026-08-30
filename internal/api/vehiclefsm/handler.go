package vehiclefsm

import (
	"context"
	"sync"
	"time"

	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/fsm"
	"github.com/ev-dev-labs/teslasync/internal/fsm/charge"
	"github.com/ev-dev-labs/teslasync/internal/fsm/drive"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// transitionLogger is the narrow persistence port fsmAction needs to durably
// record a vehicle state transition into fsm_transitions. The concrete
// *observability.FSMTransitionRepo satisfies it; unit tests inject a fake to
// assert the logged transition without standing up a database. Introduced to
// honour the package's dependency-inversion convention (handlers depend on
// small interfaces, not concrete repos).
type transitionLogger interface {
	Insert(ctx context.Context, vehicleID int64, ts time.Time,
		fsmName, fromState, toState, trigger string,
		details map[string]interface{}) error
}

// Handler owns vehicle, drive, and charge FSM state.
type Handler struct {
	mu          sync.Mutex
	machines    map[int64]*fsm.VehicleFSM
	drives      map[int64]*drive.SessionFSM  // active drive sub-FSMs per vehicle
	charges     map[int64]*charge.SessionFSM // active charge sub-FSMs per vehicle
	vehicleRepo *vehicledb.VehicleRepo
	transRepo   transitionLogger

	localSignals  *signal.Store // set by SetSignalStore()
	reconcileStop chan struct{}
	lastProcessed map[int64]time.Time
}

// NewHandler creates an authoritative FSM handler.
//
// The legacy *database.VehicleStateRepo dependency was removed. Vehicle
// current state is now sourced from the in-memory FSM
// (machines map) populated by ProcessSignals + the periodic reconciler;
// transitions are durably logged via transRepo.Insert into fsm_transitions.
// Cold-start initial state defaults to fsm.Online and
// converges to the correct state within seconds of incoming telemetry.
func NewHandler(vehicleRepo *vehicledb.VehicleRepo, transRepo *dbobs.FSMTransitionRepo) *Handler {
	h := &Handler{
		machines:      make(map[int64]*fsm.VehicleFSM),
		drives:        make(map[int64]*drive.SessionFSM),
		charges:       make(map[int64]*charge.SessionFSM),
		vehicleRepo:   vehicleRepo,
		reconcileStop: make(chan struct{}, 1),
		lastProcessed: make(map[int64]time.Time),
	}
	// Guard against the typed-nil-interface trap: a nil *FSMTransitionRepo
	// assigned to the interface field would report non-nil as an interface,
	// so the `a.transRepo != nil` skip in fsmAction.Execute would fail and
	// dereference a nil repo. Only store a genuinely non-nil repo.
	if transRepo != nil {
		h.transRepo = transRepo
	}
	return h
}

// SetSignalStore wires the signal store dependency for reconciliation.
// Called after construction because the signal store may not exist yet at
// Handler creation time.
func (h *Handler) SetSignalStore(store *signal.Store) {
	h.localSignals = store
}

// fsmAction handles all side effects of a vehicle state transition:
// updates vehicles table and logs to fsm_transitions, and manages
// drive/charge sub-FSM lifecycle. The legacy snapshot-row writer
// (vehicle_states table) was dropped — durable transition
// history now lives only in fsm_transitions, and the per-vehicle current
// state is derived from the in-memory FSM.
type fsmAction struct {
	handler     *Handler
	vehicleRepo *vehicledb.VehicleRepo
	transRepo   transitionLogger
}

func (a *fsmAction) Execute(ctx context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) error {
	// Best-effort writes; collect the first error so the FSM can decide whether to
	// roll back its in-memory transition. The legacy vehicle_states snapshot-row
	// writes were removed — fsm_transitions is now
	// the sole durable record of the transition.
	var firstErr error
	keep := func(err error) {
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	_ = keep // retained for future best-effort write fan-out

	if a.transRepo != nil {
		details := map[string]interface{}{
			"is_gear_capable": sctx.IsGearCapable,
			"is_charging":     sctx.IsCharging,
		}
		if sctx.Gear != "" {
			details["gear"] = sctx.Gear
		}
		if sctx.Speed > 0 {
			details["speed"] = sctx.Speed
		}
		if sctx.MatchedGuard != "" {
			details["guard"] = sctx.MatchedGuard
		}
		if sctx.TransitionMode != "" {
			details["mode"] = sctx.TransitionMode
		}
		ts := sctx.Now
		if ts.IsZero() {
			ts = time.Now()
		}
		if err := a.transRepo.Insert(ctx, vehicleID, ts, "vehicle",
			string(from), string(to), sctx.MatchedTrigger, details); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: failed to log transition")
		}
	}

	a.handler.manageSubFSMs(ctx, vehicleID, from, to, sctx)

	return firstErr
}

// manageSubFSMs creates/finalizes drive and charge sub-FSMs on state transitions.
func (h *Handler) manageSubFSMs(_ context.Context, vehicleID int64, from, to fsm.State, sctx *fsm.SignalContext) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if to == fsm.Driving && from != fsm.Driving {
		// Unplug-and-go: close any active charge before starting a drive.
		if chargeFSM, ok := h.charges[vehicleID]; ok {
			chargeFSM.TriggerEndingAt(sctx.Signals, true, sctx.Now)
			delete(h.charges, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: force-completed charge (drive started)")
		}
		driveFSM := drive.NewSessionFSMAt(vehicleID, "", 0, sctx.Now) // driveID will be set by session tracker
		if sctx.Signals != nil {
			driveFSM.ProcessSignalsAt(sctx.Signals, sctx.Now)
		}
		h.drives[vehicleID] = driveFSM
		log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: drive sub-FSM created")
	}

	if from == fsm.Driving && to != fsm.Driving {
		if driveFSM, ok := h.drives[vehicleID]; ok {
			driveFSM.TriggerEndingAt(sctx.Signals, sctx.Now)
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

	if to == fsm.Charging && from != fsm.Charging {
		if driveFSM, ok := h.drives[vehicleID]; ok {
			driveFSM.TriggerEndingAt(sctx.Signals, sctx.Now)
			if !driveFSM.IsCompleted() {
				driveFSM.ForceComplete()
			}
			delete(h.drives, vehicleID)
			log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: force-completed drive (charge started)")
		}
		chargeFSM := charge.NewSessionFSMAt(vehicleID, "", 0, sctx.Now)
		if sctx.Signals != nil {
			chargeFSM.ProcessSignalsAt(sctx.Signals, sctx.Now)
		}
		h.charges[vehicleID] = chargeFSM
		log.Info().Int64("vehicle_id", vehicleID).Msg("fsm: charge sub-FSM created")
	}

	if from == fsm.Charging && to != fsm.Charging {
		if chargeFSM, ok := h.charges[vehicleID]; ok {
			chargeFSM.TriggerEndingAt(sctx.Signals, false, sctx.Now)
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
func (h *Handler) getOrCreate(ctx context.Context, vehicleID int64) *fsm.VehicleFSM {
	h.mu.Lock()
	defer h.mu.Unlock()

	m, exists := h.machines[vehicleID]
	if exists {
		return m
	}

	// The legacy *VehicleStateRepo.GetCurrentState lookup that hydrated
	// initial FSM state from the dropped vehicle_states
	// table is gone. Cold start defaults to fsm.Online; the periodic
	// reconciler (reconcileVehicle) corrects it within ~15s once telemetry
	// arrives. Restart-time precision is acceptable here because the
	// reconciler treats Online → {Driving, Charging, Asleep, Offline} as a
	// normal forward transition under the same metrics.
	initial := fsm.Online

	action := &fsmAction{
		handler:     h,
		vehicleRepo: h.vehicleRepo,
		transRepo:   h.transRepo,
	}
	m = fsm.NewVehicleFSM(initial, action)

	h.machines[vehicleID] = m

	log.Info().Int64("vehicle_id", vehicleID).Str("state", string(initial)).Msg("fsm: initialized vehicle FSM (default)")
	return m
}

// ProcessSignals runs the FSM on a signal batch and forwards to active sub-FSMs.
// Legacy entry point for callers without event-time information; defers to
// ProcessSignalsAt with empty payloadTs/fieldTs (wall-clock fallback).
func (h *Handler) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	h.ProcessSignalsAt(ctx, vehicleID, signals, time.Time{}, nil)
}

// ProcessSignalsAt is the event-time-aware variant. payloadTs is the
// largest EmittedAt across the batch (provided by the AtomicsObserver
// pipeline); fieldTs is the per-Field EmittedAt map (currently unused
// at this layer but accepted to keep the bridge interface symmetric
// with SessionTracker.ProcessSignalsAt where per-field stamps drive
// drive-start/end attribution). A zero payloadTs preserves wall-clock
// behavior — required for the reconciler tick at line 427 below
// which fires from a wall-clock timer with no signal payload.
//
// Uses payload timestamps for production replay accuracy.
func (h *Handler) ProcessSignalsAt(ctx context.Context, vehicleID int64, signals map[string]interface{}, payloadTs time.Time, _ map[string]time.Time) {
	signalNames := make([]string, 0, len(signals))
	for k := range signals {
		signalNames = append(signalNames, k)
	}
	log.Debug().
		Int64("vehicle_id", vehicleID).
		Int("signal_count", len(signals)).
		Strs("signals", signalNames).
		Msg("fsm: processing signal batch")

	m := h.getOrCreate(ctx, vehicleID)

	if state := m.Current(); state == fsm.Asleep || state == fsm.Offline {
		if err := m.HandleSignalReceivedAt(ctx, vehicleID, payloadTs); err != nil {
			outcome := "error"
			if ctx.Err() == context.DeadlineExceeded {
				outcome = "timeout"
			}
			metrics.FSMDispatchTotal.WithLabelValues(outcome).Inc()
			log.Warn().Err(err).
				Int64("vehicle_id", vehicleID).
				Str("outcome", outcome).
				Msg("fsm: HandleSignalReceived error")
		}
	}

	if err := m.ProcessSignalsAt(ctx, vehicleID, signals, payloadTs); err != nil {
		outcome := "error"
		if ctx.Err() == context.DeadlineExceeded {
			outcome = "timeout"
		}
		metrics.FSMDispatchTotal.WithLabelValues(outcome).Inc()
		log.Warn().Err(err).
			Int64("vehicle_id", vehicleID).
			Str("outcome", outcome).
			Msg("fsm: ProcessSignals error")
	}

	// Check pending debounced transitions. Use payloadTs so a replay
	// batch's pending Driving→Parked debounce confirms based on
	// signal event-time, not the replay-runner's wall-clock — the
	// legacy time.Now().UTC() here was the second source of the
	// micro-drive bug fixed in v3.4.
	checkTs := payloadTs
	if checkTs.IsZero() {
		checkTs = time.Now().UTC()
	}
	sctx := &fsm.SignalContext{Now: checkTs}
	if err := m.CheckPending(ctx, vehicleID, sctx); err != nil {
		outcome := "error"
		if ctx.Err() == context.DeadlineExceeded {
			outcome = "timeout"
		}
		metrics.FSMDispatchTotal.WithLabelValues(outcome).Inc()
		log.Warn().Err(err).
			Int64("vehicle_id", vehicleID).
			Str("outcome", outcome).
			Msg("fsm: CheckPending error")
	}

	h.mu.Lock()
	activeDrive := h.drives[vehicleID]
	activeCharge := h.charges[vehicleID]
	h.mu.Unlock()

	if activeDrive != nil {
		activeDrive.ProcessSignalsAt(signals, checkTs)
	}
	if activeCharge != nil {
		activeCharge.ProcessSignalsAt(signals, checkTs)
	}

	// Track last-processed time for reconciliation staleness checks.
	// Wall-clock by design — this is a health/staleness clock, not a
	// state-math clock (see PE non-blocking note in plan v3.4).
	h.mu.Lock()
	h.lastProcessed[vehicleID] = time.Now()
	h.mu.Unlock()
}

// HandleTimeout transitions a vehicle to offline/asleep when telemetry stops.
func (h *Handler) HandleTimeout(ctx context.Context, vehicleID int64) {
	m := h.getOrCreate(ctx, vehicleID)
	if err := m.HandleTimeout(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: HandleTimeout error")
	}
}

// HandleSignalReceived wakes a vehicle from asleep/offline state.
func (h *Handler) HandleSignalReceived(ctx context.Context, vehicleID int64) {
	m := h.getOrCreate(ctx, vehicleID)
	if err := m.HandleSignalReceived(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("fsm: HandleSignalReceived error")
	}
}

// reconcileInterval is the period between reconciliation sweeps.
const reconcileInterval = 15 * time.Second

// StartReconcileLoop begins the periodic reconciliation goroutine.
// It compares the FSM state of each known vehicle against the signal store
// and replays signals when a mismatch is detected.
func (h *Handler) StartReconcileLoop() {
	go func() {
		ticker := time.NewTicker(reconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				h.reconcileAll()
			case <-h.reconcileStop:
				return
			}
		}
	}()
	log.Info().Dur("interval", reconcileInterval).Msg("fsm: reconciliation loop started")
}

// StopReconcileLoop stops the periodic reconciliation goroutine. The stop
// signal is delivered via a buffered (size 1) channel and a non-blocking send,
// so the request is retained until the loop next reaches its select even if the
// goroutine is mid-reconcileAll — an unbuffered send here could be silently
// dropped, leaking the goroutine on shutdown. Safe to call when no loop is
// running (the buffered slot simply fills) and idempotent across repeat calls.
func (h *Handler) StopReconcileLoop() {
	select {
	case h.reconcileStop <- struct{}{}:
	default:
	}
}

// reconcileAll iterates over all vehicles in the signal store and reconciles each.
func (h *Handler) reconcileAll() {
	if h.localSignals == nil {
		return
	}

	vehicleIDs := h.localSignals.VehicleIDs()
	now := time.Now()

	for _, vid := range vehicleIDs {
		h.reconcileVehicle(vid, now)
	}
}

// reconcileVehicle checks one vehicle's FSM state against the signal-derived
// expected state and replays signals through ProcessSignals if a mismatch is found.
func (h *Handler) reconcileVehicle(vehicleID int64, now time.Time) {
	// Derive expected state from signal store
	result := fsm.DeriveExpectedState(vehicleID, h.localSignals, now)

	// Skip if confidence is too low to act on
	if result.Confidence < fsm.ConfidenceMedium {
		metrics.FSMReconcileTotal.WithLabelValues("skipped_confidence").Inc()
		return
	}

	// Skip if signals were processed more recently than the freshest signal —
	// the FSM is already up to date.
	h.mu.Lock()
	lastProc, hasLastProc := h.lastProcessed[vehicleID]
	h.mu.Unlock()

	if hasLastProc && lastProc.After(result.FreshestAt) {
		metrics.FSMReconcileTotal.WithLabelValues("skipped_fresh").Inc()
		return
	}

	// Check current FSM state
	h.mu.Lock()
	m, exists := h.machines[vehicleID]
	h.mu.Unlock()

	if !exists {
		// No FSM yet — nothing to reconcile (will be created on next signal batch)
		metrics.FSMReconcileTotal.WithLabelValues("skipped_confidence").Inc()
		return
	}

	currentState := m.Current()

	// Already in the expected state — no correction needed
	if currentState == result.ExpectedState {
		metrics.FSMReconcileTotal.WithLabelValues("already_correct").Inc()
		return
	}

	// Mismatch detected — replay signal store snapshot through ProcessSignals
	signals := h.localSignals.GetRawMap(vehicleID)
	if signals == nil {
		metrics.FSMReconcileTotal.WithLabelValues("error").Inc()
		return
	}

	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("current", string(currentState)).
		Str("expected", string(result.ExpectedState)).
		Str("confidence", result.Confidence.String()).
		Str("reason", result.Reason).
		Msg("fsm: reconciliation mismatch — replaying signals")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.ProcessSignals(ctx, vehicleID, signals)

	metrics.FSMReconcileTotal.WithLabelValues("corrected").Inc()
}
