package vehicle

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// CanStartDrive checks that the vehicle is online before allowing a drive.
func CanStartDrive(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline, nil
}

// CanPlugIn checks that the vehicle is in a state where charging makes sense.
func CanPlugIn(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline || v.FSMState == StateDriving, nil
}

// CanSleep checks that the vehicle is online (not driving or charging).
func CanSleep(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline, nil
}
