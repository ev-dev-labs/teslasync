package trip

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// Trip represents a driving trip aggregate.
type Trip struct {
	ID               string    `json:"id" db:"id"`
	VehicleID        string    `json:"vehicleId" db:"vehicle_id"`
	StartLatitude    float64   `json:"startLatitude" db:"start_latitude"`
	StartLongitude   float64   `json:"startLongitude" db:"start_longitude"`
	EndLatitude      float64   `json:"endLatitude" db:"end_latitude"`
	EndLongitude     float64   `json:"endLongitude" db:"end_longitude"`
	StartAddress     string    `json:"startAddress" db:"start_address"`
	EndAddress       string    `json:"endAddress" db:"end_address"`
	DistanceM        float64   `json:"distanceM" db:"distance_m"`
	EnergyUsedWh     float64   `json:"energyUsedWh" db:"energy_used_wh"`
	EfficiencyWhPerM float64   `json:"efficiencyWhPerM" db:"efficiency_wh_per_m"`
	MaxSpeedMps      float64   `json:"maxSpeedMps" db:"max_speed_mps"`
	FSMState         fsm.State `json:"fsmState" db:"fsm_state"`
	StartedAt        time.Time `json:"startedAt" db:"started_at"`
	CompletedAt      time.Time `json:"completedAt,omitempty" db:"completed_at"`
	CreatedAt        time.Time `json:"createdAt" db:"created_at"`
}
