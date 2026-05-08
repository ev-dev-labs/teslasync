package charging

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// ChargingSession represents a charging session aggregate.
type ChargingSession struct {
	ID                string    `json:"id" db:"id"`
	VehicleID         string    `json:"vehicleId" db:"vehicle_id"`
	ChargerType       string    `json:"chargerType" db:"charger_type"` // "ac", "dc", "supercharger"
	StartBatteryLevel int       `json:"startBatteryLevel" db:"start_battery_pct"`
	EndBatteryLevel   int       `json:"endBatteryLevel" db:"end_battery_pct"`
	EnergyAddedWh     float64   `json:"energyAddedWh" db:"energy_added_wh"`
	MaxPowerW         float64   `json:"maxPowerW" db:"max_power_w"`
	CostCents         int       `json:"costCents" db:"cost_cents"`
	FSMState          fsm.State `json:"fsmState" db:"fsm_state"`
	SubFSMState       fsm.State `json:"subFsmState,omitempty" db:"sub_fsm_state"`
	ChargerConnected  bool      `json:"chargerConnected" db:"charger_connected"`
	StartedAt         time.Time `json:"startedAt" db:"started_at"`
	CompletedAt       time.Time `json:"completedAt,omitempty" db:"completed_at"`
	CreatedAt         time.Time `json:"createdAt" db:"created_at"`
}
