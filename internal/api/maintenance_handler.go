package api

import (
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MaintenanceHandler serves maintenance schedule and service record endpoints.
type MaintenanceHandler struct {
	db *database.DB
}

func NewMaintenanceHandler(db *database.DB) *MaintenanceHandler {
	return &MaintenanceHandler{db: db}
}

// defaultMaintenanceItems returns standard Tesla EV maintenance items.
func (h *MaintenanceHandler) defaultItems(vehicleID int64, currentOdometer float64) []map[string]interface{} {
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
func (h *MaintenanceHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get first vehicle's odometer
	var vehicleID int64
	var odometer float64
	err := h.db.Pool.QueryRow(ctx,
		`SELECT v.id, COALESCE(ls.odometer, 0)
		 FROM vehicles v
		 LEFT JOIN vehicle_live_state ls ON ls.vehicle_id = v.id
		 ORDER BY v.id LIMIT 1`,
	).Scan(&vehicleID, &odometer)
	if err != nil {
		log.Debug().Err(err).Msg("maintenance: no vehicle found")
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	writeJSON(w, http.StatusOK, h.defaultItems(vehicleID, odometer))
}

// Records returns service history records (empty for now — user-entered data).
func (h *MaintenanceHandler) Records(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []interface{}{})
}
