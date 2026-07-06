package maintenance

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// maintenanceReadTimeout bounds the first-vehicle lookup and the live-signal
// read so a stalled TimescaleDB or Redis connection cannot hold a maintenance
// request open indefinitely.
const maintenanceReadTimeout = 5 * time.Second

// vehicleRowReader is the read port for the single "first vehicle" lookup. It
// is satisfied by *pgxpool.Pool (and pgx.Tx) — the same QueryRow shape as
// database.DBTX — so tests can inject a fake row without a live database.
type vehicleRowReader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// liveSignalReader is the read port for current vehicle signals (odometer). It
// is satisfied by *signal.RedisSignalCache; tests inject a fake to exercise the
// odometer projection without Redis.
type liveSignalReader interface {
	GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error)
}

// Handler serves maintenance schedule and service record endpoints.
type Handler struct {
	db         vehicleRowReader
	redisCache liveSignalReader
}

// NewHandler builds a maintenance Handler backed by the given database pool. A
// nil db (or nil pool) yields a handler that degrades to an empty schedule
// rather than panicking, keeping the endpoint safe if it is wired before the
// pool is ready.
func NewHandler(db *database.DB) *Handler {
	var reader vehicleRowReader
	if db != nil && db.Pool != nil {
		reader = db.Pool
	}
	return &Handler{db: reader}
}

// WithRedisCache sets the Redis signal cache used to read live vehicle state. A
// nil cache is ignored so a mis-wired caller cannot install a typed-nil that
// would later panic on GetAll.
func (h *Handler) WithRedisCache(cache *signal.RedisSignalCache) *Handler {
	if cache != nil {
		h.redisCache = cache
	}
	return h
}

// defaultMaintenanceItems returns standard Tesla EV maintenance items.
func (h *Handler) defaultItems(vehicleID int64, currentOdometer float64) []map[string]interface{} {
	now := time.Now()
	items := []map[string]interface{}{
		{
			"id": 1, "vehicle_id": vehicleID, "category": "filters",
			"name": "Cabin Air Filter", "description": "Replace cabin air filter (HEPA)",
			"due_date": now.AddDate(0, 6, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 24, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 2, "vehicle_id": vehicleID, "category": "tires",
			"name": "Tire Rotation", "description": "Rotate tires for even wear",
			"due_date": nil, "due_mileage": currentOdometer + 10000,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": nil, "interval_miles": 10000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 3, "vehicle_id": vehicleID, "category": "brakes",
			"name": "Brake Fluid Check", "description": "Test brake fluid for moisture content",
			"due_date": now.AddDate(0, 12, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 24, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 4, "vehicle_id": vehicleID, "category": "battery",
			"name": "Battery Coolant", "description": "Check battery coolant level and condition",
			"due_date": now.AddDate(2, 0, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 48, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 5, "vehicle_id": vehicleID, "category": "fluids",
			"name": "Windshield Washer Fluid", "description": "Top up windshield washer fluid",
			"due_date": nil, "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 6, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 6, "vehicle_id": vehicleID, "category": "wipers",
			"name": "Wiper Blades", "description": "Inspect and replace wiper blades if worn",
			"due_date": now.AddDate(0, 3, 0).Format("2006-01-02"), "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 12, "interval_miles": nil, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 7, "vehicle_id": vehicleID, "category": "alignment",
			"name": "Wheel Alignment", "description": "Check and adjust wheel alignment",
			"due_date": nil, "due_mileage": currentOdometer + 20000,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": nil, "interval_miles": 20000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
		{
			"id": 8, "vehicle_id": vehicleID, "category": "brakes",
			"name": "Brake Caliper Cleaning", "description": "Clean and lubricate brake calipers",
			"due_date": nil, "due_mileage": nil,
			"current_mileage": currentOdometer, "last_service_date": nil, "last_service_mileage": nil,
			"interval_months": 12, "interval_miles": 20000, "status": "good", "created_at": now.Format(time.RFC3339),
		},
	}
	return items
}

// List returns the maintenance schedule for the first vehicle. When no vehicle
// exists, the datastore is unreachable, or the handler has no database wired,
// it degrades to an empty schedule with 200 OK so the frontend renders an empty
// state instead of an error page.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), maintenanceReadTimeout)
	defer cancel()

	vehicleID, ok := h.firstVehicleID(ctx)
	if !ok {
		httpx.WriteJSON(w, http.StatusOK, []interface{}{})
		return
	}

	odometer := h.readOdometer(ctx, vehicleID)
	httpx.WriteJSON(w, http.StatusOK, h.defaultItems(vehicleID, odometer))
}

// firstVehicleID returns the lowest vehicle id. ok is false when no reader is
// configured, there is no vehicle, or the lookup fails. A genuine "no rows"
// result logs at debug (expected on a fresh install); any other error logs at
// warn so an outage is visible without failing the request.
func (h *Handler) firstVehicleID(ctx context.Context) (int64, bool) {
	if h.db == nil {
		log.Debug().Msg("maintenance: no database reader configured — empty schedule")
		return 0, false
	}
	var vehicleID int64
	if err := h.db.QueryRow(ctx, `SELECT id FROM vehicles ORDER BY id LIMIT 1`).Scan(&vehicleID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Debug().Msg("maintenance: no vehicle found — empty schedule")
		} else {
			log.Warn().Err(err).Msg("maintenance: vehicle lookup failed — empty schedule")
		}
		return 0, false
	}
	return vehicleID, true
}

// readOdometer returns the vehicle's current odometer reading in SI metres from
// the live signal cache, or 0 when the cache is unset, unreachable, or the
// Odometer signal is absent / non-numeric. Coercion goes through signal.Float64
// on purpose: the codec stores Odometer as a float32, so a bare v.(float64)
// assertion silently drops every real reading (see internal/signal/coerce.go).
func (h *Handler) readOdometer(ctx context.Context, vehicleID int64) float64 {
	if h.redisCache == nil {
		return 0
	}
	signals, err := h.redisCache.GetAll(ctx, vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).
			Msg("maintenance: live signal read failed — odometer defaulting to 0")
		return 0
	}
	raw, ok := signals["Odometer"]
	if !ok {
		return 0
	}
	odometer, ok := signal.Float64(raw)
	if !ok {
		return 0
	}
	return odometer
}

// Records returns service history records (empty for now — user-entered data).
func (h *Handler) Records(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, []interface{}{})
}
