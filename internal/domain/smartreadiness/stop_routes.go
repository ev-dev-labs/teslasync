package smartreadiness

import "time"

type RoutePoint struct {
	Latitude  float64
	Longitude float64
}

type RoutingStop struct {
	PlaceID  int64
	Location RoutePoint
}

type RoadLeg struct {
	DistanceM int64
	DurationS int64
}

type StopRoute struct {
	PlaceID   int64
	ToStop    RoadLeg
	AfterStop RoadLeg
}

type StopRoutes struct {
	Direct RoadLeg
	Via    []StopRoute
}

type StopTripEnergy struct {
	CapacityWh      float64
	StartChargeWh   float64
	ReserveWh       float64
	ChargeLimitWh   float64
	HighUsageWhPerM float64
	DepartureAt     time.Time
}

type StopHistoryEstimate struct {
	ExpectedWaitS          float64
	ConservativePackPowerW float64
	WaitSampleCount        int
	ChargeSampleCount      int
}

type ChargingStopComparison struct {
	PlaceID             int64     `json:"place_id"`
	PlaceName           string    `json:"place_name"`
	DetourM             int64     `json:"detour_m"`
	DetourS             int64     `json:"detour_s"`
	ArriveAt            time.Time `json:"arrive_at"`
	StationArrivalWh    float64   `json:"station_arrival_wh"`
	DestinationChargeWh float64   `json:"destination_charge_wh"`
	ExpectedWaitS       float64   `json:"expected_wait_s"`
	EstimatedChargeS    int64     `json:"estimated_charge_s"`
	WaitSampleCount     int       `json:"wait_sample_count"`
	ChargeSampleCount   int       `json:"charge_sample_count"`
}

type StopWaitObservation struct {
	ArrivedAt time.Time `json:"arrived_at"`
	WaitS     int64     `json:"wait_s"`
}

type StopSetup struct {
	PlaceID        int64                 `json:"place_id"`
	PlaceUpdatedAt time.Time             `json:"place_updated_at"`
	TimeZone       string                `json:"time_zone"`
	Waits          []StopWaitObservation `json:"waits"`
}

type StopComparisonInput struct {
	PlanVersion          int64       `json:"plan_version"`
	OriginUpdatedAt      time.Time   `json:"origin_updated_at"`
	DestinationPlaceID   int64       `json:"destination_place_id"`
	DestinationUpdatedAt time.Time   `json:"destination_updated_at"`
	CapacityWh           float64     `json:"capacity_wh"`
	StartPct             float64     `json:"start_pct"`
	LimitPct             float64     `json:"limit_pct"`
	HighUsageWhPerM      float64     `json:"high_usage_wh_per_m"`
	Stops                []StopSetup `json:"stops"`
}

type ReviewedStop struct {
	StopSetup
	Location RoutePoint
	Name     string
	RadiusM  float64
}

type StopComparisonScope struct {
	ID            int64
	Input         StopComparisonInput
	Origin        RoutePoint
	Destination   RoutePoint
	DepartureAt   time.Time
	ReservePct    float64
	ReviewedStops []ReviewedStop
	NextCheckAt   *time.Time
}

type StopComparisonResult struct {
	ComparedAt time.Time                `json:"compared_at"`
	ExpiresAt  time.Time                `json:"expires_at"`
	Stops      []ChargingStopComparison `json:"stops"`
}

type StopComparisonSettings struct {
	Available   bool                  `json:"available"`
	HasSetup    bool                  `json:"has_setup"`
	Setup       *StopComparisonInput  `json:"setup"`
	Result      *StopComparisonResult `json:"result"`
	NextCheckAt *time.Time            `json:"next_check_at"`
}

type StopPlanKey struct {
	Subject   string
	VehicleID int64
	PlanID    int64
}
