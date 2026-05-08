package trip

import "github.com/ev-dev-labs/teslasync/internal/domain"

// Validate checks domain invariants for a Trip.
func (t *Trip) Validate() error {
	var errs domain.ValidationErrors

	if t.VehicleID == "" {
		errs = append(errs, domain.ValidationError{Field: "vehicleId", Message: "required"})
	}

	if t.DistanceM < 0 {
		errs = append(errs, domain.ValidationError{Field: "distanceM", Message: "must be non-negative"})
	}

	if t.EnergyUsedWh < 0 {
		errs = append(errs, domain.ValidationError{Field: "energyUsedWh", Message: "must be non-negative"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}
