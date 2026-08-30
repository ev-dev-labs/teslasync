package fsm

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

const (
	// StateConfirmDuration is the debounce period for speed-based transitions.
	StateConfirmDuration = 30 * time.Second
	// DriveHoldDuration suppresses speed-zero transitions while recently driving.
	DriveHoldDuration = 2 * time.Minute
)

type pendingTransition struct {
	To      State
	Trigger Trigger
	Since   time.Time
}

// VehicleFSM is the top-level state machine for a single vehicle.
// Thread-safe — all methods acquire the internal mutex.
type VehicleFSM struct {
	mu               sync.Mutex
	current          State
	pending          *pendingTransition
	lastTransitionAt time.Time
	isGearCapable    bool

	actions ActionExecutor
	logger  zerolog.Logger
}

// NewVehicleFSM creates a state machine starting in the given state.
func NewVehicleFSM(initial State, actions ActionExecutor) *VehicleFSM {
	if actions == nil {
		actions = NoOpAction{}
	}
	return &VehicleFSM{
		current:          initial,
		lastTransitionAt: time.Now(),
		actions:          actions,
		logger:           log.With().Str("component", "vehicle_fsm").Logger(),
	}
}

// Current returns the committed state (thread-safe).
func (m *VehicleFSM) Current() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current
}

// IsGearCapable returns whether this vehicle has ever received a Gear signal.
func (m *VehicleFSM) IsGearCapable() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.isGearCapable
}

// SetGearCapable marks this vehicle as having received Gear data (e.g., recovered from DB).
func (m *VehicleFSM) SetGearCapable(v bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.isGearCapable = v
}

// LastTransitionAt returns when the FSM last committed a transition (thread-safe).
// Used by health endpoints to detect FSMs that are stale despite live signals.
func (m *VehicleFSM) LastTransitionAt() time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.lastTransitionAt
}

// ProcessSignals is the single entry point for telemetry signal batches
// driven by callers that have no event-time information (legacy poll
// path, tests). It defers to ProcessSignalsAt with a zero payloadTs
// which falls back to wall-clock inside buildSignalContextAt.
func (m *VehicleFSM) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	return m.ProcessSignalsAt(ctx, vehicleID, signals, time.Time{})
}

// ProcessSignalsAt is the event-time-aware variant. payloadTs is the
// signal-batch timestamp threaded down from the AtomicsObserver
// pipeline (max EmittedAt across the batch's atomics). When non-zero
// it stamps both the SignalContext.Now used by transition guards and
// the ts persisted to fsm_transitions via fsmAction.Execute. A zero
// payloadTs preserves the legacy wall-clock behavior — required for
// non-pipeline callers that have no event-time (HandleTimeout-driven
// reconciler ticks, test fixtures).
//
// Replaying a 24-minute window of historical signals with the legacy
// buildSignalContext stamped every transition with the replay-runner's
// wall-clock, producing micro-drives at the runner's time rather than the
// original event window. Rule: any caller that
// has the originating signal's EmittedAt MUST pass it through.
func (m *VehicleFSM) ProcessSignalsAt(ctx context.Context, vehicleID int64, signals map[string]interface{}, payloadTs time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Permanently mark this vehicle as gear-capable once ANY Gear signal arrives.
	if _, hasGear := signals["Gear"]; hasGear {
		m.isGearCapable = true
	}

	sctx := m.buildSignalContextAt(signals, payloadTs)

	// Cancel any pending Park-debounce when the same batch carries
	// contradicting evidence (Gear=D/R or
	// VehicleSpeed > 1.0). Without this, a spurious single-frame Gear=P
	// would silently arm the debounce and CheckPending would later commit
	// Driving→Parked even though the vehicle had been moving the entire
	// 30s window. Holding the lock through this block is safe because
	// m.mu is already acquired at function entry.
	if m.pending != nil && m.pending.To == Parked {
		contradicts := false
		if sctx.HasGearInBatch {
			switch sctx.Gear {
			case enums.GearDrive, enums.GearReverse:
				contradicts = true
			}
		}
		if !contradicts && sctx.Speed > 1.0 {
			contradicts = true
		}
		if contradicts {
			m.logger.Debug().
				Int64("vehicle_id", vehicleID).
				Str("pending_to", string(m.pending.To)).
				Str("gear", sctx.Gear).
				Float64("speed", sctx.Speed).
				Msg("fsm: cancelling pending Park (contradicting evidence)")
			m.pending = nil
		}
	}

	m.logger.Debug().
		Int64("vehicle_id", vehicleID).
		Str("current_state", string(m.current)).
		Bool("has_gear", sctx.HasGearInBatch).
		Str("gear", sctx.Gear).
		Bool("charge_changed", sctx.ChargeStateChanged).
		Bool("is_charging", sctx.IsCharging).
		Float64("speed", sctx.Speed).
		Bool("is_gear_capable", sctx.IsGearCapable).
		Msg("fsm: signal context built")

	triggers := DetectTriggers(sctx)

	if len(triggers) > 0 {
		triggerNames := make([]string, len(triggers))
		for i, t := range triggers {
			triggerNames[i] = t.String()
		}
		m.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Strs("triggers", triggerNames).
			Msg("fsm: triggers detected")
	}

	for _, trigger := range triggers {
		if err := m.tryTransition(ctx, vehicleID, trigger, sctx); err != nil {
			return err
		}
	}
	return nil
}

