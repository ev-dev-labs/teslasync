package api

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// TelemetrySessionTracker detects drive starts/ends and charge starts/ends
// from streaming Fleet Telemetry signals. Tracks comprehensive telemetry
// data throughout sessions for analytics.
type TelemetrySessionTracker struct {
	db                  *database.DB
	driveRepo           *drivedb.DriveRepo
	chargeRepo          *chargingdb.ChargingRepo
	posRepo             *database.PositionRepo
	geofenceRepo        *database.GeofenceRepo
	placesCache         *dbadmin.PlacesCacheRepo
	tripRepo            *tripdb.TripRepo
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
		driveRepo:     drivedb.NewDriveRepo(db),
		chargeRepo:    chargingdb.NewChargingRepo(db),
		posRepo:       database.NewPositionRepo(db),
		geofenceRepo:  database.NewGeofenceRepo(db),
		placesCache:   dbadmin.NewPlacesCacheRepo(db),
		tripRepo:      tripdb.NewTripRepo(db),
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
//
// Legacy entry point for callers without event-time information; defers to
// ProcessSignalsAt with empty payloadTs/fieldTs so the helpers fall back to
// time.Now().UTC() — the historical wall-clock behavior.
func (t *TelemetrySessionTracker) ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	t.ProcessSignalsAt(ctx, vehicleID, vin, signals, accumulatedSignals, time.Time{}, nil)
}

// ProcessSignalsAt is the event-time-aware variant. payloadTs is the
// largest EmittedAt across the batch (provided by the AtomicsObserver
// pipeline); fieldTs maps each Field to its per-atomic EmittedAt for
// per-field-derived timestamp attribution (e.g. drive-start at the
// Gear=D atomic's EmittedAt rather than the batch high-water mark).
// A zero payloadTs preserves the legacy wall-clock behavior — used by
// the legacy ProcessSignals wrapper plus the recovery / flush
// callers that have no signal payload.
//
// Phase-42a/0030.bis (commit C2 of v3.4 prod-replay accuracy fix) —
// without this thread, replaying a 24-minute window produces drives
// stamped with the replay-runner's clock instead of the original
// event window.
func (t *TelemetrySessionTracker) ProcessSignalsAt(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, payloadTs time.Time, fieldTs map[string]time.Time) {
	t.trackDriving(ctx, vehicleID, vin, signals, accumulatedSignals, payloadTs, fieldTs)
	t.trackCharging(ctx, vehicleID, vin, signals, accumulatedSignals, payloadTs, fieldTs)
}
