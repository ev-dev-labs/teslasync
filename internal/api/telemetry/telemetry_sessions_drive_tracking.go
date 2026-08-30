package telemetry

import (
	"context"
	"math"
	"sync"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
	"github.com/ev-dev-labs/teslasync/internal/units"
)

// driveStateRegistry holds the per-tracker signal.StateReader injected by
// router.go at startup (ADR-002). The tracker struct itself is defined in
// telemetry_sessions.go, so this side table provides the wiring seam without
// altering the shared struct definition. The setter and accessor below live
// in this file because the snapshot read sites that
// consume the reader are exclusively in this file.
//
// A nil entry (or missing key) means no StateReader has been installed for
// that tracker — completion-time enrichment falls back to the unenriched
// code path (empty snapshot maps), preserving the behavior of the legacy
// fallback when both signalLogReader and signalHistoryWriter were nil. The
// gear/location-carry-forward bug manifests when a drive
// boundary lands between Tesla's delta-encoded re-emissions: the previous
// SignalLogReader.SnapshotAt path queried only the snapshot tables and so
// missed signals that had not changed across the boundary. The StateReader
// installed here forward-folds signal_log so every signal emitted at-or-
// before the anchor is included.
var (
	driveStateRegistryMu sync.RWMutex
	driveStateRegistry   = map[*TelemetrySessionTracker]signal.StateReader{}
)

// SetDriveStateReader injects the cold-path signal.StateReader used to
// reconstruct drive start/end snapshots at session completion. Replaces
// the legacy *signaldb.SignalLogReader.SnapshotAt /
// *signaldb.SignalHistoryWriter.SnapshotAt calls.
// Passing nil clears any previously installed reader.
func (t *TelemetrySessionTracker) SetDriveStateReader(s signal.StateReader) {
	driveStateRegistryMu.Lock()
	defer driveStateRegistryMu.Unlock()
	if s == nil {
		delete(driveStateRegistry, t)
		return
	}
	driveStateRegistry[t] = s
}

// driveStateReader returns the StateReader previously installed by
// SetDriveStateReader, or nil if no reader is installed (which makes
// drive-session completion fall back to the unenriched code path).
func (t *TelemetrySessionTracker) driveStateReader() signal.StateReader {
	driveStateRegistryMu.RLock()
	defer driveStateRegistryMu.RUnlock()
	return driveStateRegistry[t]
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

	// state is the signal.StateReader captured at session start. Consumed
	// by completeDriveLocked to reconstruct the start/end signal snapshots
	// used for completion-time enrichment (odometer delta, energy delta,
	// gear / location carry-forward, geocoding lat/lng). Nil when no
	// StateReader was installed via SetDriveStateReader — the enrichment
	// code path then degrades gracefully to empty snapshot maps.
	state signal.StateReader
}

func (t *TelemetrySessionTracker) trackDriving(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, payloadTs time.Time, fieldTs map[string]time.Time) {
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
				t.completeChargeLocked(ctx, vehicleID, activeCharge, signals, payloadTs)
			}
			t.startDriveLocked(ctx, vehicleID, vin, signals, accumulatedSignals, speed, true, payloadTs, fieldTs)
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
			t.completeDriveLocked(ctx, vehicleID, active, signals, payloadTs, fieldTs)
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
			t.completeChargeLocked(ctx, vehicleID, activeCharge, signals, payloadTs)
		}
		t.startDriveLocked(ctx, vehicleID, vin, signals, accumulatedSignals, speed, false, payloadTs, fieldTs)

	} else if speed > 0 && hasDrive {
		// Speed > 0, active drive → UPDATE
		active.LastSeen = time.Now().UTC()
		active.LastSpeedZeroTime = time.Time{}
		t.updateActiveDriveLocked(ctx, active, signals, speed, true)

	} else if speed == 0 && hasDrive {
		// Speed = 0, active drive → check for drive end (2-min timeout fallback)
		active.LastSeen = time.Now().UTC()
		active.LastSpeed = 0
		speedEventTs := payloadTs
		if ts, ok := fieldTs["VehicleSpeed"]; ok && !ts.IsZero() {
			speedEventTs = ts
		}
		speedEventTs = eventTimeOrNow(speedEventTs)

		if active.LastSpeedZeroTime.IsZero() {
			active.LastSpeedZeroTime = speedEventTs
		}

		// Before ending: check SignalStore for last known Gear.
		// If the car's gear is still D/R (traffic light, jam, long stop), do NOT end the drive.
		// Gear signals only fire on CHANGE — a Gear=D from 2 hours ago is still valid
		// as long as no Gear=P was received since.
		if !active.LastSpeedZeroTime.IsZero() && speedEventTs.Sub(active.LastSpeedZeroTime) > 2*time.Minute {
			if t.localSignals != nil {
				if gv := t.localSignals.Get(vehicleID, "Gear"); gv != nil {
					gearStr, _ := gv.Raw.(string)
					if gearStr == enums.GearDrive || gearStr == enums.GearReverse {
						// Last known Gear is D/R — car hasn't shifted to P.
						// Keep the drive alive (traffic light, jam, accident, etc.)
						active.LastSpeedZeroTime = speedEventTs
						log.Debug().Int64("vehicle_id", vehicleID).Str("gear", gearStr).
							Msg("telemetry: speed=0 >2min but last Gear=D/R — keeping drive alive")
						return
					}
				}
			}
			t.completeDriveLocked(ctx, vehicleID, active, signals, payloadTs, fieldTs)
		}
	}
}

