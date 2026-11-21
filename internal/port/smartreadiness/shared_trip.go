package smartreadiness

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	MaxSharedTripPageSize   = 50
	MaxSharedTripPageOffset = 10000
)

// SharedTripRepository returns ErrNotFound for missing, unauthorized or
// superseded records, without distinguishing those cases to callers.
type SharedTripRepository interface {
	SaveSharedTrip(ctx context.Context, owner string, draft domain.SharedTripDraft, now time.Time) (*domain.SharedTrip, error)
	CancelSharedTrip(ctx context.Context, owner string, tripID, revision int64, now time.Time) error
	ListOwnedSharedTrips(ctx context.Context, owner string, now time.Time, limit, offset int) ([]domain.SharedTrip, error)
	ListSharedTripInvitations(ctx context.Context, subject string, now time.Time, limit, offset int) ([]domain.SharedTripInvitation, error)
	ConfirmSharedTripVehicle(ctx context.Context, subject string, key domain.SharedTripEntryKey, confirmation domain.SharedTripConfirmation) error
	WithdrawSharedTripVehicle(ctx context.Context, subject string, key domain.SharedTripEntryKey, now time.Time) error
	ReadSharedTripComparison(ctx context.Context, subject string, tripID int64, now time.Time) (*SharedTripComparisonScope, error)
}

// SharedTripComparisonScope is an internal, consistent snapshot, available only
// to a subject with a current confirmation on an active vehicle in the trip.
type SharedTripComparisonScope struct {
	Trip            domain.SharedTrip
	AccessExpiresAt time.Time
	Confirmed       []domain.SharedTripConfirmedVehicle
}
