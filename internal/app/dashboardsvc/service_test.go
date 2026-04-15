package dashboardsvc

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
)

// mockVehicleRepo implements repository.VehicleRepository for testing.
type mockVehicleRepo struct {
	vehicles map[string]*vehicle.Vehicle
}

func newMockVehicleRepo() *mockVehicleRepo {
	return &mockVehicleRepo{vehicles: make(map[string]*vehicle.Vehicle)}
}

func (m *mockVehicleRepo) GetByID(_ context.Context, id string) (*vehicle.Vehicle, error) {
	v, ok := m.vehicles[id]
	if !ok {
		return nil, fmt.Errorf("vehicle %s: not found", id)
	}
	cp := *v
	return &cp, nil
}

func (m *mockVehicleRepo) GetByVIN(_ context.Context, vin string) (*vehicle.Vehicle, error) {
	for _, v := range m.vehicles {
		if v.VIN == vin {
			cp := *v
			return &cp, nil
		}
	}
	return nil, fmt.Errorf("vehicle vin %s: not found", vin)
}

func (m *mockVehicleRepo) GetByUserID(_ context.Context, userID string) ([]vehicle.Vehicle, error) {
	var result []vehicle.Vehicle
	for _, v := range m.vehicles {
		if v.UserID == userID {
			result = append(result, *v)
		}
	}
	return result, nil
}

func (m *mockVehicleRepo) GetByIDForUpdate(ctx context.Context, id string) (*vehicle.Vehicle, error) {
	return m.GetByID(ctx, id)
}

func (m *mockVehicleRepo) Save(_ context.Context, v *vehicle.Vehicle) error {
	cp := *v
	m.vehicles[v.ID] = &cp
	return nil
}

func (m *mockVehicleRepo) Delete(_ context.Context, id string) error {
	delete(m.vehicles, id)
	return nil
}

// mockChargingRepo implements repository.ChargingSessionRepository for testing.
type mockChargingRepo struct {
	sessions map[string]*charging.ChargingSession
}

func newMockChargingRepo() *mockChargingRepo {
	return &mockChargingRepo{sessions: make(map[string]*charging.ChargingSession)}
}

func (m *mockChargingRepo) GetByID(_ context.Context, id string) (*charging.ChargingSession, error) {
	s, ok := m.sessions[id]
	if !ok {
		return nil, fmt.Errorf("charging session %s: not found", id)
	}
	cp := *s
	return &cp, nil
}

func (m *mockChargingRepo) GetByVehicleID(_ context.Context, vehicleID string) ([]charging.ChargingSession, error) {
	var result []charging.ChargingSession
	for _, s := range m.sessions {
		if s.VehicleID == vehicleID {
			result = append(result, *s)
		}
	}
	return result, nil
}

func (m *mockChargingRepo) ListByDateRange(_ context.Context, vehicleID string, _, _ time.Time) ([]charging.ChargingSession, error) {
	var result []charging.ChargingSession
	for _, s := range m.sessions {
		if s.VehicleID == vehicleID {
			result = append(result, *s)
		}
	}
	return result, nil
}

func (m *mockChargingRepo) Save(_ context.Context, s *charging.ChargingSession) error {
	cp := *s
	m.sessions[s.ID] = &cp
	return nil
}

func (m *mockChargingRepo) GetByIDForUpdate(ctx context.Context, id string) (*charging.ChargingSession, error) {
	return m.GetByID(ctx, id)
}

// mockTripRepo implements repository.TripRepository for testing.
type mockTripRepo struct {
	trips map[string]*trip.Trip
}

func newMockTripRepo() *mockTripRepo {
	return &mockTripRepo{trips: make(map[string]*trip.Trip)}
}

func (m *mockTripRepo) GetByID(_ context.Context, id string) (*trip.Trip, error) {
	t, ok := m.trips[id]
	if !ok {
		return nil, fmt.Errorf("trip %s: not found", id)
	}
	cp := *t
	return &cp, nil
}

func (m *mockTripRepo) GetByVehicleID(_ context.Context, vehicleID string) ([]trip.Trip, error) {
	var result []trip.Trip
	for _, t := range m.trips {
		if t.VehicleID == vehicleID {
			result = append(result, *t)
		}
	}
	return result, nil
}

func (m *mockTripRepo) ListByDateRange(_ context.Context, vehicleID string, _, _ time.Time) ([]trip.Trip, error) {
	var result []trip.Trip
	for _, t := range m.trips {
		if t.VehicleID == vehicleID {
			result = append(result, *t)
		}
	}
	return result, nil
}

func (m *mockTripRepo) Save(_ context.Context, t *trip.Trip) error {
	cp := *t
	m.trips[t.ID] = &cp
	return nil
}

func (m *mockTripRepo) GetByIDForUpdate(ctx context.Context, id string) (*trip.Trip, error) {
	return m.GetByID(ctx, id)
}

