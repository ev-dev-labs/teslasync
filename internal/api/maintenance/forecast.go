package maintenance

import (
	"context"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Forecast statuses.
const (
	forecastGood    = "good"
	forecastDueSoon = "due_soon"
	forecastOverdue = "overdue"
)

// maintenanceSpec pins Tesla EV service intervals. IntervalKm == 0 means
// time-only; IntervalMonths == 0 means mileage-only.
type maintenanceSpec struct {
	Name           string
	Category       string
	Description    string
	IntervalKm     float64
	IntervalMonths int
}

func maintenanceSpecs() []maintenanceSpec {
	return []maintenanceSpec{
		{"Cabin Air Filter", "filters", "Replace cabin air filter (HEPA)", 0, 24},
		{"Tire Rotation", "tires", "Rotate tires for even wear", 10000, 0},
		{"Brake Fluid Check", "brakes", "Test brake fluid for moisture content", 0, 24},
		{"Battery Coolant", "battery", "Check battery coolant level and condition", 0, 48},
		{"Windshield Washer Fluid", "fluids", "Top up windshield washer fluid", 0, 6},
		{"Wiper Blades", "wipers", "Inspect and replace wiper blades if worn", 0, 12},
		{"Wheel Alignment", "alignment", "Check and adjust wheel alignment", 20000, 0},
		{"Brake Caliper Cleaning", "brakes", "Clean and lubricate brake calipers", 20000, 12},
		{"12V Battery Health", "battery", "Load-test the 12V auxiliary battery", 0, 24},
		{"Tire Tread Depth", "tires", "Measure tread; replace below 4/32 in", 40000, 0},
	}
}

// ForecastItem is one projected maintenance item.
type ForecastItem struct {
	Name        string   `json:"name"`
	Category    string   `json:"category"`
	Description string   `json:"description"`
	DueDate     *string  `json:"due_date"`
	KmRemaining *float64 `json:"km_remaining"`
	Status      string   `json:"status"`
	Basis       string   `json:"basis"`
}

// MaintenanceForecast is the GET /maintenance/forecast response.
type MaintenanceForecast struct {
	VehicleID    int64          `json:"vehicle_id"`
	OdometerKm   float64        `json:"odometer_km"`
	KmPerDay     float64        `json:"km_per_day"`
	Items        []ForecastItem `json:"items"`
	DueSoonCount int            `json:"due_soon_count"`
	OverdueCount int            `json:"overdue_count"`
}

// ProjectForecast is the pure wear projection: time-based items count from
// now (no service history is recorded yet), mileage-based items from the
// odometer at the trailing daily rate. A zero rate degrades mileage items
// to date-unknown instead of dividing by zero.
func ProjectForecast(vehicleID int64, odometerKm, kmPerDay float64, now time.Time) MaintenanceForecast {
	fc := MaintenanceForecast{
		VehicleID:  vehicleID,
		OdometerKm: math.Round(odometerKm*10) / 10,
		KmPerDay:   math.Round(kmPerDay*10) / 10,
		Items:      []ForecastItem{},
	}
	for _, spec := range maintenanceSpecs() {
		item := ForecastItem{Name: spec.Name, Category: spec.Category, Description: spec.Description}
		switch {
		case spec.IntervalKm > 0 && spec.IntervalMonths > 0:
			// Whichever comes first.
			dateDue := now.AddDate(0, spec.IntervalMonths, 0)
			if kmPerDay > 0 {
				days := spec.IntervalKm / kmPerDay
				if kmDue := now.Add(time.Duration(days*24) * time.Hour); kmDue.Before(dateDue) {
					rem := spec.IntervalKm
					item.KmRemaining = &rem
					item.Basis = "mileage"
					setDue(&item, &fc, kmDue, now)
					break
				}
			}
			item.Basis = "time"
			s := dateDue.Format("2006-01-02")
			item.DueDate = &s
			setDue(&item, &fc, dateDue, now)
		case spec.IntervalKm > 0:
			rem := spec.IntervalKm
			item.KmRemaining = &rem
			item.Basis = "mileage"
			if kmPerDay > 0 {
				due := now.Add(time.Duration(spec.IntervalKm/kmPerDay*24) * time.Hour)
				s := due.Format("2006-01-02")
				item.DueDate = &s
				setDue(&item, &fc, due, now)
			} else {
				item.Status = forecastGood
			}
		default:
			due := now.AddDate(0, spec.IntervalMonths, 0)
			s := due.Format("2006-01-02")
			item.DueDate = &s
			item.Basis = "time"
			setDue(&item, &fc, due, now)
		}
		fc.Items = append(fc.Items, item)
	}
	return fc
}

func setDue(item *ForecastItem, fc *MaintenanceForecast, due, now time.Time) {
	switch {
	case !due.After(now):
		item.Status = forecastOverdue
		fc.OverdueCount++
	case due.Sub(now) <= 30*24*time.Hour:
		item.Status = forecastDueSoon
		fc.DueSoonCount++
	default:
		item.Status = forecastGood
	}
}

// Forecast serves GET /maintenance/forecast?vehicle_id=.... vehicle_id is
// optional (defaults to the first vehicle); the endpoint degrades to an
// empty-items forecast on missing data, matching List.
func (h *Handler) Forecast(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), maintenanceReadTimeout)
	defer cancel()

	vehicleID := int64(0)
	if s := r.URL.Query().Get("vehicle_id"); s != "" {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil || v <= 0 {
			httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
			return
		}
		vehicleID = v
	} else {
		var ok bool
		if vehicleID, ok = h.firstVehicleID(ctx); !ok {
			httpx.WriteJSON(w, http.StatusOK, MaintenanceForecast{Items: []ForecastItem{}})
			return
		}
	}

	odometer := h.readOdometer(ctx, vehicleID) / 1000.0
	rate := h.dailyRate(ctx, vehicleID)
	httpx.WriteJSON(w, http.StatusOK, ProjectForecast(vehicleID, odometer, rate, time.Now()))
}

// dailyRate returns trailing-90d km/day from the drives table, or 0 when
// unreadable. A single aggregate keeps the forecast to two round-trips.
func (h *Handler) dailyRate(ctx context.Context, vehicleID int64) float64 {
	if h.db == nil {
		return 0
	}
	var rate float64
	err := h.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(distance_m), 0) / 1000.0 / 90.0
		FROM drives
		WHERE vehicle_id = $1
		  AND started_at >= NOW() - INTERVAL '90 days'
		  AND distance_m IS NOT NULL AND distance_m > 0`, vehicleID).Scan(&rate)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("maintenance: daily rate unreadable — defaulting to 0")
		return 0
	}
	return rate
}
