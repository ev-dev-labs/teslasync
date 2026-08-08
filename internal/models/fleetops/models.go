package fleetops

import "time"

type FleetDriver struct {
	ID            int64     `db:"id"             json:"id"`
	DisplayName   string    `db:"display_name"   json:"display_name"`
	ReferenceCode string    `db:"reference_code" json:"reference_code"`
	Status        string    `db:"status"          json:"status"`
	Version       int       `db:"version"         json:"version"`
	CreatedAt     time.Time `db:"created_at"      json:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"      json:"updated_at"`
}

type FleetCostCenter struct {
	ID        int64     `db:"id"         json:"id"`
	Code      string    `db:"code"       json:"code"`
	Name      string    `db:"name"       json:"name"`
	Active    bool      `db:"active"     json:"active"`
	Version   int       `db:"version"    json:"version"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}

type FleetVehicleDriverAssignment struct {
	ID                 int64      `db:"id"                   json:"id"`
	VehicleID          int64      `db:"vehicle_id"           json:"vehicle_id"`
	VehicleDisplayName string     `db:"vehicle_display_name" json:"vehicle_display_name"`
	DriverID           int64      `db:"driver_id"            json:"driver_id"`
	DriverDisplayName  string     `db:"driver_display_name"  json:"driver_display_name"`
	StartsAt           time.Time  `db:"starts_at"            json:"starts_at"`
	EndsAt             *time.Time `db:"ends_at"              json:"ends_at"`
	Notes              *string    `db:"notes"                json:"notes"`
	Version            int        `db:"version"              json:"version"`
	CreatedAt          time.Time  `db:"created_at"           json:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"           json:"updated_at"`
}

type FleetReservation struct {
	ID                 int64     `db:"id"                   json:"id"`
	VehicleID          int64     `db:"vehicle_id"           json:"vehicle_id"`
	VehicleDisplayName string    `db:"vehicle_display_name" json:"vehicle_display_name"`
	DriverID           *int64    `db:"driver_id"            json:"driver_id"`
	DriverDisplayName  *string   `db:"driver_display_name"  json:"driver_display_name"`
	CostCenterID       *int64    `db:"cost_center_id"       json:"cost_center_id"`
	CostCenterName     *string   `db:"cost_center_name"     json:"cost_center_name"`
	Title              string    `db:"title"                json:"title"`
	Purpose            *string   `db:"purpose"              json:"purpose"`
	StartsAt           time.Time `db:"starts_at"            json:"starts_at"`
	EndsAt             time.Time `db:"ends_at"              json:"ends_at"`
	Status             string    `db:"status"               json:"status"`
	Version            int       `db:"version"              json:"version"`
	CreatedAt          time.Time `db:"created_at"           json:"created_at"`
	UpdatedAt          time.Time `db:"updated_at"           json:"updated_at"`
}

type FleetChargingPolicyWindow struct {
	ID               int64     `db:"id"                 json:"id"`
	ChargingPolicyID int64     `db:"charging_policy_id" json:"charging_policy_id"`
	DayOfWeek        int16     `db:"day_of_week"        json:"day_of_week"`
	StartLocalTime   string    `db:"start_local_time"   json:"start_local_time"`
	EndLocalTime     string    `db:"end_local_time"     json:"end_local_time"`
	CreatedAt        time.Time `db:"created_at"         json:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"         json:"updated_at"`
}

type FleetChargingPolicy struct {
	ID                 int64                       `db:"id"                   json:"id"`
	VehicleID          int64                       `db:"vehicle_id"           json:"vehicle_id"`
	VehicleDisplayName string                      `db:"vehicle_display_name" json:"vehicle_display_name"`
	Name               string                      `db:"name"                 json:"name"`
	TargetSOCPct       int16                       `db:"target_soc_pct"       json:"target_soc_pct"`
	MaxPowerW          *float64                    `db:"max_power_w"          json:"max_power_w"`
	Priority           int16                       `db:"priority"             json:"priority"`
	EffectiveFrom      time.Time                   `db:"effective_from"       json:"effective_from"`
	EffectiveTo        *time.Time                  `db:"effective_to"         json:"effective_to"`
	Enabled            bool                        `db:"enabled"              json:"enabled"`
	Version            int                         `db:"version"              json:"version"`
	CreatedAt          time.Time                   `db:"created_at"           json:"created_at"`
	UpdatedAt          time.Time                   `db:"updated_at"           json:"updated_at"`
	Windows            []FleetChargingPolicyWindow `db:"-"                    json:"windows"`
}

type FleetMaintenanceWorkOrder struct {
	ID                 int64      `db:"id"                   json:"id"`
	VehicleID          int64      `db:"vehicle_id"           json:"vehicle_id"`
	VehicleDisplayName string     `db:"vehicle_display_name" json:"vehicle_display_name"`
	CostCenterID       *int64     `db:"cost_center_id"       json:"cost_center_id"`
	CostCenterName     *string    `db:"cost_center_name"     json:"cost_center_name"`
	Title              string     `db:"title"                json:"title"`
	Description        *string    `db:"description"          json:"description"`
	Status             string     `db:"status"               json:"status"`
	Severity           string     `db:"severity"             json:"severity"`
	DueOdometerM       *float64   `db:"due_odometer_m"       json:"due_odometer_m"`
	DueAt              *time.Time `db:"due_at"               json:"due_at"`
	ScheduledStartAt   *time.Time `db:"scheduled_start_at"   json:"scheduled_start_at"`
	ScheduledEndAt     *time.Time `db:"scheduled_end_at"     json:"scheduled_end_at"`
	CostMinor          *int64     `db:"cost_minor"           json:"cost_minor"`
	Currency           *string    `db:"currency"             json:"currency"`
	Version            int        `db:"version"              json:"version"`
	CreatedAt          time.Time  `db:"created_at"           json:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"           json:"updated_at"`
}

type FleetPage[T any] struct {
	Items  []T `json:"items"`
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

type FleetForecastDrive struct {
	VehicleID int64     `db:"vehicle_id" json:"vehicle_id"`
	StartedAt time.Time `db:"started_at" json:"started_at"`
	EndedAt   time.Time `db:"ended_at"   json:"ended_at"`
	DurationS int64     `db:"duration_s"  json:"duration_s"`
}

type FleetForecastVehicle struct {
	VehicleID          int64  `db:"vehicle_id"           json:"vehicle_id"`
	VehicleDisplayName string `db:"vehicle_display_name" json:"vehicle_display_name"`
}

type FleetForecastPoint struct {
	VehicleID              int64     `json:"vehicle_id"`
	VehicleDisplayName     string    `json:"vehicle_display_name"`
	ForecastDate           time.Time `json:"forecast_date"`
	AvailableS             int64     `json:"available_s"`
	ReservedS              int64     `json:"reserved_s"`
	MaintenanceDowntimeS   int64     `json:"maintenance_downtime_s"`
	HistoricalExpectedS    int64     `json:"historical_expected_s"`
	ExpectedUtilizationPct float64   `json:"expected_utilization_pct"`
	LowerUtilizationPct    float64   `json:"lower_utilization_pct"`
	UpperUtilizationPct    float64   `json:"upper_utilization_pct"`
}

type FleetUtilizationForecast struct {
	From              time.Time            `json:"from"`
	To                time.Time            `json:"to"`
	GeneratedAt       time.Time            `json:"generated_at"`
	Quality           string               `json:"quality"`
	HistoryDriveCount int                  `json:"history_drive_count"`
	HistoryDayCount   int                  `json:"history_day_count"`
	Limitations       []string             `json:"limitations"`
	Points            []FleetForecastPoint `json:"points"`
}