// startDriveLocked creates a new drive session. Must be called with t.mu held.
//
// payloadTs is the batch high-water EmittedAt; fieldTs is the per-Field
// EmittedAt map. The drive's StartTs/StartTime are stamped using the Gear
// field's EmittedAt when available (gear-based drives) or VehicleSpeed's
// EmittedAt (speed-fallback drives), falling back to payloadTs, then
// wall-clock if neither is set.
func (t *TelemetrySessionTracker) startDriveLocked(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, speed float64, gearBased bool, payloadTs time.Time, fieldTs map[string]time.Time) {
	batteryLevel, hasBat := t.resolveInt(vehicleID, signals, accumulatedSignals, "BatteryLevel", "Soc")
	odometer, hasOdo := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Odometer")
	lat, lon, hasLoc := t.resolveLatLon(vehicleID, signals, accumulatedSignals)
	elevation, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Elevation")
	ratedRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "RatedRange")
	idealRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "IdealBatteryRange")
	estRange, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "EstBatteryRange")
	soc, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Soc", "BatteryLevel")
	usableSoc, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "UsableSoc")

	// Prefer the originating signal's EmittedAt for the drive's start
	// timestamp. Gear-based drives use Gear's EmittedAt; speed-fallback
	// drives use VehicleSpeed's EmittedAt. Falls back to payloadTs (batch
	// high-water mark) and ultimately wall-clock.
	startTs := time.Time{}
	if gearBased {
		if ts, ok := fieldTs["Gear"]; ok && !ts.IsZero() {
			startTs = ts
		}
	} else {
		if ts, ok := fieldTs["VehicleSpeed"]; ok && !ts.IsZero() {
			startTs = ts
		}
	}
	if startTs.IsZero() {
		startTs = payloadTs
	}
	startTs = eventTimeOrNow(startTs)

	// Before creating a new drive row, look up the most recent ended drive
	// for this vehicle whose ended_at is within driveMergeWindow of the
	// candidate startTs. If found, RESUME that drive (clear ended_at) and
	// seed the in-memory streamingDrive from the prior drive's start
	// values so completeDriveLocked extends it to the true end time.
	//
	// This compensates for spurious mid-trip Gear=P transients that the
	// FSM's debounce window cannot fully prevent (e.g. when a Park frame
	// is the last gear signal before a long silent stretch and CheckPending
	// fires before another gear arrives). The merge window MUST be smaller
	// than the FSM debounce + a small grace so we don't accidentally
	// merge two genuinely separate trips made minutes apart.
	if merged := t.tryMergeDriveLocked(ctx, vehicleID, vin, signals, accumulatedSignals, speed, gearBased, startTs, payloadTs); merged {
		return
	}

	drive := &drivemodel.Drive{
		VehicleID: vehicleID,
		StartTs:   startTs,
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
		StartTime:          startTs,
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
		state:              t.driveStateReader(),
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
	metrics.DriveSessionsActive.Inc()

	// Accumulate first batch and write immediately
	sd.accumulatedSignals = accumulateSignals(sd.accumulatedSignals, signals)
	t.flushDriveTelemetry(ctx, sd)

	// Reverse geocode start address (async to not block)
	if hasLoc {
		go t.resolveAndUpdateAddress(drive.ID, lat, lon, true, resolveUseCache)
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
			// Persist SI-canonical start odometer to the drives row so the
			// boundary value survives even if the
			// snapshot path can't recover it at completion time. Mirrors
			// the start_battery_pct / start_lat backfill pattern below.
			startBackfill["start_odometer_m"] = odo
		}
	}
	if active.StartSoc == nil {
		if soc, ok := signalFloat(signals, "Soc", "BatteryLevel"); ok {
			active.StartSoc = floatPtr(soc)
			startBackfill["start_soc_pct"] = float32(soc)
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
			startBackfill["start_lng"] = lo
			go t.resolveAndUpdateAddress(active.DriveID, la, lo, true, resolveUseCache)
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
	reading := &drivemodel.DriveTelemetryReading{
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

func (t *TelemetrySessionTracker) completeDriveLocked(ctx context.Context, vehicleID int64, active *streamingDrive, signals map[string]interface{}, payloadTs time.Time, fieldTs map[string]time.Time) bool {
	// Guard: prevent double-completion race between cleanup and normal end
	if active.Completing {
		return false
	}
	active.Completing = true

	// Resolve end timestamp from event-time first: prefer Gear=P /
	// Gear=N's EmittedAt for gear-based ends, then
	// VehicleSpeed for speed-fallback ends, then payloadTs (batch
	// high-water), then wall-clock. Without this, replaying a 24-min
	// historical batch produces an end timestamp at the replay clock
	// rather than the original signal's event-time.
	endTs := time.Time{}
	if ts, ok := fieldTs["Gear"]; ok && !ts.IsZero() {
		endTs = ts
	} else if ts, ok := fieldTs["VehicleSpeed"]; ok && !ts.IsZero() {
		endTs = ts
	}
	if endTs.IsZero() {
		endTs = payloadTs
	}
	endTs = eventTimeOrNow(endTs)

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

	duration := endTs.Sub(active.StartTime).Minutes()
	if duration < 0 {
		duration = 0
	}

	// Compute distance from odometer.
	//
	// The codec emits Odometer in SI canonical meters after normalize.toSI
	// applies the unit-history distance unit. The in-memory
	// active.{Start,Last}Odometer are populated from
	// `signalFloat(signals, "Odometer")` and `signals` are the post-toSI
	// atomics, so the subtraction yields meters. completeDriveLocked feeds
	// distanceMeters straight to the SI-direct CompleteWithTx signature.
	// distanceMeters carries the SI value across the enhancedFields
	// init point (line ~826) where it can be inserted into the map.
	var distanceMeters float64
	if active.StartOdometer != nil && active.LastOdometer != nil {
		change := signalcounter.Compare(*active.StartOdometer, *active.LastOdometer)
		if change.Kind == signalcounter.ChangeAdvanced {
			distanceMeters = change.Delta
		}
	}

	// Compute averages
	var speedAvg *float64
	if active.SpeedCount > 0 {
		avg := active.SpeedSum / float64(active.SpeedCount)
		speedAvg = &avg
	}

	// Fallback: estimate distance from avg speed × duration when odometer
	// unavailable. speedAvg is m/s, duration is minutes,
	// so meters = mps × seconds = mps × duration × 60.
	if distanceMeters == 0 && speedAvg != nil && duration > 0 {
		distanceMeters = (*speedAvg) * duration * 60.0
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
	// Forward SI-canonical odometer-derived distance in meters through
	// the partial-update path (drivePartialAllowed
	// permits distance_m as direct passthrough). PartialUpdateWithTx
	// runs INSIDE the same tx after CompleteWithTx so the SI value
	// authoritatively overwrites the back-converted distance from
	// completeArgsToSI(distance_mi). Snapshot-odometer (line ~898) and
	// signal_log integration fallback further overwrite this when they
	// yield a positive value.
	if distanceMeters > 0 {
		enhancedFields["distance_m"] = distanceMeters
	}
	// Persist SI-canonical drive boundary odometer (meters) when known.
	// drivePartialAllowed passes start_odometer_m
	// and end_odometer_m through translatePartialFieldsToSI without
	// conversion. Snapshot path below may overwrite with more accurate
	// boundary values reconstructed from signal_log.
	if active.StartOdometer != nil {
		enhancedFields["start_odometer_m"] = *active.StartOdometer
	}
	if active.LastOdometer != nil {
		enhancedFields["end_odometer_m"] = *active.LastOdometer
	}
	if speedAvg != nil {
		// speedAvg is m/s. Writing to avg_speed_mph would trigger
		// translatePartialFieldsToSI to
		// multiply by mpsPerMph (0.44704) producing a 0.44× understatement.
		// Write SI-direct via avg_speed_mps which the SI passthrough in
		// translate now permits. signal_log-derived avg below (~line 1050)
		// overwrites this with a more accurate time-weighted figure when
		// the reader is wired.
		enhancedFields["avg_speed_mps"] = *speedAvg
	}
	if active.StartLatitude != nil {
		enhancedFields["start_lat"] = *active.StartLatitude
	}
	if active.StartLongitude != nil {
		enhancedFields["start_lng"] = *active.StartLongitude
	}
	if endLat != nil {
		enhancedFields["end_lat"] = *endLat
	}
	if endLon != nil {
		enhancedFields["end_lng"] = *endLon
	}

	// Enrich with signal_log for fields not captured during session.
	// signal.StateReader (active.state) reconstructs full signal state at a
	// point in time using last-known values, compensating for Tesla's delta
	// encoding (signals not sent unless changed). Replaces the legacy
	// *signaldb.SignalLogReader.SnapshotAt and
	// *signaldb.SignalHistoryWriter.SnapshotAt code paths (ADR-002).
	//
	// The tracker's signalLogReader *signaldb.SignalLogReader field
	// (declared in telemetry_sessions.go) is INTENTIONALLY retained because
	// this branch still calls signalLogReader.DriveAggregates and
	// signalLogReader.RegenEnergy for the avg/max speed-and-power rollup
	// plus regenerative-braking kWh totals, neither of which has an
	// equivalent on the StateReader API surface. Removing the field would
	// silently zero out avg_speed_mph, max_speed_mph, avg_power_kw, and
	// regen_kwh on every completed drive.
	//
	// Both branches below intentionally read through active.state — the gating
	// signalLogReader / signalHistoryWriter checks remain in place because the
	// first branch still consumes signalLogReader for the DriveAggregates +
	// RegenEnergy rollups (which have no StateReader equivalent), and the
	// second branch is preserved as the legacy degradation path when only
	// the writer-side reader is wired. State() errors are logged-and-swallowed
	// so a transient signal_log query failure does not abort drive-session
	// completion (the unenriched `drives` row is still committed).
	if t.signalLogReader != nil {
		// endTs already computed at function entry from per-field
		// EmittedAt + payloadTs fallback.
		var startSnap, endSnap map[string]interface{}
		if active.state != nil {
			s, startErr := active.state.State(ctx, vehicleID, active.StartTime)
			if startErr != nil {
				log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State drive start snapshot failed")
				startSnap = map[string]interface{}{}
			} else {
				startSnap = stateToLegacyMap(s)
			}
			s2, endErr := active.state.State(ctx, vehicleID, endTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State drive end snapshot failed")
				endSnap = map[string]interface{}{}
			} else {
				endSnap = stateToLegacyMap(s2)
			}
		} else {
			startSnap = map[string]interface{}{}
			endSnap = map[string]interface{}{}
		}

		// Unit preferences at start and end (may differ if user changed mid-drive).
		// startDistUnit is unnecessary: snapshot Odometer is SI meters
		// after normalize.toSI, so no per-snapshot unit lookup is
		// needed for the odometer-difference path.
		// endDistUnit is unnecessary: signal_log stores SI m/s, so the speed
		// aggregates are written SI-direct via avg_speed_mps/max_speed_mps
		// and need no per-snapshot unit lookup either.
		endTempUnit := units.GetUnitFromSnapshot(endSnap, "SettingTemperatureUnit")

		// Distance from snapshot odometer.
		//
		// The codec emits Odometer in SI canonical meters via normalize.toSI;
		// signal_log stores SI; the state.State() snapshot reconstructs from
		// signal_log so snapFloat(snap, "Odometer") returns meters. The SI
		// value goes straight to enhancedFields["distance_m"] with no back-derivation.
		if startOdoRaw, ok := snapFloat(startSnap, "Odometer"); ok {
			if endOdoRaw, ok := snapFloat(endSnap, "Odometer"); ok {
				sDistMeters := endOdoRaw - startOdoRaw
				if sDistMeters > 0 {
					distanceMeters = sDistMeters
					enhancedFields["distance_m"] = sDistMeters
				}
				// Persist boundary odometer regardless of distance sign — even
				// if the snapshot delta is negative (rare reorder edge case)
				// the boundary values themselves are still authoritative for
				// display.
				enhancedFields["start_odometer_m"] = startOdoRaw
				enhancedFields["end_odometer_m"] = endOdoRaw
			}
		}

		// If odometer never landed (codec did not populate Odometer at
		// boundary times — common in short trips and prod-replay where
		// samples may not align with drive-end), integrate VehicleSpeed
		// (m/s) over the window from signal_log. Returned value is METERS
		// (SI canonical).
		if distanceMeters == 0 {
			meters, intErr := t.signalLogReader.IntegrateDriveDistanceMeters(ctx, vehicleID, active.StartTime, endTs)
			if intErr != nil {
				log.Warn().Err(intErr).
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", active.DriveID).
					Msg("telemetry: SI distance integration failed; drive completes with distance=0")
			} else if meters > 0 {
				distanceMeters = meters
				enhancedFields["distance_m"] = meters
				log.Info().
					Int64("vehicle_id", vehicleID).
					Int64("drive_id", active.DriveID).
					Float64("integrated_meters", meters).
					Msg("telemetry: distance integrated from VehicleSpeed signal_log")
			}
		}

		// Battery from snapshots
		if bl, ok := snapFloat(startSnap, "BatteryLevel"); ok && bl > 0 {
			enhancedFields["start_soc_pct"] = float32(bl)
		}
		if bl, ok := snapFloat(endSnap, "BatteryLevel"); ok && bl > 0 {
			endBattery = int(bl)
		}

		// Position from snapshots (fill if missing).
		// Dual-key tolerance: the codec emits LocationLatitude /
		// LocationLongitude (codec/flatten.go:18-22); legacy JSON ingest
		// still emits "Latitude" / "Longitude". snapFloat accepts both.
		if _, exists := enhancedFields["start_lat"]; !exists {
			if lat, ok := snapFloat(startSnap, "LocationLatitude", "Latitude"); ok {
				enhancedFields["start_lat"] = lat
			}
		}
		if _, exists := enhancedFields["start_lng"]; !exists {
			if lon, ok := snapFloat(startSnap, "LocationLongitude", "Longitude"); ok {
				enhancedFields["start_lng"] = lon
			}
		}
		if _, exists := enhancedFields["end_lat"]; !exists {
			if lat, ok := snapFloat(endSnap, "LocationLatitude", "Latitude"); ok {
				enhancedFields["end_lat"] = lat
			}
		}
		if _, exists := enhancedFields["end_lng"]; !exists {
			if lon, ok := snapFloat(endSnap, "LocationLongitude", "Longitude"); ok {
				enhancedFields["end_lng"] = lon
			}
		}

		// Temperature (unit-aware, normalized to °C). The drives table only
		// has ambient_temp_c_avg; the inside cabin temp column was dropped.
		// Inside cabin temp is captured for the local insideAvg
		// pointer used downstream, but not persisted.
		if temp, ok := snapFloat(endSnap, "OutsideTemp"); ok {
			normalized := units.NormalizeTemp(temp, endTempUnit)
			enhancedFields["ambient_temp_c_avg"] = normalized
			outsideAvg = &normalized
		}
		if temp, ok := snapFloat(endSnap, "InsideTemp"); ok {
			//nolint:ineffassign,staticcheck // insideAvg is dead but retained until the persistence rewrite lands.
			normalized := units.NormalizeTemp(temp, endTempUnit)
			insideAvg = &normalized
			_ = insideAvg
		}

		// Energy: delta of cumulative counters. LifetimeEnergyUsed is
		// reported in kWh; convert to SI Wh for the energy_used_wh column.
		if startEnergy, ok := snapFloat(startSnap, "LifetimeEnergyUsed"); ok {
			if endEnergy, ok := snapFloat(endSnap, "LifetimeEnergyUsed"); ok {
				change := signalcounter.Compare(startEnergy, endEnergy)
				if change.Kind == signalcounter.ChangeAdvanced {
					enhancedFields["energy_used_wh"] = change.Delta * 1000.0
				}
			}
		}

		// Aggregates from signal_log during the drive window
		slAvgSpeed, slMaxSpeed, slAvgPower := t.signalLogReader.DriveAggregates(ctx, vehicleID, active.StartTime, endTs)
		// signal_log stores SI (m/s). Writing to *_mph would trigger
		// translatePartialFieldsToSI
		// to multiply by mpsPerMph (0.44704) producing a 0.44× understatement
		// of both avg and max speed. Write SI-direct via *_mps which the
		// SI passthrough in translate now permits. endDistUnit is no longer
		// consulted because the signal_log values are unit-canonical SI.
		if slAvgSpeed > 0 {
			enhancedFields["avg_speed_mps"] = slAvgSpeed
		}
		if slMaxSpeed > 0 {
			enhancedFields["max_speed_mps"] = slMaxSpeed
			// maxSpeed (legacy m/s passed to CompleteWithTx as if mph)
			// is left at zero so completeArgsToSI's max_speed_mph * 0.44704
			// yields zero. PartialUpdateWithTx then writes the correct
			// SI-direct value. Avoids the historical mph↔mps double convert.
		}
		if slAvgPower != 0 {
			// DriveAggregates returns avg power in kW; convert to SI W.
			avgPowerW := math.Abs(slAvgPower) * 1000.0
			enhancedFields["avg_power_w"] = avgPowerW
			powerMax = &avgPowerW
		}

		// Regen energy. RegenEnergy returns kWh; convert to SI Wh.
		regenKwh := t.signalLogReader.RegenEnergy(ctx, vehicleID, active.StartTime, endTs)
		if regenKwh > 0 {
			enhancedFields["regen_energy_wh"] = regenKwh * 1000.0
		}
	} else if t.signalHistoryWriter != nil {
		// Legacy fallback path: signalHistoryWriter is wired but signalLogReader
		// is not. Both legs still go through active.state because StateReader
		// is the canonical cold-path read API; the writer-side
		// gating is preserved purely as a degradation hint that cold reads may
		// not be backed by the primary reader. The lat/lng + temp recovery
		// below is the residual enrichment performed in this degraded mode.
		var startSnapshot, endSnapshot map[string]interface{}
		if active.state != nil {
			s, startErr := active.state.State(ctx, vehicleID, active.StartTime)
			if startErr != nil {
				log.Warn().Err(startErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State (history-writer fallback) drive start snapshot failed")
				startSnapshot = map[string]interface{}{}
			} else {
				startSnapshot = stateToLegacyMap(s)
			}
			s2, endErr := active.state.State(ctx, vehicleID, endTs)
			if endErr != nil {
				log.Warn().Err(endErr).Int64("vehicle_id", vehicleID).
					Msg("telemetry: state.State (history-writer fallback) drive end snapshot failed")
				endSnapshot = map[string]interface{}{}
			} else {
				endSnapshot = stateToLegacyMap(s2)
			}
		} else {
			startSnapshot = map[string]interface{}{}
			endSnapshot = map[string]interface{}{}
		}

		// Fill missing start position. Dual-key tolerance accepts the codec's
		// LocationLatitude name and the legacy Latitude name.
		if _, exists := enhancedFields["start_lat"]; !exists {
			for _, k := range []string{"LocationLatitude", "Latitude"} {
				if v, ok := startSnapshot[k]; ok {
					if lat, fOk := v.(float64); fOk {
						enhancedFields["start_lat"] = lat
						break
					}
				}
			}
		}
		if _, exists := enhancedFields["start_lng"]; !exists {
			for _, k := range []string{"LocationLongitude", "Longitude"} {
				if v, ok := startSnapshot[k]; ok {
					if lon, fOk := v.(float64); fOk {
						enhancedFields["start_lng"] = lon
						break
					}
				}
			}
		}

		// Fill missing end position
		if _, exists := enhancedFields["end_lat"]; !exists {
			for _, k := range []string{"LocationLatitude", "Latitude"} {
				if v, ok := endSnapshot[k]; ok {
					if lat, fOk := v.(float64); fOk {
						enhancedFields["end_lat"] = lat
						break
					}
				}
			}
		}
		if _, exists := enhancedFields["end_lng"]; !exists {
			for _, k := range []string{"LocationLongitude", "Longitude"} {
				if v, ok := endSnapshot[k]; ok {
					if lon, fOk := v.(float64); fOk {
						enhancedFields["end_lng"] = lon
						break
					}
				}
			}
		}

		// Fill missing temperature (single-point fallback when no temp signals during drive).
		// Inside cabin temp has no persistent column; only ambient is stored.
		if outsideAvg == nil {
			if v, ok := startSnapshot["OutsideTemp"]; ok {
				if temp, fOk := v.(float64); fOk {
					enhancedFields["ambient_temp_c_avg"] = temp
					outsideAvg = &temp
				}
			}
		}
		if insideAvg == nil {
			if v, ok := startSnapshot["InsideTemp"]; ok {
				if temp, fOk := v.(float64); fOk {
					//nolint:ineffassign,staticcheck // insideAvg is dead but retained until the persistence rewrite lands.
					insideAvg = &temp
					_ = insideAvg
				}
			}
		}
	}

	// Compute durationS in SI seconds for downstream completion call.
	durationS := int64(duration*60.0 + 0.5)
	// active.MaxSpeed is captured in m/s because VehicleSpeed is SI.
	// active.PowerMax is captured in kW (signalPowerKW returns
	// V*A/1000); convert to SI W for the avg_power_w write below.
	maxSpeedMps := active.MaxSpeed
	var powerMaxW *float64
	if powerMax != nil {
		w := *powerMax * 1000.0
		powerMaxW = &w
	}

	if err := t.withTransaction(ctx, func(tx pgx.Tx) error {
		var endBatteryPct *int16
		if endBattery := int16(endBattery); endBattery > 0 {
			endBatteryPct = &endBattery
		}
		if err := t.driveRepo.CompleteWithTx(ctx, tx, active.DriveID, endTs,
			distanceMeters, durationS, endBatteryPct, &maxSpeedMps, powerMaxW, outsideAvg); err != nil {
			return err
		}
		// Attach unattributed drive_telemetry rows to this drive in the same
		// tx as the completion update. Window is
		// [active.StartTime, endTs] which already accounts for drive-merge
		// (active.StartTime equals the original leg-1 start when merged via
		// tryMergeDriveLocked). Failure inside this call rolls back the
		// completion too — partial-failure window must not exist.
		if affected, err := t.driveRepo.BackfillDriveTelemetryDriveIDInTx(
			ctx, tx, active.DriveID, vehicleID, active.StartTime, endTs); err != nil {
			log.Error().Err(err).
				Int64("drive_id", active.DriveID).
				Int64("vehicle_id", vehicleID).
				Time("start_ts", active.StartTime).
				Time("end_ts", endTs).
				Msg("telemetry: drive_telemetry drive_id backfill failed; rolling back completion")
			return err
		} else if affected > 0 {
			log.Info().
				Int64("drive_id", active.DriveID).
				Int64("vehicle_id", vehicleID).
				Int64("rows_attributed", affected).
				Time("start_ts", active.StartTime).
				Time("end_ts", endTs).
				Msg("telemetry: backfilled drive_telemetry.drive_id for completed drive")
		}
		if len(enhancedFields) > 0 {
			if err := t.driveRepo.PartialUpdateWithTx(ctx, tx, active.DriveID, enhancedFields); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		active.Completing = false
		log.Error().Err(err).Int64("drive_id", active.DriveID).Msg("telemetry: failed to complete drive")
		return false
	}

	// --- Backfill missing start/end values from nearest position data ---
	// Fleet Telemetry sends signals at different intervals (SOC every ~5 min,
	// odometer sporadically). If the drive start/end moment didn't coincide
	// with a reading, we find the closest position within ±10 minutes.
	// Endpoint finalization must observe the backfilled coordinates, so it is
	// chained after the backfill instead of raced against it — both write
	// end_lat/end_lng and the later writer would win. Finalization also owns
	// the drive-completion geocode, because the end label has to be resolved
	// from the endpoint that survives that correction.
	go func() {
		t.backfillDriveValues(active, vehicleID, endTs)
		t.finalizeDriveEndpoints(active.DriveID)
	}()

	log.Info().Int64("vehicle_id", vehicleID).Int64("drive_id", active.DriveID).
		Int64("duration_s", durationS).Float64("distance_m", distanceMeters).Msg("telemetry: drive ended")

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
				"distance_m": distanceMeters, "duration_s": durationS, "source": "fleet_telemetry"}})
	}

	delete(t.activeDrives, vehicleID)
	metrics.DriveSessionsActive.Dec()
	metrics.DriveSessionsCompleted.Inc()
	metrics.TotalDrives.Inc()
	if distanceMeters > 0 {
		// metrics.TotalDistanceKm is reported in km; convert from SI meters.
		metrics.TotalDistanceKm.Add(distanceMeters / 1000.0)
	}
	return true
}

// backfillDriveValues checks if a completed drive has missing start/end values
// (SOC, odometer, range, elevation) and fills them from the nearest position data.
// Runs async after drive completion — does not block the telemetry pipeline.
func (t *TelemetrySessionTracker) backfillDriveValues(active *streamingDrive, vehicleID int64, endTime time.Time) {
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
				backfill["start_soc_pct"] = float32(startPos.BatteryLvl)
			}
			if active.StartLatitude == nil && startPos.Lat != 0 {
				backfill["start_lat"] = startPos.Lat
				backfill["start_lng"] = startPos.Lng
			}
		}
	}

	// --- Backfill end values ---
	endPos, err := findNearestPositionFallback(ctx, t.posRepo, vehicleID, endTime, lookupWindow)
	if err == nil && endPos != nil {
		if endPos.BatteryLvl > 0 {
			backfill["end_soc_pct"] = float32(endPos.BatteryLvl)
		}
		if active.LastOdometer == nil && endPos.Odometer > 0 {
			// Recompute distance if we now have both start and end odometer.
			// The positions writer supplies SI canonical odometer in meters;
			// the subtraction yields meters which goes
			// straight into the SI-canonical distance_m partial-update field.
			startOdo := 0.0
			if active.StartOdometer != nil {
				startOdo = *active.StartOdometer
			}
			if startOdo > 0 {
				dist := endPos.Odometer - startOdo
				if dist > 0 {
					backfill["distance_m"] = dist
				}
			}
		}
		if active.LastLatitude == nil && endPos.Lat != 0 {
			backfill["end_lat"] = endPos.Lat
			backfill["end_lng"] = endPos.Lng
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

// addressResolveMode selects whether a place lookup may be served from the
// places cache. Repairs must bypass it: the cache stores the label produced by
// the labelling revision in force when it was written, so a cached read would
// hand the repair back the very string it is trying to replace.
type addressResolveMode int

const (
	resolveUseCache addressResolveMode = iota
	resolveBypassCache
)

// geocodeRateLimit paces provider calls during bulk backfill/repair passes.
// Nominatim's usage policy caps callers at 1 request/second.
const geocodeRateLimit = 1100 * time.Millisecond

// resolveAndUpdateAddress resolves a place name for one drive endpoint and
// writes it to start_place or end_place. It reports whether a name was stored.
func (t *TelemetrySessionTracker) resolveAndUpdateAddress(driveID int64, lat, lon float64, isStart bool, mode addressResolveMode) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// SI canonical column names use start_place / end_place instead of
	// start_address / end_address. drivePartialAllowed gates writes to these
	// exact keys; before this
	// rename, every geocode call silently no-op'd because buildPartialUpdate
	// skips fields not in the allowlist, leaving end_place permanently NULL
	// and the Visited Locations page empty.
	field := "end_place"
	geofenceField := "end_geofence_id"
	if isStart {
		field = "start_place"
		geofenceField = "start_geofence_id"
	}

	// 1. Check geofences first (user-defined names like "Home", "Office").
	// Match-only — a drive endpoint NEVER auto-creates a geofence (that is
	// exclusive to a confirmed charging session; see
	// telemetry_sessions_charge_geofence_pricing.go). Attaching
	// start_geofence_id/end_geofence_id lets a later place rename
	// retroactively improve this drive's displayed name — see
	// DriveRepo.resolveCurrentGeofenceNames and the StartGeofenceID doc on
	// drivemodel.Drive — while start_place/end_place keep storing today's
	// name as the permanent fallback.
	if geofences, err := t.geofenceRepo.FindByCoordinates(ctx, lat, lon); err == nil && len(geofences) > 0 {
		_ = t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{
			field:         geofences[0].Name,
			geofenceField: geofences[0].ID,
		})
		metrics.GeocodingTotal.WithLabelValues("geofence").Inc()
		return true
	}

	// 2. Check places cache (previously resolved locations within 50m)
	if mode == resolveUseCache {
		if cached, err := t.placesCache.FindNearby(ctx, lat, lon, 50); err == nil && cached != nil {
			_ = t.placesCache.IncrementHitCount(ctx, cached.ID)
			_ = t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: cached.DisplayName})
			metrics.GeocodingTotal.WithLabelValues("cached").Inc()
			return true
		}
	}

	// 3. Reverse geocode via Nominatim (or Google when configured)
	geocodeStart := time.Now()
	result, err := t.geocoder.ReverseGeocode(ctx, lat, lon)
	metrics.ObserveDurationWithExemplar(ctx, metrics.GeocodingDuration, time.Since(geocodeStart).Seconds())
	if err != nil {
		metrics.GeocodingTotal.WithLabelValues("failure").Inc()
		log.Warn().Err(err).Float64("lat", lat).Float64("lon", lon).Msg("telemetry: reverse geocode failed")
		return false
	}
	if result == nil {
		metrics.GeocodingTotal.WithLabelValues("failure").Inc()
		log.Warn().Float64("lat", lat).Float64("lon", lon).Msg("telemetry: reverse geocode returned no result")
		return false
	}
	metrics.GeocodingTotal.WithLabelValues("success").Inc()

	name := result.ShortName()
	if name == "" {
		log.Warn().Float64("lat", lat).Float64("lon", lon).Msg("telemetry: reverse geocode produced an empty place name")
		return false
	}

	// Save to cache for future lookups. Upsert overwrites any entry within 50m,
	// so a repair also refreshes the stale label other drives would have read.
	_ = t.placesCache.Upsert(ctx, &dbadmin.PlaceCacheEntry{
		Latitude:     lat,
		Longitude:    lon,
		DisplayName:  name,
		Source:       "geocoding",
		BusinessName: ptrStrOrNil(result.Name),
		City:         ptrStrOrNil(result.City),
		State:        ptrStrOrNil(result.State),
		Country:      ptrStrOrNil(result.Country),
		Postcode:     ptrStrOrNil(result.PostCode),
	})

	if err := t.driveRepo.PartialUpdate(ctx, driveID, map[string]interface{}{field: name}); err != nil {
		log.Error().Err(err).Int64("drive_id", driveID).Str("field", field).Msg("telemetry: failed to update address")
		return false
	}
	return true
}

