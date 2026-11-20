package smartreadiness

import "time"

type SitePerformanceSession struct {
	ID          int64
	StartedAt   time.Time
	EndedAt     time.Time
	StartSocPct float64
	EndSocPct   float64
	Charger     string
	Cable       string
	DeliveredWh float64
}

type SitePerformanceScope struct {
	PlaceID        int64     `json:"charging_place_id"`
	PlaceName      string    `json:"place_name"`
	VehicleID      int64     `json:"vehicle_id"`
	VehicleName    string    `json:"-"`
	PlaceUpdatedAt time.Time `json:"-"`
	EnabledAt      time.Time `json:"-"`
}

type SitePerformanceReview struct {
	PlaceID        int64     `json:"charging_place_id"`
	PlaceName      string    `json:"place_name"`
	VehicleID      int64     `json:"vehicle_id"`
	LatestID       int64     `json:"latest_session_id"`
	BaselineFromAt time.Time `json:"baseline_from_at"`
	ObservedAt     time.Time `json:"observed_at"`
	ExpiresAt      time.Time `json:"expires_at"`
	RecentCount    int       `json:"recent_count"`
	BaselineCount  int       `json:"baseline_count"`
	RecentW        float64   `json:"recent_w"`
	BaselineW      float64   `json:"baseline_w"`
	VehicleName    string    `json:"-"`
}

type SitePerformanceSettings struct {
	Scope  *SitePerformanceScope  `json:"scope"`
	Review *SitePerformanceReview `json:"review"`
}
