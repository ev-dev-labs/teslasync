package vehicle

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func CanStartDrive(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline, nil
}

func CanPlugIn(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline || v.FSMState == StateDriving, nil
}

func CanSleep(_ context.Context, v *Vehicle, _ fsm.Event) (bool, error) {
	return v.FSMState == StateOnline, nil
}
