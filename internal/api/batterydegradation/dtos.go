package batterydegradation

import (
	"encoding/json"
	"math"
	"time"
)

type batterySnapshotData struct {
	ID             int64     `json:"id"`
	HealthScore    float64   `json:"health_score"`
	CapacityWh     float64   `json:"capacity_wh"`
	DegradationPct float64   `json:"degradation_pct"`
	EstRangeKm     float64   `json:"est_range_km"`
	CycleCount     int       `json:"cycle_count"`
	AvgCellTempC   float64   `json:"avg_cell_temp_c"`
	CreatedAt      time.Time `json:"created_at"`
}

type degradationPrediction struct {
	Interval *predictionInterval `json:"interval"`
	// Slopes are signed SOH percentage points/year; positive means improving health.
	FitValid         bool    `json:"fit_valid"`
	CrossingStatus   string  `json:"crossing_status"`
	SlopePerYear     float64 `json:"slope_per_year"`
	YearsTo80Pct     float64 `json:"years_to_80_pct"`
	PredictedDate    string  `json:"predicted_date"`
	HasEnoughData    bool    `json:"has_enough_data"`
	ProjectionPoints []struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	} `json:"projection_points"`
}

// Bounds describe a future observation, not confidence in the fitted mean.
// Empirical coverage has not been measured in BD-C01.
type predictionInterval struct {
	Method            string  `json:"method"`
	SampleCount       int     `json:"sample_count"`
	ResidualDF        int     `json:"residual_df"`
	Multiplier        float64 `json:"multiplier"`
	EmpiricalCoverage string  `json:"empirical_coverage"`
}

func (p degradationPrediction) MarshalJSON() ([]byte, error) {
	type predictionAlias degradationPrediction
	var slope, years *float64
	var date *string
	if p.FitValid && p.HasEnoughData && isFinite(p.SlopePerYear) {
		slope = &p.SlopePerYear
	}
	if slope != nil && p.CrossingStatus == "future_crossing" &&
		isFinite(p.YearsTo80Pct) && p.YearsTo80Pct > 0 {
		years = &p.YearsTo80Pct
		date = &p.PredictedDate
	}
	status := p.CrossingStatus
	if status == "" {
		status = "insufficient_fit"
	}
	return json.Marshal(struct {
		predictionAlias
		Slope  *float64 `json:"slope_per_year"`
		Years  *float64 `json:"years_to_80_pct"`
		Date   *string  `json:"predicted_date"`
		Status string   `json:"crossing_status"`
	}{predictionAlias(p), slope, years, date, status})
}

type predictiveProjection struct {
	// Date is a YYYY-MM calendar month key, not an observation timestamp.
	Date           string  `json:"date"`
	HealthPct      float64 `json:"health_pct"`
	ConfidenceLow  float64 `json:"confidence_low"`
	ConfidenceHigh float64 `json:"confidence_high"`
}

func (p predictiveProjection) MarshalJSON() ([]byte, error) {
	low := numericEvidence(p.ConfidenceLow, true, 0, 100)
	high := numericEvidence(p.ConfidenceHigh, true, 0, 100)
	if low == nil || high == nil || *low > *high {
		low, high = nil, nil
	}
	return json.Marshal(struct {
		Date           string   `json:"date"`
		HealthPct      *float64 `json:"health_pct"`
		ConfidenceLow  *float64 `json:"confidence_low"`
		ConfidenceHigh *float64 `json:"confidence_high"`
	}{
		p.Date, numericEvidence(p.HealthPct, true, 0, 100), low, high,
	})
}

type riskFactor struct {
	Name      string `json:"name"`
	Score     int    `json:"score"`
	Available *bool  `json:"available,omitempty"`
	Label     string `json:"label"`
	Detail    string `json:"detail"`
}

func (r riskFactor) MarshalJSON() ([]byte, error) {
	type riskAlias riskFactor
	var score *int
	if (r.Available == nil || *r.Available) && r.Score >= 0 && r.Score <= 100 {
		score = &r.Score
	}
	return json.Marshal(struct {
		riskAlias
		Score *int `json:"score"`
	}{riskAlias: riskAlias(r), Score: score})
}

type regressionResult struct {
	Prediction   degradationPrediction
	Projections  []predictiveProjection
	Horizon      horizonOutlook
	RatePerMonth float64
}

// horizonPoint is the projected pack health at a fixed year horizon with
// the regression prediction interval.
type horizonPoint struct {
	Years          int     `json:"years"`
	HealthPct      float64 `json:"health_pct"`
	ConfidenceLow  float64 `json:"confidence_low"`
	ConfidenceHigh float64 `json:"confidence_high"`
}

