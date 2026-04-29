package api

import (
	"context"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/units"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// TelemetrySessionTracker detects drive starts/ends and charge starts/ends
// from streaming Fleet Telemetry signals. Tracks comprehensive telemetry
// data throughout sessions for analytics.
type TelemetrySessionTracker struct {
	db                  *database.DB
	driveRepo           *database.DriveRepo
	chargeRepo          *database.ChargingRepo
	posRepo             *database.PositionRepo
	geofenceRepo        *database.GeofenceRepo
	placesCache         *database.PlacesCacheRepo
	tripRepo            *database.TripRepo
	eventBus            *events.Bus
	geocoder            geocoding.Geocoder
	localSignals        *signal.Store
	signalHistoryWriter *database.SignalHistoryWriter
	signalLogReader     *database.SignalLogReader

	mu            sync.Mutex
	activeDrives  map[int64]*streamingDrive  // vehicleID → active drive
	activeCharges map[int64]*streamingCharge // vehicleID → active charge
}

// streamingDrive tracks comprehensive data during an active drive session.
type streamingDrive struct {
	DriveID           int64
	VehicleID         int64
	StartTime         time.Time
	LastSpeed         float64
	LastSeen          time.Time
	LastSpeedZeroTime time.Time
	GearBased         bool // true if drive was started by Gear signal (not speed)
	Completing        bool // true while being completed — prevents double-completion

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
	MaxSpeed   float64
	MinSpeed   float64
	SpeedSum   float64
	SpeedCount int

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

	// Elevation tracking
	LastElevation *float64
	ElevationGain float64
	ElevationLoss float64

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
	TempCount                     int

	// Charger details (captured during session)
	Phases           *int
	Voltage          *int
	Current          *int
	Power            *float64
	FastChargerType  *string
	FastChargerBrand *string
	ChargeCable      *string

	// Battery at start
	StartBatteryLevel int
	StartRangeKm      *float64
	Completing        bool // prevents double-completion race
}

// NewTelemetrySessionTracker creates a session tracker with comprehensive data tracking.
func NewTelemetrySessionTracker(db *database.DB, eventBus *events.Bus, geocoder geocoding.Geocoder, store *signal.Store) *TelemetrySessionTracker {
	t := &TelemetrySessionTracker{
		db:            db,
		driveRepo:     database.NewDriveRepo(db),
		chargeRepo:    database.NewChargingRepo(db),
		posRepo:       database.NewPositionRepo(db),
		geofenceRepo:  database.NewGeofenceRepo(db),
		placesCache:   database.NewPlacesCacheRepo(db),
		tripRepo:      database.NewTripRepo(db),
		eventBus:      eventBus,
		geocoder:      geocoder,
		localSignals:  store,
		activeDrives:  make(map[int64]*streamingDrive),
		activeCharges: make(map[int64]*streamingCharge),
	}
	return t
}

// StartBufferDrains is retained for caller compatibility (main.go). Telemetry
// buffers were removed — drive/charge data now lands in signal_log.
func (t *TelemetrySessionTracker) StartBufferDrains(ctx context.Context) {}

// FlushBuffers is retained for caller compatibility (main.go).
func (t *TelemetrySessionTracker) FlushBuffers(ctx context.Context) {}

// DriveBufferLen is retained for caller compatibility (router.go).
func (t *TelemetrySessionTracker) DriveBufferLen() int { return 0 }

// ChargeBufferLen is retained for caller compatibility (router.go).
func (t *TelemetrySessionTracker) ChargeBufferLen() int { return 0 }

// SetSignalLogReader enables signal_log-based drive/charge completion enrichment.
func (t *TelemetrySessionTracker) SetSignalLogReader(r *database.SignalLogReader) {
	t.signalLogReader = r
}

// telemetryWriteInterval controls how often drive/charge telemetry readings are
// flushed to the database. Signals are accumulated across MQTT batches within
// this window so each row has complete data instead of mostly NULLs.
const telemetryWriteInterval = 5 * time.Second

// RecoverSessions restores active drive/charge sessions from Postgres on pod restart.
// Queries for sessions with no end_ts and rebuilds the in-memory tracking state.
func (t *TelemetrySessionTracker) RecoverSessions(ctx context.Context) {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Recover open drives (started within last 24 hours)
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	openDrives, err := t.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open drives")
	}
	for _, d := range openDrives {
		if _, exists := t.activeDrives[d.VehicleID]; exists {
			continue
		}
		sd := &streamingDrive{
			DriveID:            d.ID,
			VehicleID:          d.VehicleID,
			StartTime:          d.StartTs,
			LastSeen:           time.Now().UTC(),
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}

		t.activeDrives[d.VehicleID] = sd
		log.Info().Int64("drive_id", d.ID).Int64("vehicle_id", d.VehicleID).Msg("session recovery: restored open drive")
	}

	// Recover open charges (started within last 48 hours — charges can be long)
	chargeCutoff := time.Now().UTC().Add(-48 * time.Hour)
	openCharges, err := t.chargeRepo.GetStale(ctx, chargeCutoff)
	if err != nil {
		log.Warn().Err(err).Msg("session recovery: failed to query open charges")
	}
	for _, c := range openCharges {
		if _, exists := t.activeCharges[c.VehicleID]; exists {
			continue
		}
		sc := &streamingCharge{
			SessionID:          c.ID,
			VehicleID:          c.VehicleID,
			StartTime:          c.StartTs,
			StartBatteryLevel:  derefInt16AsInt(c.StartBatteryPct),
			LastSeen:           time.Now().UTC(),
			accumulatedSignals: make(map[string]interface{}),
			lastTelemetryWrite: time.Now().UTC(),
		}
		if c.ChargerPowerKwMax != nil {
			sc.Power = c.ChargerPowerKwMax
		}
		t.activeCharges[c.VehicleID] = sc
		log.Info().Int64("session_id", c.ID).Int64("vehicle_id", c.VehicleID).Msg("session recovery: restored open charge")
	}

	log.Info().Int("drives", len(t.activeDrives)).Int("charges", len(t.activeCharges)).Msg("session recovery: complete")
}

// ValidateRecoveredSessions checks recovered sessions against current SignalStore state.
// Auto-closes sessions that are no longer active (vehicle parked, charge complete, or timed out).
func (t *TelemetrySessionTracker) ValidateRecoveredSessions(ctx context.Context) {
	t.mu.Lock()
	defer t.mu.Unlock()

	for vehicleID, drive := range t.activeDrives {
		// Auto-close drives open > 4 hours with no new telemetry
		if time.Since(drive.StartTime) > 4*time.Hour {
			log.Info().Int64("drive_id", drive.DriveID).Msg("session recovery: auto-closing stale drive (>4h)")
			t.completeDriveLocked(ctx, vehicleID, drive, nil)
			continue
		}
		// If SignalStore shows Gear=P and Speed=0, close the drive
		if t.localSignals != nil {
			if gear, ok := t.localSignals.GetString(vehicleID, "Gear"); ok && gear == enums.GearPark {
				log.Info().Int64("drive_id", drive.DriveID).Msg("session recovery: closing drive (Gear=P)")
				t.completeDriveLocked(ctx, vehicleID, drive, nil)
			}
		}
	}

	for vehicleID, charge := range t.activeCharges {
		// Auto-close charges open > 24 hours
		if time.Since(charge.StartTime) > 24*time.Hour {
			log.Info().Int64("session_id", charge.SessionID).Msg("session recovery: auto-closing stale charge (>24h)")
			t.completeChargeLocked(ctx, vehicleID, charge, nil)
			continue
		}
		// If SignalStore shows charge complete, close
		if t.localSignals != nil {
			if state, ok := t.localSignals.GetString(vehicleID, "DetailedChargeState"); ok {
				if enums.IsChargeComplete(state) {
					log.Info().Int64("session_id", charge.SessionID).Msg("session recovery: closing charge (Complete)")
					t.completeChargeLocked(ctx, vehicleID, charge, nil)
				}
			}
		}
	}
}

