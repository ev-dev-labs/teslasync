package dto

import (
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// CreateVehicleRequest is the request body for creating a vehicle.
type CreateVehicleRequest struct {
	VIN         string `json:"vin"`
	DisplayName string `json:"displayName"`
	Year        int    `json:"year,omitempty"`
}

// Validate checks the transport-level shape of a CreateVehicleRequest:
// required fields, length bounds, and — when supplied — a plausible model
// year. Deeper invariants (VIN checksum, canonical model detection) belong
// to the domain layer; this guards the request boundary so malformed input
// is rejected before a domain object is constructed. The returned error, if
// any, is a domain.ValidationErrors that wraps domain.ErrValidation so the
// handler error middleware maps it to HTTP 400.
func (r CreateVehicleRequest) Validate() error {
	var errs domain.ValidationErrors

	switch {
	case r.VIN == "":
		errs = append(errs, domain.ValidationError{Field: "vin", Message: "required"})
	case len(r.VIN) != 17:
		errs = append(errs, domain.ValidationError{Field: "vin", Message: "must be exactly 17 characters"})
	}

	switch {
	case r.DisplayName == "":
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "required"})
	case len(r.DisplayName) > 100:
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "must be at most 100 characters"})
	}

	// Year is optional (omitempty); validate only when supplied.
	if r.Year != 0 {
		maxYear := time.Now().Year() + 1
		if r.Year < 2012 || r.Year > maxYear {
			errs = append(errs, domain.ValidationError{
				Field:   "year",
				Message: fmt.Sprintf("must be between 2012 and %d", maxYear),
			})
		}
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

// VehicleResponse is the API response for a vehicle.
type VehicleResponse struct {
	ID            string    `json:"id"`
	UserID        string    `json:"userId"`
	VIN           string    `json:"vin"`
	DisplayName   string    `json:"displayName"`
	Model         string    `json:"model"`
	Year          int       `json:"year"`
	FSMState      string    `json:"fsmState"`
	BatteryLevel  int       `json:"batteryLevel"`
	RangeMiles    float64   `json:"rangeMiles"`
	OdometerMiles float64   `json:"odometerMiles"`
	IsCharging    bool      `json:"isCharging"`
	Latitude      float64   `json:"latitude"`
	Longitude     float64   `json:"longitude"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
