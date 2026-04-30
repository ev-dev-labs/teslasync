package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// AnalyticsHandler handles fleet analytics HTTP requests.
type AnalyticsHandler struct {
	vehicleRepo     *database.VehicleRepo
	driveRepo       *database.DriveRepo
	chargingRepo    *database.ChargingRepo
	positionRepo    *database.PositionRepo
	db              *database.DB
	signalLogReader *database.SignalLogReader
}

func NewAnalyticsHandler(db *database.DB, slr *database.SignalLogReader) *AnalyticsHandler {
	return &AnalyticsHandler{
		vehicleRepo:     database.NewVehicleRepo(db),
		driveRepo:       database.NewDriveRepo(db),
		chargingRepo:    database.NewChargingRepo(db),
		positionRepo:    database.NewPositionRepo(db),
		db:              db,
		signalLogReader: slr,
	}
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
