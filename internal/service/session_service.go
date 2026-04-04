package service

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// SessionService manages drive and charge session lifecycle from the
// worker's API-polling path. It owns the active-session maps so the
// worker no longer needs to track them directly.
type SessionService struct {
	driveRepo  *database.DriveRepo
	chargeRepo *database.ChargingRepo
	eventBus   *events.Bus

	mu            sync.Mutex
	activeDrives  map[int64]int64 // vehicleID → driveID
	activeCharges map[int64]int64 // vehicleID → chargingSessionID
}

// NewSessionService creates a SessionService.
func NewSessionService(db *database.DB, eventBus *events.Bus) *SessionService {
	return &SessionService{
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		eventBus:      eventBus,
		activeDrives:  make(map[int64]int64),
		activeCharges: make(map[int64]int64),
	}
}

// TrackDriveFromAPI evaluates a polled VehicleDataResponse and starts or
// ends a drive session as appropriate. This is the worker (API-polling) path.
func (s *SessionService) TrackDriveFromAPI(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isDriving := data.DriveState.Speed != nil && *data.DriveState.Speed > 0

	s.mu.Lock()
	activeDriveID, hasActiveDrive := s.activeDrives[vehicle.ID]
	s.mu.Unlock()

	if isDriving && !hasActiveDrive {
		// Start new drive
		drive := &models.Drive{
			VehicleID:       vehicle.ID,
			StartDate:       time.Now().UTC(),
			StartBatteryLvl: &data.ChargeState.BatteryLevel,
		}
		range_ := data.ChargeState.BatteryRange
		drive.StartRangeKm = &range_

		if err := s.driveRepo.Create(ctx, drive); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicle.ID).Msg("failed to create drive")
			return
		}
		s.mu.Lock()
		s.activeDrives[vehicle.ID] = drive.ID
		s.mu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", drive.ID).Msg("drive started")
		if s.eventBus != nil {
			s.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	} else if !isDriving && hasActiveDrive {
		// End drive
		endRange := data.ChargeState.BatteryRange
		endBattery := data.ChargeState.BatteryLevel
		if err := s.driveRepo.Complete(ctx, activeDriveID, time.Now().UTC(),
			nil, nil, 0, 0, &endRange, &endBattery, nil, nil, nil, nil, nil); err != nil {
			log.Error().Err(err).Int64("driveID", activeDriveID).Msg("failed to complete drive")
		}
		s.mu.Lock()
		delete(s.activeDrives, vehicle.ID)
		s.mu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", activeDriveID).Msg("drive ended")
		if s.eventBus != nil {
			s.eventBus.Publish(events.Event{Type: events.DriveEnded, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"drive_id": activeDriveID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	}
}

// TrackChargeFromAPI evaluates a polled VehicleDataResponse and starts or
// ends a charging session as appropriate. This is the worker (API-polling) path.
func (s *SessionService) TrackChargeFromAPI(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isCharging := data.ChargeState.ChargingState == "Charging"

	s.mu.Lock()
	activeChargeID, hasActiveCharge := s.activeCharges[vehicle.ID]
	s.mu.Unlock()

	if isCharging && !hasActiveCharge {
		session := &models.ChargingSession{
			VehicleID:         vehicle.ID,
			StartDate:         time.Now().UTC(),
			StartBatteryLevel: data.ChargeState.BatteryLevel,
		}
		range_ := data.ChargeState.BatteryRange
		session.StartRangeKm = &range_

		if err := s.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicle.ID).Msg("failed to create charging session")
			return
		}
		s.mu.Lock()
		s.activeCharges[vehicle.ID] = session.ID
		s.mu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", session.ID).Msg("charging started")
		if s.eventBus != nil {
			s.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"session_id": session.ID, "battery_level": data.ChargeState.BatteryLevel}})
		}
	} else if !isCharging && hasActiveCharge {
		endBattery := data.ChargeState.BatteryLevel
		endRange := data.ChargeState.BatteryRange
		power := data.ChargeState.ChargerPower
		voltage := data.ChargeState.ChargerVoltage
		current := data.ChargeState.ChargerActualCurrent

		if err := s.chargeRepo.Complete(ctx, activeChargeID, time.Now().UTC(),
			data.ChargeState.ChargeEnergyAdded, nil, &endBattery, &endRange,
			data.ChargeState.ChargerPhases, &voltage, &current, &power,
			nil, nil, nil, nil, 0); err != nil {
			log.Error().Err(err).Int64("sessionID", activeChargeID).Msg("failed to complete charging session")
		}
		s.mu.Lock()
		delete(s.activeCharges, vehicle.ID)
		s.mu.Unlock()
		log.Info().Int64("vehicleID", vehicle.ID).Int64("sessionID", activeChargeID).Msg("charging ended")
		if s.eventBus != nil {
			s.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicle.ID, VIN: vehicle.VIN, Data: map[string]interface{}{"session_id": activeChargeID, "battery_level": data.ChargeState.BatteryLevel, "energy_added": data.ChargeState.ChargeEnergyAdded}})
		}
	}
}
