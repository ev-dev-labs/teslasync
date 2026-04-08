package api

import (
	"context"
	"math"
	"strings"
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
	placesCache       *database.PlacesCacheRepo
	eventBus          *events.Bus
	geocoder          geocoding.Geocoder

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
	GearBased  bool // true if drive was started by Gear signal (not speed)
	Completing bool // true while being completed — prevents double-completion

	// Signal accumulator — merges signals across MQTT batches for rich telemetry writes.
	// Fleet telemetry sends each field as a separate MQTT message, so individual batches
	// only contain 1-3 fields. The accumulator collects them over a write interval.
	accumulatedSignals map[string]interface{}
	lastTelemetryWrite time.Time

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

	// Signal accumulator (same pattern as streamingDrive)
	accumulatedSignals map[string]interface{}
	lastTelemetryWrite time.Time

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
	Completing        bool // prevents double-completion race
}

// NewTelemetrySessionTracker creates a session tracker with comprehensive data tracking.
func NewTelemetrySessionTracker(db *database.DB, eventBus *events.Bus, geocoder geocoding.Geocoder) *TelemetrySessionTracker {
	return &TelemetrySessionTracker{
		db:            db,
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		driveTelRepo:  database.NewDriveTelemetryRepo(db),
		chargeTelRepo: database.NewChargeTelemetryReadingRepo(db),
		posRepo:       database.NewPositionRepo(db),
		geofenceRepo:  database.NewGeofenceRepo(db),
		placesCache:   database.NewPlacesCacheRepo(db),
		eventBus:      eventBus,
		geocoder:      geocoder,
		activeDrives:  make(map[int64]*streamingDrive),
		activeCharges: make(map[int64]*streamingCharge),
	}
}

// telemetryWriteInterval controls how often drive/charge telemetry readings are
// flushed to the database. Signals are accumulated across MQTT batches within
// this window so each row has complete data instead of mostly NULLs.
const telemetryWriteInterval = 5 * time.Second

// accumulateSignals merges incoming signals into the accumulator map.
func accumulateSignals(acc map[string]interface{}, signals map[string]interface{}) map[string]interface{} {
	if acc == nil {
		acc = make(map[string]interface{}, len(signals))
	}
	for k, v := range signals {
		acc[k] = v
	}
	return acc
}

// ProcessSignals evaluates incoming telemetry signals for drive/charge transitions.
// accumulatedSignals contains the merged set of all signals seen in the handler's
// current accumulation window — used to fill in start values (battery, odometer,
// location) that may not be in the current batch.
func (t *TelemetrySessionTracker) ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	t.trackDriving(ctx, vehicleID, vin, signals, accumulatedSignals)
	t.trackCharging(ctx, vehicleID, vin, signals, accumulatedSignals)
}