// BackfillAddresses geocodes drives that have coordinates but no address names,
// then repairs drives still carrying labels from an older labelling revision.
// Runs as a background goroutine at startup.
func (t *TelemetrySessionTracker) BackfillAddresses(ctx context.Context) {
	t.backfillMissingAddresses(ctx)
	t.RepairStalePlaceLabels(ctx)
}

// backfillMissingAddresses fills in place names for drives that have never been
// geocoded at all.
func (t *TelemetrySessionTracker) backfillMissingAddresses(ctx context.Context) {
	drives, err := t.driveRepo.FindMissingAddresses(ctx)
	if err != nil {
		log.Error().Err(err).Msg("backfill: failed to query drives missing addresses")
		return
	}
	if len(drives) == 0 {
		return
	}
	log.Info().Int("count", len(drives)).Msg("backfill: geocoding drives with missing addresses")
	metrics.AddressBackfillRemaining.Set(float64(len(drives)))

	filled := 0
	for _, d := range drives {
		// Respect context cancellation (app shutdown)
		if ctx.Err() != nil {
			break
		}

		// A drive missing labels may also carry endpoints that were never
		// recorded or that collapsed onto one fix. Correct them from the track
		// before geocoding so the two ends resolve to different places.
		t.repairDriveEndpointCoords(ctx, d)

		needStart := (d.StartAddress == nil || *d.StartAddress == "") && d.StartLat != nil && d.StartLon != nil
		needEnd := (d.EndAddress == nil || *d.EndAddress == "") && d.EndLat != nil && d.EndLon != nil

		if needStart {
			t.resolveAndUpdateAddress(d.ID, *d.StartLat, *d.StartLon, true, resolveUseCache)
			filled++
			metrics.AddressBackfillCompleted.Inc()
			metrics.AddressBackfillRemaining.Dec()
			// Rate-limit to avoid hammering the geocoder (Nominatim 1 req/sec policy)
			time.Sleep(geocodeRateLimit)
		}
		if needEnd {
			if ctx.Err() != nil {
				break
			}
			t.resolveAndUpdateAddress(d.ID, *d.EndLat, *d.EndLon, false, resolveUseCache)
			filled++
			metrics.AddressBackfillCompleted.Inc()
			metrics.AddressBackfillRemaining.Dec()
			time.Sleep(geocodeRateLimit)
		}
	}
	log.Info().Int("resolved", filled).Int("total_drives", len(drives)).Msg("backfill: address geocoding complete")
}

