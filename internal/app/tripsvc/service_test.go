package tripsvc

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

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

func (m *mockTripRepo) ListByDateRange(_ context.Context, vehicleID string, from, to time.Time) ([]trip.Trip, error) {
	var result []trip.Trip
	for _, t := range m.trips {
		if t.VehicleID == vehicleID && !t.StartedAt.Before(from) && !t.StartedAt.After(to) {
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

// mockGeocodingProvider implements external.GeocodingProvider for testing.
type mockGeocodingProvider struct {
	addr *external.Address
	err  error
}

func (m *mockGeocodingProvider) ReverseGeocode(_ context.Context, _, _ float64) (*external.Address, error) {
	return m.addr, m.err
}

func (m *mockGeocodingProvider) Name() string { return "mock" }

func TestService_Create(t *testing.T) {
	repo := newMockTripRepo()
	geo := &mockGeocodingProvider{
		addr: &external.Address{FormattedAddress: "123 Main St, San Francisco, CA"},
	}
	svc := New(repo, &mockFSMHistory{}, geo)

	tr := &trip.Trip{
		ID:             "t1",
		VehicleID:      "v1",
		StartLatitude:  37.7749,
		StartLongitude: -122.4194,
		DistanceMiles:  10.5,
		EnergyUsedKWh: 3.2,
	}
	err := svc.Create(context.Background(), tr)
	if err != nil {
		t.Fatalf("Create() error: %v", err)
	}

	got, err := svc.GetByID(context.Background(), "t1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.FSMState != trip.StateStarted {
		t.Errorf("expected FSMState 'started', got %q", got.FSMState)
	}
	if got.StartAddress != "123 Main St, San Francisco, CA" {
		t.Errorf("expected geocoded start address, got %q", got.StartAddress)
	}
}

func TestService_Create_ValidationError(t *testing.T) {
	svc := New(newMockTripRepo(), &mockFSMHistory{}, nil)

	// Missing VehicleID should fail validation
	tr := &trip.Trip{ID: "t1", DistanceMiles: 5.0}
	err := svc.Create(context.Background(), tr)
	if err == nil {
		t.Error("expected validation error for missing VehicleID")
	}
}

func TestService_GetByID(t *testing.T) {
	repo := newMockTripRepo()
	svc := New(repo, &mockFSMHistory{}, nil)

	tr := &trip.Trip{
		ID:            "t1",
		VehicleID:     "v1",
		DistanceMiles: 5.0,
	}
	_ = svc.Create(context.Background(), tr)

	got, err := svc.GetByID(context.Background(), "t1")
	if err != nil {
		t.Fatalf("GetByID() error: %v", err)
	}
	if got.ID != "t1" {
		t.Errorf("expected ID 't1', got %q", got.ID)
	}
}

func TestService_GetByID_NotFound(t *testing.T) {
	svc := New(newMockTripRepo(), &mockFSMHistory{}, nil)

	_, err := svc.GetByID(context.Background(), "nonexistent")
	if err == nil {
		t.Error("expected error for non-existent trip")
	}
}

func TestService_HandleEvent(t *testing.T) {
	repo := newMockTripRepo()
	history := &mockFSMHistory{}
	svc := New(repo, history, nil)

	tr := &trip.Trip{
		ID:            "t1",
		VehicleID:     "v1",
		DistanceMiles: 10.0,
		FSMState:      trip.StateStarted,
	}
	_ = repo.Save(context.Background(), tr)

	// Fire begin event: started -> in_progress
	err := svc.HandleEvent(context.Background(), "t1", trip.EventBegin)
	if err != nil {
		t.Fatalf("HandleEvent(begin) error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "t1")
	if got.FSMState != trip.StateInProgress {
		t.Errorf("expected state 'in_progress', got %q", got.FSMState)
	}

	if len(history.records) != 1 {
		t.Errorf("expected 1 transition record, got %d", len(history.records))
	}
}

func TestService_HandleEvent_InvalidTransition(t *testing.T) {
	repo := newMockTripRepo()
	svc := New(repo, &mockFSMHistory{}, nil)

	tr := &trip.Trip{
		ID:            "t1",
		VehicleID:     "v1",
		DistanceMiles: 10.0,
		FSMState:      trip.StateStarted,
	}
	_ = repo.Save(context.Background(), tr)

	// resume is not valid from started state
	err := svc.HandleEvent(context.Background(), "t1", trip.EventResume)
	if err == nil {
		t.Error("expected error for invalid transition")
	}
}

func TestService_HandleEvent_CompleteWithGeocode(t *testing.T) {
	repo := newMockTripRepo()
	history := &mockFSMHistory{}
	geo := &mockGeocodingProvider{
		addr: &external.Address{FormattedAddress: "456 Oak Ave, Palo Alto, CA"},
	}
	svc := New(repo, history, geo)

	tr := &trip.Trip{
		ID:           "t1",
		VehicleID:    "v1",
		EndLatitude:  37.4419,
		EndLongitude: -122.1430,
		FSMState:     trip.StateInProgress,
	}
	_ = repo.Save(context.Background(), tr)

	// in_progress -> completed
	err := svc.HandleEvent(context.Background(), "t1", trip.EventComplete)
	if err != nil {
		t.Fatalf("HandleEvent(complete) error: %v", err)
	}

	got, _ := repo.GetByID(context.Background(), "t1")
	if got.FSMState != trip.StateCompleted {
		t.Errorf("expected state 'completed', got %q", got.FSMState)
	}
	if got.EndAddress != "456 Oak Ave, Palo Alto, CA" {
		t.Errorf("expected geocoded end address, got %q", got.EndAddress)
	}
	if got.CompletedAt.IsZero() {
		t.Error("expected CompletedAt to be set")
	}
}
