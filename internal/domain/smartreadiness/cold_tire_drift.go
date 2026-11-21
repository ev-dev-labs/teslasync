package smartreadiness

import "time"

type TireCorner string

const (
	TireFrontLeft  TireCorner = "front_left"
	TireFrontRight TireCorner = "front_right"
	TireRearLeft   TireCorner = "rear_left"
	TireRearRight  TireCorner = "rear_right"
)

type ColdTireReading struct {
	ObservedAt         time.Time `json:"observed_at"`
	AmbientC           float64   `json:"ambient_c"`
	FrontLeftPa        float64   `json:"front_left_pa"`
	FrontRightPa       float64   `json:"front_right_pa"`
	RearLeftPa         float64   `json:"rear_left_pa"`
	RearRightPa        float64   `json:"rear_right_pa"`
	ColdGaugeConfirmed bool      `json:"cold_gauge_confirmed"`
}

func (r ColdTireReading) PressuresPa() [4]float64 {
	return [4]float64{r.FrontLeftPa, r.FrontRightPa, r.RearLeftPa, r.RearRightPa}
}

type ColdTireDriftReason string

const (
	ColdTireDriftEligible             ColdTireDriftReason = "eligible"
	ColdTireDriftNoRecentReading      ColdTireDriftReason = "no_recent_reading"
	ColdTireDriftInsufficientEvidence ColdTireDriftReason = "insufficient_comparable_readings"
	ColdTireDriftInvalidReading       ColdTireDriftReason = "invalid_reading"
	ColdTireDriftNoRepeatedDrift      ColdTireDriftReason = "no_repeated_drift"
)

type ColdTireDrift struct {
	Corner              TireCorner `json:"corner"`
	Count               int        `json:"count"`
	BaselineAt          time.Time  `json:"baseline_at"`
	ObservedAt          time.Time  `json:"observed_at"`
	ExpiresAt           time.Time  `json:"expires_at"`
	RelativeDropPa      float64    `json:"relative_drop_pa"`
	LastGaugePressurePa float64    `json:"last_gauge_pressure_pa"`
}

type ColdTireReview struct {
	SeriesID     int64          `json:"series_id"`
	ReadingCount int            `json:"reading_count"`
	LastReading  *time.Time     `json:"last_reading_at,omitempty"`
	Drift        *ColdTireDrift `json:"drift"`
}
