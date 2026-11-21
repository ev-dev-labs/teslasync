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
	ConsumeDelivery(ctx context.Context, subject string, ref domain.DeliveryRef, deadline time.Time, clock func() time.Time) (*domain.Notification, error)
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
	Departed(context.Context, time.Time) (bool, error)
	Finish(context.Context, []byte, domain.DeliveryStatus) error
	Close(context.Context) error
}

type PublicFeeRepository interface {
	LockPublicFee(context.Context, domain.PublicFeeRef, time.Time) (PublicFeeLease, error)
	FindPublicFeeDelivery(context.Context, string, []byte, time.Time) (*domain.PublicFeeRef, error)
	ConsumePublicFeeDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
}

type PublicFeeLease = ExpiringDispatchLease

type ExpiringDispatchLease interface {
	Ciphertext() string
	Reserve(context.Context, []byte, time.Time, time.Time) (bool, error)
	Finish(context.Context, []byte, domain.DeliveryStatus) error
	Close(context.Context) error
}

type CabinPrepRepository interface {
	ListCabinPrepDeliveries(context.Context, time.Time, int) ([]domain.CabinPrepRef, error)
	LockCabinPrep(context.Context, domain.CabinPrepRef, time.Time) (ExpiringDispatchLease, error)
	FindCabinPrepDelivery(context.Context, string, []byte, time.Time) (*domain.CabinPrepRef, error)
	ConsumeCabinPrepDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
	PruneCabinPrepDeliveries(context.Context, time.Time) error
}

type ParkReserveRepository interface {
	ListParkReserveDeliveries(context.Context, time.Time, int) ([]domain.ParkReserveRef, error)
	LockParkReserve(context.Context, domain.ParkReserveRef, time.Time) (ExpiringDispatchLease, error)
	FindParkReserveDelivery(context.Context, string, []byte, time.Time) (*domain.ParkReserveRef, error)
	ConsumeParkReserveDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
	PruneParkReserveDeliveries(context.Context, time.Time) error
}

type WindowRainRepository interface {
	ListWindowRainDeliveries(context.Context, time.Time, int) ([]domain.WindowRainRef, error)
	LockWindowRain(context.Context, domain.WindowRainRef, time.Time) (ExpiringDispatchLease, error)
	FindWindowRainDelivery(context.Context, string, []byte, time.Time) (*domain.WindowRainRef, error)
	ConsumeWindowRainDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
	PruneWindowRainDeliveries(context.Context, time.Time) error
}

type ParkedClosureRepository interface {
	ListParkedClosureDeliveries(context.Context, time.Time, int) ([]domain.ParkedClosureRef, error)
	LockParkedClosure(context.Context, domain.ParkedClosureRef, time.Time) (ExpiringDispatchLease, error)
	FindParkedClosureDelivery(context.Context, string, []byte, time.Time) (*domain.ParkedClosureRef, error)
	ConsumeParkedClosureDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
	PruneParkedClosureDeliveries(context.Context, time.Time) error
}

type ParkedUnlockRepository interface {
	ListParkedUnlockDeliveries(context.Context, time.Time, int) ([]domain.ParkedUnlockRef, error)
	LockParkedUnlock(context.Context, domain.ParkedUnlockRef, time.Time) (ExpiringDispatchLease, error)
	FindParkedUnlockDelivery(context.Context, string, []byte, time.Time) (*domain.ParkedUnlockRef, error)
	ConsumeParkedUnlockDelivery(context.Context, string, []byte, time.Time) (*domain.Notification, error)
	PruneParkedUnlockDeliveries(context.Context, time.Time) error
}