// horizonOutlook pins the 1/3/5-year twin readout. DataMonths reports how
// many months of history back the fit so consumers can discount young fits.
type horizonOutlook struct {
	Points        []horizonPoint `json:"points"`
	DataMonths    int            `json:"data_months"`
	SlopePerYear  float64        `json:"slope_per_year"`
	HasEnoughData bool           `json:"has_enough_data"`
}

type chargingHabits struct {
	FastChargeCount       int     `json:"fast_charge_count"`
	SlowChargeCount       int     `json:"slow_charge_count"`
	DeepDischargeCount    int     `json:"deep_discharge_count"`
	ChargeToFullCount     int     `json:"charge_to_full_count"`
	HighSocCount          int     `json:"high_soc_count"`
	AvgEnergyPerSessionWh float64 `json:"avg_energy_per_session_wh"`
	TotalCount            int     `json:"total_count"`
}

type batteryHealthHistoryPoint struct {
	// Date is the UTC aggregate's YYYY-MM-DD calendar day, not a local instant.
	Date              string     `json:"date"`
	OdometerM         *float64   `json:"odometer_m"`
	OdometerSampledAt *time.Time `json:"odometer_sampled_at"`
	SohPct            float64    `json:"soh_pct"`
	CapacityWh        float64    `json:"capacity_wh"`
	RangeM            *float64   `json:"range_m"`
	RangeSampledAt    *time.Time `json:"range_sampled_at"`
}

func (p batteryHealthHistoryPoint) MarshalJSON() ([]byte, error) {
	type historyAlias batteryHealthHistoryPoint
	return json.Marshal(struct {
		historyAlias
		SohPct     *float64 `json:"soh_pct"`
		CapacityWh *float64 `json:"capacity_wh"`
		OdometerM  *float64 `json:"odometer_m"`
		RangeM     *float64 `json:"range_m"`
	}{
		historyAlias: historyAlias(p),
		SohPct:       numericEvidence(p.SohPct, true, 0, 100),
		CapacityWh:   numericEvidence(p.CapacityWh, true, 0, math.MaxFloat64),
		OdometerM:    distanceEvidence(p.OdometerM),
		RangeM:       distanceEvidence(p.RangeM),
	})
}

type chargeLevelBucket struct {
	MinSocPct  int `json:"min_soc_pct"`
	MaxSocPct  int `json:"max_soc_pct"`
	StartCount int `json:"start_count"`
	EndCount   int `json:"end_count"`
}

type batteryChargingAnalysis struct {
	ChargeLevelDistribution []chargeLevelBucket `json:"charge_level_distribution"`
	AvgStartSocPct          *float64            `json:"avg_start_soc_pct"`
	AvgEndSocPct            *float64            `json:"avg_end_soc_pct"`
	ACSessionCount          int                 `json:"ac_session_count"`
	DCSessionCount          int                 `json:"dc_session_count"`
	SuperchargerCount       int                 `json:"supercharger_count"`
	DCFastCount             int                 `json:"dc_fast_count"`
	DeepDischargeCount      int                 `json:"deep_discharge_count"`
	ACEnergyWh              float64             `json:"ac_energy_wh"`
	DCEnergyWh              float64             `json:"dc_energy_wh"`
	TotalSessions           int                 `json:"total_sessions"`
}

type batteryHealthResponse struct {
	VehicleID                  int64   `json:"vehicle_id"`
	CurrentSoh                 float64 `json:"current_soh"`
	CurrentSohAvailable        bool    `json:"current_soh_available"`
	EstimatedCapacityWh        float64 `json:"estimated_capacity_wh"`
	EstimatedCapacityAvailable bool    `json:"estimated_capacity_wh_available"`
	// Nominal VIN/model/default assumption, not a measured new-pack capacity.
	OriginalCapacityWh        float64 `json:"original_capacity_wh"`
	DegradationRatePctPerYear float64 `json:"degradation_rate_pct_per_year"`
	DegradationRateAvailable  bool    `json:"degradation_rate_available"`
	BatteryAgeMonths          int     `json:"battery_age_months"`
	// Recorded observation duration is not the age of the physical pack.
	ObservationDurationMonths *int       `json:"observation_duration_months"`
	ObservationStartedAt      *time.Time `json:"observation_started_at"`
	ObservationSource         string     `json:"observation_source"`
	TotalCycles               int        `json:"total_cycles"`
	totalCyclesExact          *float64
	TotalCyclesAvailable      bool `json:"total_cycles_available"`
	ValidEnergyCount          int  `json:"valid_energy_count"`
	ValidChargeCount          int  `json:"valid_charge_count"`
	ValidStartSocCount        int  `json:"valid_start_soc_count"`
	ValidEndSocCount          int  `json:"valid_end_soc_count"`
	ValidDoDCount             int  `json:"valid_dod_count"`
	// Arithmetic mean SOC drop in valid drives, not depth per full pack cycle.
	AvgDepthOfDischargePct float64                     `json:"avg_depth_of_discharge_pct"`
	FastChargePct          float64                     `json:"fast_charge_pct"`
	FullChargePct          float64                     `json:"full_charge_pct"`
	ChargeHabitsScore      float64                     `json:"charge_habits_score"`
	ChargeHabitsAvailable  bool                        `json:"charge_habits_available"`
	StressLevel            string                      `json:"stress_level"`
	TempExposureScore      *int                        `json:"temp_exposure_score"`
	TempExposureReason     *string                     `json:"temp_exposure_reason"`
	TempExposureAvailable  bool                        `json:"temp_exposure_available"`
	TempSampleCount        int                         `json:"temp_sample_count"`
	History                []batteryHealthHistoryPoint `json:"history"`
	Prediction             degradationPrediction       `json:"prediction"`
	Projections            []predictiveProjection      `json:"projections"`
	ChargingHabits         chargingHabits              `json:"charging_habits"`
	RiskFactors            []riskFactor                `json:"risk_factors"`
	Recommendations        []string                    `json:"recommendations"`
	ChargingAnalysis       batteryChargingAnalysis     `json:"charging_analysis"`
	// Provenance of OriginalCapacityWh, not the observed current-capacity estimator.
	CapacitySource string `json:"capacity_source"`
}