// staleSessionThreshold is the minimum duration since the last signal before
// a session is considered stale and eligible for recovery completion.
const staleSessionThreshold = 5 * time.Minute

// RecoverIncompleteSessions finds drives and charges with end_ts IS NULL that
// are not currently tracked in memory, and completes them using signal_log data.
// Run once at startup after RecoverSessions / ValidateRecoveredSessions.
// Sessions with recent signals (< 5 min) are left open — the vehicle is likely
// still active and will be picked up by normal tracking.
func (t *TelemetrySessionTracker) RecoverIncompleteSessions(ctx context.Context) {
	if t.signalLogReader == nil {
		log.Info().Msg("recovery: signal_log reader not available, skipping incomplete session recovery")
		return
	}

	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now().UTC()

	// 1. Find all open drives (end_ts IS NULL, start_ts < now)
	openDrives, err := t.driveRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open drives")
	}
	var drivesRecovered, drivesSkipped int
	for _, drive := range openDrives {
		// Skip if already tracked in memory (recovered by RecoverSessions)
		if _, exists := t.activeDrives[drive.VehicleID]; exists {
			continue
		}

		lastSignalTs, tsErr := t.signalLogReader.LatestTimestamp(ctx, drive.VehicleID)
		if tsErr != nil {
			log.Warn().Err(tsErr).Int64("drive_id", drive.ID).Int64("vehicle_id", drive.VehicleID).
				Msg("recovery: failed to get latest signal timestamp for drive")
			continue
		}
		if lastSignalTs.IsZero() {
			// No signals at all — complete with minimal data
			log.Info().Int64("drive_id", drive.ID).Msg("recovery: completing drive with no signal_log data")
			t.completeRecoveredDrive(ctx, drive, nil, nil, now)
			drivesRecovered++
			continue
		}

		staleDuration := now.Sub(lastSignalTs)
		if staleDuration < staleSessionThreshold {
			log.Info().Int64("drive_id", drive.ID).Msg("recovery: drive still active, skipping")
			drivesSkipped++
			continue
		}

		log.Info().Int64("drive_id", drive.ID).Time("last_signal", lastSignalTs).
			Msg("recovery: completing stale drive from signal_log")

		startSnap, startErr := t.signalLogReader.SnapshotAt(ctx, drive.VehicleID, drive.StartTs)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("drive_id", drive.ID).Msg("recovery: start snapshot failed")
			startSnap = map[string]interface{}{}
		}
		endSnap, endErr := t.signalLogReader.SnapshotAt(ctx, drive.VehicleID, lastSignalTs)
		if endErr != nil {
			log.Warn().Err(endErr).Int64("drive_id", drive.ID).Msg("recovery: end snapshot failed")
			endSnap = map[string]interface{}{}
		}

		t.completeRecoveredDrive(ctx, drive, startSnap, endSnap, lastSignalTs)
		drivesRecovered++
	}

	// 2. Find all open charges (end_ts IS NULL, start_ts < now)
	openCharges, err := t.chargeRepo.GetStale(ctx, now)
	if err != nil {
		log.Warn().Err(err).Msg("recovery: failed to query open charges")
	}
	var chargesRecovered, chargesSkipped int
	for _, charge := range openCharges {
		// Skip if already tracked in memory (recovered by RecoverSessions)
		if _, exists := t.activeCharges[charge.VehicleID]; exists {
			continue
		}

		lastSignalTs, tsErr := t.signalLogReader.LatestTimestamp(ctx, charge.VehicleID)
		if tsErr != nil {
			log.Warn().Err(tsErr).Int64("charge_id", charge.ID).Int64("vehicle_id", charge.VehicleID).
				Msg("recovery: failed to get latest signal timestamp for charge")
			continue
		}
		if lastSignalTs.IsZero() {
			log.Info().Int64("charge_id", charge.ID).Msg("recovery: completing charge with no signal_log data")
			t.completeRecoveredCharge(ctx, charge, nil, nil, now)
			chargesRecovered++
			continue
		}

		staleDuration := now.Sub(lastSignalTs)
		if staleDuration < staleSessionThreshold {
			log.Info().Int64("charge_id", charge.ID).Msg("recovery: charge still active, skipping")
			chargesSkipped++
			continue
		}

		log.Info().Int64("charge_id", charge.ID).Time("last_signal", lastSignalTs).
			Msg("recovery: completing stale charge from signal_log")

		startSnap, startErr := t.signalLogReader.SnapshotAt(ctx, charge.VehicleID, charge.StartTs)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("charge_id", charge.ID).Msg("recovery: charge start snapshot failed")
			startSnap = map[string]interface{}{}
		}
		endSnap, endErr := t.signalLogReader.SnapshotAt(ctx, charge.VehicleID, lastSignalTs)
		if endErr != nil {
			log.Warn().Err(endErr).Int64("charge_id", charge.ID).Msg("recovery: charge end snapshot failed")
			endSnap = map[string]interface{}{}
		}

		t.completeRecoveredCharge(ctx, charge, startSnap, endSnap, lastSignalTs)
		chargesRecovered++
	}

	log.Info().
		Int("drives_recovered", drivesRecovered).Int("drives_skipped", drivesSkipped).
		Int("charges_recovered", chargesRecovered).Int("charges_skipped", chargesSkipped).
		Msg("recovery: incomplete session recovery complete")
}

