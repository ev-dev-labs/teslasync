// Package smartdelivery declares persistence boundaries for private delivery.
package smartdelivery

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
)

var (
	ErrNotFound = errors.New("personal delivery device not found")
	ErrOwned    = errors.New("personal delivery device belongs to another subject")
	ErrLimit    = errors.New("too many personal delivery devices")
)

type Repository interface {
	ListDevices(context.Context, string, int, int) ([]domain.Device, error)
	FindDevice(context.Context, string, []byte) (*domain.Device, error)
	SavePending(context.Context, string, []byte, string, []byte, time.Time, domain.Texts, time.Time) (*domain.Device, error)
	Verify(context.Context, string, int64, []byte, time.Time) (*domain.Notification, error)
	SetChargingEnabled(context.Context, string, int64, bool, time.Time) error
	DeleteDevice(context.Context, string, int64) error
	ListChargingDevices(context.Context, string) ([]int64, error)
	LockCharging(context.Context, domain.ChargingAttempt) (DispatchLease, error)
	FindDelivery(context.Context, string, []byte, time.Time) (*domain.DeliveryRef, error)
	ConsumeDelivery(context.Context, string, domain.DeliveryRef, time.Time) (*domain.Notification, error)
}

type DispatchLease interface {
	Ciphertext() string
	Reserve(context.Context, domain.ChargingAttempt) (bool, error)
	Finish(context.Context, []byte, domain.DeliveryStatus) error
	Close(context.Context) error
}

type CommuteRepository interface {
	SetCommuteEnabled(context.Context, string, int64, bool, domain.Copy, time.Time) error
	LockCommute(context.Context, string, domain.CommuteOccurrence, time.Time) (CommuteLease, error)
	FindCommuteDelivery(context.Context, string, []byte, time.Time) (*domain.CommuteDelivery, error)
	ConsumeCommuteDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
}

type CommuteLease interface {
	Candidate() domain.CommuteDelivery
	Ciphertext() string
	Reserve(context.Context, []byte, time.Time) (bool, error)
	Finish(context.Context, []byte, domain.DeliveryStatus) error
	Close(context.Context) error
}

type PublicFeeRepository interface {
	LockPublicFee(context.Context, domain.PublicFeeRef, time.Time) (PublicFeeLease, error)
	FindPublicFeeDelivery(context.Context, string, []byte, time.Time) (*domain.PublicFeeRef, error)
	ConsumePublicFeeDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
}

type PublicFeeLease interface {
	Ciphertext() string
	Reserve(context.Context, []byte, time.Time, time.Time) (bool, error)
	Finish(context.Context, []byte, domain.DeliveryStatus) error
	Close(context.Context) error
}
