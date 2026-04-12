package fsm

import (
	"context"
	"sync"
	"time"

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
	To    State
	Since time.Time
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

// ProcessSignals is the single entry point for telemetry signal batches.
// It detects triggers, evaluates the transition table, and commits valid transitions.
func (m *VehicleFSM) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Permanently mark this vehicle as gear-capable once ANY Gear signal arrives.
	if _, hasGear := signals["Gear"]; hasGear {
		m.isGearCapable = true
	}

	sctx := m.buildSignalContext(signals)
	triggers := DetectTriggers(sctx)

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
		CurrentState: m.current,
		IsGearCapable: m.isGearCapable,
		Now:           time.Now().UTC(),
	}
	return m.tryTransition(ctx, vehicleID, TriggerTimeout, sctx)
}

// HandleSignalReceived is called when any signal arrives for a vehicle in Asleep/Offline state.
func (m *VehicleFSM) HandleSignalReceived(ctx context.Context, vehicleID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.current != Asleep && m.current != Offline {
		return nil
	}

	sctx := &SignalContext{
		CurrentState: m.current,
		IsGearCapable: m.isGearCapable,
		Now:           time.Now().UTC(),
	}
	return m.tryTransition(ctx, vehicleID, TriggerSignalReceived, sctx)
}

func (m *VehicleFSM) tryTransition(ctx context.Context, vehicleID int64, trigger Trigger, sctx *SignalContext) error {
	tr, found := LookupTransition(m.current, trigger, sctx)
	if !found {
		return nil // no valid transition — not an error
	}

	if tr.Mode == Debounced {
		return m.handleDebounced(ctx, vehicleID, tr, sctx)
	}

	return m.commit(ctx, vehicleID, tr, sctx)
}

func (m *VehicleFSM) handleDebounced(_ context.Context, _ int64, tr Transition, sctx *SignalContext) error {
	now := sctx.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}

	if m.pending == nil || m.pending.To != tr.To {
		// New candidate — start the debounce timer
		m.pending = &pendingTransition{To: tr.To, Since: now}
		return nil
	}

	// Same candidate — check if confirmation period has elapsed
	if now.Sub(m.pending.Since) < StateConfirmDuration {
		return nil // not yet confirmed
	}

	// Confirmed — promote to a real transition and commit
	// (we call commit via tryTransition path, but treat it as Immediate now)
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
	m.pending = nil

	tr := Transition{
		From:    m.current,
		To:      to,
		Trigger: TriggerSpeedZero, // debounced transitions are always speed-based
		Mode:    Immediate,
	}
	return m.commit(ctx, vehicleID, tr, sctx)
}

// CancelPending resets any pending debounced transition (e.g., speed resumed).
func (m *VehicleFSM) CancelPending() {
	m.pending = nil
}

func (m *VehicleFSM) commit(ctx context.Context, vehicleID int64, tr Transition, sctx *SignalContext) error {
	from := m.current
	duration := time.Since(m.lastTransitionAt)

	m.current = tr.To
	m.pending = nil
	m.lastTransitionAt = time.Now()

	// Populate metadata for logging
	sctx.MatchedTrigger = tr.Trigger.String()
	sctx.MatchedGuard = tr.GuardNameStr()
	sctx.TransitionMode = tr.Mode.String()

	m.logger.Info().
		Int64("vehicle_id", vehicleID).
		Str("from", string(from)).
		Str("to", string(tr.To)).
		Str("trigger", tr.Trigger.String()).
		Str("guard", tr.GuardNameStr()).
		Dur("duration_in_state", duration).
		Msg("vehicle state transition")

	return m.actions.Execute(ctx, vehicleID, from, tr.To, sctx)
}

func (m *VehicleFSM) buildSignalContext(signals map[string]interface{}) *SignalContext {
	sctx := &SignalContext{
		CurrentState: m.current,
		IsGearCapable: m.isGearCapable,
		Signals:       signals,
		Now:           time.Now().UTC(),
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
	case "Charging", "Starting", "ChargeStateCharging", "ChargeStateStarting",
		"DetailedChargeStateCharging", "DetailedChargeStateStarting", "Enable":
		return true
	}
	return false
}
