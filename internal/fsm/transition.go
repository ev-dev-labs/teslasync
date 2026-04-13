package fsm

// Guard is a predicate that must return true for a transition to fire.
type Guard func(ctx *SignalContext) bool

// GuardName returns the name of a guard function for logging, or "" for nil.
func GuardName(g Guard) string {
	if g == nil {
		return ""
	}
	// Each guard is registered with a name below.
	for name, fn := range guardRegistry {
		// Compare function pointers via a string trick — Go doesn't allow == on funcs.
		// Instead we just check the registry at init time; see guardName map.
		_ = fn
		_ = name
	}
	return ""
}

// guardNames maps guard functions to their string names for logging.
var guardNames = map[string]Guard{}

// Transition defines a single valid state change in the vehicle FSM.
type Transition struct {
	From    State
	To      State
	Trigger Trigger
	Guard   Guard          // nil means unconditional
	Mode    TransitionMode // Immediate or Debounced
	name    string         // guard name for logging
}

// GuardNameStr returns the guard name for this transition.
func (t Transition) GuardNameStr() string { return t.name }

// TransitionTable is the single source of truth for all valid vehicle state transitions.
var TransitionTable = []Transition{
	// ─── ONLINE ─────────────────────────────────────────────────────────────
	{Online, Driving, TriggerGearDriving, nil, Immediate, ""},
	{Online, Driving, TriggerSpeedDetected, nil, Immediate, ""},
	{Online, Charging, TriggerChargeStarted, nil, Immediate, ""},
	{Online, Parked, TriggerGearParked, GuardNoCharge, Debounced, "GuardNoCharge"},
	{Online, Asleep, TriggerTimeout, nil, Immediate, ""},

	// ─── DRIVING ────────────────────────────────────────────────────────────
	{Driving, Parked, TriggerGearParked, GuardNoCharge, Immediate, "GuardNoCharge"},
	{Driving, Charging, TriggerChargeStarted, nil, Immediate, ""},
	{Driving, Online, TriggerSpeedZero, GuardNoGear, Debounced, "GuardNoGear"},
	{Driving, Offline, TriggerTimeout, nil, Immediate, ""},

	// ─── CHARGING ───────────────────────────────────────────────────────────
	{Charging, Driving, TriggerGearDriving, nil, Immediate, ""},
	{Charging, Parked, TriggerChargeEnded, nil, Immediate, ""},
	{Charging, Offline, TriggerTimeout, nil, Immediate, ""},

	// ─── PARKED ─────────────────────────────────────────────────────────────
	{Parked, Driving, TriggerGearDriving, nil, Immediate, ""},
	{Parked, Driving, TriggerSpeedDetected, nil, Immediate, ""},
	{Parked, Charging, TriggerChargeStarted, nil, Immediate, ""},
	{Parked, Online, TriggerActivityDetected, nil, Immediate, ""},
	{Parked, Asleep, TriggerTimeout, nil, Immediate, ""},
	{Parked, Offline, TriggerTimeout, GuardUnexpectedLoss, Immediate, "GuardUnexpectedLoss"},

	// ─── ASLEEP ─────────────────────────────────────────────────────────────
	{Asleep, Online, TriggerSignalReceived, nil, Immediate, ""},

	// ─── OFFLINE ────────────────────────────────────────────────────────────
	{Offline, Online, TriggerSignalReceived, nil, Immediate, ""},
}

// LookupTransition finds the first matching transition for the given state and trigger.
// Returns the transition and true if found, or zero value and false if no valid transition exists.
func LookupTransition(current State, trigger Trigger, ctx *SignalContext) (Transition, bool) {
	for _, t := range TransitionTable {
		if t.From == current && t.Trigger == trigger {
			if t.Guard != nil && !t.Guard(ctx) {
				continue // guard blocked
			}
			return t, true
		}
	}
	return Transition{}, false
}

// private registry for guard name lookup (not needed externally)
var guardRegistry = map[string]Guard{
	"GuardNoCharge":      GuardNoCharge,
	"GuardNoGear":        GuardNoGear,
	"GuardUnexpectedLoss": GuardUnexpectedLoss,
}
