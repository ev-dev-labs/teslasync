package api

import (
	"context"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TelemetrySessionTracker detects drive starts/ends and charge starts/ends
// from streaming Fleet Telemetry signals. Tracks comprehensive telemetry
// data throughout sessions for analytics.
type TelemetrySessionTracker struct {
	db                *database.DB
	driveRepo         *database.DriveRepo
	chargeRepo        *database.ChargingRepo
	driveTelRepo      *database.DriveTelemetryRepo
	chargeTelRepo     *database.ChargeTelemetryReadingRepo
	posRepo           *database.PositionRepo
	geofenceRepo      *database.GeofenceRepo
	eventBus          *events.Bus
	geocoder          *geocoding.Client

	mu            sync.Mutex
	activeDrives  map[int64]*streamingDrive  // vehicleID → active drive
	activeCharges map[int64]*streamingCharge // vehicleID → active charge
}

// streamingDrive tracks comprehensive data during an active drive session.
type streamingDrive struct {
	DriveID   int64
	VehicleID int64
	StartTime time.Time
	LastSpeed float64
	LastSeen  time.Time
	LastSpeedZeroTime time.Time

	// Start values
	StartOdometer   *float64
	StartLatitude   *float64
	StartLongitude  *float64
	StartElevation  *float64
	StartRatedRange *float64
	StartIdealRange *float64
	StartEstRange   *float64
	StartSoc        *float64
	StartUsableSoc  *float64

	// Running statistics accumulators
	MaxSpeed    float64
	MinSpeed    float64
	SpeedSum    float64
	SpeedCount  int

	PowerMax float64
	PowerMin float64

	// Range accumulators
	RatedRangeSum, RatedRangeMax, RatedRangeMin float64
	IdealRangeSum, IdealRangeMax, IdealRangeMin float64
	EstRangeSum, EstRangeMax, EstRangeMin       float64
	RangeCount int

	// SOC accumulators
	SocSum, SocMax, SocMin             float64
	UsableSocSum, UsableSocMax, UsableSocMin float64
	SocCount int

	// Temperature accumulators
	InsideTempSum, OutsideTempSum float64
	DriverTempSum, PassengerTempSum float64
	TempCount int

	// Elevation tracking
	LastElevation    *float64
	ElevationGain    float64
	ElevationLoss    float64

	// Battery heater
	BatteryHeaterSeen bool

	// Last known position
	LastLatitude  *float64
	LastLongitude *float64
	LastOdometer  *float64
}

// streamingCharge tracks comprehensive data during an active charging session.
type streamingCharge struct {
	SessionID   int64
	VehicleID   int64
	StartTime   time.Time
	LastSeen    time.Time
	EnergyAdded float64

	// Location
	Latitude  *float64
	Longitude *float64

	// Temperature accumulators
	InsideTempSum, OutsideTempSum float64
	TempCount int

	// Charger details (captured during session)
	Phases          *int
	Voltage         *int
	Current         *int
	Power           *float64
	FastChargerType *string
	FastChargerBrand *string
	ChargeCable     *string

	// Battery at start
	StartBatteryLevel int
	StartRangeKm      *float64
}

// NewTelemetrySessionTracker creates a session tracker with comprehensive data tracking.
func NewTelemetrySessionTracker(db *database.DB, eventBus *events.Bus) *TelemetrySessionTracker {
	return &TelemetrySessionTracker{
		db:            db,
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		driveTelRepo:  database.NewDriveTelemetryRepo(db),
		chargeTelRepo: database.NewChargeTelemetryReadingRepo(db),
		posRepo:       database.NewPositionRepo(db),
		geofenceRepo:  database.NewGeofenceRepo(db),
		eventBus:      eventBus,
		geocoder:      geocoding.NewClient("TeslaSync/1.0"),
		activeDrives:  make(map[int64]*streamingDrive),
		activeCharges: make(map[int64]*streamingCharge),
	}
}

// ProcessSignals evaluates incoming telemetry signals for drive/charge transitions.
func (t *TelemetrySessionTracker) ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	t.trackDriving(ctx, vehicleID, vin, signals)
	t.trackCharging(ctx, vehicleID, vin, signals)
}

// CleanupStaleSessions closes sessions that have been open too long without updates.
func (t *TelemetrySessionTracker) CleanupStaleSessions(ctx context.Context, staleTimeout time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	for vehicleID, drive := range t.activeDrives {
		if now.Sub(drive.LastSeen) > staleTimeout {
			log.Warn().Int64("vehicle_id", vehicleID).Int64("drive_id", drive.DriveID).
				Dur("idle", now.Sub(drive.LastSeen)).Msg("telemetry: closing stale drive session")
			t.completeDriveLocked(ctx, vehicleID, drive, nil)
		}
	}
	for vehicleID, charge := range t.activeCharges {
		if now.Sub(charge.LastSeen) > staleTimeout {
			log.Warn().Int64("vehicle_id", vehicleID).Int64("session_id", charge.SessionID).
				Dur("idle", now.Sub(charge.LastSeen)).Msg("telemetry: closing stale charge session")
			t.completeChargeLocked(ctx, vehicleID, charge, nil)
		}
	}
}

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return toFloatOk(v)
		}
	}
	return 0, false
}

