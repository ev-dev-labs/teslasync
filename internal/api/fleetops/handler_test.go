package fleetops

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
	"github.com/go-chi/chi/v5"
)

type handlerServiceFake struct {
	fleetOpsService
	createReservationErr error
	createCalls          int
	driverFilter         dbfleetops.DriverFilter
}

func (f *handlerServiceFake) CreateReservation(context.Context, *models.FleetReservation) error {
	f.createCalls++
	return f.createReservationErr
}

func (f *handlerServiceFake) ListDrivers(_ context.Context, filter dbfleetops.DriverFilter) (*models.FleetPage[models.FleetDriver], error) {
	f.driverFilter = filter
	return &models.FleetPage[models.FleetDriver]{
		Items: []models.FleetDriver{}, Total: 0, Limit: filter.Limit, Offset: filter.Offset,
	}, nil
}

func testRouter(service fleetOpsService) http.Handler {
	r := chi.NewRouter()
	MountRoutes(r, newHandler(service))
	return r
}

func TestCreateReservationValidatesRequiredFieldsAtHandler(t *testing.T) {
	service := &handlerServiceFake{}
	req := httptest.NewRequest(http.MethodPost, "/fleet-ops/reservations",
		strings.NewReader(`{"vehicle_id":1,"title":"","starts_at":"2026-08-06T10:00:00Z","ends_at":"2026-08-06T11:00:00Z"}`))
	rec := httptest.NewRecorder()
	testRouter(service).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, want 400", rec.Code, rec.Body.String())
	}
	if service.createCalls != 0 {
		t.Fatal("service called despite handler-level validation failure")
	}
}

func TestCreateReservationMapsConflictTo409(t *testing.T) {
	service := &handlerServiceFake{createReservationErr: dbfleetops.ErrConflict}
	req := httptest.NewRequest(http.MethodPost, "/fleet-ops/reservations",
		strings.NewReader(`{"vehicle_id":1,"title":"Airport","starts_at":"2026-08-06T10:00:00Z","ends_at":"2026-08-06T11:00:00Z"}`))
	rec := httptest.NewRecorder()
	testRouter(service).ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s, want 409", rec.Code, rec.Body.String())
	}
}

func TestListDriversParsesPaginationAndFilter(t *testing.T) {
	service := &handlerServiceFake{}
	req := httptest.NewRequest(http.MethodGet, "/fleet-ops/drivers?status=active&search=pool&limit=25&offset=50", nil)
	rec := httptest.NewRecorder()
	testRouter(service).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s, want 200", rec.Code, rec.Body.String())
	}
	if service.driverFilter.Status != "active" || service.driverFilter.Search != "pool" ||
		service.driverFilter.Limit != 25 || service.driverFilter.Offset != 50 {
		t.Fatalf("filter=%+v", service.driverFilter)
	}
}

func TestListDriversRejectsInvalidStatus(t *testing.T) {
	service := &handlerServiceFake{}
	req := httptest.NewRequest(http.MethodGet, "/fleet-ops/drivers?status=deleted", nil)
	rec := httptest.NewRecorder()
	testRouter(service).ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, want 400", rec.Code, rec.Body.String())
	}
}
