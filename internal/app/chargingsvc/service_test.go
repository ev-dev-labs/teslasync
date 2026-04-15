package chargingsvc

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

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

func (m *mockChargingRepo) ListByDateRange(_ context.Context, vehicleID string, from, to time.Time) ([]charging.ChargingSession, error) {
	var result []charging.ChargingSession
	for _, s := range m.sessions {
		if s.VehicleID == vehicleID && !s.StartedAt.Before(from) && !s.StartedAt.After(to) {
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

func TestService_Create(t *testing.T) {
	repo := newMockChargingRepo()
	svc := New(repo, &mockFSMHistory{})

	s := &charging.ChargingSession{
		ID:                "cs1",
		VehicleID:         "v1",
		ChargerType:       "supercharger",
		StartBatteryLevel: 20,
	}
	err := svc.Create(context.Background(), s)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	got, err := svc.GetByID(context.Background(), "cs1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.FSMState != charging.StatePending {
		t.Errorf("expected FSMState 'pending', got %q", got.FSMState)
	}
	if got.VehicleID != "v1" {
		t.Errorf("expected VehicleID 'v1', got %q", got.VehicleID)
	}
}

func TestService_Create_ValidationError(t *testing.T) {
	svc := New(newMockChargingRepo(), &mockFSMHistory{})

	// Missing VehicleID should fail validation
	s := &charging.ChargingSession{ID: "cs1", ChargerType: "ac"}
	err := svc.Create(context.Background(), s)
	if err == nil {
		t.Error("expected validation error for missing VehicleID")
	}
}

func TestService_GetByID_NotFound(t *testing.T) {
	svc := New(newMockChargingRepo(), &mockFSMHistory{})

	_, err := svc.GetByID(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent session")
	}
}

func TestService_GetByVehicleID(t *testing.T) {
	repo := newMockChargingRepo()
	svc := New(repo, &mockFSMHistory{})

	for i := 0; i < 3; i++ {
		s := &charging.ChargingSession{
			ID:                fmt.Sprintf("cs%d", i),
			VehicleID:         "v1",
			ChargerType:       "ac",
			StartBatteryLevel: 20,
		}
		_ = svc.Create(context.Background(), s)
	}

	sessions, err := svc.GetByVehicleID(context.Background(), "v1")
	if err != nil {
		t.Fatalf("GetByVehicleID() error: %v", err)
	}
	if len(sessions) != 3 {
		t.Errorf("expected 3 sessions, got %d", len(sessions))
	}
}

func TestService_HandleEvent(t *testing.T) {
	repo := newMockChargingRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history)

	s := &charging.ChargingSession{
		ID:                "cs1",
		VehicleID:         "v1",
		ChargerType:       "supercharger",
		StartBatteryLevel: 20,
		FSMState:          charging.StatePending,
	}
	_ = repo.Save(context.Background(), s)

	// Fire connect event: pending -> connecting
	err := svc.HandleEvent(context.Background(), "cs1", charging.EventConnect)
	if err != nil {
		t.Fatalf("HandleEvent(connect) error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "cs1")
	if got.FSMState != charging.StateConnecting {
		t.Errorf("expected state 'connecting', got %q", got.FSMState)
	}

	if len(history.records) != 1 {
		t.Errorf("expected 1 transition record, got %d", len(history.records))
	}
}

func TestService_HandleEvent_InvalidTransition(t *testing.T) {
	repo := newMockChargingRepo()
	svc := New(repo, &mockFSMHistory{})

	s := &charging.ChargingSession{
		ID:                "cs1",
		VehicleID:         "v1",
		StartBatteryLevel: 20,
		FSMState:          charging.StatePending,
	}
	_ = repo.Save(context.Background(), s)

	// complete is not valid from pending state
	err := svc.HandleEvent(context.Background(), "cs1", charging.EventComplete)
	if err == nil {
		t.Error("expected error for invalid transition")
	}
}

func TestService_HandleEvent_FullFlow(t *testing.T) {
	repo := newMockChargingRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history)

	s := &charging.ChargingSession{
		ID:                "cs1",
		VehicleID:         "v1",
		ChargerType:       "supercharger",
		StartBatteryLevel: 20,
		ChargerConnected:  true,
		FSMState:          charging.StatePending,
	}
	_ = repo.Save(context.Background(), s)

	// pending -> connecting
	if err := svc.HandleEvent(context.Background(), "cs1", charging.EventConnect); err != nil {
		t.Fatalf("connect error: %v", err)
	}

	// connecting -> charging (guard requires ChargerConnected && StartBatteryLevel < 100)
	if err := svc.HandleEvent(context.Background(), "cs1", charging.EventStartCharge); err != nil {
		t.Fatalf("start_charge error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "cs1")
	if got.FSMState != charging.StateCharging {
		t.Errorf("expected state 'charging', got %q", got.FSMState)
	}

	if len(history.records) != 2 {
		t.Errorf("expected 2 transition records, got %d", len(history.records))
	}
}