// CleanupStaleSessions closes sessions that have been open too long without updates.
// Also cleans up orphaned DB sessions (open sessions with no in-memory tracker,
// e.g. from before a restart).
func (t *TelemetrySessionTracker) CleanupStaleSessions(ctx context.Context, staleTimeout time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()
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

	// Close orphaned DB sessions — drives/charges with NULL end_date that started
	// more than staleTimeout ago and have no in-memory tracker (e.g. from pre-restart)
	cutoff := now.Add(-staleTimeout)
	_, err := t.db.Pool.Exec(ctx,
		`UPDATE drives SET end_date = $1, duration_min = EXTRACT(EPOCH FROM ($1 - start_date))/60
		 WHERE end_date IS NULL AND start_date < $2`, now, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("telemetry: failed to close orphaned drives")
	}
	_, err = t.db.Pool.Exec(ctx,
		`UPDATE charging_sessions SET end_date = $1, duration_min = EXTRACT(EPOCH FROM ($1 - start_date))/60
		 WHERE end_date IS NULL AND start_date < $2`, now, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("telemetry: failed to close orphaned charges")
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

// signalLatLon extracts latitude and longitude from the signals map.
// Tesla Fleet Telemetry sends Location as a JSON object {"latitude": N, "longitude": N},
// while the REST API may send separate Latitude/Longitude signals.
func signalLatLon(signals map[string]interface{}) (lat, lon float64, ok bool) {
	// Fleet Telemetry: Location is a map with latitude/longitude keys
	if loc, isMap := signals["Location"].(map[string]interface{}); isMap {
		la, laOk := toFloatOk(loc["latitude"])
		lo, loOk := toFloatOk(loc["longitude"])
		if laOk && loOk {
			return la, lo, true
		}
	}
	// REST API fallback: separate Latitude/Longitude signals
	la, laOk := signalFloat(signals, "Latitude")
	lo, loOk := signalFloat(signals, "Longitude")
	if laOk && loOk {
		return la, lo, true
	}
	return 0, 0, false
}

// signalPowerKW extracts power in kW. Tesla Fleet Telemetry has no "PackPower"
// signal; power is computed from PackVoltage (V) × PackCurrent (A) → kW.
func signalPowerKW(signals map[string]interface{}) (float64, bool) {
	if v, ok := signalFloat(signals, "PackPower", "Power"); ok {
		return v, true
	}
	voltage, vOk := toFloatOk(signals["PackVoltage"])
	current, cOk := toFloatOk(signals["PackCurrent"])
	if vOk && cOk {
		return voltage * current / 1000.0, true
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

func (t *TelemetrySessionTracker) trackDriving(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	speed, hasSpeed := signalFloat(signals, "VehicleSpeed")
	gear, hasGear := signalStr(signals, "Gear")

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasDrive := t.activeDrives[vehicleID]

	// === GEAR-BASED PATH (primary) ===
	if hasGear {
		isDrivingGear := gear == "D" || gear == "R"
		isParkGear := gear == "P" || gear == "N"

		if isDrivingGear && !hasDrive {
			// Gear→D/R with no active drive → START DRIVE immediately
			// If there's an active charge session, force-complete it (unplug-and-go)
			if activeCharge, hasCharge := t.activeCharges[vehicleID]; hasCharge {
				log.Info().Int64("vehicle_id", vehicleID).Int64("charge_id", activeCharge.SessionID).
					Msg("telemetry: drive starting while charge active — force-completing charge")
				t.completeChargeLocked(ctx, vehicleID, activeCharge, signals)
			}
			t.startDriveLocked(ctx, vehicleID, vin, signals, accumulatedSignals, speed, true)
			return
		}

		if isDrivingGear && hasDrive {
			// Gear still D/R — update active drive
			active.LastSeen = time.Now().UTC()
			active.LastSpeedZeroTime = time.Time{} // reset any speed-zero timer
			t.updateActiveDriveLocked(ctx, active, signals, speed, hasSpeed)
			return
		}

		if isParkGear && hasDrive {
			// Gear→P with active drive → END DRIVE immediately
			log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", active.DriveID).
				Str("gear", gear).Msg("telemetry: gear→P, ending drive")
			t.completeDriveLocked(ctx, vehicleID, active, signals)
			return
		}

		// Gear=P/N with no active drive — nothing to do
		if !hasDrive {
			return
		}
	}

	// === SPEED-BASED FALLBACK (no Gear signal in this batch) ===

	if !hasSpeed {
		// No speed and no gear — just accumulate for active drive
		if hasDrive {
			active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
			active.LastSeen = time.Now().UTC()
			t.maybeFlushDriveTelemetry(ctx, active)
		}
		return
	}

	if speed > 0 && !hasDrive {
		// Speed > 0, no gear, no active drive → START DRIVE (fallback)
		// Force-complete any active charge (same as gear-based path)
		if activeCharge, hasCharge := t.activeCharges[vehicleID]; hasCharge {
			log.Info().Int64("vehicle_id", vehicleID).Int64("charge_id", activeCharge.SessionID).
				Msg("telemetry: drive starting (speed) while charge active — force-completing charge")
			t.completeChargeLocked(ctx, vehicleID, activeCharge, signals)
		}
		t.startDriveLocked(ctx, vehicleID, vin, signals, accumulatedSignals, speed, false)

	} else if speed > 0 && hasDrive {
		// Speed > 0, active drive → UPDATE
		active.LastSeen = time.Now().UTC()
		active.LastSpeedZeroTime = time.Time{}
		t.updateActiveDriveLocked(ctx, active, signals, speed, true)

	} else if speed == 0 && hasDrive {
		// Speed = 0, active drive → check for drive end (2-min timeout fallback)
		active.LastSeen = time.Now().UTC()
		active.LastSpeed = 0

		if active.LastSpeedZeroTime.IsZero() {
			active.LastSpeedZeroTime = time.Now().UTC()
		}

		if !active.LastSpeedZeroTime.IsZero() && time.Since(active.LastSpeedZeroTime) > 2*time.Minute {
			t.completeDriveLocked(ctx, vehicleID, active, signals)
		}
	}
}

// startDriveLocked creates a new drive session. Must be called with t.mu held.
func (t *TelemetrySessionTracker) startDriveLocked(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, speed float64, gearBased bool) {
	batteryLevel, hasBat := signalInt(signals, "BatteryLevel", "Soc")
	if !hasBat {
		batteryLevel, hasBat = signalInt(accumulatedSignals, "BatteryLevel", "Soc")
	}
	odometer, hasOdo := signalFloat(signals, "Odometer")
	if !hasOdo {
		odometer, hasOdo = signalFloat(accumulatedSignals, "Odometer")
	}
	lat, lon, hasLoc := signalLatLon(signals)
	if !hasLoc {
		lat, lon, hasLoc = signalLatLon(accumulatedSignals)
	}
	elevation, hasElev := signalFloat(signals, "Elevation")
	if !hasElev {
		elevation, _ = signalFloat(accumulatedSignals, "Elevation")
	}
	ratedRange, hasRR := signalFloat(signals, "RatedRange")
	if !hasRR {
		ratedRange, _ = signalFloat(accumulatedSignals, "RatedRange")
	}
	idealRange, hasIR := signalFloat(signals, "IdealBatteryRange")
	if !hasIR {
		idealRange, _ = signalFloat(accumulatedSignals, "IdealBatteryRange")
	}
	estRange, hasER := signalFloat(signals, "EstBatteryRange")
	if !hasER {
		estRange, _ = signalFloat(accumulatedSignals, "EstBatteryRange")
	}
	soc, hasSoc := signalFloat(signals, "Soc", "BatteryLevel")
	if !hasSoc {
		soc, _ = signalFloat(accumulatedSignals, "Soc", "BatteryLevel")
	}
	usableSoc, hasUS := signalFloat(signals, "UsableSoc")
	if !hasUS {
		usableSoc, _ = signalFloat(accumulatedSignals, "UsableSoc")
	}

	drive := &models.Drive{
		VehicleID: vehicleID,
		StartDate: time.Now().UTC(),
	}
	if hasBat {
		drive.StartBatteryLvl = &batteryLevel
	}
	if hasOdo {
		drive.StartOdometer = floatPtr(odometer)
	}
	if hasLoc {
		drive.StartLatitude = floatPtr(lat)
		drive.StartLongitude = floatPtr(lon)
	}

	if err := t.driveRepo.Create(ctx, drive); err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create drive")
		return
	}

	sd := &streamingDrive{
		DriveID:            drive.ID,
		VehicleID:          vehicleID,
		StartTime:          time.Now().UTC(),
		LastSpeed:          speed,
		LastSeen:           time.Now().UTC(),
		GearBased:          gearBased,
		PowerMin:           math.MaxFloat64,
		RatedRangeMin:      math.MaxFloat64,
		IdealRangeMin:      math.MaxFloat64,
		EstRangeMin:        math.MaxFloat64,
		SocMin:             math.MaxFloat64,
		UsableSocMin:       math.MaxFloat64,
		accumulatedSignals: make(map[string]interface{}),
		lastTelemetryWrite: time.Now().UTC(),
	}
	if speed > 0 {
		sd.MaxSpeed = speed
		sd.MinSpeed = speed
		sd.SpeedSum = speed
		sd.SpeedCount = 1
	}

	if hasOdo {
		sd.StartOdometer = floatPtr(odometer)
		sd.LastOdometer = floatPtr(odometer)
	}
	if hasLoc {
		sd.StartLatitude = floatPtr(lat)
		sd.LastLatitude = floatPtr(lat)
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

	// Accumulate first batch and write immediately
	sd.accumulatedSignals = accumulateSignals(sd.accumulatedSignals, signals)
	t.flushDriveTelemetry(ctx, sd)

	// Reverse geocode start address (async to not block)
	if hasLoc {
		go t.resolveAndUpdateAddress(drive.ID, lat, lon, true)
	}

	trigger := "speed"
	if gearBased {
		trigger = "gear"
	}
	log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", drive.ID).Str("trigger", trigger).Msg("telemetry: drive started")
	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicleID, VIN: vin,
			Data: map[string]interface{}{"drive_id": drive.ID, "battery_level": batteryLevel, "source": "fleet_telemetry", "trigger": trigger}})
	}
}

// updateActiveDriveLocked updates an active drive with new signals. Must be called with t.mu held.
func (t *TelemetrySessionTracker) updateActiveDriveLocked(ctx context.Context, active *streamingDrive, signals map[string]interface{}, speed float64, hasSpeed bool) {
	if hasSpeed && speed > 0 {
		active.LastSpeed = speed
		// Speed stats
		if speed > active.MaxSpeed {
			active.MaxSpeed = speed
		}
		if active.SpeedCount == 0 || speed < active.MinSpeed {
			active.MinSpeed = speed
		}
		active.SpeedSum += speed
		active.SpeedCount++
	}

	// Deferred start value backfill
	startBackfill := map[string]interface{}{}
	if active.StartOdometer == nil {
		if odo, ok := signalFloat(signals, "Odometer"); ok {
			active.StartOdometer = floatPtr(odo)
			active.LastOdometer = floatPtr(odo)
			startBackfill["start_odometer"] = odo
		}
	}
	if active.StartSoc == nil {
		if soc, ok := signalFloat(signals, "Soc", "BatteryLevel"); ok {
			active.StartSoc = floatPtr(soc)
			bl := int(soc)
			startBackfill["start_battery_level"] = bl
			startBackfill["soc_start"] = soc
			active.SocMax = soc
			active.SocMin = soc
			active.SocSum = soc
			active.SocCount = 1
		}
	}
	if active.StartLatitude == nil {
		if la, lo, ok := signalLatLon(signals); ok {
			active.StartLatitude = floatPtr(la)
			active.StartLongitude = floatPtr(lo)
			startBackfill["start_latitude"] = la
			startBackfill["start_longitude"] = lo
			go t.resolveAndUpdateAddress(active.DriveID, la, lo, true)
		}
	}
	if active.StartRatedRange == nil {
		if rr, ok := signalFloat(signals, "RatedRange"); ok {
			active.StartRatedRange = floatPtr(rr)
			startBackfill["start_rated_range_km"] = rr
		}
	}
	if active.StartIdealRange == nil {
		if ir, ok := signalFloat(signals, "IdealBatteryRange"); ok {
			active.StartIdealRange = floatPtr(ir)
			startBackfill["start_ideal_range_km"] = ir
		}
	}
	if active.StartEstRange == nil {
		if er, ok := signalFloat(signals, "EstBatteryRange"); ok {
			active.StartEstRange = floatPtr(er)
			startBackfill["start_est_range_km"] = er
		}
	}
	if len(startBackfill) > 0 {
		if err := t.driveRepo.PartialUpdate(ctx, active.DriveID, startBackfill); err != nil {
			log.Warn().Err(err).Int64("drive_id", active.DriveID).Msg("telemetry: failed to backfill drive start values")
		}
	}

	// Power
	if power, ok := signalPowerKW(signals); ok {
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
	if la, lo, ok := signalLatLon(signals); ok {
		active.LastLatitude = floatPtr(la)
		active.LastLongitude = floatPtr(lo)
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

	// Accumulate signals and flush periodically
	active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
	t.maybeFlushDriveTelemetry(ctx, active)
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

// maybeFlushDriveTelemetry writes accumulated signals if the write interval has elapsed.
func (t *TelemetrySessionTracker) maybeFlushDriveTelemetry(ctx context.Context, drive *streamingDrive) {
	if time.Since(drive.lastTelemetryWrite) < telemetryWriteInterval {
		return
	}
	t.flushDriveTelemetry(ctx, drive)
}

// flushDriveTelemetry writes a telemetry reading from accumulated signals and resets the accumulator.
func (t *TelemetrySessionTracker) flushDriveTelemetry(ctx context.Context, drive *streamingDrive) {
	if len(drive.accumulatedSignals) == 0 {
		return
	}
	t.recordDriveTelemetry(ctx, drive, drive.accumulatedSignals)
	drive.accumulatedSignals = make(map[string]interface{})
	drive.lastTelemetryWrite = time.Now().UTC()
}

func (t *TelemetrySessionTracker) recordDriveTelemetry(ctx context.Context, drive *streamingDrive, signals map[string]interface{}) {
	reading := &models.DriveTelemetryReading{
		DriveID:   drive.DriveID,
		VehicleID: drive.VehicleID,
	}

	// Location — extract from Location map (fleet telemetry) or separate signals
	if la, lo, ok := signalLatLon(signals); ok {
		reading.Latitude = floatPtr(la)
		reading.Longitude = floatPtr(lo)
	}
	if v, ok := signalFloat(signals, "Elevation"); ok { reading.Elevation = floatPtr(v) }
	if v, ok := signalInt(signals, "GpsHeading", "Heading"); ok { reading.Heading = intPtr(v) }
	if v, ok := signalFloat(signals, "Odometer"); ok { reading.Odometer = floatPtr(v) }
	if v, ok := signalFloat(signals, "VehicleSpeed"); ok { reading.Speed = floatPtr(v) }
	if v, ok := signalPowerKW(signals); ok { reading.Power = floatPtr(v) }
	if v, ok := signalInt(signals, "BatteryLevel"); ok { reading.BatteryLevel = intPtr(v) }
	if v, ok := signalFloat(signals, "Soc"); ok { reading.Soc = floatPtr(v) }
	if v, ok := signalFloat(signals, "UsableSoc"); ok { reading.UsableSoc = floatPtr(v) }
	if v, ok := signalFloat(signals, "RatedRange"); ok { reading.RatedRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok { reading.IdealRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok { reading.EstRange = floatPtr(v) }
	if v, ok := signalFloat(signals, "InsideTemp"); ok { reading.InsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "OutsideTemp"); ok { reading.OutsideTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "HvacLeftTemperatureRequest", "DriverSeatTemp", "DriverTemp"); ok { reading.DriverTemp = floatPtr(v) }
	if v, ok := signalFloat(signals, "HvacRightTemperatureRequest", "PassengerSeatTemp", "PassengerTemp"); ok { reading.PassengerTemp = floatPtr(v) }
	if v, ok := signalInt(signals, "HvacFanStatus", "FanStatus"); ok { reading.FanStatus = intPtr(v) }
	if v, ok := signals["IsClimateOn"]; ok {
		if b, ok2 := v.(bool); ok2 { reading.IsClimateOn = boolPtr(b) }
	}
	// Fleet Telemetry sends tire pressure in bar via TpmsPressure* signals
	if v, ok := signalFloat(signals, "TpmsPressureFl", "TirePressureFL", "TPMS_PressureFL"); ok { reading.TirePressureFL = floatPtr(v) }
	if v, ok := signalFloat(signals, "TpmsPressureFr", "TirePressureFR", "TPMS_PressureFR"); ok { reading.TirePressureFR = floatPtr(v) }
	if v, ok := signalFloat(signals, "TpmsPressureRl", "TirePressureRL", "TPMS_PressureRL"); ok { reading.TirePressureRL = floatPtr(v) }
	if v, ok := signalFloat(signals, "TpmsPressureRr", "TirePressureRR", "TPMS_PressureRR"); ok { reading.TirePressureRR = floatPtr(v) }
	if v, ok := signals["BatteryHeaterOn"]; ok {
		if b, ok2 := v.(bool); ok2 { reading.BatteryHeaterOn = boolPtr(b) }
	}

	if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
		log.Error().Err(err).Int64("drive_id", drive.DriveID).Msg("telemetry: failed to insert drive telemetry reading")
	}
}

func (t *TelemetrySessionTracker) completeDriveLocked(ctx context.Context, vehicleID int64, active *streamingDrive, signals map[string]interface{}) {
	// Guard: prevent double-completion race between cleanup and normal end
	if active.Completing {
		return
	}
	active.Completing = true

	// Flush any remaining accumulated signals before closing
	if signals != nil {
		active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
	}
	t.flushDriveTelemetry(ctx, active)

	// Use accumulated state for end values, falling back to final signals
	finalSignals := signals
	if finalSignals == nil {
		finalSignals = map[string]interface{}{}
	}

	endBattery := 0
	if bl, ok := signalInt(finalSignals, "BatteryLevel", "Soc"); ok {
		endBattery = bl
	} else if active.SocCount > 0 && active.SocMin < math.MaxFloat64 {
		// Fallback: use the last SOC reading from the accumulator when
		// the final signal batch doesn't contain BatteryLevel.
		endBattery = int(active.SocMin)
	} else if active.StartSoc != nil {
		endBattery = int(*active.StartSoc)
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
	if v, ok := signalFloat(finalSignals, "RatedRange"); ok { endRatedRange = floatPtr(v) }
	if v, ok := signalFloat(finalSignals, "IdealBatteryRange"); ok { endIdealRange = floatPtr(v) }
	if v, ok := signalFloat(finalSignals, "EstBatteryRange"); ok { endEstRange = floatPtr(v) }
	if v, ok := signalFloat(finalSignals, "Soc", "BatteryLevel"); ok { endSoc = floatPtr(v) }
	if v, ok := signalFloat(finalSignals, "UsableSoc"); ok { endUsableSoc = floatPtr(v) }

	var powerMax, powerMin *float64
	if active.SpeedCount > 0 {
		// Always store power stats if we had any speed readings (drive was active)
		powerMax = &active.PowerMax
		if active.PowerMin < math.MaxFloat64 {
			powerMin = &active.PowerMin
		}
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

	// --- Backfill missing start/end values from nearest position data ---
	// Fleet Telemetry sends signals at different intervals (SOC every ~5 min,
	// odometer sporadically). If the drive start/end moment didn't coincide
	// with a reading, we find the closest position within ±10 minutes.
	go t.backfillDriveValues(active, vehicleID)

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
	TotalDrives.Inc()
	if distance > 0 {
		TotalDistanceKm.Add(distance)
	}
}

// backfillDriveValues checks if a completed drive has missing start/end values
// (SOC, odometer, range, elevation) and fills them from the nearest position data.
// Runs async after drive completion — does not block the telemetry pipeline.
func (t *TelemetrySessionTracker) backfillDriveValues(active *streamingDrive, vehicleID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	const lookupWindow = 10 * time.Minute
	backfill := map[string]interface{}{}

	// --- Backfill start values ---
	startNeedsBackfill := active.StartSoc == nil || *active.StartSoc == 0 ||
		active.StartOdometer == nil || *active.StartOdometer == 0 ||
		active.StartRatedRange == nil || *active.StartRatedRange == 0

	if startNeedsBackfill {
		startPos, err := t.posRepo.FindNearestPosition(ctx, vehicleID, active.StartTime, lookupWindow)
		if err == nil && startPos != nil {
			if (active.StartSoc == nil || *active.StartSoc == 0) && startPos.BatteryLvl > 0 {
				bl := startPos.BatteryLvl
				backfill["start_battery_level"] = bl
				backfill["soc_start"] = float64(bl)
			}
			if (active.StartOdometer == nil || *active.StartOdometer == 0) && startPos.Odometer > 0 {
				backfill["start_odometer"] = startPos.Odometer
			}
			if (active.StartRatedRange == nil || *active.StartRatedRange == 0) && startPos.RatedRange != nil && *startPos.RatedRange > 0 {
				backfill["start_rated_range_km"] = *startPos.RatedRange
			}
			if active.StartIdealRange == nil && startPos.IdealRange != nil && *startPos.IdealRange > 0 {
				backfill["start_ideal_range_km"] = *startPos.IdealRange
			}
			if active.StartEstRange == nil && startPos.Elevation != nil {
				backfill["elevation_start"] = *startPos.Elevation
			}
			if active.StartLatitude == nil && startPos.Latitude != 0 {
				backfill["start_latitude"] = startPos.Latitude
				backfill["start_longitude"] = startPos.Longitude
			}
		}
	}

	// --- Backfill end values ---
	endTime := time.Now().UTC()
	endPos, err := t.posRepo.FindNearestPosition(ctx, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if _, ok := backfill["soc_end"]; !ok {
			if endPos.BatteryLvl > 0 {
				backfill["end_battery_level"] = endPos.BatteryLvl
				backfill["soc_end"] = float64(endPos.BatteryLvl)
			}
		}
		if active.LastOdometer == nil && endPos.Odometer > 0 {
			backfill["end_odometer"] = endPos.Odometer
			// Recompute distance if we now have both start and end odometer
			startOdo := 0.0
			if active.StartOdometer != nil {
				startOdo = *active.StartOdometer
			} else if v, ok := backfill["start_odometer"]; ok {
				startOdo = v.(float64)
			}
			if startOdo > 0 {
				dist := endPos.Odometer - startOdo
				if dist > 0 {
					backfill["distance"] = dist
				}
			}
		}
		if endPos.RatedRange != nil && *endPos.RatedRange > 0 {
			backfill["end_rated_range_km"] = *endPos.RatedRange
		}
		if endPos.IdealRange != nil && *endPos.IdealRange > 0 {
			backfill["end_ideal_range_km"] = *endPos.IdealRange
		}
		if endPos.Elevation != nil {
			backfill["elevation_end"] = *endPos.Elevation
		}
		if active.LastLatitude == nil && endPos.Latitude != 0 {
			backfill["end_latitude"] = endPos.Latitude
			backfill["end_longitude"] = endPos.Longitude
		}
	}

	if len(backfill) > 0 {
		if err := t.driveRepo.PartialUpdate(ctx, active.DriveID, backfill); err != nil {
			log.Warn().Err(err).Int64("drive_id", active.DriveID).Msg("telemetry: failed to backfill drive values")
		} else {
			log.Info().Int64("drive_id", active.DriveID).Int("fields", len(backfill)).Msg("telemetry: backfilled drive values from nearest positions")
		}
	}
}

func (t *TelemetrySessionTracker) resolveAndUpdateAddress(driveID int64, lat, lon float64, isStart bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	field := "end_address"
	if isStart {
		field = "start_address"
	}

	// 1. Check geofences first (user-defined names like "Home", "Office")
	if geofences, err := t.geofenceRepo.FindByCoordinates(ctx, lat, lon); err == nil && len(geofences) > 0 {
		_ = t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: geofences[0].Name})
		GeocodingTotal.WithLabelValues("geofence").Inc()
		return
	}

	// 2. Check places cache (previously resolved locations within 50m)
	if cached, err := t.placesCache.FindNearby(ctx, lat, lon, 50); err == nil && cached != nil {
		_ = t.placesCache.IncrementHitCount(ctx, cached.ID)
		_ = t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: cached.DisplayName})
		GeocodingTotal.WithLabelValues("cached").Inc()
		return
	}

	// 3. Reverse geocode via Nominatim (or Google when configured)
	geocodeStart := time.Now()
	result, err := t.geocoder.ReverseGeocode(ctx, lat, lon)
	GeocodingDuration.Observe(time.Since(geocodeStart).Seconds())
	if err != nil {
		GeocodingTotal.WithLabelValues("failure").Inc()
		log.Warn().Err(err).Float64("lat", lat).Float64("lon", lon).Msg("telemetry: reverse geocode failed")
		return
	}
	GeocodingTotal.WithLabelValues("success").Inc()

	name := result.ShortName()

	// Save to cache for future lookups
	_ = t.placesCache.Upsert(ctx, &database.PlaceCacheEntry{
		Latitude:    lat,
		Longitude:   lon,
		DisplayName: name,
		Source:      "geocoding",
		City:        ptrStrOrNil(result.City),
		State:       ptrStrOrNil(result.State),
		Country:     ptrStrOrNil(result.Country),
		Postcode:    ptrStrOrNil(result.PostCode),
	})

	if err := t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: name}); err != nil {
		log.Error().Err(err).Int64("drive_id", driveID).Str("field", field).Msg("telemetry: failed to update address")
	}
}

// BackfillAddresses geocodes drives that have coordinates but no address names.
// Runs as a background goroutine at startup to fill in missing addresses.
func (t *TelemetrySessionTracker) BackfillAddresses(ctx context.Context) {
	drives, err := t.driveRepo.FindMissingAddresses(ctx)
	if err != nil {
		log.Error().Err(err).Msg("backfill: failed to query drives missing addresses")
		return
	}
	if len(drives) == 0 {
		return
	}
	log.Info().Int("count", len(drives)).Msg("backfill: geocoding drives with missing addresses")
	AddressBackfillRemaining.Set(float64(len(drives)))

	filled := 0
	for _, d := range drives {
		// Respect context cancellation (app shutdown)
		if ctx.Err() != nil {
			break
		}

		needStart := (d.StartAddress == nil || *d.StartAddress == "") && d.StartLatitude != nil && d.StartLongitude != nil
		needEnd := (d.EndAddress == nil || *d.EndAddress == "") && d.EndLatitude != nil && d.EndLongitude != nil

		if needStart {
			t.resolveAndUpdateAddress(d.ID, *d.StartLatitude, *d.StartLongitude, true)
			filled++
			AddressBackfillCompleted.Inc()
			AddressBackfillRemaining.Dec()
			// Rate-limit to avoid hammering the geocoder (Nominatim 1 req/sec policy)
			time.Sleep(1100 * time.Millisecond)
		}
		if needEnd {
			if ctx.Err() != nil {
				break
			}
			t.resolveAndUpdateAddress(d.ID, *d.EndLatitude, *d.EndLongitude, false)
			filled++
			AddressBackfillCompleted.Inc()
			AddressBackfillRemaining.Dec()
			time.Sleep(1100 * time.Millisecond)
		}
	}
	log.Info().Int("resolved", filled).Int("total_drives", len(drives)).Msg("backfill: address geocoding complete")
}

func ptrStrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (t *TelemetrySessionTracker) trackCharging(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	chargeState, hasChargeState := signalStr(signals, "DetailedChargeState", "ChargeState")
	if !hasChargeState {
		// Even without charge state, accumulate signals for active charge
		t.mu.Lock()
		if active, ok := t.activeCharges[vehicleID]; ok {
			active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
			active.LastSeen = time.Now().UTC()
			t.maybeFlushChargeTelemetry(ctx, active)
		}
		t.mu.Unlock()
		return
	}

	// Tesla Fleet Telemetry sends enum values with prefixes like
	// "DetailedChargeStateCharging", "DetailedChargeStateStarting", or just "Enable".
	isCharging := strings.Contains(chargeState, "Charging") || strings.Contains(chargeState, "Starting") || chargeState == "Enable"

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasCharge := t.activeCharges[vehicleID]

	if isCharging && !hasCharge {
		// === START CHARGE ===
		// Use accumulated signals from handler as fallback for start values
		batteryLevel, hasBat := signalInt(signals, "BatteryLevel", "Soc")
		if !hasBat {
			batteryLevel, _ = signalInt(accumulatedSignals, "BatteryLevel", "Soc")
		}
		lat, lon, hasLoc := signalLatLon(signals)
		if !hasLoc {
			lat, lon, hasLoc = signalLatLon(accumulatedSignals)
		}
		startRange, hasRange := signalFloat(signals, "RatedRange")
		if !hasRange {
			startRange, _ = signalFloat(accumulatedSignals, "RatedRange")
		}

		session := &models.ChargingSession{
			VehicleID:         vehicleID,
			StartDate:         time.Now().UTC(),
			StartBatteryLevel: batteryLevel,
		}
		if startRange > 0 {
			session.StartRangeKm = floatPtr(startRange)
		}
		if hasLoc {
			session.Latitude = floatPtr(lat)
			session.Longitude = floatPtr(lon)
		}

		if err := t.chargeRepo.Create(ctx, session); err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to create charge session")
			return
		}

		sc := &streamingCharge{
			SessionID:          session.ID,
			VehicleID:          vehicleID,
			StartTime:          time.Now().UTC(),
			LastSeen:           time.Now().UTC(),
			StartBatteryLevel:  batteryLevel,
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}
		if hasLoc {
			sc.Latitude = floatPtr(lat)
			sc.Longitude = floatPtr(lon)
		}
		if startRange > 0 { sc.StartRangeKm = floatPtr(startRange) }

		t.activeCharges[vehicleID] = sc
		ChargeSessionsActive.Inc()

		// Accumulate and flush first reading immediately
		sc.accumulatedSignals = accumulateSignals(sc.accumulatedSignals, signals)
		t.flushChargeTelemetry(ctx, sc)

		log.Info().Int64("vehicle_id", vehicleID).Int64("session_id", session.ID).Msg("telemetry: charging started")
		if t.eventBus != nil {
			t.eventBus.Publish(events.Event{Type: events.ChargeStarted, VehicleID: vehicleID, VIN: vin,
				Data: map[string]interface{}{"session_id": session.ID, "battery_level": batteryLevel, "source": "fleet_telemetry"}})
		}

	} else if isCharging && hasCharge {
		// === UPDATE ACTIVE CHARGE ===
		active.LastSeen = time.Now().UTC()

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

		// Accumulate signals and flush periodically
		active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
		t.maybeFlushChargeTelemetry(ctx, active)

	} else if !isCharging && hasCharge {
		// === CHARGE ENDED ===
		t.completeChargeLocked(ctx, vehicleID, active, signals)
	}
}