// HandleTimeout is called when no signals arrive for the stale timeout period.
func (m *VehicleFSM) HandleTimeout(ctx context.Context, vehicleID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	sctx := &SignalContext{
		CurrentState:  m.current,
		IsGearCapable: m.isGearCapable,
		Now:           time.Now().UTC(),
	}
	return m.tryTransition(ctx, vehicleID, TriggerTimeout, sctx)
}

// HandleSignalReceived is called when any signal arrives for a vehicle in Asleep/Offline state.
func (m *VehicleFSM) HandleSignalReceived(ctx context.Context, vehicleID int64) error {
	return m.HandleSignalReceivedAt(ctx, vehicleID, time.Now().UTC())
}

// HandleSignalReceivedAt wakes an asleep/offline vehicle using the signal's
// event time. This keeps replayed transitions anchored to when Tesla emitted
// the signal rather than when a queued MQTT message was consumed.
func (m *VehicleFSM) HandleSignalReceivedAt(ctx context.Context, vehicleID int64, eventTime time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.current != Asleep && m.current != Offline {
		return nil
	}
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}

	sctx := &SignalContext{
		CurrentState:  m.current,
		IsGearCapable: m.isGearCapable,
		Now:           eventTime,
	}
	return m.tryTransition(ctx, vehicleID, TriggerSignalReceived, sctx)
}

func (m *VehicleFSM) tryTransition(ctx context.Context, vehicleID int64, trigger Trigger, sctx *SignalContext) error {
	tr, found := LookupTransition(m.current, trigger, sctx)
	if !found {
		m.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Str("current", string(m.current)).
			Str("trigger", trigger.String()).
			Msg("fsm: no valid transition (guard blocked or not in table)")
		return nil // no valid transition — not an error
	}

	m.logger.Debug().
		Int64("vehicle_id", vehicleID).
		Str("from", string(tr.From)).
		Str("to", string(tr.To)).
		Str("trigger", trigger.String()).
		Str("mode", tr.Mode.String()).
		Str("guard", tr.GuardNameStr()).
		Msg("fsm: transition found")

	if tr.Mode == Debounced {
		return m.handleDebounced(ctx, vehicleID, tr, sctx)
	}

	return m.commit(ctx, vehicleID, tr, sctx)
}

func (m *VehicleFSM) handleDebounced(_ context.Context, vehicleID int64, tr Transition, sctx *SignalContext) error {
	now := sctx.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	if m.pending == nil || m.pending.To != tr.To {
		// New candidate — start the debounce timer.
		// C3 (v3.4): preserve the originating Trigger so CheckPending
		// commits with the same trigger semantics. Without this,
		// debounced Gear=P transitions would commit with TriggerSpeedZero
		// in the persisted fsm_transitions row — useless for audit and
		// silently breaks any downstream consumer that reads the trigger
		// (e.g. drive-merge logic in C3 below).
		m.pending = &pendingTransition{To: tr.To, Trigger: tr.Trigger, Since: now}
		m.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Str("to", string(tr.To)).
			Msg("fsm: debounce started")
		return nil
	}

	// Same candidate — check if confirmation period has elapsed
	if now.Sub(m.pending.Since) < StateConfirmDuration {
		return nil // not yet confirmed
	}

	// Confirmed — promote to a real transition and commit
	m.logger.Debug().
		Int64("vehicle_id", vehicleID).
		Str("to", string(m.pending.To)).
		Dur("elapsed", time.Since(m.pending.Since)).
		Msg("fsm: debounce confirmed, will commit on next batch")

	m.pending = nil
	confirmedTr := tr
	confirmedTr.Mode = Immediate
	return nil // debounced transitions commit on the NEXT signal batch after confirmation
}

// CheckPending should be called on each signal batch to commit debounced transitions
// that have been pending long enough.
func (m *VehicleFSM) CheckPending(ctx context.Context, vehicleID int64, sctx *SignalContext) error {
	if m.pending == nil {
		return nil
	}

	now := sctx.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	if now.Sub(m.pending.Since) < StateConfirmDuration {
		return nil
	}

	// Confirmed — commit
	to := m.pending.To
	trigger := m.pending.Trigger
	m.logger.Debug().
		Int64("vehicle_id", vehicleID).
		Str("to", string(to)).
		Str("trigger", trigger.String()).
		Msg("fsm: committing confirmed debounced transition")
	m.pending = nil

	tr := Transition{
		From:    m.current,
		To:      to,
		Trigger: trigger,
		Mode:    Immediate,
	}
	return m.commit(ctx, vehicleID, tr, sctx)
}