// endpointsDegenerate reports whether a drive's stored endpoint coordinates
// cannot describe two distinct places: either end is missing, or both ends hold
// the identical fix. Such a row geocodes to the same label twice.
func endpointsDegenerate(d *drivemodel.Drive) bool {
	if d.StartLat == nil || d.StartLon == nil || d.EndLat == nil || d.EndLon == nil {
		return true
	}
	return *d.StartLat == *d.EndLat && *d.StartLon == *d.EndLon
}

// repairDriveEndpointCoords corrects a drive's stored endpoint coordinates from
// its recorded GPS track and reports whether anything changed.
//
// Re-geocoding alone cannot fix a Journey Details panel that shows the same
// Start and Destination, because the geocoder is handed drives.start_lat /
// end_lat — so when those columns already hold one fix twice, a repair pass
// faithfully rewrites the identical label into both fields. The true endpoints
// survive in signal_log, which is the same track the route map draws, which is
// why the map looks right while the panel does not.
//
// The drive struct is updated in place so the caller geocodes the corrected
// coordinates in the same pass. Only endpoints that are actually wrong are
// rewritten: a drive that genuinely starts and ends in one place (a round trip)
// keeps its coordinates, because the track's first and last fix agree with what
// is stored. It reports which endpoints moved so the caller can re-resolve the
// labels that the correction invalidated.
func (t *TelemetrySessionTracker) repairDriveEndpointCoords(ctx context.Context, d *drivemodel.Drive) (startRepaired, endRepaired bool) {
	if t.signalLogReader == nil || d == nil || !endpointsDegenerate(d) {
		return false, false
	}

	endTs := time.Now()
	if d.EndTs != nil {
		endTs = *d.EndTs
	}
	track, err := t.signalLogReader.DriveEndpointCoordinates(ctx, d.VehicleID, d.StartTs, endTs)
	if err != nil {
		log.Warn().Err(err).Int64("drive_id", d.ID).
			Msg("endpoint repair: failed to read drive track")
		return false, false
	}
	if track == nil || track.StartLat == nil || track.EndLat == nil {
		return false, false
	}

	fields := map[string]interface{}{}
	if d.StartLat == nil || d.StartLon == nil || *d.StartLat != *track.StartLat || *d.StartLon != *track.StartLon {
		fields["start_lat"] = *track.StartLat
		fields["start_lng"] = *track.StartLon
	}
	if d.EndLat == nil || d.EndLon == nil || *d.EndLat != *track.EndLat || *d.EndLon != *track.EndLon {
		fields["end_lat"] = *track.EndLat
		fields["end_lng"] = *track.EndLon
	}
	if len(fields) == 0 {
		return false, false
	}

	if err := t.driveRepo.PartialUpdate(ctx, d.ID, fields); err != nil {
		log.Error().Err(err).Int64("drive_id", d.ID).
			Msg("endpoint repair: failed to persist corrected coordinates")
		return false, false
	}

	if _, ok := fields["start_lat"]; ok {
		d.StartLat, d.StartLon = track.StartLat, track.StartLon
		startRepaired = true
	}
	if _, ok := fields["end_lat"]; ok {
		d.EndLat, d.EndLon = track.EndLat, track.EndLon
		endRepaired = true
	}
	log.Info().Int64("drive_id", d.ID).Int64("vehicle_id", d.VehicleID).
		Bool("start_repaired", startRepaired).Bool("end_repaired", endRepaired).
		Msg("endpoint repair: corrected drive endpoints from GPS track")
	return startRepaired, endRepaired
}

