package tripsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// Service orchestrates trip use cases.
type Service struct {
	repo       repository.TripRepository
	fsmHistory repository.FSMHistoryRepository
	geocoding  external.GeocodingProvider
	engine     *fsm.Engine[*trip.Trip]
}

// New creates a new trip service.
func New(
	repo repository.TripRepository,
	fsmHistory repository.FSMHistoryRepository,
	geocoding external.GeocodingProvider,
) *Service {
	def := trip.NewTripFSM()
	return &Service{
		repo:       repo,
		fsmHistory: fsmHistory,
		geocoding:  geocoding,
		engine:     fsm.NewEngine[*trip.Trip](def),
	}
}

// Create starts a new trip.
func (s *Service) Create(ctx context.Context, t *trip.Trip) error {
	if err := t.Validate(); err != nil {
		return fmt.Errorf("trip validation: %w", err)
	}
	t.FSMState = trip.StateStarted
	t.CreatedAt = time.Now()
	t.StartedAt = time.Now()

	// Reverse geocode start address
	if s.geocoding != nil && t.StartAddress == "" {
		addr, err := s.geocoding.ReverseGeocode(ctx, t.StartLatitude, t.StartLongitude)
		if err == nil {
			t.StartAddress = addr.FormattedAddress
		}
	}

	return s.repo.Save(ctx, t)
}

// GetByID returns a trip by ID.
func (s *Service) GetByID(ctx context.Context, id string) (*trip.Trip, error) {
	return s.repo.GetByID(ctx, id)
}

// GetByVehicleID returns all trips for a vehicle.
func (s *Service) GetByVehicleID(ctx context.Context, vehicleID string) ([]trip.Trip, error) {
	return s.repo.GetByVehicleID(ctx, vehicleID)
}

// HandleEvent processes an FSM event for a trip.
func (s *Service) HandleEvent(ctx context.Context, tripID string, event fsm.Event) error {
	t, err := s.repo.GetByID(ctx, tripID)
	if err != nil {
		return fmt.Errorf("loading trip: %w", err)
	}

	oldState := t.FSMState
	newState, err := s.engine.Fire(ctx, t, t.FSMState, event)
	if err != nil {
		return fmt.Errorf("firing event %s on trip %s: %w", event, tripID, err)
	}

	t.FSMState = newState
	if newState == trip.StateCompleted {
		t.CompletedAt = time.Now()
		// Reverse geocode end address
		if s.geocoding != nil && t.EndAddress == "" {
			addr, err := s.geocoding.ReverseGeocode(ctx, t.EndLatitude, t.EndLongitude)
			if err == nil {
				t.EndAddress = addr.FormattedAddress
			}
		}
	}

	if err := s.repo.Save(ctx, t); err != nil {
		return fmt.Errorf("saving trip after transition: %w", err)
	}

	return s.fsmHistory.RecordTransition(ctx, repository.FSMTransitionRecord{
		ID:        fmt.Sprintf("%s-%d", tripID, time.Now().UnixNano()),
		EntityID:  tripID,
		FSMName:   "trip",
		FromState: oldState,
		Event:     event,
		ToState:   newState,
		CreatedAt: time.Now(),
	})
}
