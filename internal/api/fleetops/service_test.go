package fleetops

import (
	"context"
	"errors"
	"testing"
	"time"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

type serviceStoreFake struct {
	Store
	currentReservation *models.FleetReservation
	reservationUpdate  *models.FleetReservation
	createErr          error
}

func (f *serviceStoreFake) GetReservation(context.Context, int64) (*models.FleetReservation, error) {
	return f.currentReservation, nil
}

func (f *serviceStoreFake) UpdateReservation(_ context.Context, item *models.FleetReservation) error {
	copy := *item
	f.reservationUpdate = &copy
	return nil
}

func (f *serviceStoreFake) CreateReservation(context.Context, *models.FleetReservation) error {
	return f.createErr
}

func validReservation() *models.FleetReservation {
	start := time.Date(2026, 8, 6, 10, 0, 0, 0, time.UTC)
	return &models.FleetReservation{
		ID: 4, VehicleID: 1, Title: "Client visit", StartsAt: start,
		EndsAt: start.Add(time.Hour), Status: "confirmed", Version: 2,
	}
}

func TestUpdateReservationRejectsTerminalLifecycle(t *testing.T) {
	store := &serviceStoreFake{
		currentReservation: &models.FleetReservation{ID: 4, Status: "completed"},
	}
	service := NewService(store)
	err := service.UpdateReservation(context.Background(), validReservation())
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("err=%v, want validation error", err)
	}
	if store.reservationUpdate != nil {
		t.Fatal("repository update called for forbidden terminal transition")
	}
}

func TestUpdateReservationAllowsConfirmedToCompleted(t *testing.T) {
	store := &serviceStoreFake{
		currentReservation: &models.FleetReservation{ID: 4, Status: "confirmed"},
	}
	service := NewService(store)
	item := validReservation()
	item.Status = "completed"
	if err := service.UpdateReservation(context.Background(), item); err != nil {
		t.Fatalf("UpdateReservation: %v", err)
	}
	if store.reservationUpdate == nil || store.reservationUpdate.Status != "completed" {
		t.Fatalf("update=%+v, want completed", store.reservationUpdate)
	}
}

func TestCreateReservationPreservesRepositoryConflict(t *testing.T) {
	store := &serviceStoreFake{createErr: dbfleetops.ErrConflict}
	service := NewService(store)
	err := service.CreateReservation(context.Background(), validReservation())
	if !errors.Is(err, dbfleetops.ErrConflict) {
		t.Fatalf("err=%v, want conflict", err)
	}
}