// completeRecoveredDrive closes a drive that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
func (t *TelemetrySessionTracker) completeRecoveredDrive(ctx context.Context, drive *models.Drive, startSnap, endSnap map[string]interface{}, endTs time.Time) {
	if startSnap == nil {
		startSnap = map[string]interface{}{}
	}
	if endSnap == nil {
		endSnap = map[string]interface{}{}
	}

	duration := endTs.Sub(drive.StartTs).Minutes()
	enhancedFields := map[string]interface{}{
		"ended_status": "recovered",
	}

	// Unit preferences from snapshots
	startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
	endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")
	endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

	// Distance from odometer (unit-aware, normalized to miles)
	var distance float64
	if startOdoRaw, ok := snapFloat(startSnap, "Odometer"); ok {
		if endOdoRaw, ok := snapFloat(endSnap, "Odometer"); ok {
			startOdo := units.NormalizeDistance(startOdoRaw, startDistUnit)
			endOdo := units.NormalizeDistance(endOdoRaw, endDistUnit)
			d := endOdo - startOdo
			if d > 0 {
				distance = d
				enhancedFields["distance_mi"] = distance
			}
		}
	}

	// Battery
	var endBattery int
	if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
		enhancedFields["start_battery_pct"] = int16(bl)
	}
	if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
		endBattery = int(bl)
	}

	// Position from snapshots
	if lat, ok := snapFloat(startSnap, "Latitude"); ok {
		enhancedFields["start_lat"] = lat
	}
	if lon, ok := snapFloat(startSnap, "Longitude"); ok {
		enhancedFields["start_lon"] = lon
	}
	if lat, ok := snapFloat(endSnap, "Latitude"); ok {
		enhancedFields["end_lat"] = lat
	}
	if lon, ok := snapFloat(endSnap, "Longitude"); ok {
		enhancedFields["end_lon"] = lon
	}

	// Temperature (unit-aware, normalized to °C)
	var insideAvg, outsideAvg *float64
	if temp, ok := snapFloat(endSnap, "OutsideTemp"); ok {
		normalized := units.NormalizeTemp(temp, endTempUnit)
		enhancedFields["outside_temp_avg_c"] = normalized
		outsideAvg = &normalized
	}
	if temp, ok := snapFloat(endSnap, "InsideTemp"); ok {
		normalized := units.NormalizeTemp(temp, endTempUnit)
		enhancedFields["inside_temp_avg_c"] = normalized
		insideAvg = &normalized
	}

	// Energy: delta of cumulative counters
	if startEnergy, ok := snapFloat(startSnap, "LifetimeEnergyUsed"); ok {
		if endEnergy, ok := snapFloat(endSnap, "LifetimeEnergyUsed"); ok {
			energyUsed := endEnergy - startEnergy
			if energyUsed > 0 {
				enhancedFields["energy_used_kwh"] = energyUsed
			}
		}
	}

	// Aggregates from signal_log during the drive window
	var maxSpeed float64
	var powerMax *float64
	slAvgSpeed, slMaxSpeed, slAvgPower := t.signalLogReader.DriveAggregates(ctx, drive.VehicleID, drive.StartTs, endTs)
	if slAvgSpeed > 0 {
		normalizedAvg := units.NormalizeSpeed(slAvgSpeed, endDistUnit)
		enhancedFields["avg_speed_mph"] = normalizedAvg
	}
	if slMaxSpeed > 0 {
		normalizedMax := units.NormalizeSpeed(slMaxSpeed, endDistUnit)
		enhancedFields["max_speed_mph"] = normalizedMax
		maxSpeed = normalizedMax
	}
	if slAvgPower != 0 {
		p := math.Abs(slAvgPower)
		enhancedFields["avg_power_kw"] = p
		powerMax = &p
	}

	// Regen energy
	regenKwh := t.signalLogReader.RegenEnergy(ctx, drive.VehicleID, drive.StartTs, endTs)
	if regenKwh > 0 {
		enhancedFields["regen_kwh"] = regenKwh
	}

	// Commit to DB
	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if b := int16(endBattery); b > 0 {
			endBatteryPct = &b
		}
		if err := t.driveRepo.CompleteWithTx(ctx, tx, drive.ID, endTs,
			distance, duration, endBatteryPct, &maxSpeed, powerMax, insideAvg, outsideAvg); err != nil {
			return err
		}
		if len(enhancedFields) > 0 {
			if err := t.driveRepo.PartialUpdateWithTx(ctx, tx, drive.ID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Error().Err(err).Int64("drive_id", drive.ID).Msg("recovery: failed to complete drive")
		return
	}

	log.Info().Int64("drive_id", drive.ID).Int64("vehicle_id", drive.VehicleID).
		Time("original_start", drive.StartTs).Time("recovered_end", endTs).
		Float64("duration_min", duration).Float64("distance_mi", distance).
		Msg("recovery: drive completed")
}

// completeRecoveredCharge closes a charge that was left open after a crash, using
// signal_log snapshots to populate end values. Best-effort: if snapshots are
// empty the session is still closed with whatever data is available.
func (t *TelemetrySessionTracker) completeRecoveredCharge(ctx context.Context, charge *models.ChargingSession, startSnap, endSnap map[string]interface{}, endTs time.Time) {
	if startSnap == nil {
		startSnap = map[string]interface{}{}
	}
	if endSnap == nil {
		endSnap = map[string]interface{}{}
	}

	duration := endTs.Sub(charge.StartTs).Minutes()
	enhancedFields := map[string]interface{}{
		"ended_status": "recovered",
	}

	// Unit preferences from snapshots
	startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
	endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")
	endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

	// Battery level from snapshots
	var endBattery int
	if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
		enhancedFields["start_battery_pct"] = int16(bl)
	}
	if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
		endBattery = int(bl)
	}

	// Energy added: difference in cumulative energy counter
	var energyAdded float64
	if startEnergy, ok := snapFloat(startSnap, "ACChargingEnergyIn"); ok {
		if endEnergy, ok := snapFloat(endSnap, "ACChargingEnergyIn"); ok {
			delta := endEnergy - startEnergy
			if delta > 0 {
				energyAdded = delta
				enhancedFields["energy_added_kwh"] = delta
			}
		}
	}

	// Estimate energy from battery% diff if direct signal unavailable
	startBattery := derefInt16AsInt(charge.StartBatteryPct)
	if energyAdded == 0 && startBattery > 0 && endBattery > startBattery {
		energyAdded = float64(endBattery-startBattery) * 0.75
	}

	// Range added (normalized to miles)
	var milesAdded *float64
	if startRangeRaw, ok := snapFloat(startSnap, "BatteryRange"); ok {
		if endRangeRaw, ok := snapFloat(endSnap, "BatteryRange"); ok {
			startRangeMi := units.NormalizeDistance(startRangeRaw, startDistUnit)
			endRangeMi := units.NormalizeDistance(endRangeRaw, endDistUnit)
			mi := endRangeMi - startRangeMi
			if mi > 0 {
				milesAdded = &mi
				enhancedFields["miles_added"] = mi
			}
		}
	}

	// Location from snapshots
	if lat, ok := snapFloat(endSnap, "Latitude"); ok {
		enhancedFields["latitude"] = lat
	}
	if lon, ok := snapFloat(endSnap, "Longitude"); ok {
		enhancedFields["longitude"] = lon
	}

	// Temperature (unit-aware, normalized to °C)
	if temp, ok := snapFloat(endSnap, "InsideTemp"); ok {
		normalized := units.NormalizeTemp(temp, endTempUnit)
		enhancedFields["inside_temp_avg_c"] = normalized
	}
	if temp, ok := snapFloat(endSnap, "OutsideTemp"); ok {
		normalized := units.NormalizeTemp(temp, endTempUnit)
		enhancedFields["outside_temp_avg_c"] = normalized
	}

	// Charger type detection from snapshot
	if dcPower, ok := snapFloat(endSnap, "DCChargingPower"); ok && dcPower > 0 {
		enhancedFields["charger_type"] = "DC"
	}

	// Max/avg power from signal_log aggregate during charge window
	slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, charge.VehicleID, charge.StartTs, endTs)
	if slMaxPower > 0 {
		enhancedFields["charger_power_kw_max"] = slMaxPower
	}
	if slAvgPower > 0 {
		enhancedFields["charger_power_kw_avg"] = slAvgPower
	}

	// Charger spec fields from signal_log snapshots
	if v, ok := snapFloat(endSnap, "ChargerVoltage"); ok && v > 0 {
		enhancedFields["max_charger_voltage"] = int16(v)
	}
	if v, ok := snapFloat(endSnap, "ChargerPhases"); ok && v > 0 {
		enhancedFields["charger_phases"] = int16(v)
	}
	if v, ok := signalStr(endSnap, "ChargingCableType"); ok {
		enhancedFields["cable_type"] = v
	}

	// Commit to DB
	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if b := int16(endBattery); b > 0 {
			endBatteryPct = &b
		}
		var energyAddedPtr *float64
		if energyAdded > 0 {
			energyAddedPtr = &energyAdded
		}
		var maxPower, avgPower *float64
		if slMaxPower > 0 {
			maxPower = &slMaxPower
		}
		if slAvgPower > 0 {
			avgPower = &slAvgPower
		}
		endedStatus := "recovered"
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, charge.ID, endTs,
			energyAddedPtr, endBatteryPct, milesAdded,
			maxPower, avgPower,
			nil, nil, &duration, &endedStatus); err != nil {
			return err
		}
		if len(enhancedFields) > 0 {
			if err := t.chargeRepo.PartialUpdateWithTx(ctx, tx, charge.ID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		log.Error().Err(err).Int64("charge_id", charge.ID).Msg("recovery: failed to complete charge")
		return
	}

	log.Info().Int64("charge_id", charge.ID).Int64("vehicle_id", charge.VehicleID).
		Time("original_start", charge.StartTs).Time("recovered_end", endTs).
		Float64("duration_min", duration).Float64("energy_added_kwh", energyAdded).
		Msg("recovery: charge completed")
}

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

