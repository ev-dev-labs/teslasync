package trip

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// Trip represents a driving trip aggregate.
type Trip struct {
	ID                 string    `json:"id" db:"id"`
	VehicleID          string    `json:"vehicleId" db:"vehicle_id"`
	StartLatitude      float64   `json:"startLatitude" db:"start_latitude"`
	StartLongitude     float64   `json:"startLongitude" db:"start_longitude"`
	EndLatitude        float64   `json:"endLatitude" db:"end_latitude"`
	EndLongitude       float64   `json:"endLongitude" db:"end_longitude"`
	StartAddress       string    `json:"startAddress" db:"start_address"`
	EndAddress         string    `json:"endAddress" db:"end_address"`
	DistanceMiles      float64   `json:"distanceMiles" db:"distance_miles"`
	EnergyUsedKWh     float64   `json:"energyUsedKwh" db:"energy_used_kwh"`
	EfficiencyWhPerMile float64 `json:"efficiencyWhPerMile" db:"efficiency_wh_per_mile"`
	MaxSpeedMph        float64   `json:"maxSpeedMph" db:"max_speed_mph"`
	FSMState           fsm.State `json:"fsmState" db:"fsm_state"`
	StartedAt          time.Time `json:"startedAt" db:"started_at"`
	CompletedAt        time.Time `json:"completedAt,omitempty" db:"completed_at"`
	CreatedAt          time.Time `json:"createdAt" db:"created_at"`
}
