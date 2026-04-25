package service

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// apiDriveState tracks comprehensive data during an active drive session
// created via the REST API polling path. Mirrors the streamingDrive struct
// from the Fleet Telemetry path so both produce equivalent drive records.
type apiDriveState struct {
	DriveID   int64
	VehicleID int64
	StartTime time.Time

	// Start values
	StartOdometer   *float64
	StartLatitude   *float64
	StartLongitude  *float64
	StartRatedRange *float64
	StartIdealRange *float64
	StartEstRange   *float64
	StartSoc        *float64

	// Running speed stats
	MaxSpeed   float64
	MinSpeed   float64
	SpeedSum   float64
	SpeedCount int

	// Power stats
	PowerMax float64
	PowerMin float64

	// Range accumulators
	RatedRangeSum, RatedRangeMax, RatedRangeMin float64
	IdealRangeSum, IdealRangeMax, IdealRangeMin float64
	EstRangeSum, EstRangeMax, EstRangeMin       float64
	RangeCount                                  int

	// SOC accumulators
	SocSum, SocMax, SocMin                   float64
	UsableSocSum, UsableSocMax, UsableSocMin float64
	SocCount                                 int

	// Temperature accumulators
	InsideTempSum, OutsideTempSum   float64
	DriverTempSum, PassengerTempSum float64
	TempCount                       int

	// Last known values (updated each poll)
	LastOdometer  *float64
	LastLatitude  *float64
	LastLongitude *float64
}

// SessionService manages drive and charge session lifecycle from the
// worker's API-polling path. It owns the active-session maps so the
// worker no longer needs to track them directly.
type SessionService struct {
	driveRepo  *database.DriveRepo
	chargeRepo *database.ChargingRepo
	tripRepo   *database.TripRepo
	eventBus   *events.Bus

	mu               sync.Mutex
	activeDrives     map[int64]int64          // vehicleID → driveID
	activeDriveState map[int64]*apiDriveState // vehicleID → in-memory accumulator
	activeCharges    map[int64]int64          // vehicleID → chargingSessionID
}

// NewSessionService creates a SessionService.
func NewSessionService(db *database.DB, eventBus *events.Bus) *SessionService {
	return &SessionService{
		driveRepo:        database.NewDriveRepo(db),
		chargeRepo:       database.NewChargingRepo(db),
		tripRepo:         database.NewTripRepo(db),
		eventBus:         eventBus,
		activeDrives:     make(map[int64]int64),
		activeDriveState: make(map[int64]*apiDriveState),
		activeCharges:    make(map[int64]int64),
	}
}

// TrackDriveFromAPI evaluates a polled VehicleDataResponse and starts,
// updates, or ends a drive session. This is the worker (API-polling) path.
func (s *SessionService) TrackDriveFromAPI(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isDriving := data.DriveState.Speed != nil && *data.DriveState.Speed > 0

	s.mu.Lock()
	activeDriveID, hasActiveDrive := s.activeDrives[vehicle.ID]
	activeState := s.activeDriveState[vehicle.ID]
	s.mu.Unlock()

	if isDriving && !hasActiveDrive {
		// === START NEW DRIVE ===
		s.startDrive(ctx, vehicle, data)
	} else if isDriving && hasActiveDrive && activeState != nil {
		// === UPDATE ACTIVE DRIVE (accumulate stats) ===
		s.updateActiveDrive(vehicle, data, activeState)
	} else if !isDriving && hasActiveDrive {
		// === END DRIVE ===
		s.completeDrive(ctx, vehicle, activeDriveID, activeState, data)
	}
}