func signalInt(signals map[string]interface{}, keys ...string) (int, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if f, fok := toFloatOk(v); fok {
				return int(f), true
			}
		}
	}
	return 0, false
}

func signalStr(signals map[string]interface{}, keys ...string) (string, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			if s, ok2 := v.(string); ok2 && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

func floatPtr(v float64) *float64 { return &v }
func intPtr(v int) *int           { return &v }
func boolPtr(v bool) *bool        { return &v }
func strPtr(v string) *string     { return &v }

func (t *TelemetrySessionTracker) trackDriving(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	speed, hasSpeed := signalFloat(signals, "VehicleSpeed")
	if !hasSpeed {
		// Even without speed, update active drive with other signals if present
		t.mu.Lock()
		if active, ok := t.activeDrives[vehicleID]; ok {
			t.recordDriveTelemetry(ctx, active, signals)
			active.LastSeen = time.Now()
		}
		t.mu.Unlock()
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasDrive := t.activeDrives[vehicleID]

	if speed > 0 && !hasDrive {
		// === START DRIVE ===
		batteryLevel, _ := signalInt(signals, "BatteryLevel", "Soc")
		odometer, hasOdo := signalFloat(signals, "Odometer")
		lat, hasLat := signalFloat(signals, "Latitude", "Location.Latitude")
		lon, hasLon := signalFloat(signals, "Longitude", "Location.Longitude")
		elevation, _ := signalFloat(signals, "Elevation")
		ratedRange, _ := signalFloat(signals, "RatedRange")
		idealRange, _ := signalFloat(signals, "IdealBatteryRange")
		estRange, _ := signalFloat(signals, "EstBatteryRange")
		soc, _ := signalFloat(signals, "Soc", "BatteryLevel")
		usableSoc, _ := signalFloat(signals, "UsableSoc")

		drive := &models.Drive{
			VehicleID:       vehicleID,
			StartDate:       time.Now().UTC(),
			StartBatteryLvl: &batteryLevel,
		}
		if hasOdo {
			drive.StartOdometer = floatPtr(odometer)
		}
		if hasLat && hasLon {
			drive.StartLatitude = floatPtr(lat)
			drive.StartLongitude = floatPtr(lon)
		}

		if err := t.driveRepo.Create(ctx, drive); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create drive")
			return
		}

		sd := &streamingDrive{
			DriveID:   drive.ID,
			VehicleID: vehicleID,
			StartTime: time.Now(),
			LastSpeed: speed,
			LastSeen:  time.Now(),
			MaxSpeed:  speed,
			MinSpeed:  speed,
			SpeedSum:  speed,
			SpeedCount: 1,
			PowerMin:  math.MaxFloat64,
			RatedRangeMin: math.MaxFloat64,
			IdealRangeMin: math.MaxFloat64,
			EstRangeMin:   math.MaxFloat64,
			SocMin:        math.MaxFloat64,
			UsableSocMin:  math.MaxFloat64,
		}

		if hasOdo {
			sd.StartOdometer = floatPtr(odometer)
			sd.LastOdometer = floatPtr(odometer)
		}
		if hasLat {
			sd.StartLatitude = floatPtr(lat)
			sd.LastLatitude = floatPtr(lat)
		}
		if hasLon {
			sd.StartLongitude = floatPtr(lon)
			sd.LastLongitude = floatPtr(lon)
		}
		sd.StartElevation = floatPtr(elevation)
		sd.LastElevation = floatPtr(elevation)
		sd.StartRatedRange = floatPtr(ratedRange)
		sd.StartIdealRange = floatPtr(idealRange)
		sd.StartEstRange = floatPtr(estRange)
		sd.StartSoc = floatPtr(soc)
		sd.StartUsableSoc = floatPtr(usableSoc)

		// Initialize range accumulators
		if ratedRange > 0 {
			sd.RatedRangeMax = ratedRange
			sd.RatedRangeMin = ratedRange
			sd.RatedRangeSum = ratedRange
			sd.RangeCount = 1
		}
		if idealRange > 0 {
			sd.IdealRangeMax = idealRange
			sd.IdealRangeMin = idealRange
			sd.IdealRangeSum = idealRange
		}
		if estRange > 0 {
			sd.EstRangeMax = estRange
			sd.EstRangeMin = estRange
			sd.EstRangeSum = estRange
		}
		if soc > 0 {
			sd.SocMax = soc
			sd.SocMin = soc
			sd.SocSum = soc
			sd.SocCount = 1
		}
		if usableSoc > 0 {
			sd.UsableSocMax = usableSoc
			sd.UsableSocMin = usableSoc
			sd.UsableSocSum = usableSoc
		}

		t.activeDrives[vehicleID] = sd
		DriveSessionsActive.Inc()

		// Record first telemetry reading
		t.recordDriveTelemetry(ctx, sd, signals)

		// Reverse geocode start address (async to not block)
		if hasLat && hasLon {
			go t.resolveAndUpdateAddress(drive.ID, lat, lon, true)
		}

		log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", drive.ID).Msg("telemetry: drive started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if speed > 0 && hasDrive {
		// === UPDATE ACTIVE DRIVE ===
		active.LastSpeed = speed
		active.LastSeen = time.Now()
		active.LastSpeedZeroTime = time.Time{}

		// Speed stats
		if speed > active.MaxSpeed {
			active.MaxSpeed = speed
		}
		if speed < active.MinSpeed {
			active.MinSpeed = speed
		}
		active.SpeedSum += speed
		active.SpeedCount++

		// Power
		if power, ok := signalFloat(signals, "PackPower", "Power"); ok {
			if power > active.PowerMax {
				active.PowerMax = power
			}
			if power < active.PowerMin {
				active.PowerMin = power
			}
		}

		// Range tracking
		t.updateDriveRangeStats(active, signals)

		// SOC tracking
		t.updateDriveSocStats(active, signals)

		// Temperature
		t.updateDriveTempStats(active, signals)

		// Elevation
		t.updateDriveElevation(active, signals)

		// Position
		if lat, ok := signalFloat(signals, "Latitude", "Location.Latitude"); ok {
			active.LastLatitude = floatPtr(lat)
		}
		if lon, ok := signalFloat(signals, "Longitude", "Location.Longitude"); ok {
			active.LastLongitude = floatPtr(lon)
		}
		if odo, ok := signalFloat(signals, "Odometer"); ok {
			active.LastOdometer = floatPtr(odo)
		}

		// Battery heater
		if bh, ok := signals["BatteryHeaterOn"]; ok {
			if b, ok2 := bh.(bool); ok2 && b {
				active.BatteryHeaterSeen = true
			}
		}

		// Record telemetry reading
		t.recordDriveTelemetry(ctx, active, signals)

	} else if speed == 0 && hasDrive {
		// === SPEED IS ZERO — check for drive end ===
		active.LastSeen = time.Now()
		active.LastSpeed = 0

		if active.LastSpeedZeroTime.IsZero() {
			active.LastSpeedZeroTime = time.Now()
		}

		if !active.LastSpeedZeroTime.IsZero() && time.Since(active.LastSpeedZeroTime) > 2*time.Minute {
			t.completeDriveLocked(ctx, vehicleID, active, signals)
		}
	}
}

func (t *TelemetrySessionTracker) updateDriveRangeStats(active *streamingDrive, signals map[string]interface{}) {
	rr, hasRR := signalFloat(signals, "RatedRange")
	ir, hasIR := signalFloat(signals, "IdealBatteryRange")
	er, hasER := signalFloat(signals, "EstBatteryRange")

	if hasRR {
		if rr > active.RatedRangeMax { active.RatedRangeMax = rr }
		if rr < active.RatedRangeMin { active.RatedRangeMin = rr }
		active.RatedRangeSum += rr
	}
	if hasIR {
		if ir > active.IdealRangeMax { active.IdealRangeMax = ir }
		if ir < active.IdealRangeMin { active.IdealRangeMin = ir }
		active.IdealRangeSum += ir
	}
	if hasER {
		if er > active.EstRangeMax { active.EstRangeMax = er }
		if er < active.EstRangeMin { active.EstRangeMin = er }
		active.EstRangeSum += er
	}
	if hasRR || hasIR || hasER {
		active.RangeCount++
	}
}

func (t *TelemetrySessionTracker) updateDriveSocStats(active *streamingDrive, signals map[string]interface{}) {
	soc, hasSoc := signalFloat(signals, "Soc", "BatteryLevel")
	usoc, hasUSoc := signalFloat(signals, "UsableSoc")

	if hasSoc {
		if soc > active.SocMax { active.SocMax = soc }
		if soc < active.SocMin { active.SocMin = soc }
		active.SocSum += soc
		active.SocCount++
	}
	if hasUSoc {
		if usoc > active.UsableSocMax { active.UsableSocMax = usoc }
		if usoc < active.UsableSocMin { active.UsableSocMin = usoc }
		active.UsableSocSum += usoc
	}
}

func (t *TelemetrySessionTracker) updateDriveTempStats(active *streamingDrive, signals map[string]interface{}) {
	if it, ok := signalFloat(signals, "InsideTemp"); ok {
		active.InsideTempSum += it
		active.TempCount++
	}
	if ot, ok := signalFloat(signals, "OutsideTemp"); ok {
		active.OutsideTempSum += ot
	}
	if dt, ok := signalFloat(signals, "DriverSeatTemp", "DriverTemp"); ok {
		active.DriverTempSum += dt
	}
	if pt, ok := signalFloat(signals, "PassengerSeatTemp", "PassengerTemp"); ok {
		active.PassengerTempSum += pt
	}
}

func (t *TelemetrySessionTracker) updateDriveElevation(active *streamingDrive, signals map[string]interface{}) {
	elev, ok := signalFloat(signals, "Elevation")
	if !ok || elev == 0 {
		return
	}
	if active.LastElevation != nil {
		diff := elev - *active.LastElevation
		if diff > 0 {
			active.ElevationGain += diff
		} else {
			active.ElevationLoss += math.Abs(diff)
		}
	}
	active.LastElevation = floatPtr(elev)
}

func (t *TelemetrySessionTracker) recordDriveTelemetry(ctx context.Context, drive *streamingDrive, signals map[string]interface{}) {
	reading := &models.DriveTelemetryReading{
		DriveID:   drive.DriveID,
		VehicleID: drive.VehicleID,
	}

	if v, ok := signalFloat(signals, "Latitude", "Location.Latitude"); ok { reading.Latitude = floatPtr(v) }
	if v, ok := signalFloat(signals, "Longitude", "Location.Longitude"); ok { reading.Longitude = floatPtr(v) }
	if v, ok := signalFloat(signals, "Elevation"); ok { reading.Elevation = floatPtr(v) }
	if v, ok := signalInt(signals, "Heading"); ok { reading.Heading = intPtr(v) }
	if v, ok := signalFloat(signals, "Odometer"); ok { reading.Odometer = floatPtr(v) }
	if v, ok := signalFloat(signals, "VehicleSpeed"); ok { reading.Speed = floatPtr(v) }
	if v, ok := signalFloat(signals, "PackPower", "Power"); ok { reading.Power = floatPtr(v) }
	if v, ok := signalInt(signals, "BatteryLevel"); ok { reading.BatteryLevel = intPtr(v) }
	if v, ok := signalFloat(signals, "Soc"); ok { reading.Soc = floatPtr(v) }
	if v, ok := signalFloat(signals, "UsableSoc"); ok { reading.UsableSoc = floatPtr(v) }
	if v, ok := signalFloat(signals, "RatedRange"); ok { reading.RatedRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok { reading.IdealRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok { reading.EstRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "InsideTemp"); ok { reading.InsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "OutsideTemp"); ok { reading.OutsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "DriverSeatTemp", "DriverTemp"); ok { reading.DriverTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "PassengerSeatTemp", "PassengerTemp"); ok { reading.PassengerTemp = floatPtr(v) }
	if v, ok := signalInt(signals, "FanStatus"); ok { reading.FanStatus = intPtr(v) }
	if v, ok := signals["IsClimateOn"]; ok {
		if b, ok2 := v.(bool); ok2 { reading.IsClimateOn = boolPtr(b) }
	}
	if v, ok := signalFloat(signals, "TirePressureFL", "TpmsPressureFl", "TPMS_PressureFL"); ok { reading.TirePressureFL = floatPtr(v) }
	if v, ok := signalFloat(signals, "TirePressureFR", "TpmsPressureFr", "TPMS_PressureFR"); ok { reading.TirePressureFR = floatPtr(v) }
	if v, ok := signalFloat(signals, "TirePressureRL", "TpmsPressureRl", "TPMS_PressureRL"); ok { reading.TirePressureRL = floatPtr(v) }
	if v, ok := signalFloat(signals, "TirePressureRR", "TpmsPressureRr", "TPMS_PressureRR"); ok { reading.TirePressureRR = floatPtr(v) }
	if v, ok := signals["BatteryHeaterOn"]; ok {
		if b, ok2 := v.(bool); ok2 { reading.BatteryHeaterOn = boolPtr(b) }
	}

	if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
		log.Error().Err(err).Int64("drive_id", drive.DriveID).Msg("telemetry: failed to insert drive telemetry reading")
	}
}

func (t *TelemetrySessionTracker) completeDriveLocked(ctx context.Context, vehicleID int64, active *streamingDrive, signals map[string]interface{}) {
	endBattery := 0
	if signals != nil {
		if bl, ok := signalInt(signals, "BatteryLevel", "Soc"); ok {
			endBattery = bl
		}
	}

	duration := time.Since(active.StartTime).Minutes()
	maxSpeed := active.MaxSpeed

	// Compute distance from odometer
	var distance float64
	if active.StartOdometer != nil && active.LastOdometer != nil {
		distance = *active.LastOdometer - *active.StartOdometer
		if distance < 0 {
			distance = 0
		}
	}

	// Compute averages
	var speedAvg, speedMin *float64
	if active.SpeedCount > 0 {
		avg := active.SpeedSum / float64(active.SpeedCount)
		speedAvg = &avg
		if active.MinSpeed < math.MaxFloat64 {
			speedMin = &active.MinSpeed
		}
	}

	var insideAvg, outsideAvg *float64
	if active.TempCount > 0 {
		ia := active.InsideTempSum / float64(active.TempCount)
		oa := active.OutsideTempSum / float64(active.TempCount)
		insideAvg = &ia
		outsideAvg = &oa
	}

	// End position for geocoding
	var endLat, endLon *float64
	if active.LastLatitude != nil {
		endLat = active.LastLatitude
	}
	if active.LastLongitude != nil {
		endLon = active.LastLongitude
	}

	// Get end ranges/SOC
	var endRatedRange, endIdealRange, endEstRange *float64
	var endSoc, endUsableSoc *float64
	if signals != nil {
		if v, ok := signalFloat(signals, "RatedRange"); ok { endRatedRange = floatPtr(v) }
		if v, ok := signalFloat(signals, "IdealBatteryRange"); ok { endIdealRange = floatPtr(v) }
		if v, ok := signalFloat(signals, "EstBatteryRange"); ok { endEstRange = floatPtr(v) }
		if v, ok := signalFloat(signals, "Soc", "BatteryLevel"); ok { endSoc = floatPtr(v) }
		if v, ok := signalFloat(signals, "UsableSoc"); ok { endUsableSoc = floatPtr(v) }
	}

	var powerMax, powerMin *float64
	if active.PowerMax != 0 {
		powerMax = &active.PowerMax
	}
	if active.PowerMin < math.MaxFloat64 {
		powerMin = &active.PowerMin
	}

	// Build enhanced fields map
	enhancedFields := map[string]interface{}{}
	if active.StartOdometer != nil { enhancedFields["start_odometer"] = *active.StartOdometer }
	if active.LastOdometer != nil { enhancedFields["end_odometer"] = *active.LastOdometer }
	if speedAvg != nil { enhancedFields["speed_avg"] = *speedAvg }
	if speedMin != nil { enhancedFields["speed_min"] = *speedMin }

	// Range stats
	if active.StartRatedRange != nil { enhancedFields["start_rated_range_km"] = *active.StartRatedRange }
	if endRatedRange != nil { enhancedFields["end_rated_range_km"] = *endRatedRange }
	if active.RangeCount > 0 {
		enhancedFields["rated_range_avg"] = active.RatedRangeSum / float64(active.RangeCount)
		if active.RatedRangeMax > 0 { enhancedFields["rated_range_max"] = active.RatedRangeMax }
		if active.RatedRangeMin < math.MaxFloat64 { enhancedFields["rated_range_min"] = active.RatedRangeMin }
		enhancedFields["ideal_range_avg"] = active.IdealRangeSum / float64(active.RangeCount)
		if active.IdealRangeMax > 0 { enhancedFields["ideal_range_max"] = active.IdealRangeMax }
		if active.IdealRangeMin < math.MaxFloat64 { enhancedFields["ideal_range_min"] = active.IdealRangeMin }
		enhancedFields["est_range_avg"] = active.EstRangeSum / float64(active.RangeCount)
		if active.EstRangeMax > 0 { enhancedFields["est_range_max"] = active.EstRangeMax }
		if active.EstRangeMin < math.MaxFloat64 { enhancedFields["est_range_min"] = active.EstRangeMin }
	}
	if active.StartIdealRange != nil { enhancedFields["start_ideal_range_km"] = *active.StartIdealRange }
	if endIdealRange != nil { enhancedFields["end_ideal_range_km"] = *endIdealRange }
	if active.StartEstRange != nil { enhancedFields["start_est_range_km"] = *active.StartEstRange }
	if endEstRange != nil { enhancedFields["end_est_range_km"] = *endEstRange }

	// SOC stats
	if active.StartSoc != nil { enhancedFields["soc_start"] = *active.StartSoc }
	if endSoc != nil { enhancedFields["soc_end"] = *endSoc }
	if active.SocCount > 0 {
		enhancedFields["soc_avg"] = active.SocSum / float64(active.SocCount)
		if active.SocMax > 0 { enhancedFields["soc_max"] = active.SocMax }
		if active.SocMin < math.MaxFloat64 { enhancedFields["soc_min"] = active.SocMin }
	}
	if active.StartUsableSoc != nil { enhancedFields["usable_soc_start"] = *active.StartUsableSoc }
	if endUsableSoc != nil { enhancedFields["usable_soc_end"] = *endUsableSoc }
	if active.SocCount > 0 {
		enhancedFields["usable_soc_avg"] = active.UsableSocSum / float64(active.SocCount)
		if active.UsableSocMax > 0 { enhancedFields["usable_soc_max"] = active.UsableSocMax }
		if active.UsableSocMin < math.MaxFloat64 { enhancedFields["usable_soc_min"] = active.UsableSocMin }
	}

	// Elevation
	if active.StartElevation != nil { enhancedFields["elevation_start"] = *active.StartElevation }
	if active.LastElevation != nil { enhancedFields["elevation_end"] = *active.LastElevation }
	if active.ElevationGain > 0 { enhancedFields["elevation_gain"] = active.ElevationGain }
	if active.ElevationLoss > 0 { enhancedFields["elevation_loss"] = active.ElevationLoss }

	// Temperature
	if active.TempCount > 0 {
		enhancedFields["driver_temp_avg"] = active.DriverTempSum / float64(active.TempCount)
		enhancedFields["passenger_temp_avg"] = active.PassengerTempSum / float64(active.TempCount)
	}

	// Battery heater
	enhancedFields["battery_heater_on"] = active.BatteryHeaterSeen

	// Coordinates
	if active.StartLatitude != nil { enhancedFields["start_latitude"] = *active.StartLatitude }
	if active.StartLongitude != nil { enhancedFields["start_longitude"] = *active.StartLongitude }
	if endLat != nil { enhancedFields["end_latitude"] = *endLat }
	if endLon != nil { enhancedFields["end_longitude"] = *endLon }

	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := t.driveRepo.CompleteWithTx(ctx, tx, active.DriveID, time.Now().UTC(),
			nil, nil, distance, duration, endRatedRange, &endBattery, &maxSpeed, powerMax, powerMin, insideAvg, outsideAvg); err != nil {
			return err
		}
		if len(enhancedFields) > 0 {
			if err := t.driveRepo.PartialUpdateWithTx(ctx, tx, active.DriveID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Error().Err(err).Int64("drive_id", active.DriveID).Msg("telemetry: failed to complete drive")
	}

	// Reverse geocode end address (async)
	if endLat != nil && endLon != nil {
		go t.resolveAndUpdateAddress(active.DriveID, *endLat, *endLon, false)
	}

	log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", active.DriveID).
		Float64("duration_min", duration).Float64("distance", distance).Msg("telemetry: drive ended")

	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.DriveEnded, VehicleID: vehicleID,
			Data: map[string]interface{}{"drive_id": active.DriveID, "battery_level": endBattery,
				"distance": distance, "duration_min": duration, "source": "fleet_telemetry"}})
	}

	delete(t.activeDrives, vehicleID)
	DriveSessionsActive.Dec()
	DriveSessionsCompleted.Inc()
}

func (t *TelemetrySessionTracker) resolveAndUpdateAddress(driveID int64, lat, lon float64, isStart bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Check if coordinates fall inside a user-defined geofence first
	name := ""
	if geofences, err := t.geofenceRepo.FindByCoordinates(ctx, lat, lon); err == nil && len(geofences) > 0 {
		name = geofences[0].Name
	}

	// Fall back to Nominatim reverse geocoding
	if name == "" {
		result, err := t.geocoder.ReverseGeocode(ctx, lat, lon)
		if err != nil {
			log.Warn().Err(err).Float64("lat", lat).Float64("lon", lon).Msg("telemetry: reverse geocode failed")
			return
		}
		name = result.ShortName()
	}

	field := "end_address"
	if isStart {
		field = "start_address"
	}

	if err := t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: name}); err != nil {
		log.Error().Err(err).Int64("drive_id", driveID).Str("field", field).Msg("telemetry: failed to update address")
	}
}

