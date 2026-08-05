package advancedintelligence

import "time"

type CalibrationEvidence struct {
	VehicleID              int64
	DriveSampleCount       int
	ChargeSampleCount      int
	DistanceM              *float64
	EnergyUsedWh           *float64
	EfficiencyWhPerM       *float64
	EfficiencyStddevWhPerM *float64
	UsableBatteryWh        *float64
	AmbientTempC           *float64
	FirstObservedAt        *time.Time
	LastObservedAt         *time.Time
}

type TwinScenarioInput struct {
	Name           string   `json:"name"`
	HorizonS       int64    `json:"horizon_s"`
	DistanceM      float64  `json:"distance_m"`
	SpeedMps       float64  `json:"speed_mps"`
	OutsideTempC   *float64 `json:"outside_temp_c"`
	AuxiliaryLoadW float64  `json:"auxiliary_load_w"`
}

type TwinLabRequest struct {
	VehicleID int64               `json:"vehicle_id"`
	Confirmed bool                `json:"confirmed"`
	Scenarios []TwinScenarioInput `json:"scenarios"`
}

type TwinBaseline struct {
	EfficiencyWhPerM       *float64 `json:"efficiency_wh_per_m"`
	UsableBatteryWh        *float64 `json:"usable_battery_wh"`
	AmbientTempC           *float64 `json:"ambient_temp_c"`
	CalibrationSampleCount int      `json:"calibration_sample_count"`
}

type TwinScenarioOutput struct {
	Name               string              `json:"name"`
	HorizonS           int64               `json:"horizon_s"`
	BatteryDeltaWh     *float64            `json:"battery_delta_wh"`
	BatteryLowWh       *float64            `json:"battery_low_wh"`
	BatteryHighWh      *float64            `json:"battery_high_wh"`
	RangeDeltaM        *float64            `json:"range_delta_m"`
	RangeLowM          *float64            `json:"range_low_m"`
	RangeHighM         *float64            `json:"range_high_m"`
	ThermalDeltaC      *float64            `json:"thermal_delta_c"`
	ThermalLowC        *float64            `json:"thermal_low_c"`
	ThermalHighC       *float64            `json:"thermal_high_c"`
	WearDeltaPct       *float64            `json:"wear_delta_pct"`
	WearLowPct         *float64            `json:"wear_low_pct"`
	WearHighPct        *float64            `json:"wear_high_pct"`
	SensitivityDrivers []SensitivityDriver `json:"sensitivity_drivers"`
}

type SensitivityDriver struct {
	Driver    string  `json:"driver"`
	EffectPct float64 `json:"effect_pct"`
}

type TwinLabResponse struct {
	VehicleID   int64                `json:"vehicle_id"`
	ModelName   string               `json:"model_name"`
	Baseline    TwinBaseline         `json:"baseline"`
	Scenarios   []TwinScenarioOutput `json:"scenarios"`
	DataQuality DataQuality          `json:"data_quality"`
	Evidence    []Evidence           `json:"evidence"`
	Limitations []string             `json:"limitations"`
	GeneratedAt time.Time            `json:"generated_at"`
}

type FirmwareWindowEvidence struct {
	VehicleID                int64
	Version                  *string
	InstalledAt              *time.Time
	PreStart                 *time.Time
	PreEnd                   *time.Time
	PostStart                *time.Time
	PostEnd                  *time.Time
	PreDriveSampleCount      int
	PostDriveSampleCount     int
	PeerPreSampleCount       int
	PeerPostSampleCount      int
	PreEfficiencyWhPerM      *float64
	PostEfficiencyWhPerM     *float64
	PeerPreEfficiencyWhPerM  *float64
	PeerPostEfficiencyWhPerM *float64
}

type CanaryDecision string

const (
	CanaryRollout      CanaryDecision = "rollout"
	CanaryHold         CanaryDecision = "hold"
	CanaryInvestigate  CanaryDecision = "investigate"
	CanaryInsufficient CanaryDecision = "insufficient"
)

type FirmwareCanary struct {
	VehicleID            int64          `json:"vehicle_id"`
	Version              *string        `json:"version"`
	Decision             CanaryDecision `json:"decision"`
	VehicleRegressionPct *float64       `json:"vehicle_regression_pct"`
	PeerRegressionPct    *float64       `json:"peer_regression_pct"`
	MatchedExcessPct     *float64       `json:"matched_excess_pct"`
	WindowQuality        DataQuality    `json:"window_quality"`
	Evidence             []Evidence     `json:"evidence"`
	Limitations          []string       `json:"limitations"`
	GeneratedAt          time.Time      `json:"generated_at"`
}