// maybeFlushChargeTelemetry writes accumulated signals if the write interval has elapsed.
func (t *TelemetrySessionTracker) maybeFlushChargeTelemetry(ctx context.Context, charge *streamingCharge) {
	if time.Since(charge.lastTelemetryWrite) < telemetryWriteInterval {
		return
	}
	t.flushChargeTelemetry(ctx, charge)
}

// flushChargeTelemetry writes a telemetry reading from accumulated signals and resets the accumulator.
func (t *TelemetrySessionTracker) flushChargeTelemetry(ctx context.Context, charge *streamingCharge) {
	if len(charge.accumulatedSignals) == 0 {
		return
	}
	t.recordChargeTelemetry(ctx, charge, charge.accumulatedSignals)
	charge.accumulatedSignals = make(map[string]interface{})
	charge.lastTelemetryWrite = time.Now().UTC()
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
	if la, lo, ok := signalLatLon(signals); ok {
		reading.Latitude = floatPtr(la)
		reading.Longitude = floatPtr(lo)
	}
	if v, ok := signalFloat(signals, "ChargeRateMilePerHour", "ChargeRateMph"); ok { reading.ChargeRate = floatPtr(v) }

	if err := t.chargeTelRepo.Insert(ctx, reading); err != nil {
		log.Error().Err(err).Int64("session_id", charge.SessionID).Msg("telemetry: failed to insert charge telemetry reading")
	}
}

