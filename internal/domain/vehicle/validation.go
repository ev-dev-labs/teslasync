package vehicle

import (
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// Validate checks domain invariants for a Vehicle.
func (v *Vehicle) Validate() error {
	var errs domain.ValidationErrors

	if len(v.VIN) != 17 {
		errs = append(errs, domain.ValidationError{Field: "vin", Message: "must be exactly 17 characters"})
	} else if !isValidVINChecksum(v.VIN) {
		errs = append(errs, domain.ValidationError{Field: "vin", Message: "invalid VIN checksum"})
	}

	currentYear := time.Now().Year()
	if v.Year < 2012 || v.Year > currentYear+1 {
		errs = append(errs, domain.ValidationError{
			Field:   "year",
			Message: fmt.Sprintf("must be between 2012 and %d", currentYear+1),
		})
	}

	if v.DisplayName == "" {
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "required"})
	} else if len(v.DisplayName) > 100 {
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "must be at most 100 characters"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

// DetectModelFromVIN extracts the Tesla model from a VIN.
func DetectModelFromVIN(vin string) string {
	if len(vin) < 4 {
		return "unknown"
	}
	switch vin[3] {
	case 'S', 's':
		return "Model S"
	case '3':
		return "Model 3"
	case 'X', 'x':
		return "Model X"
	case 'Y', 'y':
		return "Model Y"
	case 'R', 'r':
		return "Roadster"
	case 'T', 't':
		return "Semi"
	case 'C', 'c':
		return "Cybertruck"
	default:
		return "unknown"
	}
}

// isValidVINChecksum is intentionally not full ISO 3779 validation; it
// only rejects characters forbidden in VINs (I, O, Q).
func isValidVINChecksum(vin string) bool {
	for _, c := range vin {
		if c == 'I' || c == 'O' || c == 'Q' || c == 'i' || c == 'o' || c == 'q' {
			return false
		}
		if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
			return false
		}
	}
	return true
}