// CancelPending resets any pending debounced transition (e.g., speed resumed).
func (m *VehicleFSM) CancelPending(vehicleID int64) {
	if m.pending != nil {
		m.logger.Debug().
			Int64("vehicle_id", vehicleID).
			Str("cancelled_to", string(m.pending.To)).
			Msg("fsm: debounce cancelled")
	}
	m.pending = nil
}

func (m *VehicleFSM) commit(ctx context.Context, vehicleID int64, tr Transition, sctx *SignalContext) error {
	from := m.current
	duration := time.Since(m.lastTransitionAt)

	// Populate metadata for logging
	sctx.MatchedTrigger = tr.Trigger.String()
	sctx.MatchedGuard = tr.GuardNameStr()
	sctx.TransitionMode = tr.Mode.String()

	// Persist FIRST. If the action layer fails, leave in-memory state untouched
	// so the next signal batch retries the transition. Without this, a transient
	// DB error would leave us claiming we're in `tr.To` while the DB still says `from`.
	if err := m.actions.Execute(ctx, vehicleID, from, tr.To, sctx); err != nil {
		m.logger.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("from", string(from)).
			Str("to", string(tr.To)).
			Msg("vehicle state transition aborted: action failed")
		return err
	}

	m.current = tr.To
	m.pending = nil
	m.lastTransitionAt = time.Now()

	m.logger.Info().
		Int64("vehicle_id", vehicleID).
		Str("from", string(from)).
		Str("to", string(tr.To)).
		Str("trigger", tr.Trigger.String()).
		Str("guard", tr.GuardNameStr()).
		Dur("duration_in_state", duration).
		Msg("vehicle state transition")

	return nil
}

// buildSignalContextAt is the event-time-aware constructor. When
// payloadTs is zero it falls back to wall-clock so non-pipeline
// callers (HandleTimeout, HandleSignalReceived, tests) keep their
// existing semantics. When non-zero it stamps SignalContext.Now with
// payloadTs so transition guards (Debounced timers, CheckPending) and
// the persisted fsm_transitions row reflect the originating signal's
// event-time. Any caller threading EmittedAt MUST pass it here.
func (m *VehicleFSM) buildSignalContextAt(signals map[string]interface{}, payloadTs time.Time) *SignalContext {
	now := payloadTs
	if now.IsZero() {
		now = time.Now().UTC()
	}
	sctx := &SignalContext{
		CurrentState:  m.current,
		IsGearCapable: m.isGearCapable,
		Signals:       signals,
		Now:           now,
	}

	// Gear
	if g, ok := signals["Gear"]; ok {
		sctx.HasGearInBatch = true
		sctx.Gear = toString(g)
	}

	// Speed
	if s, ok := toFloat(signals["VehicleSpeed"]); ok {
		sctx.Speed = s
	}

	// Charging — any charge state signal in the batch counts as a change
	if dcs, ok := signals["DetailedChargeState"]; ok {
		sctx.IsCharging = isChargingState(toString(dcs))
		sctx.ChargeStateChanged = true
	} else if cs, ok := signals["ChargeState"]; ok {
		sctx.IsCharging = isChargingState(toString(cs))
		sctx.ChargeStateChanged = true
	}
	if amps, ok := toFloat(signals["ChargeAmps"]); ok && amps > 1.0 {
		sctx.IsCharging = true
	}

	return sctx
}

// toString converts an interface{} to string.
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// toFloat converts an interface{} to float64.
func toFloat(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

// isChargingState returns true if the charge state string indicates active charging.
func isChargingState(s string) bool {
	switch s {
	case enums.ChargeStateCharging, enums.ChargeStateStarting, "ChargeStateCharging", "ChargeStateStarting",
		"DetailedChargeStateCharging", "DetailedChargeStateStarting", "Enable":
		return true
	}
	return false
}

// FSMDebugInfo holds diagnostic information about a vehicle FSM.
type FSMDebugInfo struct {
	CurrentState     string     `json:"current_state"`
	LastTransitionAt time.Time  `json:"last_transition_at"`
	IsGearCapable    bool       `json:"is_gear_capable"`
	HasPending       bool       `json:"has_pending"`
	PendingTo        string     `json:"pending_to,omitempty"`
	PendingSince     *time.Time `json:"pending_since,omitempty"`
}

// DebugInfo returns diagnostic information about the FSM. Thread-safe.
func (m *VehicleFSM) DebugInfo() FSMDebugInfo {
	m.mu.Lock()
	defer m.mu.Unlock()

	info := FSMDebugInfo{
		CurrentState:     string(m.current),
		LastTransitionAt: m.lastTransitionAt,
		IsGearCapable:    m.isGearCapable,
	}
	if m.pending != nil {
		info.HasPending = true
		info.PendingTo = string(m.pending.To)
		info.PendingSince = &m.pending.Since
	}
	return info
}
