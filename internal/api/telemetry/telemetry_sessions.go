package telemetry

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/jackc/pgx/v5"
)

// TelemetrySessionTracker detects drive and charge boundaries from streaming Fleet Telemetry.
type TelemetrySessionTracker struct {
	db                  *database.DB
	driveRepo           *drivedb.DriveRepo
	chargeRepo          *chargingdb.ChargingRepo
	posRepo             *positiondb.PositionRepo
	geofenceRepo        *geofencedb.GeofenceRepo
	placesCache         *dbadmin.PlacesCacheRepo
	tripRepo            *tripdb.TripRepo
	eventBus            *events.Bus
	geocoder            geocoding.Geocoder
	localSignals        *signal.Store
	signalHistoryWriter *signaldb.SignalHistoryWriter
	signalLogReader     *signaldb.SignalLogReader
	transaction         func(context.Context, func(pgx.Tx) error) error

	mu            sync.Mutex
	activeDrives  map[int64]*streamingDrive  // vehicleID → active drive
	activeCharges map[int64]*streamingCharge // vehicleID → active charge
}

func (t *TelemetrySessionTracker) withTransaction(ctx context.Context, fn func(pgx.Tx) error) error {
	if t.transaction != nil {
		return t.transaction(ctx, fn)
	}
	return t.db.WithTx(ctx, fn)
}

// NewTelemetrySessionTracker creates a tracker with its repository dependencies.
func NewTelemetrySessionTracker(db *database.DB, eventBus *events.Bus, geocoder geocoding.Geocoder, store *signal.Store) *TelemetrySessionTracker {
	t := &TelemetrySessionTracker{
		db:            db,
		driveRepo:     drivedb.NewDriveRepo(db),
		chargeRepo:    chargingdb.NewChargingRepo(db),
		posRepo:       positiondb.NewPositionRepo(db),
		geofenceRepo:  geofencedb.NewGeofenceRepo(db),
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
func (t *TelemetrySessionTracker) SetSignalLogReader(r *signaldb.SignalLogReader) {
	t.signalLogReader = r
}

// telemetryWriteInterval controls how often drive/charge telemetry readings are
// flushed to the database. Signals are accumulated across MQTT batches within
// this window so each row has complete data instead of mostly NULLs.
const telemetryWriteInterval = 5 * time.Second

func accumulateSignals(acc map[string]interface{}, signals map[string]interface{}) map[string]interface{} {
	if acc == nil {
		acc = make(map[string]interface{}, len(signals))
	}
	for k, v := range signals {
		acc[k] = v
	}
	return acc
}

// ProcessSignals preserves the legacy wall-clock path for callers without event timestamps.
// accumulatedSignals supplies start values that may have arrived in earlier batches within the throttle window.
func (t *TelemetrySessionTracker) ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}) {
	t.ProcessSignalsAt(ctx, vehicleID, vin, signals, accumulatedSignals, time.Time{}, nil)
}

// ProcessSignalsAt attributes session transitions to telemetry event time when available.
// This keeps replayed windows stamped with original event times instead of the replay runner clock.
func (t *TelemetrySessionTracker) ProcessSignalsAt(ctx context.Context, vehicleID int64, vin string, signals map[string]interface{}, accumulatedSignals map[string]interface{}, payloadTs time.Time, fieldTs map[string]time.Time) {
	t.trackDriving(ctx, vehicleID, vin, signals, accumulatedSignals, payloadTs, fieldTs)
	t.trackCharging(ctx, vehicleID, vin, signals, accumulatedSignals, payloadTs, fieldTs)
}