func (t *TelemetrySessionTracker) trackCharging(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}) {
	chargeState, hasChargeState := signalStr(signals, "DetailedChargeState", "ChargeState")
	if !hasChargeState {
		// Even without charge state, update active charge with readings
		t.mu.Lock()
		if active, ok := t.activeCharges[vehicleID]; ok {
			t.recordChargeTelemetry(ctx, active, signals)
			active.LastSeen = time.Now()
		}
		t.mu.Unlock()
		return
	}

	isCharging := chargeState == "Charging" || chargeState == "Starting"

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasCharge := t.activeCharges[vehicleID]

	if isCharging && !hasCharge {
		// === START CHARGE ===
		batteryLevel, _ := signalInt(signals, "BatteryLevel", "Soc")
		lat, hasLat := signalFloat(signals, "Latitude", "Location.Latitude")
		lon, hasLon := signalFloat(signals, "Longitude", "Location.Longitude")
		startRange, _ := signalFloat(signals, "RatedRange")

		session := &models.ChargingSession{
			VehicleID:         vehicleID,
			StartDate:         time.Now().UTC(),
			StartBatteryLevel: batteryLevel,
		}
		if startRange > 0 {
			session.StartRangeKm = floatPtr(startRange)
		}
		if hasLat && hasLon {
			session.Latitude = floatPtr(lat)
			session.Longitude = floatPtr(lon)
		}

		if err := t.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create charge session")
			return
		}

		sc := &streamingCharge{
			SessionID:         session.ID,
			VehicleID:         vehicleID,
			StartTime:         time.Now(),
			LastSeen:          time.Now(),
			StartBatteryLevel: batteryLevel,
		}
		if hasLat { sc.Latitude = floatPtr(lat) }
		if hasLon { sc.Longitude = floatPtr(lon) }
		if startRange > 0 { sc.StartRangeKm = floatPtr(startRange) }

		t.activeCharges[vehicleID] = sc
		ChargeSessionsActive.Inc()

		// Record first reading
		t.recordChargeTelemetry(ctx, sc, signals)

		log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", session.ID).Msg("telemetry: charging started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"session_id": session.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if isCharging && hasCharge {
		// === UPDATE ACTIVE CHARGE ===
		active.LastSeen = time.Now()

		// Track energy
		if ea, ok := signalFloat(signals, "DCChargingEnergyIn"); ok {
			active.EnergyAdded = ea
		} else if ea, ok := signalFloat(signals, "ACChargingEnergyIn"); ok {
			active.EnergyAdded = ea
		}

		// Track charger details
		if v, ok := signalInt(signals, "ChargerPhases"); ok { active.Phases = intPtr(v) }
		if v, ok := signalInt(signals, "ChargerVoltage"); ok { active.Voltage = intPtr(v) }
		if v, ok := signalInt(signals, "ChargerActualCurrent", "ChargeAmps"); ok { active.Current = intPtr(v) }
		if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok { active.Power = floatPtr(v) }
		if v, ok := signalStr(signals, "FastChargerType"); ok { active.FastChargerType = strPtr(v) }
		if v, ok := signalStr(signals, "FastChargerBrand"); ok { active.FastChargerBrand = strPtr(v) }
		if v, ok := signalStr(signals, "ChargingCableType", "ConnChargeCable"); ok { active.ChargeCable = strPtr(v) }

		// Temperature
		if it, ok := signalFloat(signals, "InsideTemp"); ok {
			active.InsideTempSum += it
			active.TempCount++
		}
		if ot, ok := signalFloat(signals, "OutsideTemp"); ok {
			active.OutsideTempSum += ot
		}

		// Record telemetry reading
		t.recordChargeTelemetry(ctx, active, signals)

	} else if !isCharging && hasCharge {
		// === CHARGE ENDED ===
		t.completeChargeLocked(ctx, vehicleID, active, signals)
	}
}

