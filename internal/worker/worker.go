package worker

import (
	"sync"
	"time"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbauth "github.com/ev-dev-labs/teslasync/internal/database/auth"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/polling"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// vehicleHealth tracks per-vehicle polling state for backoff.
type vehicleHealth struct {
	consecFails  int
	consecAsleep int
	lastError    time.Time
	backoffUntil time.Time
}

// Worker polls Tesla API for vehicle data and stores it.
type Worker struct {
	db            *database.DB
	vehicleRepo   *vehicledb.VehicleRepo
	posRepo       *positiondb.PositionRepo
	driveRepo     *drivedb.DriveRepo
	chargeRepo    *chargingdb.ChargingRepo
	tokenRepo     *dbauth.TokenRepo
	alertRuleRepo *dbalert.AlertRuleRepo
	settingsRepo  *settingsdb.SettingsRepo
	teslaClient   *tesla.Client
	mqttClient    *mqtt.Client
	eventBus      *events.Bus
	cfg           config.WorkerConfig
	sessionSvc    *service.SessionService

	// Fleet Telemetry integration — when enabled, telemetry is primary and
	// the worker only polls as a fallback for non-streaming vehicles.
	FleetTelemetryEnabled bool

	// Optional streaming checker — when set, vehicles that are actively
	// streaming via Fleet Telemetry are skipped entirely (telemetry-primary
	// mode) or get reduced polling (hybrid mode).
	IsVehicleStreaming func(vin string) bool

	// Per-vehicle health tracking for adaptive backoff (guarded by mu)
	mu            sync.Mutex
	vehicleHealth map[int64]*vehicleHealth

	// Vehicle discovery ticker interval when fleet telemetry is primary
	discoveryInterval    time.Duration
	lastDiscovery        time.Time
	fallbackPollInterval time.Duration // overrides cfg.PollInterval when fleet telemetry is primary

	// Cached polling config — refreshed each poll cycle from the database.
	pollingConfig *settingsmodel.LegacyPollingConfig

	// Adaptive polling engine — evaluates API responses to determine optimal
	// poll intervals. When set, replaces the fixed-interval backoff logic.
	PollEngine *polling.PollEngine
}

// New creates a new Worker that polls the Tesla API at the configured interval,
// persists data to the database, and publishes updates via MQTT.
func New(db *database.DB, tc *tesla.Client, mc *mqtt.Client, cfg config.WorkerConfig, eb *events.Bus, enc *crypto.Encryptor) *Worker {
	return &Worker{
		db:                db,
		vehicleRepo:       vehicledb.NewVehicleRepo(db),
		posRepo:           positiondb.NewPositionRepo(db),
		driveRepo:         drivedb.NewDriveRepo(db),
		chargeRepo:        chargingdb.NewChargingRepo(db),
		tokenRepo:         dbauth.NewTokenRepo(db, enc),
		alertRuleRepo:     dbalert.NewAlertRuleRepo(db),
		settingsRepo:      settingsdb.NewSettingsRepo(db),
		teslaClient:       tc,
		mqttClient:        mc,
		eventBus:          eb,
		cfg:               cfg,
		sessionSvc:        service.NewSessionService(db, eb),
		vehicleHealth:     make(map[int64]*vehicleHealth),
		discoveryInterval: time.Hour,
	}
}

// SetFallbackPollInterval sets the polling interval used when fleet telemetry
// is the primary data source. In this mode, the worker only polls non-streaming
// vehicles as a fallback, so a longer interval (e.g., 60s) reduces API costs.
func (w *Worker) SetFallbackPollInterval(d time.Duration) {
	if d > 0 {
		w.fallbackPollInterval = d
	}
}
