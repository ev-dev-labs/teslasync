package charging

import (
	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// Validate checks domain invariants for a ChargingSession.
func (s *ChargingSession) Validate() error {
	var errs domain.ValidationErrors

	if s.VehicleID == "" {
		errs = append(errs, domain.ValidationError{Field: "vehicleId", Message: "required"})
	}

	validChargerTypes := map[string]bool{"ac": true, "dc": true, "supercharger": true, "": true}
	if !validChargerTypes[s.ChargerType] {
		errs = append(errs, domain.ValidationError{Field: "chargerType", Message: "must be ac, dc, or supercharger"})
	}

	if s.StartBatteryLevel < 0 || s.StartBatteryLevel > 100 {
		errs = append(errs, domain.ValidationError{Field: "startBatteryLevel", Message: "must be 0-100"})
	}

	if s.EndBatteryLevel < 0 || s.EndBatteryLevel > 100 {
		errs = append(errs, domain.ValidationError{Field: "endBatteryLevel", Message: "must be 0-100"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}
