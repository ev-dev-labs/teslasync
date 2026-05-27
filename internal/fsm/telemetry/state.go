// Package telemetry implements a finite state machine for Fleet Telemetry
// connection lifecycle tracking per vehicle. It detects streaming, stale,
// and disconnected states and logs transitions to the fsm_transitions table.
package telemetry

// State represents a Fleet Telemetry connection state for a vehicle.
type State string

const (
	// Unknown — vehicle has never sent Fleet Telemetry data to this instance.
	Unknown State = "unknown"

	// Connecting — first batch received, connection establishing.
	Connecting State = "connecting"

	// Streaming — actively receiving telemetry batches within expected intervals.
	Streaming State = "streaming"

	// Stale — was streaming but no data received for > staleThreshold.
	Stale State = "stale"

	// Disconnected — no data for > offlineThreshold; vehicle likely asleep or FT disconnected.
	Disconnected State = "disconnected"

	// PollingOnly — vehicle data arrives via REST API polling, not Fleet Telemetry streaming.
	PollingOnly State = "polling_only"
)

// ValidStates enumerates all known connection states.
var ValidStates = map[State]bool{
	Unknown: true, Connecting: true, Streaming: true,
	Stale: true, Disconnected: true, PollingOnly: true,
}

// IsValid returns true if s is a recognised connection state.
func (s State) IsValid() bool { return ValidStates[s] }

// Trigger represents an event that may cause a connection state transition.
type Trigger string

const (
	TriggerFirstBatch       Trigger = "first_batch"       // first-ever signal batch from this vehicle
	TriggerBatchReceived    Trigger = "batch_received"    // subsequent batch within threshold
	TriggerStaleTimeout     Trigger = "stale_timeout"     // no batch for > staleThreshold
	TriggerOfflineTimeout   Trigger = "offline_timeout"   // no batch for > offlineThreshold
	TriggerReconnected      Trigger = "reconnected"       // batch received after stale/disconnected
	TriggerPollingDetected  Trigger = "polling_detected"  // data arriving via fleet_api, not fleet_telemetry
	TriggerStreamingResumed Trigger = "streaming_resumed" // switched from polling back to streaming
)

// transitionTable is the single source of truth for valid connection state changes.
// Looked up as transitionTable[currentState][trigger] → newState.
var transitionTable = map[State]map[Trigger]State{
	Unknown: {
		TriggerFirstBatch:      Connecting,
		TriggerPollingDetected: PollingOnly,
	},
	Connecting: {
		TriggerBatchReceived:  Streaming,
		TriggerStaleTimeout:   Stale,
		TriggerOfflineTimeout: Disconnected,
	},
	Streaming: {
		TriggerStaleTimeout:   Stale,
		TriggerOfflineTimeout: Disconnected,
	},
	Stale: {
		TriggerReconnected:    Streaming,
		TriggerOfflineTimeout: Disconnected,
	},
	Disconnected: {
		TriggerReconnected: Streaming,
	},
	PollingOnly: {
		TriggerStreamingResumed: Streaming,
	},
}

// LookupTransition returns the target state for a given current state + trigger,
// or empty string if no valid transition exists.
func LookupTransition(current State, trigger Trigger) State {
	if triggers, ok := transitionTable[current]; ok {
		return triggers[trigger]
	}
	return ""
}
