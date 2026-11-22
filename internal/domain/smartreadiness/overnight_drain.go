package smartreadiness

import "time"

type OvernightFactor string

const (
	OvernightSentry        OvernightFactor = "sentry"
	OvernightClimate       OvernightFactor = "climate"
	OvernightWakeRequested OvernightFactor = "wake_requested"
)

type OvernightFactorObservation struct {
	Kind       OvernightFactor `json:"kind"`
	ObservedAt time.Time       `json:"observed_at"`
}

type OvernightDrainObservation struct {
	StartAt         time.Time
	EndAt           time.Time
	StartBatteryPct float64
	EndBatteryPct   float64
	StartOutsideC   float64
	EndOutsideC     float64
	Factors         []OvernightFactorObservation
}

type OvernightDrainReview struct {
	MorningAt           time.Time                    `json:"morning_at"`
	ExpiresAt           time.Time                    `json:"expires_at"`
	StartAt             time.Time                    `json:"start_at"`
	EndAt               time.Time                    `json:"end_at"`
	MeasuredLossPct     float64                      `json:"measured_loss_pct"`
	TypicalLossLowPct   float64                      `json:"typical_loss_low_pct"`
	TypicalLossHighPct  float64                      `json:"typical_loss_high_pct"`
	ComparableNights    int                          `json:"comparable_nights"`
	Factors             []OvernightFactorObservation `json:"factors"`
	BaselineStarts      []time.Time                  `json:"-"`
	BaselineEnds        []time.Time                  `json:"-"`
	EvidenceFingerprint []byte                       `json:"-"`
}

type OvernightDrainPlan struct {
	ID       int64                 `json:"id"`
	TimeZone string                `json:"time_zone"`
	Paused   bool                  `json:"paused"`
	Review   *OvernightDrainReview `json:"review,omitempty"`
}

type OvernightDrainSettings struct {
	Plan *OvernightDrainPlan `json:"plan"`
}

type OvernightDrainReason string

const (
	OvernightMissingEvidence    OvernightDrainReason = "missing_measured_night"
	OvernightInsufficientNights OvernightDrainReason = "insufficient_comparable_nights"
	OvernightWithinUsualRange   OvernightDrainReason = "within_usual_range"
	OvernightNoObservedFactors  OvernightDrainReason = "no_observed_factors"
	OvernightAboveUsualRange    OvernightDrainReason = "above_usual_range"
)
