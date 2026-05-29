package vehicle

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

type Vehicle struct {
	ID            string    `json:"id" db:"id"`
	UserID        string    `json:"userId" db:"user_id"`
	VIN           string    `json:"vin" db:"vin"`
	DisplayName   string    `json:"displayName" db:"display_name"`
	Model         string    `json:"model" db:"model"`
	Year          int       `json:"year" db:"year"`
	Color         string    `json:"color" db:"color"`
	FSMState      fsm.State `json:"fsmState" db:"fsm_state"`
	SubFSMState   fsm.State `json:"subFsmState,omitempty" db:"sub_fsm_state"`
	OdometerMiles float64   `json:"odometerMiles" db:"odometer_miles"`
	BatteryLevel  int       `json:"batteryLevel" db:"battery_level"`
	RangeMiles    float64   `json:"rangeMiles" db:"range_miles"`
	IsCharging    bool      `json:"isCharging" db:"is_charging"`
	Latitude      float64   `json:"latitude" db:"latitude"`
	Longitude     float64   `json:"longitude" db:"longitude"`
	CreatedAt     time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt     time.Time `json:"updatedAt" db:"updated_at"`
}