func (s *SessionService) startDrive(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	now := time.Now().UTC()
	odometer := data.VehicleState.Odometer
	lat := data.DriveState.Latitude
	lon := data.DriveState.Longitude
	batteryLevel := data.ChargeState.BatteryLevel
	ratedRange := data.ChargeState.BatteryRange
	idealRange := data.ChargeState.IdealBatteryRange
	estRange := data.ChargeState.EstBatteryRange
	soc := float64(batteryLevel)
	bl := int16(batteryLevel)

	drive := &models.Drive{
		VehicleID:       vehicle.ID,
		StartTs:         now,
		StartBatteryPct: &bl,
		StartLat:        &lat,
		StartLon:        &lon,
	}

	if err := s.driveRepo.Create(ctx, drive); err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicle.ID).Msg("failed to create drive")
		return
	}

	// Write additional start fields via PartialUpdate
	startFields := map[string]interface{}{
		"start_lat": lat,
		"start_lon": lon,
	}
	if err := s.driveRepo.PartialUpdate(ctx, drive.ID, startFields); err != nil {
		log.Warn().Err(err).Int64("driveID", drive.ID).Msg("failed to write drive start enhanced fields")
	}

	// Initialize the accumulator
	speed := float64(*data.DriveState.Speed)
	power := float64(data.DriveState.Power)
	state := &apiDriveState{
		DriveID:         drive.ID,
		VehicleID:       vehicle.ID,
		StartTime:       now,
		StartOdometer:   &odometer,
		StartLatitude:   &lat,
		StartLongitude:  &lon,
		StartRatedRange: &ratedRange,
		StartIdealRange: &idealRange,
		StartEstRange:   &estRange,
		StartSoc:        &soc,
		MaxSpeed:        speed,
		MinSpeed:        speed,
		SpeedSum:        speed,
		SpeedCount:      1,
		PowerMax:        power,
		PowerMin:        power,
		RatedRangeMax:   ratedRange,
		RatedRangeMin:   ratedRange,
		RatedRangeSum:   ratedRange,
		IdealRangeMax:   idealRange,
		IdealRangeMin:   idealRange,
		IdealRangeSum:   idealRange,
		EstRangeMax:     estRange,
		EstRangeMin:     estRange,
		EstRangeSum:     estRange,
		RangeCount:      1,
		SocMax:          soc,
		SocMin:          soc,
		SocSum:          soc,
		SocCount:        1,
		InsideTempSum:   data.ClimateState.InsideTemp,
		OutsideTempSum:  data.ClimateState.OutsideTemp,
		DriverTempSum:   data.ClimateState.DriverTempSetting,
		PassengerTempSum: data.ClimateState.PassengerTempSetting,
		TempCount:       1,
		LastOdometer:    &odometer,
		LastLatitude:    &lat,
		LastLongitude:   &lon,
	}

	s.mu.Lock()
	s.activeDrives[vehicle.ID] = drive.ID
	s.activeDriveState[vehicle.ID] = state
	s.mu.Unlock()

	log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", drive.ID).
		Float64("odometer", odometer).Int("battery", batteryLevel).Msg("drive started (API polling)")
	if s.eventBus != nil {
		s.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicle.ID, VIN: vehicle.VIN,
			Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": batteryLevel, "source": "api_polling"}})
	}
}

func (s *SessionService) updateActiveDrive(vehicle *models.Vehicle, data *tesla.VehicleDataResponse, state *apiDriveState) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Speed
	if data.DriveState.Speed != nil {
		speed := float64(*data.DriveState.Speed)
		if speed > state.MaxSpeed {
			state.MaxSpeed = speed
		}
		if speed < state.MinSpeed {
			state.MinSpeed = speed
		}
		state.SpeedSum += speed
		state.SpeedCount++
	}

	// Power
	power := float64(data.DriveState.Power)
	if power > state.PowerMax {
		state.PowerMax = power
	}
	if power < state.PowerMin {
		state.PowerMin = power
	}

	// Ranges
	rr := data.ChargeState.BatteryRange
	ir := data.ChargeState.IdealBatteryRange
	er := data.ChargeState.EstBatteryRange
	if rr > state.RatedRangeMax {
		state.RatedRangeMax = rr
	}
	if rr < state.RatedRangeMin {
		state.RatedRangeMin = rr
	}
	state.RatedRangeSum += rr
	if ir > state.IdealRangeMax {
		state.IdealRangeMax = ir
	}
	if ir < state.IdealRangeMin {
		state.IdealRangeMin = ir
	}
	state.IdealRangeSum += ir
	if er > state.EstRangeMax {
		state.EstRangeMax = er
	}
	if er < state.EstRangeMin {
		state.EstRangeMin = er
	}
	state.EstRangeSum += er
	state.RangeCount++

	// SOC
	soc := float64(data.ChargeState.BatteryLevel)
	if soc > state.SocMax {
		state.SocMax = soc
	}
	if soc < state.SocMin {
		state.SocMin = soc
	}
	state.SocSum += soc
	state.SocCount++

	// Temperatures
	state.InsideTempSum += data.ClimateState.InsideTemp
	state.OutsideTempSum += data.ClimateState.OutsideTemp
	state.DriverTempSum += data.ClimateState.DriverTempSetting
	state.PassengerTempSum += data.ClimateState.PassengerTempSetting
	state.TempCount++

	// Position + odometer
	odo := data.VehicleState.Odometer
	lat := data.DriveState.Latitude
	lon := data.DriveState.Longitude
	state.LastOdometer = &odo
	state.LastLatitude = &lat
	state.LastLongitude = &lon
}

