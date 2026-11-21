package smartreadiness

import "time"

type BackupGridState uint8

const (
	BackupGridUnknown BackupGridState = iota
	BackupGridConnected
	BackupGridIslanded
	BackupGridIntentional
)

type BackupSiteReading struct {
	SiteID        int64
	ObservedAt    time.Time
	Grid          BackupGridState
	BackupCapable bool
	GridPowerW    float64
	SolarPowerW   float64
	BatteryPowerW float64
	SiteLoadW     float64
}

type BackupChargingSample struct {
	ObservedAt            time.Time `json:"observed_at"`
	ExpiresAt             time.Time `json:"expires_at"`
	VehiclePowerW         float64   `json:"vehicle_power_w"`
	VehiclePowerAt        time.Time `json:"-"`
	MinimumBatteryToLoadW float64   `json:"minimum_battery_to_load_w"`
}

type BackupChargingWatch struct {
	ID              int64                 `json:"id"`
	Subject         string                `json:"-"`
	VehicleID       int64                 `json:"vehicle_id"`
	ConnectionID    int64                 `json:"-"`
	EnergySiteID    int64                 `json:"-"`
	PlaceID         int64                 `json:"place_id"`
	PlaceUpdatedAt  time.Time             `json:"place_updated_at"`
	DeviceID        int64                 `json:"device_id"`
	DeviceUpdatedAt time.Time             `json:"-"`
	ConsentedAt     time.Time             `json:"consented_at"`
	NextCheckAt     time.Time             `json:"-"`
	OutageStart     time.Time             `json:"outage_confirmed_at"`
	WatchUntil      time.Time             `json:"watch_until"`
	QualifiedFrom   *time.Time            `json:"-"`
	Sample          *BackupChargingSample `json:"-"`
}

type BackupChargingDecision struct {
	Watch  BackupChargingWatch  `json:"watch"`
	Sample BackupChargingSample `json:"evidence"`
}

type BackupChargingSettings struct {
	Available          bool                    `json:"available"`
	Connected          bool                    `json:"connected"`
	ConnectionRevision int64                   `json:"connection_revision,omitempty"`
	Active             bool                    `json:"active"`
	Watch              *BackupChargingWatch    `json:"watch"`
	Decision           *BackupChargingDecision `json:"decision"`
}