// finalizeDriveEndpoints runs once a completed drive's deferred value backfill
// has settled. It re-reads the persisted row so it observes the final stored
// coordinates, corrects endpoints that collapsed onto a single fix, and then
// resolves the place labels.
//
// The end label is always resolved here — this is the drive-completion geocode.
// The start label is only re-resolved when the repair moved the start endpoint,
// because the label written at drive start then describes the wrong place.
func (t *TelemetrySessionTracker) finalizeDriveEndpoints(driveID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	d, err := t.driveRepo.GetByID(ctx, driveID)
	if err != nil {
		log.Warn().Err(err).Int64("drive_id", driveID).
			Msg("telemetry: endpoint finalize could not read drive")
		return
	}
	if d == nil {
		return
	}

	startRepaired, _ := t.repairDriveEndpointCoords(ctx, d)

	if d.StartLat != nil && d.StartLon != nil &&
		(startRepaired || d.StartAddress == nil || *d.StartAddress == "") {
		t.resolveAndUpdateAddress(d.ID, *d.StartLat, *d.StartLon, true, resolveUseCache)
	}
	if d.EndLat != nil && d.EndLon != nil {
		t.resolveAndUpdateAddress(d.ID, *d.EndLat, *d.EndLon, false, resolveUseCache)
	}
}