func (t *TelemetrySessionTracker) recordChargeTelemetry(ctx context.Context, charge *streamingCharge, signals map[string]interface{}) {
	reading := &models.ChargeTelemetryReading{
		SessionID: charge.SessionID,
		VehicleID: charge.VehicleID,
	}

	if v, ok := signalInt(signals, "BatteryLevel"); ok { reading.BatteryLevel = intPtr(v) }
	if v, ok := signalFloat(signals, "Soc"); ok { reading.Soc = floatPtr(v) }
	if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok { reading.PowerKW = floatPtr(v) }
	if v, ok := signalFloat(signals, "ChargerVoltage"); ok { reading.Voltage = floatPtr(v) }
	if v, ok := signalFloat(signals, "ChargerActualCurrent", "ChargeAmps"); ok { reading.CurrentAmps = floatPtr(v) }
	if v, ok := signalInt(signals, "ChargerPhases"); ok { reading.Phases = intPtr(v) }
	if v, ok := signalFloat(signals, "DCChargingEnergyIn", "ACChargingEnergyIn"); ok { reading.EnergyAdded = floatPtr(v) }
	if v, ok := signalFloat(signals, "RatedRange"); ok { reading.RatedRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok { reading.IdealRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok { reading.EstRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "InsideTemp"); ok { reading.InsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "OutsideTemp"); ok { reading.OutsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "ModuleTempMax"); ok { reading.BatteryTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "Latitude", "Location.Latitude"); ok { reading.Latitude = floatPtr(v) }
	if v, ok := signalFloat(signals, "Longitude", "Location.Longitude"); ok { reading.Longitude = floatPtr(v) }
	if v, ok := signalFloat(signals, "ChargeRateMph"); ok { reading.ChargeRate = floatPtr(v) }

	if err := t.chargeTelRepo.Insert(ctx, reading); err != nil {
		log.Error().Err(err).Int64("session_id", charge.SessionID).Msg("telemetry: failed to insert charge telemetry reading")
	}
}

func (t *TelemetrySessionTracker) completeChargeLocked(ctx context.Context, vehicleID int64, active *streamingCharge, signals map[string]interface{}) {
	endBattery := 0
	if signals != nil {
		if bl, ok := signalInt(signals, "BatteryLevel", "Soc"); ok {
			endBattery = bl
		}
	}
	duration := time.Since(active.StartTime).Minutes()

	// Estimate energy from battery% diff if direct energy signal unavailable
	if active.EnergyAdded == 0 && active.StartBatteryLevel > 0 && endBattery > active.StartBatteryLevel {
		// Estimate: typical Model Y pack is ~75 kWh, so 1% ≈ 0.75 kWh
		estimatedKWh := float64(endBattery-active.StartBatteryLevel) * 0.75
		active.EnergyAdded = estimatedKWh
	}

	// Get end range
	var endRange *float64
	if signals != nil {
		if v, ok := signalFloat(signals, "RatedRange"); ok { endRange = floatPtr(v) }
	}

	// Temperature averages
	var insideAvg, outsideAvg *float64
	if active.TempCount > 0 {
		ia := active.InsideTempSum / float64(active.TempCount)
		oa := active.OutsideTempSum / float64(active.TempCount)
		insideAvg = &ia
		outsideAvg = &oa
	}

	// Build enhanced fields
	enhancedFields := map[string]interface{}{}
	if active.Latitude != nil { enhancedFields["latitude"] = *active.Latitude }
	if active.Longitude != nil { enhancedFields["longitude"] = *active.Longitude }
	if insideAvg != nil { enhancedFields["inside_temp_avg"] = *insideAvg }
	if outsideAvg != nil { enhancedFields["outside_temp_avg"] = *outsideAvg }

	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, active.SessionID, time.Now().UTC(),
			active.EnergyAdded, nil, &endBattery, endRange,
			active.Phases, active.Voltage, active.Current, active.Power,
			active.FastChargerType, active.FastChargerBrand, active.ChargeCable, nil, duration); err != nil {
			return err
		}

		// Synchronous enhanced fields (non-geocoded) in same tx
		if len(enhancedFields) > 0 {
			// Only write fields without geocoding inside the tx when no async geocoding needed
			if active.Latitude == nil || active.Longitude == nil {
				if err := t.chargeRepo.PartialUpdateWithTx(ctx, tx, active.SessionID, enhancedFields); err != nil {
					return err
				}
			}
		}

		// Auto-calculate charge cost from geofence electricity rate
		if active.Latitude != nil && active.Longitude != nil && active.EnergyAdded > 0 {
			geofences, gErr := t.geofenceRepo.FindByCoordinates(ctx, *active.Latitude, *active.Longitude)
			if gErr == nil && len(geofences) > 0 && geofences[0].CostPerKwh != nil {
				cost := active.EnergyAdded * *geofences[0].CostPerKwh
				if err := t.chargeRepo.PartialUpdateWithTx(ctx, tx, active.SessionID, map[string]interface{}{"cost": cost}); err != nil {
					return err
				}
			}
		}

		return nil
	}); err != nil {
		log.Error().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to complete charge")
	}

	// Resolve location name async — geocoding stays outside the transaction
	if len(enhancedFields) > 0 && active.Latitude != nil && active.Longitude != nil {
		fieldsCopy := make(map[string]interface{}, len(enhancedFields)+1)
		for k, v := range enhancedFields {
			fieldsCopy[k] = v
		}
		go func(sessionID int64, lat, lon float64, fields map[string]interface{}) {
			gctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()

			// Check geofences first for user-defined name (e.g., "Home", "Office")
			if geofences, err := t.geofenceRepo.FindByCoordinates(gctx, lat, lon); err == nil && len(geofences) > 0 {
				fields["location_name"] = geofences[0].Name
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// Fall back to Nominatim reverse geocoding
			result, err := t.geocoder.ReverseGeocode(gctx, lat, lon)
			if err != nil {
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}
			fields["location_name"] = result.ShortName()
			_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
		}(active.SessionID, *active.Latitude, *active.Longitude, fieldsCopy)
	}

	log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", active.SessionID).
		Float64("duration_min", duration).Float64("energy_added", active.EnergyAdded).Msg("telemetry: charging ended")

	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.ChargeCompleted, VehicleID: vehicleID,
			Data: map[string]interface{}{"session_id": active.SessionID, "battery_level": endBattery,
				"energy_added": active.EnergyAdded, "source": "fleet_telemetry"}})
	}

	delete(t.activeCharges, vehicleID)
	ChargeSessionsActive.Dec()
	ChargeSessionsCompleted.Inc()
}