// resolveFloat gets a float signal from batch → accumulated → SignalStore (last-known).
func (t *TelemetrySessionTracker) resolveFloat(vehicleID int64, signals, accum map[string]interface{}, keys ...string) (float64, bool) {
	if v, ok := signalFloat(signals, keys...); ok {
		return v, true
	}
	if v, ok := signalFloat(accum, keys...); ok {
		return v, true
	}
	if t.localSignals != nil {
		for _, k := range keys {
			if v, ok := t.localSignals.GetFloat(vehicleID, k); ok {
				return v, true
			}
		}
	}
	return 0, false
}

// resolveInt gets an int signal from batch → accumulated → SignalStore.
func (t *TelemetrySessionTracker) resolveInt(vehicleID int64, signals, accum map[string]interface{}, keys ...string) (int, bool) {
	if v, ok := signalInt(signals, keys...); ok {
		return v, true
	}
	if v, ok := signalInt(accum, keys...); ok {
		return v, true
	}
	if t.localSignals != nil {
		for _, k := range keys {
			if fv, ok := t.localSignals.GetFloat(vehicleID, k); ok {
				return int(fv), true
			}
		}
	}
	return 0, false
}

// resolveLatLon gets location from batch → accumulated → SignalStore.
func (t *TelemetrySessionTracker) resolveLatLon(vehicleID int64, signals, accum map[string]interface{}) (float64, float64, bool) {
	if lat, lon, ok := signalLatLon(signals); ok {
		return lat, lon, true
	}
	if lat, lon, ok := signalLatLon(accum); ok {
		return lat, lon, true
	}
	if t.localSignals != nil {
		lat, latOk := t.localSignals.GetFloat(vehicleID, "Latitude")
		lon, lonOk := t.localSignals.GetFloat(vehicleID, "Longitude")
		if latOk && lonOk && lat != 0 && lon != 0 {
			return lat, lon, true
		}
	}
	return 0, 0, false
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

	// Close orphaned DB sessions — drives/charges with NULL end_ts that started
	// more than staleTimeout ago and have no in-memory tracker (e.g. from pre-restart)
	cutoff := now.Add(-staleTimeout)
	_, err := t.db.Pool.Exec(ctx,
		`UPDATE drives SET end_ts = $1, duration_min = EXTRACT(EPOCH FROM ($1 - start_ts))/60,
		 ended_status = 'interrupted'
		 WHERE end_ts IS NULL AND start_ts < $2`, now, cutoff)
	if err != nil {
		log.Warn().Err(err).Msg("telemetry: failed to close orphaned drives")
	}
	_, err = t.db.Pool.Exec(ctx,
		`UPDATE charging_sessions SET end_ts = $1,
		 duration_min = EXTRACT(EPOCH FROM ($1 - start_ts))/60,
		 ended_status = 'interrupted'
		 WHERE end_ts IS NULL AND start_ts < $2`, now, cutoff)
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
func int16Ptr(v int) *int16       { i := int16(v); return &i }
func boolPtr(v bool) *bool        { return &v }
func strPtr(v string) *string     { return &v }
func derefInt16AsInt(p *int16) int {
	if p == nil {
		return 0
	}
	return int(*p)
}

// snapFloat extracts a float64 from a signal snapshot map (returned by SnapshotAt).
// Returns (0, false) if the key is missing or not a numeric type.
func snapFloat(snap map[string]interface{}, key string) (float64, bool) {
	if snap == nil {
		return 0, false
	}
	return toFloatOk(snap[key])
}

// findNearestPositionFallback approximates FindNearestPosition using ListByVehicle
// with a narrow time window. Returns the position closest to targetTime.
type nearestPosition struct {
	Latitude   float64
	Longitude  float64
	Odometer   float64
	BatteryLvl int
	RatedRange *float64
	IdealRange *float64
	Elevation  *float64
}

func findNearestPositionFallback(ctx context.Context, repo *database.PositionRepo, vehicleID int64, targetTime time.Time, window time.Duration) (*nearestPosition, error) {
	from := targetTime.Add(-window)
	to := targetTime.Add(window)
	positions, err := repo.ListByVehicle(ctx, vehicleID, from, to)
	if err != nil || len(positions) == 0 {
		return nil, err
	}
	// Find closest to targetTime
	best := &positions[0]
	bestDiff := absDuration(positions[0].Ts.Sub(targetTime))
	for i := 1; i < len(positions); i++ {
		diff := absDuration(positions[i].Ts.Sub(targetTime))
		if diff < bestDiff {
			best = &positions[i]
			bestDiff = diff
		}
	}
	return &nearestPosition{
		Latitude:  best.Latitude,
		Longitude: best.Longitude,
		Elevation: best.ElevationM,
	}, nil
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func (t *TelemetrySessionTracker) trackDriving(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	speed, hasSpeed := signalFloat(signals, "VehicleSpeed")
	gear, hasGear := signalStr(signals, "Gear")

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasDrive := t.activeDrives[vehicleID]

	// === GEAR-BASED PATH (primary) ===
	if hasGear {
		isDrivingGear := gear == enums.GearDrive || gear == enums.GearReverse
		isParkGear := gear == enums.GearPark || gear == enums.GearNeutral

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

		// Before ending: check SignalStore for last known Gear.
		// If the car's gear is still D/R (traffic light, jam, long stop), do NOT end the drive.
		// Gear signals only fire on CHANGE — a Gear=D from 2 hours ago is still valid
		// as long as no Gear=P was received since.
		if !active.LastSpeedZeroTime.IsZero() && time.Since(active.LastSpeedZeroTime) > 2*time.Minute {
			if t.localSignals != nil {
				if gv := t.localSignals.Get(vehicleID, "Gear"); gv != nil {
					gearStr, _ := gv.Raw.(string)
					if gearStr == enums.GearDrive || gearStr == enums.GearReverse {
						// Last known Gear is D/R — car hasn't shifted to P.
						// Keep the drive alive (traffic light, jam, accident, etc.)
						active.LastSpeedZeroTime = time.Now().UTC()
						log.Debug().Int64("vehicle_id", vehicleID).Str("gear", gearStr).
							Msg("telemetry: speed=0 >2min but last Gear=D/R — keeping drive alive")
						return
					}
				}
			}
			t.completeDriveLocked(ctx, vehicleID, active, signals)
		}
	}
}

// startDriveLocked creates a new drive session. Must be called with t.mu held.
func (t *TelemetrySessionTracker) startDriveLocked(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, speed float64, gearBased bool) {
	batteryLevel, hasBat := t.resolveInt(vehicleID, signals, accumulatedSignals, "BatteryLevel", "Soc")
	odometer, hasOdo := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Odometer")
	lat, lon, hasLoc := t.resolveLatLon(vehicleID, signals, accumulatedSignals)
	elevation, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Elevation")
	ratedRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "RatedRange")
	idealRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "IdealBatteryRange")
	estRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "EstBatteryRange")
	soc, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Soc", "BatteryLevel")
	usableSoc, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "UsableSoc")

	drive := &models.Drive{
		VehicleID: vehicleID,
		StartTs:   time.Now().UTC(),
	}
	if hasBat {
		drive.StartBatteryPct = int16Ptr(batteryLevel)
	}
	if hasLoc {
		drive.StartLat = floatPtr(lat)
		drive.StartLon = floatPtr(lon)
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
		}
	}
	if active.StartSoc == nil {
		if soc, ok := signalFloat(signals, "Soc", "BatteryLevel"); ok {
			active.StartSoc = floatPtr(soc)
			startBackfill["start_battery_pct"] = int16(soc)
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
			startBackfill["start_lat"] = la
			startBackfill["start_lon"] = lo
			go t.resolveAndUpdateAddress(active.DriveID, la, lo, true)
		}
	}
	if active.StartRatedRange == nil {
		if rr, ok := signalFloat(signals, "RatedRange"); ok {
			active.StartRatedRange = floatPtr(rr)
		}
	}
	if active.StartIdealRange == nil {
		if ir, ok := signalFloat(signals, "IdealBatteryRange"); ok {
			active.StartIdealRange = floatPtr(ir)
		}
	}
	if active.StartEstRange == nil {
		if er, ok := signalFloat(signals, "EstBatteryRange"); ok {
			active.StartEstRange = floatPtr(er)
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
		if rr > active.RatedRangeMax {
			active.RatedRangeMax = rr
		}
		if rr < active.RatedRangeMin {
			active.RatedRangeMin = rr
		}
		active.RatedRangeSum += rr
	}
	if hasIR {
		if ir > active.IdealRangeMax {
			active.IdealRangeMax = ir
		}
		if ir < active.IdealRangeMin {
			active.IdealRangeMin = ir
		}
		active.IdealRangeSum += ir
	}
	if hasER {
		if er > active.EstRangeMax {
			active.EstRangeMax = er
		}
		if er < active.EstRangeMin {
			active.EstRangeMin = er
		}
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
		if soc > active.SocMax {
			active.SocMax = soc
		}
		if soc < active.SocMin {
			active.SocMin = soc
		}
		active.SocSum += soc
		active.SocCount++
	}
	if hasUSoc {
		if usoc > active.UsableSocMax {
			active.UsableSocMax = usoc
		}
		if usoc < active.UsableSocMin {
			active.UsableSocMin = usoc
		}
		active.UsableSocSum += usoc
	}
}

