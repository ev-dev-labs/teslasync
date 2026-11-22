package smartreadiness

import "time"

type SolarChargingPlan struct {
	ClaimCurrent   bool                `json:"-"`
	ID             int64               `json:"-"`
	Subject        string              `json:"-"`
	VehicleID      int64               `json:"vehicle_id"`
	EnergySiteID   int64               `json:"-"`
	PlaceID        int64               `json:"place_id"`
	PlaceUpdatedAt time.Time           `json:"place_updated_at"`
	ConsentedAt    time.Time           `json:"consented_at"`
	NextCheckAt    time.Time           `json:"-"`
	Reserve        *SolarBackupReserve `json:"-"`
}

type SolarSurplusObservation struct {
	SiteID        int64
	ObservedAt    time.Time
	GridConnected bool
	StormMode     bool
	GridPowerW    float64
	SolarPowerW   float64
	BatteryPowerW float64
	BatteryPct    float64
}

type SolarBackupReserve struct {
	SiteID     int64
	ObservedAt time.Time
	Percent    float64
}

type SolarSurplusDecision struct {
	SiteID         int64     `json:"-"`
	MinimumExportW float64   `json:"minimum_export_w"`
	BatteryPct     float64   `json:"battery_pct"`
	ChargeLimitPct float64   `json:"charge_limit_pct"`
	BackupPct      float64   `json:"backup_pct"`
	ReservePct     float64   `json:"reserve_pct"`
	SampleCount    int       `json:"sample_count"`
	SampleStart    time.Time `json:"sample_start"`
	ObservedAt     time.Time `json:"observed_at"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type SolarChargingScope struct {
	PlanID      int64
	VehicleID   int64
	VehicleName string
	ConsentedAt time.Time
}

type SolarChargingOpportunity struct {
	Scope    SolarChargingScope
	Decision SolarSurplusDecision
}
