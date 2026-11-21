package smartreadiness

import "time"

type TripMaintenanceSetup struct {
	PlanVersion        int64     `json:"plan_version"`
	ServiceLabel       string    `json:"service_label"`
	ServiceCompletedAt time.Time `json:"service_completed_at"`
	ServiceOdometerM   float64   `json:"service_odometer_m"`
	IntervalM          float64   `json:"interval_m"`
	TripDistanceLowM   float64   `json:"trip_distance_low_m"`
	TripDistanceHighM  float64   `json:"trip_distance_high_m"`
}

type TripOdometerObservation struct {
	VehicleID  int64
	OdometerM  float64
	ObservedAt time.Time
}

type TripMaintenanceProjection struct {
	PlanID               int64     `json:"plan_id"`
	VehicleID            int64     `json:"vehicle_id"`
	DepartureAt          time.Time `json:"departure_at"`
	ServiceLabel         string    `json:"service_label"`
	ServiceCompletedAt   time.Time `json:"service_completed_at"`
	ServiceOdometerM     float64   `json:"service_odometer_m"`
	IntervalM            float64   `json:"interval_m"`
	DueOdometerM         float64   `json:"due_odometer_m"`
	RecordedOdometerM    float64   `json:"recorded_odometer_m"`
	RecordedAt           time.Time `json:"recorded_at"`
	TripDistanceLowM     float64   `json:"trip_distance_low_m"`
	TripDistanceHighM    float64   `json:"trip_distance_high_m"`
	ArrivalOdometerLowM  float64   `json:"arrival_odometer_low_m"`
	ArrivalOdometerHighM float64   `json:"arrival_odometer_high_m"`
	ExpiresAt            time.Time `json:"expires_at"`
}

type TripMaintenanceSettings struct {
	Setup       *TripMaintenanceSetup      `json:"setup"`
	Projection  *TripMaintenanceProjection `json:"projection"`
	NeedsReview bool                       `json:"needs_review"`
}

type TripMaintenanceReason string

const (
	TripMaintenanceEligible        TripMaintenanceReason = "eligible"
	TripMaintenancePlanUnavailable TripMaintenanceReason = "plan_unavailable"
	TripMaintenanceSetupInvalid    TripMaintenanceReason = "setup_invalid"
	TripMaintenanceOutsideWindow   TripMaintenanceReason = "outside_window"
	TripMaintenanceUnknownOdometer TripMaintenanceReason = "unknown_odometer"
	TripMaintenanceAlreadyDue      TripMaintenanceReason = "already_due"
	TripMaintenanceBelowInterval   TripMaintenanceReason = "below_interval"
)
