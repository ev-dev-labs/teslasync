package api

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/signal"
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
