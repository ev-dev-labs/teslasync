package vehiclesvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
	"testing"
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

// mockFSMHistory implements repository.FSMHistoryRepository for testing.
type mockFSMHistory struct {
	records []repository.FSMTransitionRecord
}

func (m *mockFSMHistory) RecordTransition(_ context.Context, r repository.FSMTransitionRecord) error {
	m.records = append(m.records, r)
	return nil
}

func (m *mockFSMHistory) GetHistory(_ context.Context, _ string, _ int) ([]repository.FSMTransitionRecord, error) {
	return m.records, nil
}

func (m *mockFSMHistory) GetByEntityID(_ context.Context, entityID string) ([]repository.FSMTransitionRecord, error) {
	var result []repository.FSMTransitionRecord
	for _, r := range m.records {
		if r.EntityID == entityID {
			result = append(result, r)
		}
	}
	return result, nil
}

// mockTeslaClient implements external.TeslaClient for testing.
type mockTeslaClient struct {
	state *external.VehicleState
	err   error
}

func (m *mockTeslaClient) GetVehicleState(_ context.Context, _ string) (*external.VehicleState, error) {
	return m.state, m.err
}

func (m *mockTeslaClient) GetVehicleData(_ context.Context, _ string) (map[string]interface{}, error) {
	return nil, nil
}

func (m *mockTeslaClient) WakeUp(_ context.Context, _ string) error { return nil }

func (m *mockTeslaClient) SendCommand(_ context.Context, _ string, _ string, _ map[string]interface{}) error {
	return nil
}

func (m *mockTeslaClient) RefreshToken(_ context.Context, _ string) (*external.TokenPair, error) {
	return nil, nil
}

func (m *mockTeslaClient) RevokeToken(_ context.Context, _ string) error { return nil }

func TestService_Create(t *testing.T) {
	repo := newMockVehicleRepo()
	svc := New(repo, &mockFSMHistory{}, &mockTeslaClient{})

	v := &vehicle.Vehicle{
		ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF123456",
		DisplayName: "My Tesla", Year: 2020,
	}
	err := svc.Create(context.Background(), v)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	got, err := svc.GetByID(context.Background(), "v1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.FSMState != vehicle.StateUnknown {
		t.Errorf("expected FSMState 'unknown', got %q", got.FSMState)
	}
	if got.Model != "Model 3" {
		t.Errorf("expected Model 'Model 3', got %q", got.Model)
	}
}

func TestService_Create_ValidationError(t *testing.T) {
	svc := New(newMockVehicleRepo(), &mockFSMHistory{}, &mockTeslaClient{})

	v := &vehicle.Vehicle{ID: "v1", VIN: "short", DisplayName: "Test", Year: 2020}
	err := svc.Create(context.Background(), v)
	if err == nil {
		t.Error("expected validation error")
	}
}

func TestService_HandleEvent(t *testing.T) {
	repo := newMockVehicleRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history, &mockTeslaClient{})

	v := &vehicle.Vehicle{
		ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF123456",
		DisplayName: "Test", Year: 2020, FSMState: vehicle.StateUnknown,
	}
	_ = repo.Save(context.Background(), v)

	// Fire come_online event
	err := svc.HandleEvent(context.Background(), "v1", vehicle.EventComeOnline)
	if err != nil {
		t.Fatalf("HandleEvent() error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "v1")
	if got.FSMState != vehicle.StateOnline {
		t.Errorf("expected state 'online', got %q", got.FSMState)
	}

	if len(history.records) != 1 {
		t.Errorf("expected 1 transition record, got %d", len(history.records))
	}
}

func TestService_Refresh(t *testing.T) {
	repo := newMockVehicleRepo()
	tesla := &mockTeslaClient{
		state: &external.VehicleState{
			BatteryLevel:  85,
			BatteryRange:  250.5,
			OdometerMiles: 15000.0,
			Latitude:      37.7749,
			Longitude:     -122.4194,
		},
	}
	svc := New(repo, &mockFSMHistory{}, tesla)

	v := &vehicle.Vehicle{
		ID: "v1", UserID: "u1", VIN: "5YJ3E1EA7KF123456",
		DisplayName: "Test", Year: 2020, CreatedAt: time.Now(),
	}
	_ = repo.Save(context.Background(), v)

	err := svc.Refresh(context.Background(), "v1")
	if err != nil {
		t.Fatalf("Refresh() error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "v1")
	if got.BatteryLevel != 85 {
		t.Errorf("expected battery 85, got %d", got.BatteryLevel)
	}
	if got.OdometerMiles != 15000.0 {
		t.Errorf("expected odometer 15000, got %f", got.OdometerMiles)
	}
}

func TestService_HandleEvent_InvalidTransition(t *testing.T) {
	repo := newMockVehicleRepo()
	svc := New(repo, &mockFSMHistory{}, &mockTeslaClient{})

	v := &vehicle.Vehicle{
		ID: "v1", VIN: "5YJ3E1EA7KF123456", DisplayName: "Test",
		Year: 2020, FSMState: vehicle.StateUnknown,
	}
	_ = repo.Save(context.Background(), v)

	err := svc.HandleEvent(context.Background(), "v1", vehicle.EventSleep)
	if err == nil {
		t.Error("expected error for invalid transition")
	}
}