func (t *TelemetrySessionTracker) updateDriveTempStats(active *streamingDrive, signals map[string]interface{}) {
	it, hasIT := signalFloat(signals, "InsideTemp")
	if !hasIT && t.localSignals != nil {
		it, hasIT = t.localSignals.GetFloat(active.VehicleID, "InsideTemp")
	}
	ot, hasOT := signalFloat(signals, "OutsideTemp")
	if !hasOT && t.localSignals != nil {
		ot, hasOT = t.localSignals.GetFloat(active.VehicleID, "OutsideTemp")
	}
	if hasIT {
		active.InsideTempSum += it
		active.TempCount++
	}
	if hasOT {
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
	if v, ok := signalFloat(signals, "Elevation"); ok {
		reading.Elevation = floatPtr(v)
	}
	if v, ok := signalInt(signals, "GpsHeading", "Heading"); ok {
		reading.Heading = intPtr(v)
	}
	if v, ok := signalFloat(signals, "Odometer"); ok {
		reading.Odometer = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "VehicleSpeed"); ok {
		reading.Speed = floatPtr(v)
	}
	if v, ok := signalPowerKW(signals); ok {
		reading.Power = floatPtr(v)
	}
	if v, ok := signalInt(signals, "BatteryLevel"); ok {
		reading.BatteryLevel = intPtr(v)
	}
	if v, ok := signalFloat(signals, "Soc"); ok {
		reading.Soc = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "UsableSoc"); ok {
		reading.UsableSoc = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "RatedRange"); ok {
		reading.RatedRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok {
		reading.IdealRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok {
		reading.EstRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "InsideTemp"); ok {
		reading.InsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "OutsideTemp"); ok {
		reading.OutsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "HvacLeftTemperatureRequest", "DriverSeatTemp", "DriverTemp"); ok {
		reading.DriverTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "HvacRightTemperatureRequest", "PassengerSeatTemp", "PassengerTemp"); ok {
		reading.PassengerTemp = floatPtr(v)
	}
	if v, ok := signalInt(signals, "HvacFanStatus", "FanStatus"); ok {
		reading.FanStatus = intPtr(v)
	}
	if v, ok := signals["IsClimateOn"]; ok {
		if b, ok2 := v.(bool); ok2 {
			reading.IsClimateOn = boolPtr(b)
		}
	}
	// Fleet Telemetry sends tire pressure in bar via TpmsPressure* signals.
	// TPMS reports infrequently (~every 25 min) so we fall back to the SignalStore
	// for last-known values — otherwise most drive telemetry rows have NULL tire data.
	if v, ok := t.resolveFloat(drive.VehicleID, signals, nil, "TpmsFl", "TpmsPressureFl", "TirePressureFL", "TPMS_PressureFL"); ok {
		reading.TirePressureFL = floatPtr(v)
	}
	if v, ok := t.resolveFloat(drive.VehicleID, signals, nil, "TpmsFr", "TpmsPressureFr", "TirePressureFR", "TPMS_PressureFR"); ok {
		reading.TirePressureFR = floatPtr(v)
	}
	if v, ok := t.resolveFloat(drive.VehicleID, signals, nil, "TpmsRl", "TpmsPressureRl", "TirePressureRL", "TPMS_PressureRL"); ok {
		reading.TirePressureRL = floatPtr(v)
	}
	if v, ok := t.resolveFloat(drive.VehicleID, signals, nil, "TpmsRr", "TpmsPressureRr", "TirePressureRR", "TPMS_PressureRR"); ok {
		reading.TirePressureRR = floatPtr(v)
	}
	if v, ok := signals["BatteryHeaterOn"]; ok {
		if b, ok2 := v.(bool); ok2 {
			reading.BatteryHeaterOn = boolPtr(b)
		}
	}

	// Drive telemetry data now lands in signal_log; reading built for session stats only.
	_ = reading
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
	if bl, ok := t.resolveInt(vehicleID, finalSignals, active.accumulatedSignals, "BatteryLevel", "Soc"); ok {
		endBattery = bl
	} else if active.SocCount > 0 && active.SocMin < math.MaxFloat64 {
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
	var speedAvg *float64
	if active.SpeedCount > 0 {
		avg := active.SpeedSum / float64(active.SpeedCount)
		speedAvg = &avg
	}

	// Fallback: estimate distance from avg speed × duration when odometer unavailable
	if distance == 0 && speedAvg != nil && duration > 0 {
		distance = (*speedAvg) * (duration / 60.0) // mph × hours = miles
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

	var powerMax *float64
	if active.SpeedCount > 0 {
		powerMax = &active.PowerMax
	}

	// Build enhanced fields map (only columns in drivePartialAllowed)
	enhancedFields := map[string]interface{}{}
	if speedAvg != nil {
		enhancedFields["avg_speed_mph"] = *speedAvg
	}
	if active.StartLatitude != nil {
		enhancedFields["start_lat"] = *active.StartLatitude
	}
	if active.StartLongitude != nil {
		enhancedFields["start_lon"] = *active.StartLongitude
	}
	if endLat != nil {
		enhancedFields["end_lat"] = *endLat
	}
	if endLon != nil {
		enhancedFields["end_lon"] = *endLon
	}

	// Enrich with signal_log for fields not captured during session.
	// SignalLogReader reconstructs full signal state using last-known values,
	// compensating for Tesla's delta encoding (signals not sent unless changed).
	// Falls back to signalHistoryWriter if signalLogReader is unavailable.
	if t.signalLogReader != nil {
		endTs := time.Now().UTC()
		startSnap, startErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log start snapshot failed")
			startSnap = map[string]interface{}{}
		}
		endSnap, endErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log end snapshot failed")
			endSnap = map[string]interface{}{}
		}

		// Unit preferences at start and end (may differ if user changed mid-drive)
		startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
		endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")
		endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

		// Distance from odometer (unit-aware, normalized to miles)
		if startOdoRaw, ok := snapFloat(startSnap, "Odometer"); ok {
			if endOdoRaw, ok := snapFloat(endSnap, "Odometer"); ok {
				startOdo := units.NormalizeDistance(startOdoRaw, startDistUnit)
				endOdo := units.NormalizeDistance(endOdoRaw, endDistUnit)
				sDist := endOdo - startOdo
				if sDist > 0 {
					distance = sDist
					enhancedFields["distance_mi"] = distance
				}
			}
		}

		// Battery from snapshots
		if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
			enhancedFields["start_battery_pct"] = int16(bl)
		}
		if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
			endBattery = int(bl)
		}

		// Position from snapshots (fill if missing)
		if _, exists := enhancedFields["start_lat"]; !exists {
			if lat, ok := snapFloat(startSnap, "Latitude"); ok {
				enhancedFields["start_lat"] = lat
			}
		}
		if _, exists := enhancedFields["start_lon"]; !exists {
			if lon, ok := snapFloat(startSnap, "Longitude"); ok {
				enhancedFields["start_lon"] = lon
			}
		}
		if _, exists := enhancedFields["end_lat"]; !exists {
			if lat, ok := snapFloat(endSnap, "Latitude"); ok {
				enhancedFields["end_lat"] = lat
			}
		}
		if _, exists := enhancedFields["end_lon"]; !exists {
			if lon, ok := snapFloat(endSnap, "Longitude"); ok {
				enhancedFields["end_lon"] = lon
			}
		}

		// Temperature (unit-aware, normalized to °C)
		if temp, ok := snapFloat(endSnap, "OutsideTemp"); ok {
			normalized := units.NormalizeTemp(temp, endTempUnit)
			enhancedFields["outside_temp_avg_c"] = normalized
			outsideAvg = &normalized
		}
		if temp, ok := snapFloat(endSnap, "InsideTemp"); ok {
			normalized := units.NormalizeTemp(temp, endTempUnit)
			enhancedFields["inside_temp_avg_c"] = normalized
			insideAvg = &normalized
		}

		// Energy: delta of cumulative counters
		if startEnergy, ok := snapFloat(startSnap, "LifetimeEnergyUsed"); ok {
			if endEnergy, ok := snapFloat(endSnap, "LifetimeEnergyUsed"); ok {
				energyUsed := endEnergy - startEnergy
				if energyUsed > 0 {
					enhancedFields["energy_used_kwh"] = energyUsed
				}
			}
		}

		// Aggregates from signal_log during the drive window
		slAvgSpeed, slMaxSpeed, slAvgPower := t.signalLogReader.DriveAggregates(ctx, vehicleID, active.StartTime, endTs)
		if slAvgSpeed > 0 {
			// Normalize speed: signal_log stores raw values in car's unit
			normalizedAvg := units.NormalizeSpeed(slAvgSpeed, endDistUnit)
			enhancedFields["avg_speed_mph"] = normalizedAvg
		}
		if slMaxSpeed > 0 {
			normalizedMax := units.NormalizeSpeed(slMaxSpeed, endDistUnit)
			enhancedFields["max_speed_mph"] = normalizedMax
			maxSpeed = normalizedMax
		}
		if slAvgPower != 0 {
			enhancedFields["avg_power_kw"] = math.Abs(slAvgPower)
			p := math.Abs(slAvgPower)
			powerMax = &p
		}

		// Regen energy
		regenKwh := t.signalLogReader.RegenEnergy(ctx, vehicleID, active.StartTime, endTs)
		if regenKwh > 0 {
			enhancedFields["regen_kwh"] = regenKwh
		}
	} else if t.signalHistoryWriter != nil {
		// Legacy fallback: use signalHistoryWriter for enrichment
		startSnapshot, startErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history start snapshot failed")
		}
		endSnapshot, endErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, time.Now().UTC())
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history end snapshot failed")
		}

		// Fill missing start position
		if _, exists := enhancedFields["start_lat"]; !exists {
			if v, ok := startSnapshot["Latitude"]; ok {
				if lat, fOk := v.(float64); fOk {
					enhancedFields["start_lat"] = lat
				}
			}
		}
		if _, exists := enhancedFields["start_lon"]; !exists {
			if v, ok := startSnapshot["Longitude"]; ok {
				if lon, fOk := v.(float64); fOk {
					enhancedFields["start_lon"] = lon
				}
			}
		}

		// Fill missing end position
		if _, exists := enhancedFields["end_lat"]; !exists {
			if v, ok := endSnapshot["Latitude"]; ok {
				if lat, fOk := v.(float64); fOk {
					enhancedFields["end_lat"] = lat
				}
			}
		}
		if _, exists := enhancedFields["end_lon"]; !exists {
			if v, ok := endSnapshot["Longitude"]; ok {
				if lon, fOk := v.(float64); fOk {
					enhancedFields["end_lon"] = lon
				}
			}
		}

		// Fill missing temperature (single-point fallback when no temp signals during drive)
		if insideAvg == nil {
			if v, ok := startSnapshot["InsideTemp"]; ok {
				if temp, fOk := v.(float64); fOk {
					enhancedFields["inside_temp_avg_c"] = temp
				}
			}
		}
		if outsideAvg == nil {
			if v, ok := startSnapshot["OutsideTemp"]; ok {
				if temp, fOk := v.(float64); fOk {
					enhancedFields["outside_temp_avg_c"] = temp
				}
			}
		}
	}

	// Determine ended_status based on how the drive ended
	switch {
	case duration < 1.0 || distance < 0.1:
		enhancedFields["ended_status"] = "aborted"
	case signals != nil:
		enhancedFields["ended_status"] = "completed"
	default:
		// signals == nil means stale-session cleanup closed the drive
		enhancedFields["ended_status"] = "interrupted"
	}

	// Compute drive score (0–100) from available driving data
	driveScore := 100.0
	if maxSpeed > 85 {
		driveScore -= 10
	}
	if regenKwh, ok := enhancedFields["regen_kwh"].(float64); ok && regenKwh > 0 {
		if energyUsed, ok := enhancedFields["energy_used_kwh"].(float64); ok && energyUsed > 0 {
			if regenKwh/energyUsed > 0.3 {
				driveScore += 5 // good regen usage
			}
		}
	}
	// Penalize very high average speed (aggressive driving)
	if speedAvg != nil && *speedAvg > 80 {
		driveScore -= 5
	}
	if driveScore < 0 {
		driveScore = 0
	}
	if driveScore > 100 {
		driveScore = 100
	}
	enhancedFields["score"] = driveScore

	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if endBattery := int16(endBattery); endBattery > 0 {
			endBatteryPct = &endBattery
		}
		if err := t.driveRepo.CompleteWithTx(ctx, tx, active.DriveID, time.Now().UTC(),
			distance, duration, endBatteryPct, &maxSpeed, powerMax, insideAvg, outsideAvg); err != nil {
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

	// Update monthly trip summary for this drive's month
	go func() {
		tripCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		monthStart := time.Date(active.StartTime.Year(), active.StartTime.Month(), 1, 0, 0, 0, 0, time.UTC)
		if _, err := t.tripRepo.UpsertMonthTrip(tripCtx, vehicleID, monthStart, true); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update monthly trip")
		}
	}()

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
		active.StartLatitude == nil

	if startNeedsBackfill {
		startPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, active.StartTime, lookupWindow)
		if err == nil && startPos != nil {
			if (active.StartSoc == nil || *active.StartSoc == 0) && startPos.BatteryLvl > 0 {
				backfill["start_battery_pct"] = int16(startPos.BatteryLvl)
			}
			if active.StartLatitude == nil && startPos.Latitude != 0 {
				backfill["start_lat"] = startPos.Latitude
				backfill["start_lon"] = startPos.Longitude
			}
		}
	}

	// --- Backfill end values ---
	endTime := time.Now().UTC()
	endPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_battery_pct"] = int16(endPos.BatteryLvl)
		}
		if active.LastOdometer == nil && endPos.Odometer > 0 {
			// Recompute distance if we now have both start and end odometer
			startOdo := 0.0
			if active.StartOdometer != nil {
				startOdo = *active.StartOdometer
			}
			if startOdo > 0 {
				dist := endPos.Odometer - startOdo
				if dist > 0 {
					backfill["distance_mi"] = dist
				}
			}
		}
		if active.LastLatitude == nil && endPos.Latitude != 0 {
			backfill["end_lat"] = endPos.Latitude
			backfill["end_lon"] = endPos.Longitude
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

		needStart := (d.StartAddress == nil || *d.StartAddress == "") && d.StartLat != nil && d.StartLon != nil
		needEnd := (d.EndAddress == nil || *d.EndAddress == "") && d.EndLat != nil && d.EndLon != nil

		if needStart {
			t.resolveAndUpdateAddress(d.ID, *d.StartLat, *d.StartLon, true)
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
			t.resolveAndUpdateAddress(d.ID, *d.EndLat, *d.EndLon, false)
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
	isCharging := enums.IsCharging(chargeState)

	t.mu.Lock()
	defer t.mu.Unlock()

	active, hasCharge := t.activeCharges[vehicleID]

	if isCharging && !hasCharge {
		// === START CHARGE ===
		// Use resolve helpers: batch → accumulated → SignalStore
		batteryLevel, _ := t.resolveInt(vehicleID, signals, accumulatedSignals, "BatteryLevel", "Soc")
		lat, lon, hasLoc := t.resolveLatLon(vehicleID, signals, accumulatedSignals)
		startRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "RatedRange")

		session := &models.ChargingSession{
			VehicleID:       vehicleID,
			StartTs:         time.Now().UTC(),
			StartBatteryPct: int16Ptr(batteryLevel),
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
		if startRange > 0 {
			sc.StartRangeKm = floatPtr(startRange)
		}

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
		if v, ok := signalInt(signals, "ChargerPhases"); ok {
			active.Phases = intPtr(v)
		}
		if v, ok := signalInt(signals, "ChargerVoltage"); ok {
			active.Voltage = intPtr(v)
		}
		if v, ok := signalInt(signals, "ChargerActualCurrent", "ChargeAmps"); ok {
			active.Current = intPtr(v)
		}
		if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok {
			active.Power = floatPtr(v)
		}
		if v, ok := signalStr(signals, "FastChargerType"); ok {
			active.FastChargerType = strPtr(v)
		}
		if v, ok := signalStr(signals, "FastChargerBrand"); ok {
			active.FastChargerBrand = strPtr(v)
		}
		if v, ok := signalStr(signals, "ChargingCableType", "ConnChargeCable"); ok {
			active.ChargeCable = strPtr(v)
		}

		// Temperature — fall back to SignalStore for sparse batches
		it, hasIT := signalFloat(signals, "InsideTemp")
		if !hasIT && t.localSignals != nil {
			it, hasIT = t.localSignals.GetFloat(vehicleID, "InsideTemp")
		}
		ot, hasOT := signalFloat(signals, "OutsideTemp")
		if !hasOT && t.localSignals != nil {
			ot, hasOT = t.localSignals.GetFloat(vehicleID, "OutsideTemp")
		}
		if hasIT {
			active.InsideTempSum += it
			active.TempCount++
		}
		if hasOT {
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

	if v, ok := signalInt(signals, "BatteryLevel"); ok {
		reading.BatteryLevel = intPtr(v)
	}
	if v, ok := signalFloat(signals, "Soc"); ok {
		reading.Soc = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingPower", "ACChargingPower"); ok {
		reading.PowerKW = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerVoltage"); ok {
		reading.Voltage = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ChargerActualCurrent", "ChargeAmps"); ok {
		reading.CurrentAmps = floatPtr(v)
	}
	if v, ok := signalInt(signals, "ChargerPhases"); ok {
		reading.Phases = intPtr(v)
	}
	if v, ok := signalFloat(signals, "DCChargingEnergyIn", "ACChargingEnergyIn"); ok {
		reading.EnergyAdded = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "RatedRange"); ok {
		reading.RatedRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "IdealBatteryRange"); ok {
		reading.IdealRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "EstBatteryRange"); ok {
		reading.EstRange = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "InsideTemp"); ok {
		reading.InsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "OutsideTemp"); ok {
		reading.OutsideTemp = floatPtr(v)
	}
	if v, ok := signalFloat(signals, "ModuleTempMax"); ok {
		reading.BatteryTemp = floatPtr(v)
	}
	if la, lo, ok := signalLatLon(signals); ok {
		reading.Latitude = floatPtr(la)
		reading.Longitude = floatPtr(lo)
	}
	if v, ok := signalFloat(signals, "ChargeRateMilePerHour", "ChargeRateMph"); ok {
		reading.ChargeRate = floatPtr(v)
	}

	// Charge telemetry data now lands in signal_log; reading built for session stats only.
	_ = reading
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
	if bl, ok := t.resolveInt(vehicleID, finalSignals, active.accumulatedSignals, "BatteryLevel", "Soc"); ok {
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
		if endBattery == 0 && maxBatt != nil {
			endBattery = int(*maxBatt)
		}
		if active.EnergyAdded == 0 && maxEnergy != nil && *maxEnergy > 0 {
			active.EnergyAdded = *maxEnergy
		}
		if active.Power == nil && maxPower != nil {
			active.Power = maxPower
		}
		if active.Voltage == nil && maxVoltage != nil {
			v := int(*maxVoltage)
			active.Voltage = &v
		}
		if active.Current == nil && maxCurrent != nil {
			v := int(*maxCurrent)
			active.Current = &v
		}
		if active.Phases == nil && maxPhases != nil {
			active.Phases = maxPhases
		}
	}

	// Estimate energy from battery% diff if direct energy signal unavailable
	if active.EnergyAdded == 0 && active.StartBatteryLevel > 0 && endBattery > active.StartBatteryLevel {
		estimatedKWh := float64(endBattery-active.StartBatteryLevel) * 0.75
		active.EnergyAdded = estimatedKWh
	}

	// Get end range — fall back to accumulated signals → SignalStore
	var endRange *float64
	if v, ok := t.resolveFloat(vehicleID, finalSignals, active.accumulatedSignals, "RatedRange"); ok {
		endRange = floatPtr(v)
	}

	// Build enhanced fields (only columns that exist in charging_sessions)
	enhancedFields := map[string]interface{}{}

	// Enrich with signal_log for fields not captured during charge session.
	// SignalLogReader reconstructs full signal state using last-known values,
	// compensating for Tesla's delta encoding (signals not sent unless changed).
	// Falls back to signalHistoryWriter if signalLogReader is unavailable.
	if t.signalLogReader != nil {
		endTs := time.Now().UTC()
		startSnap, startErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log charge start snapshot failed")
			startSnap = map[string]interface{}{}
		}
		endSnap, endErr := t.signalLogReader.SnapshotAt(ctx, vehicleID, endTs)
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_log charge end snapshot failed")
			endSnap = map[string]interface{}{}
		}

		// Unit preferences at start and end (may differ if user changed mid-charge)
		startDistUnit := units.GetUnitFromSnapshot(startSnap, "SettingDistanceUnit")
		endDistUnit := units.GetUnitFromSnapshot(endSnap, "SettingDistanceUnit")

		// Battery level from snapshots
		if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
			enhancedFields["start_battery_pct"] = int16(bl)
		}
		if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
			endBattery = int(bl)
		}

		// Energy added: difference in cumulative energy counter
		if startEnergy, ok := snapFloat(startSnap, "ACChargingEnergyIn"); ok {
			if endEnergy, ok := snapFloat(endSnap, "ACChargingEnergyIn"); ok {
				energyDelta := endEnergy - startEnergy
				if energyDelta > 0 {
					active.EnergyAdded = energyDelta
					enhancedFields["energy_added_kwh"] = energyDelta
				}
			}
		}

		// Range added (normalized to miles)
		if startRangeRaw, ok := snapFloat(startSnap, "BatteryRange"); ok {
			if endRangeRaw, ok := snapFloat(endSnap, "BatteryRange"); ok {
				startRangeMi := units.NormalizeDistance(startRangeRaw, startDistUnit)
				endRangeMi := units.NormalizeDistance(endRangeRaw, endDistUnit)
				milesAdded := endRangeMi - startRangeMi
				if milesAdded > 0 {
					endRange = floatPtr(milesAdded)
					enhancedFields["miles_added"] = milesAdded
				}
			}
		}

		// Location from snapshots (for geocoding — not written to DB)
		if active.Latitude == nil {
			if lat, ok := snapFloat(endSnap, "Latitude"); ok {
				active.Latitude = floatPtr(lat)
			}
		}
		if active.Longitude == nil {
			if lon, ok := snapFloat(endSnap, "Longitude"); ok {
				active.Longitude = floatPtr(lon)
			}
		}

		// Charger type detection from snapshot
		if dcPower, ok := snapFloat(endSnap, "DCChargingPower"); ok && dcPower > 0 {
			enhancedFields["charger_type"] = "DC"
		}

		// Max/avg power from signal_log aggregate during charge window
		slMaxPower, slAvgPower := t.signalLogReader.ChargeAggregates(ctx, vehicleID, active.StartTime, endTs)
		if slMaxPower > 0 {
			enhancedFields["charger_power_kw_max"] = slMaxPower
		}
		if slAvgPower > 0 {
			enhancedFields["charger_power_kw_avg"] = slAvgPower
		}

		// Charger spec fields from in-memory session data or signal_log snapshots
		if active.Voltage != nil && *active.Voltage > 0 {
			enhancedFields["max_charger_voltage"] = int16(*active.Voltage)
		} else if v, ok := snapFloat(endSnap, "ChargerVoltage"); ok && v > 0 {
			enhancedFields["max_charger_voltage"] = int16(v)
		}
		if active.Phases != nil && *active.Phases > 0 {
			enhancedFields["charger_phases"] = int16(*active.Phases)
		} else if v, ok := snapFloat(endSnap, "ChargerPhases"); ok && v > 0 {
			enhancedFields["charger_phases"] = int16(v)
		}
		if active.ChargeCable != nil && *active.ChargeCable != "" {
			enhancedFields["cable_type"] = *active.ChargeCable
		} else if v, ok := signalStr(endSnap, "ChargingCableType"); ok {
			enhancedFields["cable_type"] = v
		}
	} else if t.signalHistoryWriter != nil {
		// Legacy fallback: use signalHistoryWriter for enrichment
		_, startErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, active.StartTime)
		if startErr != nil {
			log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history charge start snapshot failed")
		}
		endSnapshot, endErr := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, time.Now().UTC())
		if endErr != nil {
			log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
				Msg("telemetry: signal_history charge end snapshot failed")
		}

		// Fill missing location (for geocoding — not written to DB)
		if active.Latitude == nil {
			if v, ok := endSnapshot["Latitude"]; ok {
				if f, fOk := v.(float64); fOk {
					active.Latitude = &f
				}
			}
		}
		if active.Longitude == nil {
			if v, ok := endSnapshot["Longitude"]; ok {
				if f, fOk := v.(float64); fOk {
					active.Longitude = &f
				}
			}
		}
	}

	// Determine ended_status based on how the charge ended
	switch {
	case signals == nil:
		enhancedFields["ended_status"] = "interrupted"
	case endBattery >= 95:
		enhancedFields["ended_status"] = "full"
	default:
		// Check DetailedChargeState for user-stop vs normal completion
		if cs, ok := signalStr(signals, "DetailedChargeState", "ChargeState"); ok {
			if strings.Contains(cs, enums.ChargeStateStopped) || strings.Contains(cs, enums.ChargeStateDisconnected) {
				enhancedFields["ended_status"] = "user_stopped"
			} else {
				enhancedFields["ended_status"] = "completed"
			}
		} else {
			enhancedFields["ended_status"] = "completed"
		}
	}

	// Default cost_currency — will be overridden when geofence electricity pricing is implemented
	// TODO: Set from geofence.ElectricityCurrency when Geofence model gains that field
	enhancedFields["cost_currency"] = "USD"

	if err := t.db.WithTx(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if b := int16(endBattery); b > 0 {
			endBatteryPct = &b
		}
		var energyAdded *float64
		if active.EnergyAdded > 0 {
			energyAdded = &active.EnergyAdded
		}
		if err := t.chargeRepo.CompleteWithTx(ctx, tx, active.SessionID, time.Now().UTC(),
			energyAdded, endBatteryPct, endRange,
			active.Power, active.Power,
			nil, nil, &duration, nil); err != nil {
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

		// TODO: Auto-calculate charge cost from geofence electricity rate.
		// Geofence model does not yet have ElectricityRate/ElectricityCurrency fields.
		// When added, compute: cost = energyAdded * rate, cost_currency = geofence.ElectricityCurrency.

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
				fields["charger_location"] = geofences[0].Name
				_ = t.chargeRepo.PartialUpdate(gctx, sessionID, fields)
				return
			}

			// 2. Check places cache (previously resolved, within 50m)
			if cached, err := t.placesCache.FindNearby(gctx, lat, lon, 50); err == nil && cached != nil {
				_ = t.placesCache.IncrementHitCount(gctx, cached.ID)
				fields["charger_location"] = cached.DisplayName
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
			fields["charger_location"] = name
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
		startPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, active.StartTime, lookupWindow)
		if err == nil && startPos != nil && startPos.BatteryLvl > 0 {
			backfill["start_battery_pct"] = int16(startPos.BatteryLvl)
		}
	}

	// Backfill end battery from nearest position to end time
	endTime := time.Now().UTC()
	endPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_battery_pct"] = int16(endPos.BatteryLvl)
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