func TestService_GetStats(t *testing.T) {
	vehicleRepo := newMockVehicleRepo()
	chargingRepo := newMockChargingRepo()
	tripRepo := newMockTripRepo()
	svc := New(vehicleRepo, chargingRepo, tripRepo)

	// Add a vehicle
	_ = vehicleRepo.Save(context.Background(), &vehicle.Vehicle{
		ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF123456",
	})

	// Add trips
	_ = tripRepo.Save(context.Background(), &trip.Trip{
		ID: "t1", VehicleID: "v1", DistanceMiles: 50.0, EnergyUsedKWh: 15.0,
		StartedAt: time.Now(),
	})
	_ = tripRepo.Save(context.Background(), &trip.Trip{
		ID: "t2", VehicleID: "v1", DistanceMiles: 30.0, EnergyUsedKWh: 9.0,
		StartedAt: time.Now(),
	})

	// Add charging sessions
	_ = chargingRepo.Save(context.Background(), &charging.ChargingSession{
		ID: "cs1", VehicleID: "v1", CostCents: 1500,
		StartedAt: time.Now(),
	})

	stats, err := svc.GetStats(context.Background(), "u1")
	if err != nil {
		t.Fatalf("GetStats() error: %v", err)
	}

	if stats.TotalVehicles != 1 {
		t.Errorf("expected 1 vehicle, got %d", stats.TotalVehicles)
	}
	if stats.TotalTrips != 2 {
		t.Errorf("expected 2 trips, got %d", stats.TotalTrips)
	}
	if stats.TotalMiles != 80.0 {
		t.Errorf("expected 80.0 miles, got %f", stats.TotalMiles)
	}
	if stats.TotalEnergyKWh != 24.0 {
		t.Errorf("expected 24.0 kWh, got %f", stats.TotalEnergyKWh)
	}
	if stats.TotalChargingSessions != 1 {
		t.Errorf("expected 1 charging session, got %d", stats.TotalChargingSessions)
	}
	if stats.TotalCostCents != 1500 {
		t.Errorf("expected 1500 cost cents, got %d", stats.TotalCostCents)
	}
	// AvgEfficiency = (24.0 * 1000) / 80.0 = 300
	if stats.AvgEfficiency != 300.0 {
		t.Errorf("expected avg efficiency 300.0, got %f", stats.AvgEfficiency)
	}
}

func TestService_GetStats_NoVehicles(t *testing.T) {
	svc := New(newMockVehicleRepo(), newMockChargingRepo(), newMockTripRepo())

	stats, err := svc.GetStats(context.Background(), "u1")
	if err != nil {
		t.Fatalf("GetStats() error: %v", err)
	}
	if stats.TotalVehicles != 0 {
		t.Errorf("expected 0 vehicles, got %d", stats.TotalVehicles)
	}
	if stats.TotalTrips != 0 {
		t.Errorf("expected 0 trips, got %d", stats.TotalTrips)
	}
	if stats.AvgEfficiency != 0 {
		t.Errorf("expected 0 avg efficiency, got %f", stats.AvgEfficiency)
	}
}

func TestService_GetStats_MultipleVehicles(t *testing.T) {
	vehicleRepo := newMockVehicleRepo()
	chargingRepo := newMockChargingRepo()
	tripRepo := newMockTripRepo()
	svc := New(vehicleRepo, chargingRepo, tripRepo)

	_ = vehicleRepo.Save(context.Background(), &vehicle.Vehicle{
		ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF000001",
	})
	_ = vehicleRepo.Save(context.Background(), &vehicle.Vehicle{
		ID: "v2", UserID: "u1", VIN: "5YJ3E1EA7KF000002",
	})

	_ = tripRepo.Save(context.Background(), &trip.Trip{
		ID: "t1", VehicleID: "v1", DistanceMiles: 100.0, EnergyUsedKWh: 30.0,
		StartedAt: time.Now(),
	})
	_ = tripRepo.Save(context.Background(), &trip.Trip{
		ID: "t2", VehicleID: "v2", DistanceMiles: 50.0, EnergyUsedKWh: 15.0,
		StartedAt: time.Now(),
	})

	_ = chargingRepo.Save(context.Background(), &charging.ChargingSession{
		ID: "cs1", VehicleID: "v1", CostCents: 2000, StartedAt: time.Now(),
	})
	_ = chargingRepo.Save(context.Background(), &charging.ChargingSession{
		ID: "cs2", VehicleID: "v2", CostCents: 1000, StartedAt: time.Now(),
	})

	stats, err := svc.GetStats(context.Background(), "u1")
	if err != nil {
		t.Fatalf("GetStats() error: %v", err)
	}

	if stats.TotalVehicles != 2 {
		t.Errorf("expected 2 vehicles, got %d", stats.TotalVehicles)
	}
	if stats.TotalTrips != 2 {
		t.Errorf("expected 2 trips, got %d", stats.TotalTrips)
	}
	if stats.TotalMiles != 150.0 {
		t.Errorf("expected 150.0 miles, got %f", stats.TotalMiles)
	}
	if stats.TotalChargingSessions != 2 {
		t.Errorf("expected 2 charging sessions, got %d", stats.TotalChargingSessions)
	}
	if stats.TotalCostCents != 3000 {
		t.Errorf("expected 3000 cost cents, got %d", stats.TotalCostCents)
	}
}