// placeLabelRepairBatch bounds one database round-trip of the repair backlog.
// The pass loops until the backlog drains, so this only caps how many rows are
// held in memory at once.
const placeLabelRepairBatch = 100

// RepairStalePlaceLabels re-resolves start_place / end_place for drives whose
// labels were produced by an older labelling revision.
//
// Every provider adapter used to discard the house number and POI name, so a
// drive with both ends on one road stored the same road-level string twice and
// Journey Details showed an identical Start and Destination. Fixing the
// labelling logic only helps drives geocoded afterwards; already-stored rows
// stay wrong until they are resolved again, which is what this pass does.
//
// The places cache is deliberately bypassed — it holds labels written by the
// old revision, so a cached read would return the exact string being replaced.
// Each drive is marked with the current revision once at least one endpoint
// resolves, making the pass idempotent: the backlog only ever shrinks, and a
// drive whose provider lookup fails is retried on a later run instead of being
// silently marked done.
func (t *TelemetrySessionTracker) RepairStalePlaceLabels(ctx context.Context) {
	if t.driveRepo == nil || t.geocoder == nil {
		return
	}

	repaired, failed := 0, 0
	for {
		if ctx.Err() != nil {
			break
		}
		drives, err := t.driveRepo.FindStalePlaceLabels(ctx, placeLabelRepairBatch)
		if err != nil {
			log.Error().Err(err).Msg("place-label repair: failed to query stale drives")
			return
		}
		if len(drives) == 0 {
			break
		}
		if repaired == 0 && failed == 0 {
			log.Info().Msg("place-label repair: re-resolving drives labelled by an older revision")
		}

		batchRepaired := 0
		batchFailed := 0
		for _, d := range drives {
			if ctx.Err() != nil {
				break
			}

			resolved := false
			// Correct the stored coordinates first. Geocoding reads
			// d.StartLat / d.EndLat, so repairing labels before endpoints
			// would just rewrite the same wrong label into both fields.
			t.repairDriveEndpointCoords(ctx, d)

			if d.StartLat != nil && d.StartLon != nil {
				if t.resolveAndUpdateAddress(d.ID, *d.StartLat, *d.StartLon, true, resolveBypassCache) {
					resolved = true
				}
				time.Sleep(geocodeRateLimit)
			}
			if ctx.Err() != nil {
				break
			}
			if d.EndLat != nil && d.EndLon != nil {
				if t.resolveAndUpdateAddress(d.ID, *d.EndLat, *d.EndLon, false, resolveBypassCache) {
					resolved = true
				}
				time.Sleep(geocodeRateLimit)
			}

			// Leave the version untouched when nothing resolved so a provider
			// outage cannot permanently strand a drive on the old label.
			if !resolved {
				batchFailed++
				continue
			}
			if err := t.driveRepo.MarkPlaceLabelVersion(ctx, d.ID); err != nil {
				log.Error().Err(err).Int64("drive_id", d.ID).Msg("place-label repair: failed to mark drive resolved")
				batchFailed++
				continue
			}
			batchRepaired++
		}
		repaired += batchRepaired
		// Failures stay in the backlog and are re-selected by the next query,
		// so only the latest batch's count describes what is still outstanding;
		// accumulating would report the same row once per pass.
		failed = batchFailed

		// The backlog query is not cursor-paginated: rows that failed stay
		// selected. A batch that marked nothing therefore returns the identical
		// rows next time, so stop instead of spinning. The survivors are picked
		// up by the next run.
		if batchRepaired == 0 {
			break
		}
	}

	if repaired > 0 || failed > 0 {
		log.Info().Int("repaired", repaired).Int("deferred", failed).
			Msg("place-label repair: complete")
	}
}

