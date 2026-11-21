// Package smartdelivery defines subject-scoped browser delivery.
package smartdelivery

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

type Device struct {
	ID              int64     `json:"id"`
	Verified        bool      `json:"verified"`
	ChargingEnabled bool      `json:"charging_enabled"`
	CommuteEnabled  bool      `json:"commute_enabled"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type Subscription struct {
	Endpoint string `json:"endpoint"`
	P256DH   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

type Texts struct {
	VerificationTitle string `json:"verification_title"`
	VerificationBody  string `json:"verification_body"`
	ChargingTitle     string `json:"charging_title"`
	ChargingBody      string `json:"charging_body"`
}

type Notification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

type DeviceSecret struct {
	ID                     int64
	Subject                string
	SubscriptionCiphertext string
}

type ChargingAttempt struct {
	Subject        string
	DeviceID       int64
	PlanID         int64
	VehicleID      int64
	PlanVersion    int64
	PlaceUpdatedAt time.Time
	DecisionKind   string
	InterruptedAt  *time.Time
	DepartureAt    time.Time
	TokenHash      []byte
	CreatedAt      time.Time
	ExpiresAt      time.Time
}

type DeliveryRef struct {
	ID             int64
	PlanID         int64
	VehicleID      int64
	PlanVersion    int64
	PlaceUpdatedAt time.Time
	DecisionKind   string
	InterruptedAt  *time.Time
}

type CommuteOccurrence struct {
	ConsentID   int64
	RoutineID   int64
	DepartureAt time.Time
}

type CommuteDelivery struct {
	Occurrence CommuteOccurrence
	VehicleID  int64
	Origin     smartcommute.Point
	ExpiresAt  time.Time
}

type PublicFeeRef struct {
	Subject        string
	DeviceID       int64
	VehicleID      int64
	PlaceID        int64
	SessionID      int64
	PlaceUpdatedAt time.Time
	ConfirmedAt    time.Time
	ExpiresAt      time.Time
}

type Copy struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type DeliveryStatus string

const (
	DeliveryAccepted DeliveryStatus = "accepted"
	DeliveryFailed   DeliveryStatus = "failed"
	DeliveryUnknown  DeliveryStatus = "unknown"
)