func (t *TelemetrySessionTracker) completeChargeLocked(ctx context.Context, vehicleID int64, active *streamingCharge, signals map[string]interface{}) {
	// Guard: prevent double-completion race between cleanup and normal end
	if active.Completing {
		return
	}
	active.Completing = true

	// Flush remaining accumulated signals
	if signals != nil {
		active.accumulatedSignals = accumulateSignals(active.accumulatedSignals, signals)
	}
	t.flushChargeTelemetry(ctx, active)

	finalSignals := signals
	if finalSignals == nil {
		finalSignals = map[string]interface{}{}
	}

	endBattery := 0
	if bl, ok := signalInt(finalSignals, "BatteryLevel", "Soc"); ok {
		endBattery = bl
	}
	duration := time.Since(active.StartTime).Minutes()

	// Backfill from telemetry readings if in-memory values are empty
	if endBattery == 0 || active.EnergyAdded == 0 || active.Power == nil || active.Voltage == nil {
		var maxBatt, maxPower, maxEnergy, maxVoltage, maxCurrent *float64
		var maxPhases *int
		_ = t.db.Pool.QueryRow(ctx, `SELECT 
			MAX(battery_level)::float, MAX(power_kw), MAX(energy_added),
			MAX(voltage), MAX(current_amps), MAX(phases)
			FROM charge_telemetry_readings WHERE session_id = $1`,
			active.SessionID).Scan(&maxBatt, &maxPower, &maxEnergy, &maxVoltage, &maxCurrent, &maxPhases)
		if endBattery == 0 && maxBatt != nil { endBattery = int(*maxBatt) }
		if active.EnergyAdded == 0 && maxEnergy != nil && *maxEnergy > 0 { active.EnergyAdded = *maxEnergy }
		if active.Power == nil && maxPower != nil { active.Power = maxPower }
		if active.Voltage == nil && maxVoltage != nil { v := int(*maxVoltage); active.Voltage = &v }
		if active.Current == nil && maxCurrent != nil { v := int(*maxCurrent); active.Current = &v }
		if active.Phases == nil && maxPhases != nil { active.Phases = maxPhases }
	}

	// Estimate energy from battery% diff if direct energy signal unavailable
	if active.EnergyAdded == 0 && active.StartBatteryLevel > 0 && endBattery > active.StartBatteryLevel {
		estimatedKWh := float64(endBattery-active.StartBatteryLevel) * 0.75
		active.EnergyAdded = estimatedKWh
	}

	// Get end range
	var endRange *float64
	if v, ok := signalFloat(finalSignals, "RatedRange"); ok { endRange = floatPtr(v) }

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

			// 1. Check geofences first (user-defined name)
			if geofences, err := t.geofenceRepo.FindByCoordinates(gctx, lat, lon); err == nil && len(geofences) > 0 {
				fields["location_name"] = geofences[0].Name
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// 2. Check places cache (previously resolved, within 50m)
			if cached, err := t.placesCache.FindNearby(gctx, lat, lon, 50); err == nil && cached != nil {
				_ = t.placesCache.IncrementHitCount(gctx, cached.ID)
				fields["location_name"] = cached.DisplayName
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// 3. Reverse geocode and cache the result
			result, err := t.geocoder.ReverseGeocode(gctx, lat, lon)
			if err != nil {
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}
			name := result.ShortName()
			fields["location_name"] = name
			_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)

			// Save to cache
			_ = t.placesCache.Upsert(gctx, &database.PlaceCacheEntry{
				Latitude: lat, Longitude: lon, DisplayName: name, Source: "geocoding",
				City: ptrStrOrNil(result.City), State: ptrStrOrNil(result.State),
				Country: ptrStrOrNil(result.Country), Postcode: ptrStrOrNil(result.PostCode),
			})
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
	TotalCharges.Inc()
	if active.EnergyAdded > 0 {
		TotalEnergyKwh.Add(active.EnergyAdded)
	}

	// Backfill missing start/end values from nearest position data (async)
	go t.backfillChargeValues(active, vehicleID)
}

// backfillChargeValues fills missing charging session start/end values
// from the nearest position data, similar to backfillDriveValues.
func (t *TelemetrySessionTracker) backfillChargeValues(active *streamingCharge, vehicleID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	const lookupWindow = 10 * time.Minute
	backfill := map[string]interface{}{}

	// Backfill start battery from nearest position
	if active.StartBatteryLevel == 0 {
		startPos, err := t.posRepo.FindNearestPosition(ctx, vehicleID, active.StartTime, lookupWindow)
		if err == nil && startPos != nil && startPos.BatteryLvl > 0 {
			backfill["start_battery_level"] = startPos.BatteryLvl
		}
		if err == nil && startPos != nil && startPos.RatedRange != nil && *startPos.RatedRange > 0 {
			backfill["start_range_km"] = *startPos.RatedRange
		}
	}

	// Backfill end battery/range from nearest position to end time
	endTime := time.Now().UTC()
	endPos, err := t.posRepo.FindNearestPosition(ctx, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_battery_level"] = endPos.BatteryLvl
		}
		if endPos.RatedRange != nil && *endPos.RatedRange > 0 {
			backfill["end_range_km"] = *endPos.RatedRange
		}
		if active.Latitude == nil && endPos.Latitude != 0 {
			backfill["latitude"] = endPos.Latitude
			backfill["longitude"] = endPos.Longitude
		}
	}

	if len(backfill) > 0 {
		if err := t.chargeRepo.PartialUpdate(ctx, active.SessionID, backfill); err != nil {
			log.Warn().Err(err).Int64("session_id", active.SessionID).Msg("telemetry: failed to backfill charge values")
		} else {
			log.Info().Int64("session_id", active.SessionID).Int("fields", len(backfill)).Msg("telemetry: backfilled charge values from nearest positions")
		}
	}
}
