package trip

import "github.com/ev-dev-labs/teslasync/internal/domain"

// Validate checks domain invariants for a Trip.
func (t *Trip) Validate() error {
	var errs domain.ValidationErrors

	if t.VehicleID == "" {
		errs = append(errs, domain.ValidationError{Field: "vehicleId", Message: "required"})
	}

	if t.DistanceMiles < 0 {
		errs = append(errs, domain.ValidationError{Field: "distanceMiles", Message: "must be non-negative"})
	}

	if t.EnergyUsedKWh < 0 {
		errs = append(errs, domain.ValidationError{Field: "energyUsedKwh", Message: "must be non-negative"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}
