package vehiclesvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Service orchestrates vehicle use cases.
type Service struct {
	repo       repository.VehicleRepository
	fsmHistory repository.FSMHistoryRepository
	tesla      external.TeslaClient
	engine     *fsm.Engine[*vehicle.Vehicle]
}

// New creates a new vehicle service with all dependencies injected.
func New(
	repo repository.VehicleRepository,
	fsmHistory repository.FSMHistoryRepository,
	tesla external.TeslaClient,
) *Service {
	s := &Service{
		repo:       repo,
		fsmHistory: fsmHistory,
		tesla:      tesla,
	}
	s.engine = s.setupFSM()
	return s
}

// Create registers a new vehicle.
func (s *Service) Create(ctx context.Context, v *vehicle.Vehicle) error {
	if err := v.Validate(); err != nil {
		return fmt.Errorf("vehicle validation: %w", err)
	}
	v.FSMState = vehicle.StateUnknown
	v.CreatedAt = time.Now()
	v.UpdatedAt = time.Now()

	if v.Model == "" {
		v.Model = vehicle.DetectModelFromVIN(v.VIN)
	}

	if err := s.repo.Save(ctx, v); err != nil {
		return fmt.Errorf("saving vehicle: %w", err)
	}
	return nil
}

// GetByID returns a vehicle by its ID.
func (s *Service) GetByID(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	v, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("getting vehicle %s: %w", id, err)
	}
	return v, nil
}

// GetByUserID returns all vehicles for a user.
func (s *Service) GetByUserID(ctx context.Context, userID string) ([]vehicle.Vehicle, error) {
	vehicles, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("getting vehicles for user %s: %w", userID, err)
	}
	return vehicles, nil
}

// Refresh fetches the latest state from the Tesla API and updates the vehicle.
func (s *Service) Refresh(ctx context.Context, vehicleID string) error {
	v, err := s.repo.GetByID(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("loading vehicle for refresh: %w", err)
	}

	state, err := s.tesla.GetVehicleState(ctx, v.VIN)
	if err != nil {
		return fmt.Errorf("fetching Tesla state for %s: %w", v.VIN, err)
	}

	v.BatteryLevel = state.BatteryLevel
	v.RangeMiles = state.BatteryRange
	v.OdometerMiles = state.OdometerMiles
	v.IsCharging = state.IsCharging
	v.Latitude = state.Latitude
	v.Longitude = state.Longitude
	v.UpdatedAt = time.Now()

	if err := s.repo.Save(ctx, v); err != nil {
		return fmt.Errorf("saving refreshed vehicle: %w", err)
	}
	return nil
}

// Delete removes a vehicle.
func (s *Service) Delete(ctx context.Context, id string) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return fmt.Errorf("deleting vehicle %s: %w", id, err)
	}
	return nil
}

// HandleEvent processes an FSM event for a vehicle using the FSM engine.
func (s *Service) HandleEvent(ctx context.Context, vehicleID string, event fsm.Event) error {
	v, err := s.repo.GetByID(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("loading vehicle for event: %w", err)
	}

	oldState := v.FSMState
	newState, err := s.engine.Fire(ctx, v, v.FSMState, event)
	if err != nil {
		return fmt.Errorf("firing event %s on vehicle %s: %w", event, vehicleID, err)
	}

	v.FSMState = newState
	v.UpdatedAt = time.Now()

	if err := s.repo.Save(ctx, v); err != nil {
		return fmt.Errorf("saving vehicle after transition: %w", err)
	}

	// Record the transition
	if err := s.fsmHistory.RecordTransition(ctx, repository.FSMTransitionRecord{
		ID:        fmt.Sprintf("%s-%d", vehicleID, time.Now().UnixNano()),
		EntityID:  vehicleID,
		FSMName:   "vehicle_lifecycle",
		FromState: oldState,
		Event:     event,
		ToState:   newState,
		CreatedAt: time.Now(),
	}); err != nil {
		return fmt.Errorf("recording transition: %w", err)
	}

	return nil
}
