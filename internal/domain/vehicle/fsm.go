package vehicle

import "github.com/ev-dev-labs/teslasync/internal/domain/fsm"

const (
	StateUnknown  fsm.State = "unknown"
	StateOnline   fsm.State = "online"
	StateAsleep   fsm.State = "asleep"
	StateDriving  fsm.State = "driving"
	StateCharging fsm.State = "charging"
	StateOffline  fsm.State = "offline"
)

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

func NewVehicleFSM() *fsm.Definition {
	return fsm.NewDefinition("vehicle_lifecycle").
		InitialState(StateUnknown).
		Transition(StateUnknown, EventComeOnline, StateOnline).
		Transition(StateOnline, EventStartDrive, StateDriving).
		Transition(StateOnline, EventPlugIn, StateCharging).
		Transition(StateOnline, EventSleep, StateAsleep).
		Transition(StateOnline, EventGoOffline, StateOffline).
		Transition(StateDriving, EventStopDrive, StateOnline).
		Transition(StateDriving, EventPlugIn, StateCharging).
		Transition(StateCharging, EventUnplug, StateOnline).
		Transition(StateAsleep, EventWake, StateOnline).
		Transition(StateAsleep, EventGoOffline, StateOffline).
		Transition(StateOffline, EventComeOnline, StateOnline).
		Build()
}
