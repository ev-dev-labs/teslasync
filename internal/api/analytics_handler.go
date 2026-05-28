package api

import (
	"context"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// vehicleListFetcher abstracts *database.VehicleRepo.GetAll so analytics
// handler tests can inject a fake fleet roster without standing up a
// Postgres pool. The Fleet endpoint walks the entire vehicle list to
// compute per-vehicle drive / charge / battery rollups, so this is the
// single most important seam for unit-testing it.
type vehicleListFetcher interface {
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
}

// driveByVehicleFetcher abstracts *database.DriveRepo.GetByVehicle so
// analytics handler tests can avoid a real driveRepo.
type driveByVehicleFetcher interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*drivemodel.Drive, error)
}

// chargingByVehicleFetcher abstracts *chargingdb.ChargingRepo.GetByVehicle so
// analytics handler tests can avoid a real chargingRepo.
type chargingByVehicleFetcher interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*chargingmodel.ChargingSession, error)
}

// AnalyticsHandler handles fleet analytics HTTP requests.
//
// Phase-39 migration: the legacy *database.SignalLogReader (raw pivot +
// snapshot helpers) has been replaced with the canonical
// signal.StateReader for the per-vehicle current-battery snapshot the
// Fleet endpoint folds into the fleet battery_trend response. The
// underlying repo dependencies are typed as small fetcher interfaces so
// the migrated handler is unit-testable without a real Postgres pool.
// See ADR-002.
type AnalyticsHandler struct {
	vehicleRepo  vehicleListFetcher
	driveRepo    driveByVehicleFetcher
	chargingRepo chargingByVehicleFetcher
	positionRepo *database.PositionRepo
	db           *database.DB
	state        signal.StateReader
}

func NewAnalyticsHandler(db *database.DB, state signal.StateReader) *AnalyticsHandler {
	return &AnalyticsHandler{
		vehicleRepo:  database.NewVehicleRepo(db),
		driveRepo:    database.NewDriveRepo(db),
		chargingRepo: chargingdb.NewChargingRepo(db),
		positionRepo: database.NewPositionRepo(db),
		db:           db,
		state:        state,
	}
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
