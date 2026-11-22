package smartreadiness

import "time"

type PublicFeeTerms struct {
	ConfirmedUnconditional bool      `json:"confirmed_unconditional"`
	VehicleID              int64     `json:"vehicle_id"`
	PlaceID                int64     `json:"place_id"`
	Subject                string    `json:"-"`
	PlaceUpdatedAt         time.Time `json:"place_updated_at"`
	Currency               string    `json:"currency"`
	FeePerMinuteMinor      int64     `json:"fee_per_minute_minor"`
	GraceS                 int       `json:"grace_s"`
	SourceURL              string    `json:"source_url"`
	ConfirmedAt            time.Time `json:"confirmed_at"`
	ValidUntil             time.Time `json:"valid_until"`
	PushDeviceID           *int64    `json:"push_device_id,omitempty"`
	PushTitle              string    `json:"-"`
	PushBody               string    `json:"-"`
}

type PublicFeeRecipient struct {
	Subject   string
	VehicleID int64
}

type PublicFeeSettings struct {
	Terms       *PublicFeeTerms `json:"terms"`
	NeedsReview bool           `json:"needs_review"`
}

type PublicChargeCompletion struct {
	SessionID   int64
	VehicleID   int64
	PlaceID     int64
	ChargingAt  time.Time
	CompletedAt time.Time
}

type PublicFeeDecision struct {
	Terms                PublicFeeTerms `json:"terms"`
	SessionID            int64          `json:"session_id"`
	CompletionObservedAt time.Time      `json:"completion_observed_at"`
	EarliestFeeStartsAt  time.Time      `json:"earliest_fee_starts_at"`
	ObservedAt           time.Time      `json:"observed_at"`
	ExpiresAt            time.Time      `json:"expires_at"`
}
