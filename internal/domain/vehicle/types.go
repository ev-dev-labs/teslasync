package vehicle

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

type Vehicle struct {
	ID          string     `json:"id" db:"id"`
	TeslaID     int64      `json:"tesla_id" db:"tesla_id"`
	VIN         string     `json:"vin" db:"vin"`
	DisplayName string     `json:"display_name" db:"display_name"`
	Model       *string    `json:"model" db:"model"`
	OptionCodes *string    `json:"option_codes" db:"option_codes"`
	Color       *string    `json:"color" db:"color"`
	TrimLevel   *string    `json:"trim_level" db:"trim_level"`
	EnrolledAt  time.Time  `json:"enrolled_at" db:"enrolled_at"`
	ArchivedAt  *time.Time `json:"archived_at" db:"archived_at"`
	CreatedAt   time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at" db:"updated_at"`
	Timezone    string     `json:"timezone" db:"timezone"`

	// Lifecycle working data is not vehicle metadata. It must never be
	// projected from vehicles or exposed as fabricated current measurements.
	Year          int       `json:"-" db:"-"`
	FSMState      fsm.State `json:"-" db:"-"`
	SubFSMState   fsm.State `json:"-" db:"-"`
	OdometerMiles float64   `json:"-" db:"-"`
	BatteryLevel  int       `json:"-" db:"-"`
	RangeMiles    float64   `json:"-" db:"-"`
	IsCharging    bool      `json:"-" db:"-"`
	Latitude      float64   `json:"-" db:"-"`
	Longitude     float64   `json:"-" db:"-"`
}
