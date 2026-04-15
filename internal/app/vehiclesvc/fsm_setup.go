package vehiclesvc

import (
	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
)

// setupFSM creates and configures the vehicle FSM engine with guards.
func (s *Service) setupFSM() *fsm.Engine[*vehicle.Vehicle] {
	def := vehicle.NewVehicleFSM()
	engine := fsm.NewEngine[*vehicle.Vehicle](def)

	// Register guards
	engine.AddGuard(
		fsm.Transition{From: vehicle.StateOnline, Event: vehicle.EventStartDrive, To: vehicle.StateDriving},
		vehicle.CanStartDrive,
	)
	engine.AddGuard(
		fsm.Transition{From: vehicle.StateOnline, Event: vehicle.EventPlugIn, To: vehicle.StateCharging},
		vehicle.CanPlugIn,
	)
	engine.AddGuard(
		fsm.Transition{From: vehicle.StateDriving, Event: vehicle.EventPlugIn, To: vehicle.StateCharging},
		vehicle.CanPlugIn,
	)
	engine.AddGuard(
		fsm.Transition{From: vehicle.StateOnline, Event: vehicle.EventSleep, To: vehicle.StateAsleep},
		vehicle.CanSleep,
	)

	return engine
}