// driveMergeWindow is the maximum gap between an ended drive's ended_at and
// a new candidate drive's startTs that triggers a merge instead of a new
// drive row. MUST stay smaller than fsm.StateConfirmDuration (30s) plus
// a small grace so two genuinely
// separate trips made minutes apart never get merged.
const driveMergeWindow = 90 * time.Second

// tryMergeDriveLocked attempts to extend a recently-ended drive instead of
// creating a new one. Returns true when a merge happened (caller should
// return without proceeding to the create path), false otherwise. Must be
// called with t.mu held.
//
// On merge, the prior drive's ended_at is cleared via DriveRepo.ResumeForMerge,
// the in-memory streamingDrive is seeded from the prior drive's start values
// (StartTs, StartOdometer, StartLat/Lng, StartBatteryPct) so completeDriveLocked
// extends the original drive's distance/duration window. In-memory aggregate
// scratch (MaxSpeed, SpeedSum, …) starts fresh; signal_log enrichment in
// completeDriveLocked recomputes max/avg over the full original-start →
// new-end window via DriveAggregates.
func (t *TelemetrySessionTracker) tryMergeDriveLocked(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, speed float64, gearBased bool, startTs time.Time, payloadTs time.Time) bool {
	if t.driveRepo == nil {
		return false
	}
	prev, err := t.driveRepo.FindRecentEndedForMerge(ctx, vehicleID, startTs, driveMergeWindow)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).
			Msg("telemetry: drive-merge lookup failed; falling back to new drive")
		return false
	}
	if prev == nil {
		return false
	}

	// Re-open the prior drive: clear ended_at so a subsequent Complete() extends it.
	if err := t.driveRepo.ResumeForMerge(ctx, prev.ID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Int64("drive_id", prev.ID).
			Msg("telemetry: drive-merge resume failed; falling back to new drive")
		return false
	}

	// Resolve current-batch values for live tracking (Last* fields used during the resumed leg).
	odometer, hasOdo := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Odometer")
	lat, lon, hasLoc := t.resolveLatLon(vehicleID, signals, accumulatedSignals)
	elevation, _ := t.resolveFloat(vehicleID, signals, accumulatedSignals, "Elevation")

	sd := &streamingDrive{
		DriveID:            prev.ID,
		VehicleID:          vehicleID,
		StartTime:          prev.StartTs, // canonical leg-1 start preserved
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
		state:              t.driveStateReader(),
	}
	if speed > 0 {
		sd.MaxSpeed = speed
		sd.MinSpeed = speed
		sd.SpeedSum = speed
		sd.SpeedCount = 1
	}

	// Seed start values from the prior drive row so completeDriveLocked
	// reports start-of-original-trip values and not start-of-second-leg.
	if prev.StartLat != nil {
		sd.StartLatitude = floatPtr(*prev.StartLat)
	}
	if prev.StartLon != nil {
		sd.StartLongitude = floatPtr(*prev.StartLon)
	}
	// Seed Last* from the current batch so subsequent samples extend continuously.
	if hasOdo {
		sd.LastOdometer = floatPtr(odometer)
	}
	if hasLoc {
		sd.LastLatitude = floatPtr(lat)
		sd.LastLongitude = floatPtr(lon)
	}
	sd.LastElevation = floatPtr(elevation)

	t.activeDrives[vehicleID] = sd
	metrics.DriveSessionsActive.Inc()

	// Accumulate this batch and flush so the resumed leg's first telemetry sample lands.
	sd.accumulatedSignals = accumulateSignals(sd.accumulatedSignals, signals)
	t.flushDriveTelemetry(ctx, sd)

	gap := startTs.Sub(*prev.EndTs)
	log.Info().
		Int64("vehicle_id", vehicleID).
		Int64("drive_id", prev.ID).
		Time("original_start", prev.StartTs).
		Time("merge_resume_at", startTs).
		Dur("gap", gap).
		Bool("gear_based", gearBased).
		Msg("telemetry: drive-merge — resumed prior drive instead of starting new one")

	if t.eventBus != nil {
		t.eventBus.Publish(events.Event{Type: events.DriveStarted, VehicleID: vehicleID, VIN: vin,
			Data: map[string]interface{}{
				"drive_id": prev.ID,
				"merged":   true,
				"gap_sec":  gap.Seconds(),
				"source":   "fleet_telemetry",
			}})
	}
	return true
}
