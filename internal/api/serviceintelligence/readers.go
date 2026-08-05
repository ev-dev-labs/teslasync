package serviceintelligence

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbserviceintelligence "github.com/ev-dev-labs/teslasync/internal/database/serviceintelligence"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

type vehicleRepository interface {
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

type softwareRepository interface {
	GetLatestVersion(ctx context.Context, vehicleID int64) (string, error)
}

// DatabaseVehicleReader composes existing typed repositories so the service
// never depends on pgx or table details for vehicle identity and firmware.
type DatabaseVehicleReader struct {
	vehicles vehicleRepository
	software softwareRepository
}

func NewDatabaseVehicleReader(db *database.DB) *DatabaseVehicleReader {
	return &DatabaseVehicleReader{
		vehicles: vehicledb.NewVehicleRepo(db),
		software: systemdb.NewSoftwareUpdateRepo(db),
	}
}

func (r *DatabaseVehicleReader) GetVehicleMetadata(ctx context.Context, vehicleID int64) (*VehicleMetadata, error) {
	vehicle, err := r.vehicles.GetByID(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("read vehicle %d metadata: %w", vehicleID, err)
	}
	if vehicle == nil || !vehicle.IsActive() {
		return nil, nil
	}

	firmware, err := r.software.GetLatestVersion(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("read vehicle %d firmware: %w", vehicleID, err)
	}
	var firmwarePtr *string
	if firmware != "" {
		value := firmware
		firmwarePtr = &value
	}
	return &VehicleMetadata{
		ID:              vehicle.ID,
		VIN:             vehicle.VIN,
		StoredModel:     vehicle.Model,
		FirmwareVersion: firmwarePtr,
	}, nil
}

type observationRepository interface {
	RecentObservations(
		context.Context,
		int64,
		time.Time,
		time.Time,
		int,
	) ([]dbserviceintelligence.Observation, error)
}

// SignalObservationReader adapts the database aggregation to the service port.
type SignalObservationReader struct {
	repo observationRepository
}

func NewSignalObservationReader(db *database.DB) *SignalObservationReader {
	return &SignalObservationReader{repo: dbserviceintelligence.NewObservationRepo(db)}
}

func (r *SignalObservationReader) RecentObservations(
	ctx context.Context,
	vehicleID int64,
	start, end time.Time,
	limit int,
) ([]SignalObservation, error) {
	records, err := r.repo.RecentObservations(ctx, vehicleID, start, end, limit)
	if err != nil {
		return nil, err
	}
	observations := make([]SignalObservation, 0, len(records))
	for _, record := range records {
		observations = append(observations, SignalObservation{
			Signal:      record.Signal,
			Value:       record.Value,
			Baseline:    record.Baseline,
			Deviation:   record.Deviation,
			SampleCount: record.SampleCount,
			ObservedAt:  record.ObservedAt,
		})
	}
	return observations, nil
}

var (
	_ VehicleReader     = (*DatabaseVehicleReader)(nil)
	_ ObservationReader = (*SignalObservationReader)(nil)
)
