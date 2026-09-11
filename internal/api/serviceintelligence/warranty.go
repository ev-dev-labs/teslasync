package serviceintelligence

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

// Tesla warranty terms (US). Start date is the delivery date, which
// TeslaSync does not know — the outlook conservatively counts from
// January 1 of the model year and says so, so real coverage can only be
// longer than shown.
const (
	basicYears    = 4
	basicKm       = 80467.0 // 50,000 mi
	batteryYears  = 8
	batteryKmS3RY = 160934.0 // Model 3 RWD / Model Y RWD: 100,000 mi
	batteryKmLR   = 192000.0 // Model 3/Y Long Range: 120,000 mi (rounded)
	batteryKmSX   = 241402.0 // Model S/X: 150,000 mi
)

// WarrantyCoverage is one countdown: time leg always, mileage leg only when
// the caller supplies an odometer reading.
type WarrantyCoverage struct {
	Name          string   `json:"name"`
	ExpiresAt     string   `json:"expires_at"`
	DaysRemaining int      `json:"days_remaining"`
	KmLimit       *float64 `json:"km_limit"`
	KmRemaining   *float64 `json:"km_remaining"`
	Status        string   `json:"status"` // active | expiring_soon | expired
	Basis         string   `json:"basis"`
}

// WarrantyOutlook is the GET .../warranty response.
type WarrantyOutlook struct {
	VehicleID  int64              `json:"vehicle_id"`
	Model      string             `json:"model"`
	ModelYear  int                `json:"model_year"`
	Coverages  []WarrantyCoverage `json:"coverages"`
	Assumption string             `json:"assumption"`
}

// WarrantyOutlookFor is the pure countdown over a model + model year.
// odometerKm < 0 (or NaN) means unknown: mileage legs are omitted rather
// than guessed.
func WarrantyOutlookFor(vehicleID int64, model string, modelYear int, odometerKm float64, now time.Time) WarrantyOutlook {
	out := WarrantyOutlook{
		VehicleID:  vehicleID,
		Model:      model,
		ModelYear:  modelYear,
		Coverages:  []WarrantyCoverage{},
		Assumption: "Counted from January 1 of the model year (delivery date unknown) — actual coverage runs longer.",
	}
	if modelYear <= 0 {
		return out
	}
	start := time.Date(modelYear, 1, 1, 0, 0, 0, 0, time.UTC)
	out.Coverages = append(out.Coverages,
		coverage("Basic Limited", start.AddDate(basicYears, 0, 0), basicKm, odometerKm, now),
		coverage("Battery & Drive Unit", start.AddDate(batteryYears, 0, 0), batteryKmFor(model), odometerKm, now),
	)
	return out
}

// batteryKmFor maps the model to its battery/drive-unit mileage cap.
// Unknown trims map to the lowest cap (conservative) and say so.
func batteryKmFor(model string) float64 {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(m, "model s"), m == "s",
		strings.Contains(m, "model x"), m == "x":
		return batteryKmSX
	case strings.Contains(m, "model 3"), m == "3":
		if strings.Contains(m, "long range") || strings.Contains(m, "performance") {
			return batteryKmLR
		}
		return batteryKmS3RY
	case strings.Contains(m, "model y"), m == "y",
		strings.Contains(m, "cybertruck"):
		return batteryKmLR
	default:
		return batteryKmS3RY
	}
}

func coverage(name string, expires time.Time, kmLimit, odometerKm float64, now time.Time) WarrantyCoverage {
	c := WarrantyCoverage{
		Name:      name,
		ExpiresAt: expires.Format("2006-01-02"),
		Basis:     "time",
	}
	days := int(math.Floor(expires.Sub(now).Hours() / 24))
	c.DaysRemaining = days
	if odometerKm >= 0 && !math.IsNaN(odometerKm) {
		limit, rem := kmLimit, kmLimit-odometerKm
		c.KmLimit, c.KmRemaining = &limit, &rem
		if rem < 0 {
			c.DaysRemaining = 0
		}
	}
	switch {
	case days < 0 || (c.KmRemaining != nil && *c.KmRemaining < 0):
		c.Status = "expired"
		if c.KmRemaining != nil && *c.KmRemaining < 0 && days >= 0 {
			c.Basis = "mileage"
		}
	case days <= 180 || (c.KmRemaining != nil && *c.KmRemaining <= 8000):
		c.Status = "expiring_soon"
	default:
		c.Status = "active"
	}
	return c
}

// Warranty resolves the vehicle's decoded model/year and returns the
// coverage countdown. odometerKm < 0 means unknown (time-only outlook).
func (s *Service) Warranty(ctx context.Context, vehicleID int64, odometerKm float64) (*WarrantyOutlook, error) {
	if vehicleID <= 0 {
		return nil, ErrInvalidVehicle
	}
	if s == nil || s.vehicles == nil || s.nhtsa == nil {
		return nil, fmt.Errorf("service intelligence dependencies are not configured")
	}
	vehicle, err := s.vehicles.GetVehicleMetadata(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("load service-intelligence vehicle %d: %w", vehicleID, err)
	}
	if vehicle == nil {
		return nil, ErrVehicleNotFound
	}
	decoded, err := s.nhtsa.DecodeVIN(ctx, vehicle.VIN, nhtsa.FetchOptions{})
	if err != nil {
		return nil, fmt.Errorf("decode service-intelligence vehicle %d: %w", vehicleID, err)
	}
	out := WarrantyOutlookFor(vehicleID, decoded.Vehicle.Model, decoded.Vehicle.ModelYear, odometerKm, s.now().UTC())
	return &out, nil
}

// WarrantyHandler serves GET /service-intelligence/vehicles/{vehicleID}/warranty?odometer_km=.
func (h *Handler) WarrantyHandler(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "service_intelligence.warranty")
	defer span.End()
	r = r.WithContext(ctx)

	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}
	odometerKm := -1.0
	if s := r.URL.Query().Get("odometer_km"); s != "" {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < 0 || math.IsNaN(v) {
			httpx.WriteError(w, http.StatusBadRequest, "odometer_km must be a non-negative number")
			return
		}
		odometerKm = v
	}
	out, err := h.service.Warranty(ctx, vehicleID, odometerKm)
	if err != nil {
		h.writeServiceError(w, ctx, span, vehicleID, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
