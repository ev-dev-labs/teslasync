package maintenance

import (
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// Handler serves maintenance schedule and service record endpoints.
type Handler struct {
	db         *database.DB
	redisCache *signal.RedisSignalCache
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

// WithRedisCache sets the Redis signal cache for reading live vehicle state.
func (h *Handler) WithRedisCache(cache *signal.RedisSignalCache) *Handler {
	h.redisCache = cache
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

// List returns maintenance items for the first vehicle (or all).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var vehicleID int64
	err := h.db.Pool.QueryRow(ctx,
		`SELECT id FROM vehicles ORDER BY id LIMIT 1`,
	).Scan(&vehicleID)
	if err != nil {
		log.Debug().Err(err).Msg("maintenance: no vehicle found")
		httpx.WriteJSON(w, http.StatusOK, []interface{}{})
		return
	}

	// Read odometer from Redis signal cache
	var odometer float64
	if h.redisCache != nil {
		signals, rErr := h.redisCache.GetAll(ctx, vehicleID)
		if rErr == nil && signals != nil {
			if v, ok := signals["Odometer"]; ok {
				if f, ok := v.(float64); ok {
					odometer = f
				}
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, h.defaultItems(vehicleID, odometer))
}

// Records returns service history records (empty for now — user-entered data).
func (h *Handler) Records(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, []interface{}{})
}
