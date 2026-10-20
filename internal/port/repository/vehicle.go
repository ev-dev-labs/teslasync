package repository

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
)

// VehicleRepository persists static metadata in the installation's shared
// fleet. HTTP callers authorize through ForwardAuth before using this port;
// a subject string is not a per-vehicle ownership grant.
type VehicleRepository interface {
	GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error)
	GetAll(ctx context.Context) ([]vehicle.Vehicle, error)
	GetByVIN(ctx context.Context, vin string) (*vehicle.Vehicle, error)
	Save(ctx context.Context, v *vehicle.Vehicle) error
	Delete(ctx context.Context, id string) error
	GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error)
}

// VehicleStateRepository was deleted alongside the vehicle_states table.
// Current vehicle state is now derived from the
// in-memory FSM (internal/api/fsm_handler.go) and durably logged via
// fsm_transitions; the snapshot-row contract had no SI replacement.