// The Health wire contract is nullable and fractional; the signed certificate
// keeps its existing in-process fields and versioned integer-cycle contract.
func (r batteryHealthResponse) MarshalJSON() ([]byte, error) {
	type healthAlias batteryHealthResponse
	cycleValue := float64(r.TotalCycles)
	if r.totalCyclesExact != nil {
		cycleValue = *r.totalCyclesExact
	}
	var cycles, driveDrop *float64
	if r.TotalCyclesAvailable && isFinite(cycleValue) && cycleValue >= 0 {
		cycles = &cycleValue
	}
	if r.ValidDoDCount > 0 && isFinite(r.AvgDepthOfDischargePct) &&
		r.AvgDepthOfDischargePct >= 0 && r.AvgDepthOfDischargePct <= 100 {
		driveDrop = &r.AvgDepthOfDischargePct
	}
	var score *float64
	var stress *string
	var rate *float64
	if r.DegradationRateAvailable && isFinite(r.DegradationRatePctPerYear) {
		rate = &r.DegradationRatePctPerYear
	}
	if r.ChargeHabitsAvailable && numericEvidence(r.ChargeHabitsScore, true, 0, 100) != nil {
		score = &r.ChargeHabitsScore
		if r.StressLevel == "Low" || r.StressLevel == "Medium" || r.StressLevel == "High" {
			stress = &r.StressLevel
		}
	}
	return json.Marshal(struct {
		healthAlias
		TotalCycles       *float64 `json:"total_cycles"`
		AverageDriveDrop  *float64 `json:"avg_depth_of_discharge_pct"`
		ChargeHabitsScore *float64 `json:"charge_habits_score"`
		StressLevel       *string  `json:"stress_level"`
		DegradationRate   *float64 `json:"degradation_rate_pct_per_year"`
		BatteryAgeMonths  *int     `json:"battery_age_months"`
		CurrentSoh        *float64 `json:"current_soh"`
		CapacityWh        *float64 `json:"estimated_capacity_wh"`
		OriginalCapacity  *float64 `json:"original_capacity_wh"`
		FastChargePct     *float64 `json:"fast_charge_pct"`
		FullChargePct     *float64 `json:"full_charge_pct"`
	}{
		healthAlias:       healthAlias(r),
		TotalCycles:       cycles,
		AverageDriveDrop:  driveDrop,
		ChargeHabitsScore: score,
		StressLevel:       stress,
		DegradationRate:   rate,
		CurrentSoh:        numericEvidence(r.CurrentSoh, r.CurrentSohAvailable, 0, 100),
		CapacityWh:        numericEvidence(r.EstimatedCapacityWh, r.EstimatedCapacityAvailable, 0, math.MaxFloat64),
		OriginalCapacity:  numericEvidence(r.OriginalCapacityWh, r.OriginalCapacityWh > 0, 0, math.MaxFloat64),
		FastChargePct:     numericEvidence(r.FastChargePct, r.ValidChargeCount > 0, 0, 100),
		FullChargePct:     numericEvidence(r.FullChargePct, r.ValidEndSocCount > 0, 0, 100),
	})
}

// monthlyTrend holds monthly aggregation of battery health data.
type monthlyTrend struct {
	Month          string  `json:"month"`
	AvgHealth      float64 `json:"avg_health"`
	AvgCapacity    float64 `json:"avg_capacity"`
	AvgDegradation float64 `json:"avg_degradation"`
	AvgRange       float64 `json:"avg_range"`
	MaxCycles      int     `json:"max_cycles"`
	AvgCellTemp    float64 `json:"avg_cell_temp"`
}
