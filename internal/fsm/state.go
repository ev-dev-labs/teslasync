// Package fsm implements a hierarchical finite state machine for vehicle
// state tracking. The vehicle FSM is the top-level machine; drive and charge
// session sub-FSMs are owned by the Driving and Charging states respectively.
package fsm

// State represents a vehicle operational state.
type State string

const (
	Online   State = "online"
	Driving  State = "driving"
	Charging State = "charging"
	Parked   State = "parked"
	Asleep   State = "asleep"
	Offline  State = "offline"
)

// ValidStates is the set of all valid vehicle states.
var ValidStates = map[State]bool{
	Online: true, Driving: true, Charging: true,
	Parked: true, Asleep: true, Offline: true,
}

// IsValid returns true if s is a recognised vehicle state.
func (s State) IsValid() bool { return ValidStates[s] }

// Trigger represents an event that may cause a state transition.
type Trigger int

const (
	TriggerGearDriving      Trigger = iota // Gear=D or Gear=R
	TriggerGearParked                      // Gear=P
	TriggerSpeedDetected                   // Speed > 1 (no Gear available — REST API polling only)
	TriggerSpeedZero                       // Speed = 0 for driveHoldDuration (REST API polling only)
	TriggerChargeStarted                   // DetailedChargeState is active
	TriggerChargeEnded                     // DetailedChargeState = Disconnected (unplugged)
	TriggerTimeout                         // No signals for staleTimeout
	TriggerSignalReceived                  // Any telemetry signal arrived (wake from sleep/offline)
	TriggerActivityDetected                // Non-idle signal while parked
)

// String returns a human-readable name for the trigger.
func (t Trigger) String() string {
	switch t {
	case TriggerGearDriving:
		return "TriggerGearDriving"
	case TriggerGearParked:
		return "TriggerGearParked"
	case TriggerSpeedDetected:
		return "TriggerSpeedDetected"
	case TriggerSpeedZero:
		return "TriggerSpeedZero"
	case TriggerChargeStarted:
		return "TriggerChargeStarted"
	case TriggerChargeEnded:
		return "TriggerChargeEnded"
	case TriggerTimeout:
		return "TriggerTimeout"
	case TriggerSignalReceived:
		return "TriggerSignalReceived"
	case TriggerActivityDetected:
		return "TriggerActivityDetected"
	default:
		return "TriggerUnknown"
	}
}

// TransitionMode controls whether a transition commits immediately or
// requires a confirmation period (debounce).
type TransitionMode int

const (
	Immediate TransitionMode = iota // Commit on first occurrence
	Debounced                       // Require confirmation period before commit
)

// String returns a human-readable name for the mode.
func (m TransitionMode) String() string {
	if m == Debounced {
		return "debounced"
	}
	return "immediate"
}
