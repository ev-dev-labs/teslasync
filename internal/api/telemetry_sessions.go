package api

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/signal"
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