func (s *SessionService) completeDrive(ctx context.Context, vehicle *models.Vehicle, driveID int64, state *apiDriveState, data *tesla.VehicleDataResponse) {
	now := time.Now().UTC()
	endBattery := data.ChargeState.BatteryLevel

	// If state is nil (shouldn't happen, but safety), fall back to old behavior
	if state == nil {
		log.Warn().Int64("driveID", driveID).Msg("completing drive without accumulator state — data will be incomplete")
		eb := int16(endBattery)
		if err := s.driveRepo.Complete(ctx, driveID, now,
			0, 0, &eb, nil, nil, nil, nil); err != nil {
			log.Error().Err(err).Int64("driveID", driveID).Msg("failed to complete drive")
		}
		s.mu.Lock()
		delete(s.activeDrives, vehicle.ID)
		delete(s.activeDriveState, vehicle.ID)
		s.mu.Unlock()
		return
	}

	// Accumulate the final poll data
	s.updateActiveDrive(vehicle, data, state)

	// Calculate metrics
	var distance float64
	if state.StartOdometer != nil && state.LastOdometer != nil {
		distance = *state.LastOdometer - *state.StartOdometer
		if distance < 0 {
			distance = 0
		}
	}
	duration := now.Sub(state.StartTime).Minutes()
	maxSpeed := state.MaxSpeed

	var speedAvg *float64
	if state.SpeedCount > 0 {
		avg := state.SpeedSum / float64(state.SpeedCount)
		speedAvg = &avg
	}

	// Fallback: estimate distance from avg speed when odometer delta is zero
	if distance == 0 && speedAvg != nil && duration > 0 {
		distance = (*speedAvg) * (duration / 60.0) // mph × hours = miles
	}

	var insideAvg, outsideAvg *float64
	if state.TempCount > 0 {
		ia := state.InsideTempSum / float64(state.TempCount)
		oa := state.OutsideTempSum / float64(state.TempCount)
		insideAvg = &ia
		outsideAvg = &oa
	}

	// Complete with core fields
	endBatteryPct := int16(endBattery)
	if err := s.driveRepo.Complete(ctx, driveID, now,
		distance, duration, &endBatteryPct, &maxSpeed, nil, insideAvg, outsideAvg); err != nil {
		log.Error().Err(err).Int64("driveID", driveID).Msg("failed to complete drive")
	}

	// Build enhanced fields map (same as telemetry path)
	enhanced := map[string]interface{}{}

	// Speed
	if speedAvg != nil {
		enhanced["avg_speed_mph"] = *speedAvg
	}

	// Coordinates
	if state.StartLatitude != nil {
		enhanced["start_lat"] = *state.StartLatitude
	}
	if state.StartLongitude != nil {
		enhanced["start_lon"] = *state.StartLongitude
	}
	if state.LastLatitude != nil {
		enhanced["end_lat"] = *state.LastLatitude
	}
	if state.LastLongitude != nil {
		enhanced["end_lon"] = *state.LastLongitude
	}

	if len(enhanced) > 0 {
		if err := s.driveRepo.PartialUpdate(ctx, driveID, enhanced); err != nil {
			log.Warn().Err(err).Int64("driveID", driveID).Msg("failed to write drive enhanced fields")
		}
	}

	s.mu.Lock()
	delete(s.activeDrives, vehicle.ID)
	delete(s.activeDriveState, vehicle.ID)
	s.mu.Unlock()

	log.Info().Int64("vehicleID", vehicle.ID).Int64("driveID", driveID).
		Float64("distance", distance).Float64("duration_min", duration).
		Float64("maxSpeed", maxSpeed).Int("endBattery", endBattery).
		Msg("drive ended (API polling)")

	// Update monthly trip summary for this drive's month
	go func() {
		tripCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		monthStart := time.Date(state.StartTime.Year(), state.StartTime.Month(), 1, 0, 0, 0, 0, time.UTC)
		if _, err := s.tripRepo.UpsertMonthTrip(tripCtx, vehicle.ID, monthStart, true); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).Msg("api-polling: failed to update monthly trip")
		}
	}()

	if s.eventBus != nil {
		s.eventBus.Publish(events.Event{Type: events.DriveEnded, VehicleID: vehicle.ID, VIN: vehicle.VIN,
			Data: map[string]interface{}{"drive_id": driveID, "battery_level": endBattery,
				"distance": distance, "duration_min": duration, "source": "api_polling"}})
	}
}

// TrackChargeFromAPI evaluates a polled VehicleDataResponse and starts or
// ends a charging session as appropriate. This is the worker (API-polling) path.
func (s *SessionService) TrackChargeFromAPI(ctx context.Context, vehicle *models.Vehicle, data *tesla.VehicleDataResponse) {
	isCharging := data.ChargeState.ChargingState == enums.ChargeStateCharging

	s.mu.Lock()
	activeChargeID, hasActiveCharge := s.activeCharges[vehicle.ID]
	s.mu.Unlock()

	if isCharging && !hasActiveCharge {
		cbl := int16(data.ChargeState.BatteryLevel)
		session := &models.ChargingSession{
			VehicleID:       vehicle.ID,
			StartTs:         time.Now().UTC(),
			StartBatteryPct: &cbl,
		}

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
		power := data.ChargeState.ChargerPower
		energyAdded := data.ChargeState.ChargeEnergyAdded
		ceb := int16(endBattery)

		if err := s.chargeRepo.Complete(ctx, activeChargeID, time.Now().UTC(),
			&energyAdded, &ceb, nil,
			&power, nil,
			nil, nil, nil, nil); err != nil {
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
