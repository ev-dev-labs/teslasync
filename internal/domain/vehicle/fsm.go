package vehicle

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

// Vehicle lifecycle states.
const (
	StateUnknown  fsm.State = "unknown"
	StateOnline   fsm.State = "online"
	StateAsleep   fsm.State = "asleep"
	StateDriving  fsm.State = "driving"
	StateCharging fsm.State = "charging"
	StateOffline  fsm.State = "offline"
)

// Vehicle lifecycle events.
const (
	EventWake       fsm.Event = "wake"
	EventSleep      fsm.Event = "sleep"
	EventStartDrive fsm.Event = "start_drive"
	EventStopDrive  fsm.Event = "stop_drive"
	EventPlugIn     fsm.Event = "plug_in"
	EventUnplug     fsm.Event = "unplug"
	EventGoOffline  fsm.Event = "go_offline"
	EventComeOnline fsm.Event = "come_online"
)

// NewVehicleFSM creates the vehicle lifecycle state machine definition.
func NewVehicleFSM() *fsm.Definition {
	return fsm.NewDefinition("vehicle_lifecycle").
		InitialState(StateUnknown).
		// From Unknown
		Transition(StateUnknown, EventComeOnline, StateOnline).
		// From Online
		Transition(StateOnline, EventStartDrive, StateDriving).
		Transition(StateOnline, EventPlugIn, StateCharging).
		Transition(StateOnline, EventSleep, StateAsleep).
		Transition(StateOnline, EventGoOffline, StateOffline).
		// From Driving
		Transition(StateDriving, EventStopDrive, StateOnline).
		Transition(StateDriving, EventPlugIn, StateCharging).
		// From Charging
		Transition(StateCharging, EventUnplug, StateOnline).
		// From Asleep
		Transition(StateAsleep, EventWake, StateOnline).
		Transition(StateAsleep, EventGoOffline, StateOffline).
		// From Offline
		Transition(StateOffline, EventComeOnline, StateOnline).
		Build()
}
